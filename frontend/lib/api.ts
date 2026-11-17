/**
 * Empty (or unset) NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL means automatic:
 *
 * - direct Next dev on http://localhost:3000 -> backend on :5000
 * - everywhere else (gateway, HTTPS tunnel, LAN, production) -> same origin
 *
 * Same-origin is what makes the tunnel setup work: the browser calls /api and
 * /ws on the https:// tunnel host, so cookies stay first-party and camera /
 * microphone are allowed as a secure context.
 */
const configuredApiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
const configuredWsUrl = (process.env.NEXT_PUBLIC_WS_URL ?? "").trim();

const trimSlash = (url: string) => url.replace(/\/$/, "");

function isLoopback(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function directDevBackend(kind: "http" | "ws"): string | null {
  if (typeof window === "undefined") return null;
  const { protocol, hostname, port } = window.location;
  if (protocol !== "http:" || port !== "3000" || !isLoopback(hostname)) return null;
  return `${kind === "http" ? "http" : "ws"}://${hostname}:5000`;
}

function autoApiUrl(): string {
  if (typeof window === "undefined") return "http://127.0.0.1:5000";
  return directDevBackend("http") ?? "";
}

function autoWsUrl(): string {
  if (typeof window === "undefined") return "ws://127.0.0.1:5000";
  const direct = directDevBackend("ws");
  if (direct) return direct;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

export const API_URL = configuredApiUrl ? trimSlash(configuredApiUrl) : autoApiUrl();
export const WS_URL = configuredWsUrl ? trimSlash(configuredWsUrl) : autoWsUrl();

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

/** Fetch wrapper that always sends cookies and normalises backend errors. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    const details =
      payload && typeof payload === "object" && "details" in payload
        ? (payload as { details: unknown }).details
        : undefined;
    throw new ApiError(message, response.status, details);
  }

  return payload as T;
}

export function iceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_ICE_SERVERS;
  if (!raw) return [{ urls: "stun:stun.l.google.com:19302" }];
  try {
    const parsed = JSON.parse(raw) as RTCIceServer[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fall through to default
  }
  return [{ urls: "stun:stun.l.google.com:19302" }];
}
