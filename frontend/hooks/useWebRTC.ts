"use client";

import { useCallback, useEffect, useRef } from "react";
import { iceServers } from "@/lib/api";
import type { ParticipantInfo } from "@/types";

type SendFn = (event: Record<string, unknown>) => boolean;

interface PeerEntry {
  pc: RTCPeerConnection;
  pendingIce: RTCIceCandidateInit[];
  remoteStream: MediaStream;
}

interface Options {
  send: SendFn;
  onRemoteStream: (participantId: string, stream: MediaStream | null) => void;
  onPeerState: (participantId: string, state: RTCPeerConnectionState) => void;
}

/**
 * Mesh WebRTC: one RTCPeerConnection per remote participant.
 * The participant who just joined initiates offers to everyone already there,
 * which avoids offer glare without needing perfect negotiation.
 */
export function useWebRTC(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const selfIdRef = useRef<string | null>(null);

  const outgoingTracks = useCallback((): MediaStreamTrack[] => {
    const tracks: MediaStreamTrack[] = [];
    const audio = localStreamRef.current?.getAudioTracks()[0];
    if (audio) tracks.push(audio);
    const video = screenTrackRef.current ?? cameraTrackRef.current;
    if (video) tracks.push(video);
    return tracks;
  }, []);

  const transceiverForKind = (pc: RTCPeerConnection, kind: "audio" | "video") =>
    pc.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === kind) ?? null;

  const removePeer = useCallback((participantId: string, notify = true) => {
    const entry = peersRef.current.get(participantId);
    if (!entry) return;
    try {
      entry.pc.onicecandidate = null;
      entry.pc.ontrack = null;
      entry.pc.onconnectionstatechange = null;
      entry.pc.close();
    } catch {
      // ignore
    }
    peersRef.current.delete(participantId);
    if (notify) optionsRef.current.onRemoteStream(participantId, null);
  }, []);

  const closeAll = useCallback(() => {
    for (const id of Array.from(peersRef.current.keys())) {
      removePeer(id, true);
    }
  }, [removePeer]);

  const createPeer = useCallback(
    (participantId: string): PeerEntry => {
      const existing = peersRef.current.get(participantId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({
        iceServers: iceServers(),
        bundlePolicy: "max-bundle",
      });
      const remoteStream = new MediaStream();
      const entry: PeerEntry = { pc, pendingIce: [], remoteStream };
      peersRef.current.set(participantId, entry);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          optionsRef.current.send({
            type: "ICE_CANDIDATE",
            to: participantId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) {
          entry.remoteStream = stream;
        } else {
          entry.remoteStream.addTrack(event.track);
        }
        optionsRef.current.onRemoteStream(participantId, entry.remoteStream);
      };

      pc.onconnectionstatechange = () => {
        optionsRef.current.onPeerState(participantId, pc.connectionState);
        if (pc.connectionState === "failed") {
          try {
            pc.restartIce();
          } catch {
            // ignore
          }
        }
      };

      const fallbackStream = localStreamRef.current ?? new MediaStream();
      const audioTrack = fallbackStream.getAudioTracks()[0] ?? null;
      const videoTrack = screenTrackRef.current ?? fallbackStream.getVideoTracks()[0] ?? null;
      if (audioTrack) {
        try {
          pc.addTrack(audioTrack, fallbackStream);
        } catch {
          // Track may already be ended.
        }
      } else {
        pc.addTransceiver("audio", { direction: "recvonly" });
      }
      if (videoTrack) {
        try {
          pc.addTrack(videoTrack, fallbackStream);
        } catch {
          // Track may already be ended.
        }
      } else {
        pc.addTransceiver("video", { direction: "recvonly" });
      }

      return entry;
    },
    [outgoingTracks],
  );

  const makeOffer = useCallback(async (participantId: string) => {
    const entry = peersRef.current.get(participantId);
    if (!entry) return;
    try {
      const offer = await entry.pc.createOffer();
      await entry.pc.setLocalDescription(offer);
      optionsRef.current.send({
        type: "OFFER",
        to: participantId,
        sdp: entry.pc.localDescription?.sdp ?? offer.sdp,
      });
    } catch {
      optionsRef.current.onPeerState(participantId, "failed");
    }
  }, []);

  const flushIce = useCallback(async (entry: PeerEntry) => {
    while (entry.pendingIce.length > 0) {
      const candidate = entry.pendingIce.shift();
      if (!candidate) continue;
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        // ignore stale candidates
      }
    }
  }, []);

  const handleRoomJoined = useCallback(
    (payload: {
      self: ParticipantInfo;
      participants: ParticipantInfo[];
      initiateTo: string[];
    }) => {
      selfIdRef.current = payload.self.participantId;
      closeAll();
      for (const participant of payload.participants) {
        createPeer(participant.participantId);
      }
      for (const id of payload.initiateTo) {
        void makeOffer(id);
      }
    },
    [closeAll, createPeer, makeOffer],
  );

  const handlePeerJoined = useCallback(
    (participant: ParticipantInfo) => {
      removePeer(participant.participantId, false);
      createPeer(participant.participantId);
    },
    [createPeer, removePeer],
  );

  const handleOffer = useCallback(
    async (from: string, sdp: string) => {
      const entry = createPeer(from);
      const pc = entry.pc;
      if (pc.signalingState !== "stable") {
        const polite = (selfIdRef.current ?? "") > from;
        if (!polite) return;
        try {
          await pc.setLocalDescription({ type: "rollback" });
        } catch {
          // ignore
        }
      }
      try {
        await pc.setRemoteDescription({ type: "offer", sdp });
        await flushIce(entry);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        optionsRef.current.send({
          type: "ANSWER",
          to: from,
          sdp: pc.localDescription?.sdp ?? answer.sdp,
        });
      } catch {
        optionsRef.current.onPeerState(from, "failed");
      }
    },
    [createPeer, flushIce],
  );

  const handleAnswer = useCallback(
    async (from: string, sdp: string) => {
      const entry = peersRef.current.get(from);
      if (!entry) return;
      if (entry.pc.signalingState !== "have-local-offer") return;
      try {
        await entry.pc.setRemoteDescription({ type: "answer", sdp });
        await flushIce(entry);
      } catch {
        // ignore stale answers
      }
    },
    [flushIce],
  );

  const handleIce = useCallback(async (from: string, candidate: RTCIceCandidateInit | null) => {
    if (!candidate) return;
    const entry = peersRef.current.get(from);
    if (!entry) return;
    if (!entry.pc.remoteDescription || entry.pc.remoteDescription.type === undefined) {
      entry.pendingIce.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      entry.pendingIce.push(candidate);
    }
  }, []);

  const setLocalStream = useCallback(
    (stream: MediaStream | null) => {
      localStreamRef.current = stream;
      cameraTrackRef.current = stream?.getVideoTracks()[0] ?? null;
      if (!stream) return;

      const audioTrack = stream.getAudioTracks()[0] ?? null;
      const videoTrack = screenTrackRef.current ?? stream.getVideoTracks()[0] ?? null;

      for (const [participantId, entry] of peersRef.current) {
        const pc = entry.pc;
        let needsNegotiation = false;

        const audioTransceiver = transceiverForKind(pc, "audio");
        if (audioTransceiver) {
          if (audioTrack && audioTransceiver.direction !== "sendrecv") {
            try {
              audioTransceiver.direction = "sendrecv";
              needsNegotiation = true;
            } catch {
              // ignore
            }
          }
          void audioTransceiver.sender.replaceTrack(audioTrack).catch(() => undefined);
        } else if (audioTrack) {
          try {
            pc.addTrack(audioTrack, stream);
            needsNegotiation = true;
          } catch {
            // ignore
          }
        }

        const videoTransceiver = transceiverForKind(pc, "video");
        const desiredVideo = screenTrackRef.current ?? cameraTrackRef.current;
        if (videoTransceiver) {
          if (desiredVideo && videoTransceiver.direction !== "sendrecv") {
            try {
              videoTransceiver.direction = "sendrecv";
              needsNegotiation = true;
            } catch {
              // ignore
            }
          }
          void videoTransceiver.sender.replaceTrack(desiredVideo).catch(() => undefined);
        } else if (videoTrack) {
          try {
            pc.addTrack(videoTrack, stream);
            needsNegotiation = true;
          } catch {
            // ignore
          }
        }

        if (needsNegotiation) {
          void makeOffer(participantId);
        }
      }
    },
    [makeOffer],
  );

  const setScreenTrack = useCallback(
    (track: MediaStreamTrack | null) => {
      screenTrackRef.current = track;
      for (const [participantId, entry] of peersRef.current) {
        const videoTransceiver = transceiverForKind(entry.pc, "video");
        if (videoTransceiver) {
          const desired = track ?? cameraTrackRef.current;
          let needsNegotiation = false;
          if (desired && videoTransceiver.direction !== "sendrecv") {
            try {
              videoTransceiver.direction = "sendrecv";
              needsNegotiation = true;
            } catch {
              // ignore
            }
          }
          void videoTransceiver.sender.replaceTrack(desired).catch(() => undefined);
          if (needsNegotiation) void makeOffer(participantId);
          continue;
        }
        if (track) {
          try {
            entry.pc.addTransceiver(track, { direction: "sendonly", streams: [new MediaStream([track])] });
            void makeOffer(participantId);
          } catch {
            // ignore
          }
        }
      }
    },
    [makeOffer],
  );

  const reset = useCallback(() => {
    closeAll();
    selfIdRef.current = null;
  }, [closeAll]);

  useEffect(() => {
    return () => {
      closeAll();
    };
  }, [closeAll]);

  return {
    peersRef,
    handleRoomJoined,
    handlePeerJoined,
    handleOffer,
    handleAnswer,
    handleIce,
    removePeer,
    setLocalStream,
    setScreenTrack,
    reset,
    closeAll,
  };
}
