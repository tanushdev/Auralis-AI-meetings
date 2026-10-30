import crypto from "node:crypto";

/** Generates a Google-Meet-style room id: abc-defg-hij */
export function generateRoomId(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz";
  const block = (length: number) =>
    Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `${block(3)}-${block(4)}-${block(3)}`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export const ROOM_ID_PATTERN = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;

export function isValidRoomId(value: string): boolean {
  return ROOM_ID_PATTERN.test(value);
}
