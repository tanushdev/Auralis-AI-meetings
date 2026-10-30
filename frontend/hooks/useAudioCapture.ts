"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  stream: MediaStream | null;
  send: (event: Record<string, unknown>) => boolean;
  sendBinary: (data: ArrayBuffer) => boolean;
}

/**
 * Captures microphone audio at 16 kHz mono and streams raw PCM16 frames to the
 * signaling server, which forwards them to the local faster-whisper service.
 * The AudioWorklet handles resampling from the device rate.
 */
export function useAudioCapture(options: Options) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const activeRef = useRef(false);
  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const stop = useCallback((notifyServer = true) => {
    if (!activeRef.current && !contextRef.current) return;
    activeRef.current = false;
    if (notifyServer) optionsRef.current.send({ type: "AUDIO_STOP" });
    try {
      nodeRef.current?.port.close();
      nodeRef.current?.disconnect();
      sourceRef.current?.disconnect();
      gainRef.current?.disconnect();
    } catch {
      // ignore
    }
    nodeRef.current = null;
    sourceRef.current = null;
    gainRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => undefined);
    }
    setActive(false);
  }, []);

  const start = useCallback(async (streamOverride?: MediaStream | null) => {
    if (activeRef.current || starting) return;
    const stream = streamOverride ?? optionsRef.current.stream;
    if (!stream || stream.getAudioTracks().length === 0) {
      setError("A microphone is required for live transcription.");
      return;
    }
    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass || typeof AudioWorkletNode === "undefined") {
      setError("This browser does not support AudioWorklet, which is required for local transcription.");
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const context = new AudioContextClass({ sampleRate: 16_000, latencyHint: "interactive" });
      contextRef.current = context;
      await context.audioWorklet.addModule("/pcm-worklet.js");
      if (context.state === "suspended") await context.resume();

      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "pcm16-capture");
      const gain = context.createGain();
      gain.gain.value = 0;

      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        optionsRef.current.sendBinary(event.data);
      };

      source.connect(node);
      node.connect(gain);
      gain.connect(context.destination);

      sourceRef.current = source;
      nodeRef.current = node;
      gainRef.current = gain;

      const started = optionsRef.current.send({ type: "AUDIO_START", sampleRate: 16000 });
      if (!started) {
        throw new Error("The live connection is not ready yet.");
      }
      activeRef.current = true;
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audio capture.");
      stop(false);
    } finally {
      setStarting(false);
    }
  }, [starting, stop]);

  const restart = useCallback(async () => {
    optionsRef.current.send({ type: "TRANSCRIPTION_RETRY" });
    stop(false);
    // Re-use the same WebSocket after resetting the server-side stream.
    await start();
  }, [start, stop]);

  useEffect(() => {
    return () => {
      stop(false);
    };
  }, [stop]);

  return { active, starting, error, start, stop, restart, setError };
}
