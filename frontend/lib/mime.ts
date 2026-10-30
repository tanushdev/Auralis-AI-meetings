export function pickRecordingMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=h264,opus",
    "video/webm",
    "audio/webm;codecs=opus",
    "audio/webm",
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  return "webm";
}
