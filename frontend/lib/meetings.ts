export const ROOM_ID_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

/** Accepts a raw room id, a /meeting/:roomId path, or a full invite URL. */
export function parseRoomId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (ROOM_ID_PATTERN.test(value)) return value;

  const direct = value.match(/\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/);
  if (direct) return direct[1] ?? null;

  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/meeting\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
    if (match) return match[1] ?? null;
  } catch {
    // Not a URL; the regex checks above already covered the valid forms.
  }
  return null;
}

export function inviteUrl(roomId: string): string {
  if (typeof window === "undefined") return `/meeting/${roomId}`;
  return `${window.location.origin}/meeting/${roomId}`;
}

export function meetingJoinUrl(roomId: string): string {
  return `/meeting/${roomId}`;
}

export function safeFileName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "meeting"
  );
}
