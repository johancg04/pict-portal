const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I para evitar confusión

export function generateRoomCode(length = 5): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}

export const ROOM_PARAM = "sala";

/** Link that opens the app already pointed at this room (?sala=CODE). */
export function buildRoomLink(code: string, origin: string): string {
  return `${origin}/?${ROOM_PARAM}=${encodeURIComponent(normalizeRoomCode(code))}`;
}

/** Room code carried by the current URL, or "" if there is none. */
export function readRoomFromUrl(search: string): string {
  const raw = new URLSearchParams(search).get(ROOM_PARAM) ?? "";
  return normalizeRoomCode(raw).replace(/[^A-Z0-9]/g, "").slice(0, 8);
}
