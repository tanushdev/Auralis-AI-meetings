"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DeviceLists {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
}

interface Options {
  onStreamChange?: (stream: MediaStream | null) => void;
  onScreenEnd?: () => void;
}

export function useMediaDevices(options: Options = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceLists>({ cameras: [], microphones: [] });
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [selectedMicrophone, setSelectedMicrophone] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices({
      cameras: list.filter((device) => device.kind === "videoinput"),
      microphones: list.filter((device) => device.kind === "audioinput"),
    });
  }, []);

  const stop = useCallback(() => {
    const current = streamRef.current;
    if (current) {
      current.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
    setStream(null);
    optionsRef.current.onStreamChange?.(null);
  }, []);

  const start = useCallback(
    async (overrides?: { audio?: boolean; video?: boolean }) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser does not support camera or microphone access.");
        setInitialized(true);
        return null;
      }
      setRequesting(true);
      setError(null);
      const wantAudio = overrides?.audio ?? audioEnabled;
      const wantVideo = overrides?.video ?? videoEnabled;

      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: wantAudio
            ? {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                ...(selectedMicrophone ? { deviceId: { exact: selectedMicrophone } } : {}),
              }
            : false,
          video: wantVideo
            ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
                ...(selectedCamera ? { deviceId: { exact: selectedCamera } } : {}),
              }
            : false,
        });

        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = next;
        next.getAudioTracks().forEach((track) => {
          track.enabled = wantAudio;
        });
        next.getVideoTracks().forEach((track) => {
          track.enabled = wantVideo;
        });
        setStream(next);
        setAudioEnabled(wantAudio);
        setVideoEnabled(wantVideo);
        optionsRef.current.onStreamChange?.(next);
        await refreshDevices();
        return next;
      } catch (err) {
        const message = describeMediaError(err);
        setError(message);
        return null;
      } finally {
        setRequesting(false);
        setInitialized(true);
      }
    },
    [audioEnabled, videoEnabled, refreshDevices, selectedCamera, selectedMicrophone],
  );

  const toggleAudio = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    if (tracks.length === 0) {
      setAudioEnabled((value) => !value);
      return;
    }
    const next = !tracks.every((track) => track.enabled);
    tracks.forEach((track) => {
      track.enabled = next;
    });
    setAudioEnabled(next);
  }, []);

  const toggleVideo = useCallback(() => {
    const tracks = streamRef.current?.getVideoTracks() ?? [];
    if (tracks.length === 0) {
      setVideoEnabled((value) => !value);
      return;
    }
    const next = !tracks.every((track) => track.enabled);
    tracks.forEach((track) => {
      track.enabled = next;
    });
    setVideoEnabled(next);
  }, []);

  const switchDevice = useCallback(
    async (kind: "audio" | "video", deviceId: string) => {
      if (kind === "audio") setSelectedMicrophone(deviceId);
      else setSelectedCamera(deviceId);
      const constraints: MediaStreamConstraints = {
        audio:
          kind === "audio" || audioEnabled
            ? {
                ...(kind === "audio" ? { deviceId: { exact: deviceId } } : {}),
                echoCancellation: true,
                noiseSuppression: true,
              }
            : false,
        video:
          kind === "video" || videoEnabled
            ? {
                ...(kind === "video" ? { deviceId: { exact: deviceId } } : {}),
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : false,
      };
      try {
        const next = await navigator.mediaDevices.getUserMedia(constraints);
        const previous = streamRef.current;
        streamRef.current = next;
        next.getAudioTracks().forEach((track) => {
          track.enabled = audioEnabled;
        });
        next.getVideoTracks().forEach((track) => {
          track.enabled = videoEnabled;
        });
        setStream(next);
        previous?.getTracks().forEach((track) => track.stop());
        optionsRef.current.onStreamChange?.(next);
        await refreshDevices();
      } catch (err) {
        setError(describeMediaError(err));
      }
    },
    [audioEnabled, videoEnabled, refreshDevices],
  );

  const startScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen sharing is not supported in this browser.");
      return null;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      screenRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current = display;
      setScreenStream(display);
      const videoTrack = display.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          screenRef.current = null;
          setScreenStream(null);
          optionsRef.current.onScreenEnd?.();
        };
      }
      return display;
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return null;
      setError(describeMediaError(err));
      return null;
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    screenRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current = null;
    setScreenStream(null);
    optionsRef.current.onScreenEnd?.();
  }, []);

  useEffect(() => {
    const onChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, [refreshDevices]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return {
    stream,
    streamRef,
    screenStream,
    screenRef,
    audioEnabled,
    videoEnabled,
    requesting,
    initialized,
    error,
    devices,
    selectedCamera,
    selectedMicrophone,
    start,
    stop,
    toggleAudio,
    toggleVideo,
    switchDevice,
    startScreenShare,
    stopScreenShare,
    refreshDevices,
    setError,
    setAudioEnabled,
    setVideoEnabled,
  };
}

export function describeMediaError(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return "Camera or microphone permission was denied. Allow access in your browser settings and try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera or microphone was found on this device.";
      case "NotReadableError":
        return "Your camera or microphone is already in use by another application.";
      case "OverconstrainedError":
        return "The selected device does not support the requested settings.";
      default:
        return error.message || "Could not access your camera or microphone.";
    }
  }
  return error instanceof Error ? error.message : "Could not access your camera or microphone.";
}
