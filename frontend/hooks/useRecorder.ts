"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickRecordingMimeType, extensionForMime } from "@/lib/mime";
import { avatarGradient, formatClock, initials } from "@/lib/format";
import type { MediaState, ParticipantInfo } from "@/types";

export interface RecordingOutput {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  sizeBytes: number;
  fileName: string;
}

interface Options {
  localStream: MediaStream | null;
  localScreenStream?: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  participants: Record<string, ParticipantInfo>;
  selfName: string;
  meetingId: string | null;
  roomId: string;
  meetingTitle: string;
  onComplete: (output: RecordingOutput) => void | Promise<void>;
}

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 12;

/**
 * Whole-meeting local recording. Remote audio is mixed through WebAudio, and
 * video is rendered to a canvas because MediaRecorder cannot record a mesh of
 * streams directly. Nothing is uploaded; the blob is handed to the caller.
 */
export function useRecorder(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastOutput, setLastOutput] = useState<RecordingOutput | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureTrackRef = useRef<CanvasCaptureMediaStreamTrack | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioSourcesRef = useRef<Map<string, MediaStreamAudioSourceNode>>(new Map());
  const keepAliveRef = useRef<OscillatorNode | null>(null);
  const videosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  const recordedMsRef = useRef(0);
  const mimeRef = useRef("");
  const recordingRef = useRef(false);
  const pausedRef = useRef(false);

  const remoteStreamsRef = useRef(options.remoteStreams);
  const participantsRef = useRef(options.participants);
  const localStreamRef = useRef(options.localStream);
  const localScreenStreamRef = useRef(options.localScreenStream ?? null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  remoteStreamsRef.current = options.remoteStreams;
  participantsRef.current = options.participants;
  localStreamRef.current = options.localStream;
  localScreenStreamRef.current = options.localScreenStream ?? null;

  const clearResources = useCallback(() => {
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;

    for (const source of audioSourcesRef.current.values()) {
      try {
        source.disconnect();
      } catch {
        // ignore
      }
    }
    audioSourcesRef.current.clear();
    localAudioStreamRef.current = null;
    const keepAlive = keepAliveRef.current;
    keepAliveRef.current = null;
    if (keepAlive) {
      try {
        keepAlive.stop();
        keepAlive.disconnect();
      } catch {
        // already stopped
      }
    }

    for (const video of videosRef.current.values()) {
      video.pause();
      video.srcObject = null;
    }
    videosRef.current.clear();

    canvasRef.current?.remove();
    const context = audioContextRef.current;
    audioContextRef.current = null;
    destinationRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    canvasRef.current = null;
    captureTrackRef.current = null;
  }, []);

  const syncMedia = useCallback(() => {
    const context = audioContextRef.current;
    const destination = destinationRef.current;
    if (!context || !destination) return;

    const streams = remoteStreamsRef.current;
    for (const [participantId, stream] of Object.entries(streams)) {
      if (!videosRef.current.has(participantId)) {
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
        videosRef.current.set(participantId, video);
      }
      if (!audioSourcesRef.current.has(participantId)) {
        try {
          const source = context.createMediaStreamSource(stream);
          source.connect(destination);
          audioSourcesRef.current.set(participantId, source);
        } catch {
          // Stream may have no audio track.
        }
      }
    }

    for (const [participantId, video] of Array.from(videosRef.current.entries())) {
      if (!(participantId in streams)) {
        video.pause();
        video.srcObject = null;
        videosRef.current.delete(participantId);
      }
    }
    for (const [participantId, source] of Array.from(audioSourcesRef.current.entries())) {
      if (!(participantId in streams)) {
        try {
          source.disconnect();
        } catch {
          // ignore
        }
        audioSourcesRef.current.delete(participantId);
      }
    }

    const local = localStreamRef.current;
    if (local && localAudioStreamRef.current !== local) {
      const previous = audioSourcesRef.current.get("self");
      if (previous) {
        try {
          previous.disconnect();
        } catch {
          // ignore
        }
        audioSourcesRef.current.delete("self");
      }
      if (local.getAudioTracks().length > 0) {
        try {
          const source = context.createMediaStreamSource(local);
          source.connect(destination);
          audioSourcesRef.current.set("self", source);
          localAudioStreamRef.current = local;
        } catch {
          // Stream may have no usable audio track.
        }
      }
    }

    const localVisual = localScreenStreamRef.current ?? local;
    const localVideo = videosRef.current.get("self");
    if (localVideo && localVideo.srcObject !== localVisual) {
      localVideo.srcObject = localVisual;
      if (localVisual) void localVideo.play().catch(() => undefined);
    }
  }, []);

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const participants = participantsRef.current;
    const localStream = localStreamRef.current;
    const selfName = optionsRef.current.selfName;

    const tiles: Array<{
      id: string;
      name: string;
      video: HTMLVideoElement | undefined;
      media: MediaState;
    }> = [];

    tiles.push({
      id: "self",
      name: `${selfName} (you)`,
      video: videosRef.current.get("self"),
      media: {
        audio: Boolean(localStream?.getAudioTracks()[0]?.enabled),
        video: Boolean(localStream?.getVideoTracks()[0]?.enabled),
        screen: Boolean(localScreenStreamRef.current),
      },
    });
    for (const participant of Object.values(participants)) {
      tiles.push({
        id: participant.participantId,
        name: participant.name,
        video: videosRef.current.get(participant.participantId),
        media: participant.media,
      });
    }

    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, "#0b0f18");
    background.addColorStop(1, "#111726");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const count = tiles.length;
    const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    const rows = Math.ceil(count / columns);
    const gap = 14;
    const tileWidth = (WIDTH - gap * (columns + 1)) / columns;
    const tileHeight = (HEIGHT - gap * (rows + 1)) / rows;

    tiles.forEach((tile, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = gap + column * (tileWidth + gap);
      const y = gap + row * (tileHeight + gap);
      const radius = 18;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, tileWidth, tileHeight, radius);
      ctx.clip();

      const video = tile.video;
      const hasVideo =
        (tile.media.video || tile.media.screen) &&
        video &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0;

      if (hasVideo && video) {
        const scale = tile.media.screen
          ? Math.min(tileWidth / video.videoWidth, tileHeight / video.videoHeight)
          : Math.max(tileWidth / video.videoWidth, tileHeight / video.videoHeight);
        const drawWidth = video.videoWidth * scale;
        const drawHeight = video.videoHeight * scale;
        if (tile.media.screen) {
          ctx.fillStyle = "#06080f";
          ctx.fillRect(x, y, tileWidth, tileHeight);
        }
        ctx.drawImage(
          video,
          x + (tileWidth - drawWidth) / 2,
          y + (tileHeight - drawHeight) / 2,
          drawWidth,
          drawHeight,
        );
      } else {
        const gradient = ctx.createLinearGradient(x, y, x + tileWidth, y + tileHeight);
        gradient.addColorStop(0, "#1b2337");
        gradient.addColorStop(1, "#0e1320");
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, tileWidth, tileHeight);

        const colors = avatarGradient(tile.name);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.arc(x + tileWidth / 2, y + tileHeight / 2 - 10, 54, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#cbd3e8";
        ctx.font = "600 40px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(tile.name), x + tileWidth / 2, y + tileHeight / 2 - 10);
        void colors;
      }

      const labelGradient = ctx.createLinearGradient(0, y + tileHeight - 70, 0, y + tileHeight);
      labelGradient.addColorStop(0, "rgba(0,0,0,0)");
      labelGradient.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = labelGradient;
      ctx.fillRect(x, y + tileHeight - 70, tileWidth, 70);

      ctx.fillStyle = "#e8ebf5";
      ctx.font = "600 22px Inter, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(tile.name.slice(0, 42), x + 18, y + tileHeight - 20);

      if (tile.media.screen) {
        ctx.fillStyle = "rgba(108,92,231,0.85)";
        ctx.beginPath();
        ctx.roundRect(x + tileWidth - 128, y + 14, 114, 30, 8);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "600 15px Inter, sans-serif";
        ctx.fillText("Screen", x + tileWidth - 116, y + 35);
      }

      ctx.restore();
    });

    ctx.fillStyle = "rgba(248,113,113,0.95)";
    ctx.beginPath();
    ctx.arc(34, 34, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8ebf5";
    ctx.font = "600 20px Inter, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(
      `${formatClock(Math.floor((Date.now() - startedAtRef.current + accumulatedRef.current) / 1000))} REC`,
      50,
      41,
    );

    // Ask the canvas capture track for this frame explicitly. Browser
    // compositors stop producing frames for hidden tabs, which otherwise
    // leaves MediaRecorder with no video keyframe and therefore no output.
    try {
      captureTrackRef.current?.requestFrame();
    } catch {
      // Track may have just ended.
    }
  }, []);

  const loop = useCallback(() => {
    drawFrame();
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    // Do not rely on requestAnimationFrame: browsers stop it when the tab is
    // hidden, which starves canvas.captureStream and can leave MediaRecorder
    // with no video frames (and therefore no muxed output at all).
    frameTimerRef.current = setInterval(drawFrame, Math.max(1, Math.round(1000 / FPS)));
  }, [drawFrame]);

  const start = useCallback(async () => {
    if (recordingRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      setError("This browser does not support MediaRecorder, so recording is unavailable.");
      return;
    }
    const local = localStreamRef.current ?? optionsRef.current.localStream;
    if (!local) {
      setError("A camera or microphone stream is required to start recording.");
      return;
    }

    setError(null);
    chunksRef.current = [];
    try {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      // Chrome only reliably delivers CanvasCaptureMediaStreamTrack frames and
      // MediaRecorder timeslices for a canvas that is part of the document.
      // Keep it off-screen so it never affects the meeting UI.
      canvas.style.cssText =
        "position:fixed;left:-20000px;top:0;width:1280px;height:720px;pointer-events:none;";
      canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(canvas);
      canvasRef.current = canvas;
      // captureStream(0) disables automatic frame capture: every frame is
      // delivered explicitly via requestFrame() from our draw loop. With an
      // auto-capturing stream the first canvas frame can be sampled before
      // recorder.start(), so the encoder never sees a first keyframe and
      // MediaRecorder buffers nothing until stop() — a pause/resume in that
      // window produced empty recordings.
      const canvasStream = canvas.captureStream(0);
      captureTrackRef.current =
        (canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined) ?? null;

      const AudioContextClass =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("WebAudio is not supported in this browser.");
      const context = new AudioContextClass({ latencyHint: "interactive" });
      audioContextRef.current = context;
      if (context.state === "suspended") await context.resume();
      const destination = context.createMediaStreamDestination();
      destinationRef.current = destination;
      // MediaStreamAudioDestinationNode can stop delivering samples when every
      // connected source is momentarily silent or stalled. MediaRecorder then
      // waits forever for audio and emits no chunks at all. A sub-audible
      // oscillator keeps the destination track alive for the whole recording.
      try {
        const keepAlive = context.createOscillator();
        keepAlive.frequency.value = 20;
        const keepAliveGain = context.createGain();
        keepAliveGain.gain.value = 0.00001;
        keepAlive.connect(keepAliveGain);
        keepAliveGain.connect(destination);
        keepAlive.start();
        keepAliveRef.current = keepAlive;
      } catch (error) {
        console.warn("[recorder] keep-alive audio source failed", error);
      }

      const localVideo = document.createElement("video");
      localVideo.muted = true;
      localVideo.playsInline = true;
      localVideo.autoplay = true;
      localVideo.srcObject = local;
      void localVideo.play().catch(() => undefined);
      videosRef.current.set("self", localVideo);

      syncMedia();

      const combined = new MediaStream();
      canvasStream.getVideoTracks().forEach((track) => combined.addTrack(track));
      destination.stream.getAudioTracks().forEach((track) => combined.addTrack(track));

      const mimeType = pickRecordingMimeType();
      mimeRef.current = mimeType;
      const recorder = new MediaRecorder(combined, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 128_000,
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.addEventListener("error", (event) => {
        const failure = (event as Event & { error?: DOMException }).error;
        const message = failure?.message ?? "The browser stopped the recording unexpectedly.";
        setError(`Recording failed: ${message}`);
        clearResources();
        recordingRef.current = false;
        pausedRef.current = false;
        setRecording(false);
        setPaused(false);
      });

      recorder.onstop = () => {
        const type = mimeRef.current || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        const sizeBytes = blob.size;
        chunksRef.current = [];
        const durationSec = Math.max(1, Math.round(recordedMsRef.current / 1000));
        const base = optionsRef.current.meetingTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48) || "meeting";
        const fileName = `${base}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extensionForMime(type)}`;

        clearResources();
        recordingRef.current = false;
        pausedRef.current = false;
        setRecording(false);
        setPaused(false);

        if (sizeBytes > 0) {
          const output: RecordingOutput = { blob, mimeType: type, sizeBytes, durationSec, fileName };
          setPreviewUrl((previous) => {
            if (previous) URL.revokeObjectURL(previous);
            return URL.createObjectURL(blob);
          });
          setLastOutput(output);
          void Promise.resolve(optionsRef.current.onComplete(output)).catch(() => undefined);
        } else {
          setError(
            "The browser did not produce any media for this recording. Check that your microphone and camera are available, then try again.",
          );
        }
      };

      recorder.start(1000);
      recordingRef.current = true;
      pausedRef.current = false;
      startedAtRef.current = Date.now();
      accumulatedRef.current = 0;
      recordedMsRef.current = 0;
      setRecording(true);
      setPaused(false);
      setElapsed(0);

      timerRef.current = setInterval(() => {
        if (pausedRef.current) return;
        const ms = Date.now() - startedAtRef.current + accumulatedRef.current;
        recordedMsRef.current = ms;
        setElapsed(Math.floor(ms / 1000));
      }, 1000);

      loop();
    } catch (err) {
      clearResources();
      setError(err instanceof Error ? err.message : "Could not start recording.");
      setRecording(false);
      recordingRef.current = false;
    }
  }, [clearResources, loop, syncMedia]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (!pausedRef.current) {
      recordedMsRef.current = Date.now() - startedAtRef.current + accumulatedRef.current;
    }
    try {
      recorder.stop();
    } catch {
      clearResources();
      setRecording(false);
      recordingRef.current = false;
    }
    recorderRef.current = null;
  }, [clearResources]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.pause();
    pausedRef.current = true;
    accumulatedRef.current += Date.now() - startedAtRef.current;
    recordedMsRef.current = accumulatedRef.current;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    recorder.resume();
    pausedRef.current = false;
    startedAtRef.current = Date.now();
    setPaused(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    syncMedia();
  }, [
    options.remoteStreams,
    options.participants,
    options.localStream,
    options.localScreenStream,
    recording,
    syncMedia,
  ]);

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      clearResources();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    recording,
    paused,
    elapsed,
    error,
    previewUrl,
    lastOutput,
    start,
    stop,
    pause,
    resume,
    setError,
  };
}
