#!/usr/bin/env node
/**
 * Local end-to-end verification (no mocks).
 *
 * Requires: MongoDB, backend (:5000), transcription (:8000), Ollama with the
 * configured model, and a 16 kHz mono PCM16 file containing real speech.
 *
 * Usage:
 *   node scripts/verify-local.mjs
 *   AURALIS_VERIFY_PCM=C:\path\speech-16k.pcm node scripts/verify-local.mjs
 *
 * The script:
 *   - registers a fresh account and creates a real meeting
 *   - joins with an authenticated host and a signed guest
 *   - verifies presence, media-state and recording-state signaling
 *   - streams real speech through the live faster-whisper path
 *   - verifies chat persistence and recording metadata
 *   - ends the meeting and waits for the automatic Ollama final summary
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const BASE = process.env.AURALIS_BACKEND_URL ?? "http://127.0.0.1:5000";
const WS_URL = BASE.replace(/^http/, "ws") + "/ws";
const PCM_PATH =
  process.env.AURALIS_VERIFY_PCM ??
  path.join(os.tmpdir(), "auralis-test-16k.pcm");
const FRAME_BYTES = 3200; // 100 ms of 16 kHz mono PCM16
const HOST_NAME = "Verification Host";
const GUEST_NAME = "Guest Verifier";
const PASSWORD = "AuralisVerify!2026";

const results = {
  signaling: false,
  liveTranscription: false,
  provisionalTranscript: false,
  chat: false,
  recordingMetadata: false,
  meetingHistory: false,
  finalSummary: false,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(message) {
  throw new Error(message);
}

async function request(endpoint, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // keep text for diagnostics
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  if (!response.ok) {
    fail(
      `${method} ${endpoint} failed with HTTP ${response.status}: ${text.slice(0, 800)}`,
    );
  }
  return { json, text, setCookies };
}

function cookieValue(setCookies, name) {
  for (const header of setCookies) {
    const first = header.split(";")[0].trim();
    if (first.startsWith(`${name}=`)) return first;
  }
  return null;
}

function connect(cookie) {
  const socket = new WebSocket(WS_URL, { headers: { Cookie: cookie } });
  const events = [];
  const waiters = [];
  let closeInfo = null;

  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("unexpected-response", (_request, response) =>
      reject(new Error(`WebSocket upgrade rejected: HTTP ${response.statusCode}`)),
    );
    socket.once("error", reject);
  });

  socket.on("message", (raw, isBinary) => {
    if (isBinary) return;
    let event;
    try {
      event = JSON.parse(raw.toString());
    } catch {
      return;
    }
    events.push(event);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timer);
        waiters.splice(index, 1);
        waiter.resolve(event);
      }
    }
  });

  socket.on("close", (code, reason) => {
    closeInfo = { code, reason: reason.toString() };
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error(
          `WebSocket closed while waiting for ${waiter.label} (${code} ${reason.toString()})`,
        ),
      );
    }
  });
  socket.on("error", () => undefined);

  function waitFor(predicate, label, timeoutMs = 30_000, from = 0) {
    for (let index = from; index < events.length; index += 1) {
      if (predicate(events[index])) return Promise.resolve(events[index]);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        label,
        from,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index !== -1) waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${label}`));
        }, timeoutMs),
      };
      waiter.timer.unref?.();
      waiters.push(waiter);
    });
  }

  function send(payload) {
    if (socket.readyState !== WebSocket.OPEN) {
      fail(`Cannot send ${payload.type}: WebSocket is not open`);
    }
    socket.send(JSON.stringify(payload));
  }

  return {
    socket,
    events,
    get closeInfo() {
      return closeInfo;
    },
    opened,
    waitFor,
    send,
    close() {
      try {
        socket.close();
      } catch {
        // ignore
      }
    },
  };
}

function eventOfType(client, type) {
  return client.events.filter((event) => event.type === type);
}

function transcriptSegments(client) {
  return eventOfType(client, "TRANSCRIPT_UPDATE").map((event) => event.segment);
}

async function waitForFinalTranscript(client, since, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const finals = transcriptSegments(client)
      .slice(since)
      .filter((segment) => segment.status === "final");
    if (finals.length > 0) return finals;
    await sleep(1000);
  }
  throw new Error("No final transcript segments arrived from the live stream");
}

/** Waits until the transcript event count has been stable for a full quiet period. */
async function waitForTranscriptIdle(client, quietMs = 8000, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let previous = transcriptSegments(client).length;
  while (Date.now() < deadline) {
    await sleep(quietMs);
    const current = transcriptSegments(client).length;
    if (current === previous) return;
    previous = current;
  }
  throw new Error("Transcript did not become idle before timeout");
}

async function sendAudioRealtime(client, pcm) {
  const frames = Math.ceil(pcm.length / FRAME_BYTES);
  for (let index = 0; index < frames; index += 1) {
    const frame = pcm.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES);
    if (frame.length === 0) break;
    client.socket.send(frame, { binary: true });
    await sleep(100);
  }
}

async function main() {
  if (!fs.existsSync(PCM_PATH)) {
    fail(
      `Missing PCM fixture at ${PCM_PATH}. Provide 16 kHz mono PCM16 speech via AURALIS_VERIFY_PCM.`,
    );
  }
  const pcm = fs.readFileSync(PCM_PATH);
  if (pcm.length < 16_000 * 2 * 2) {
    fail("PCM fixture must contain at least two seconds of audio");
  }

  const health = (await request("/api/health")).json;
  if (!health?.ok) fail(`Local stack is not healthy: ${JSON.stringify(health)}`);
  console.log("Health OK:", {
    transcription: health.services.transcription,
    ollama: health.services.ollama.modelAvailable,
  });

  // 1. Authentication + meeting creation.
  const email = `verify-${Date.now()}@auralis.local`;
  const registered = await request("/api/auth/register", {
    method: "POST",
    body: { name: HOST_NAME, email, password: PASSWORD },
  });
  const authCookie = cookieValue(registered.setCookies, "auth_token");
  if (!authCookie) fail("Registration did not set auth_token");
  const me = await request("/api/auth/me", { cookie: authCookie });
  if (me.json?.user?.name !== HOST_NAME) fail("Cookie session did not resolve the user");

  const title = `Verification meeting ${new Date().toISOString()}`;
  const created = await request("/api/meetings", {
    method: "POST",
    cookie: authCookie,
    body: { title },
  });
  const meeting = created.json.meeting;
  if (!meeting?.id || !meeting?.roomId) fail("Meeting creation returned no id/roomId");

  const publicRoom = await request(`/api/meetings/room/${meeting.roomId}`);
  if (!publicRoom.json?.room?.roomId) fail("Public room lookup failed");
  console.log("Meeting created:", { id: meeting.id, roomId: meeting.roomId });

  // 2. Guest pass scoped to this room.
  const guestPass = await request("/api/auth/guest", {
    method: "POST",
    cookie: authCookie,
    body: { roomId: meeting.roomId, name: GUEST_NAME },
  });
  const guestCookie = cookieValue(guestPass.setCookies, "guest_token");
  if (!guestCookie) fail("Guest endpoint did not set guest_token");

  // 3. Host joins.
  const host = connect(authCookie);
  await host.opened;
  host.send({ type: "JOIN_ROOM", roomId: meeting.roomId });
  const hostJoined = await host.waitFor(
    (event) => event.type === "ROOM_JOINED",
    "host ROOM_JOINED",
    30_000,
  );
  if (hostJoined.self.name !== HOST_NAME) fail("Host identity was not server-derived");
  console.log("Host joined:", hostJoined.self.participantId);

  // 4. Guest joins and presence/roles are server-derived.
  const guest = connect(guestCookie);
  await guest.opened;
  const guestSince = guest.events.length;
  const hostPeerSince = host.events.length;
  guest.send({ type: "JOIN_ROOM", roomId: meeting.roomId });
  const guestJoined = await guest.waitFor(
    (event) => event.type === "ROOM_JOINED",
    "guest ROOM_JOINED",
    30_000,
    guestSince,
  );
  if (guestJoined.self.name !== GUEST_NAME) fail("Guest display name was not server-derived");
  const guestSeesHost = guestJoined.participants.find(
    (participant) => participant.name === HOST_NAME,
  );
  if (!guestSeesHost?.isHost) fail("Guest did not see the host role in presence");
  const peerJoined = await host.waitFor(
    (event) => event.type === "PEER_JOINED",
    "host PEER_JOINED",
    30_000,
    hostPeerSince,
  );
  if (peerJoined.participant.name !== GUEST_NAME) fail("Host did not see the guest join");
  results.signaling = true;
  console.log("Presence OK: host + guest, host role verified");

  // 5. Media and recording state signaling.
  const mediaSince = host.events.length;
  guest.send({
    type: "MEDIA_STATE",
    media: { audio: false, video: false, screen: false },
  });
  await host.waitFor(
    (event) =>
      event.type === "MEDIA_STATE" &&
      event.participantId === guestJoined.self.participantId &&
      event.media.audio === false,
    "guest MEDIA_STATE",
    15_000,
    mediaSince,
  );

  const recordingSince = host.events.length;
  guest.send({ type: "RECORDING_STATE", state: "recording" });
  await host.waitFor(
    (event) =>
      event.type === "RECORDING_STATE" &&
      event.participantId === guestJoined.self.participantId &&
      event.state === "recording",
    "guest RECORDING_STATE",
    15_000,
    recordingSince,
  );
  guest.send({ type: "RECORDING_STATE", state: "off" });
  console.log("Media and recording state signaling OK");

  // 6. Chat persistence through the live socket.
  const chatSince = host.events.length;
  const chatText = `Live verification message ${Date.now()}`;
  guest.send({ type: "CHAT_MESSAGE", message: chatText });
  const chatEvent = await host.waitFor(
    (event) => event.type === "CHAT_MESSAGE" && event.message.message === chatText,
    "guest chat broadcast",
    15_000,
    chatSince,
  );
  if (chatEvent.message.senderName !== GUEST_NAME) fail("Chat sender attribution is wrong");
  results.chat = true;
  console.log("Chat OK:", chatText);

  // 7. Real speech through the browser -> backend -> faster-whisper path.
  const audioStartSince = host.events.length;
  host.send({ type: "AUDIO_START", sampleRate: 16000 });
  await host.waitFor(
    (event) =>
      event.type === "TRANSCRIPTION_STATUS" &&
      event.participantId === hostJoined.self.participantId &&
      event.state === "active",
    "transcription active",
    60_000,
    audioStartSince,
  );

  const transcriptSince = transcriptSegments(host).length;
  console.log(`Streaming ${(pcm.length / 32000).toFixed(1)}s of real speech at real time...`);
  await sendAudioRealtime(host, pcm);
  host.send({ type: "AUDIO_STOP" });

  await waitForFinalTranscript(host, transcriptSince, 120_000);
  await waitForTranscriptIdle(host);
  const allSegments = transcriptSegments(host).slice(transcriptSince);
  const finals = allSegments.filter((segment) => segment.status === "final");
  if (!allSegments.some((segment) => segment.status === "provisional")) {
    console.warn("Warning: no provisional transcript was observed (final text still verified)");
  } else {
    results.provisionalTranscript = true;
  }
  if (!finals.some((segment) => segment.speakerName === HOST_NAME)) {
    fail("Transcript speaker attribution is missing or wrong");
  }
  const joinedTranscript = finals.map((segment) => segment.text).join(" ");
  if (!joinedTranscript.trim()) fail("Transcript text is empty");
  if (finals.length < 2) {
    fail(`Expected the full speech to produce multiple segments, got ${finals.length}`);
  }
  results.liveTranscription = true;
  console.log("Live transcript OK:", joinedTranscript);
  console.log(
    `Provisional updates: ${allSegments.filter((s) => s.status === "provisional").length}`,
  );

  // 8. Recording metadata only (the file would live in IndexedDB in the UI).
  const recording = await request(`/api/meetings/${meeting.id}/recordings`, {
    method: "POST",
    cookie: authCookie,
    body: {
      fileName: "verification-local-recording.webm",
      mimeType: "video/webm",
      sizeBytes: 123456,
      durationSec: 9,
    },
  });
  if (!recording.json?.recording?.id) fail("Recording metadata was not stored");
  const recordings = await request(`/api/meetings/${meeting.id}/recordings`, {
    cookie: authCookie,
  });
  if (
    !recordings.json.recordings.some(
      (item) => item.fileName === "verification-local-recording.webm" && item.storedLocally,
    )
  ) {
    fail("Recording metadata was not returned with storedLocally");
  }
  results.recordingMetadata = true;
  console.log("Recording metadata OK (no media uploaded)");

  // 9. Guest leaves, host ends the meeting for everyone.
  const peerLeftSince = host.events.length;
  guest.send({ type: "LEAVE_ROOM" });
  await host.waitFor(
    (event) =>
      event.type === "PEER_LEFT" &&
      event.participantId === guestJoined.self.participantId,
    "guest PEER_LEFT",
    15_000,
    peerLeftSince,
  );
  guest.close();

  const endedSince = host.events.length;
  const ended = await request(`/api/meetings/${meeting.id}/end`, {
    method: "POST",
    cookie: authCookie,
  });
  if (ended.json?.meeting?.status !== "ended") fail("Meeting did not end");
  await host.waitFor(
    (event) => event.type === "MEETING_ENDED",
    "MEETING_ENDED broadcast",
    30_000,
    endedSince,
  );
  console.log("Meeting ended; waiting for automatic final Ollama summary...");

  // 10. Automatic final summary, produced from the persisted transcript.
  const deadline = Date.now() + 12 * 60_000;
  let summaryPayload = null;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const response = await request(`/api/meetings/${meeting.id}/summary`, {
      cookie: authCookie,
    });
    lastStatus = {
      summaryStatus: response.json.meeting.summaryStatus,
      transcriptionStatus: response.json.meeting.transcriptionStatus,
      summary: response.json.summary?.status ?? null,
    };
    if (response.json.summary?.status === "final") {
      summaryPayload = response.json.summary;
      break;
    }
    if (
      response.json.summary?.status === "failed" ||
      response.json.meeting.summaryStatus === "failed"
    ) {
      fail(
        `Final summary failed: ${
          response.json.summary?.error ?? response.json.meeting.summaryError
        }`,
      );
    }
    await sleep(2500);
  }
  if (!summaryPayload) {
    fail(`Final summary was not ready before timeout; last status ${JSON.stringify(lastStatus)}`);
  }
  if (!summaryPayload.executiveSummary?.trim()) fail("Summary executive summary is empty");
  if (!summaryPayload.model) fail("Summary did not record the Ollama model");
  if (summaryPayload.basedOnSegmentCount < 1) fail("Summary did not use transcript segments");
  results.finalSummary = true;

  // 11. Transcript, chat, history and detail persistence.
  const transcript = await request(`/api/meetings/${meeting.id}/transcript`, {
    cookie: authCookie,
  });
  const persisted = transcript.json.transcript?.segments ?? [];
  if (!persisted.some((segment) => segment.speakerName === HOST_NAME)) {
    fail("Persisted transcript is missing host segments");
  }
  const chat = await request(`/api/meetings/${meeting.id}/chat`, { cookie: authCookie });
  if (!chat.json.messages.some((message) => message.message === chatText)) {
    fail("Chat message was not persisted");
  }
  const detail = await request(`/api/meetings/${meeting.id}`, { cookie: authCookie });
  if (detail.json.meeting.status !== "ended") fail("Meeting detail is not ended");
  const history = await request(
    `/api/meetings?search=${encodeURIComponent(title.slice(0, 24))}`,
    { cookie: authCookie },
  );
  if (!history.json.meetings.some((item) => item._id === meeting.id)) {
    fail("Meeting history search did not return the meeting");
  }
  const transcriptList = await request("/api/transcripts", { cookie: authCookie });
  if (!transcriptList.json.meetings.some((item) => item._id === meeting.id)) {
    fail("Transcript browser did not return the meeting");
  }
  results.meetingHistory = true;

  console.log("\nFINAL SUMMARY");
  console.log("--------------");
  console.log(summaryPayload.executiveSummary);
  console.log("Key points:", summaryPayload.keyPoints);
  console.log("Decisions:", summaryPayload.decisions);
  console.log("Action items:", summaryPayload.actionItems);
  console.log("Moments:", summaryPayload.importantMoments);
  console.log("Open questions:", summaryPayload.openQuestions);
  console.log("Model:", summaryPayload.model, "| segments:", summaryPayload.basedOnSegmentCount);

  console.log("\nVERIFICATION RESULTS");
  console.log(JSON.stringify(results, null, 2));
  console.log("All checks passed.");
  host.close();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nVERIFICATION FAILED");
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  });
