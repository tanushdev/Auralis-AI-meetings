# Build Checklist

Implementation follows the mandatory build order from `llm.md` §16. A stage is checked only after
it has been implemented **and verified** against the running local stack.

## M0 — Monorepo, configuration, health checks (§16.1)

- [x] Git repository initialised
- [x] npm workspaces for `frontend` and `backend`
- [x] Root `.env.example` + `npm run setup` generating per-service env files
- [x] Express backend boots and serves `/api/health`
- [x] Health endpoint probes MongoDB, transcription, and Ollama for real
- [x] Next.js frontend boots on :3000
- [x] Python faster-whisper service boots on :8000 with `/health`
- [x] Ollama installed and configured model pulled
- [x] Verification: all three services report healthy

## M1 — MongoDB + authentication (§16.2)

- [x] User model with bcrypt password hashing
- [x] Register / login / me / logout via httpOnly JWT cookie
- [x] Guest join tokens scoped to one room
- [x] Auth middleware, validation, rate limiting
- [x] Verification: register, login, cookie auth, guest authorization rules

## M2 — Meetings + signaling + 2-peer WebRTC (§16.3–16.6)

- [x] Meeting / participant models and CRUD APIs
- [x] Shareable room links and pre-join lobby
- [x] WebSocket signaling with authenticated `JOIN_ROOM`
- [x] One `RTCPeerConnection` per remote peer
- [x] ICE candidate queueing
- [x] Verification: two real browsers exchange audio/video

## M3 — Multi-peer, toggles, screen share, reconnection (§16.7–16.8)

- [x] Mesh support up to configured participant limit
- [x] Mic / camera toggle without destroying peers
- [x] Screen share via `getDisplayMedia` + `replaceTrack`, camera restored
- [x] Participant avatars when camera off
- [x] Heartbeats, exponential backoff reconnect, media cleanup
- [x] Verification: three peers, toggle tracks, screen share, receive-only renegotiation, no leaked connections

## M4 — Chat + local recording (§16.9–16.10)

- [x] Real-time chat with server-derived identity, persisted
- [x] MediaRecorder recording with mixed local + remote audio
- [x] IndexedDB storage, WebM download, elapsed timer
- [x] Pause/resume where supported
- [x] Recording metadata stored in MongoDB, never the blob
- [x] Verification: chat persists; recording pauses, resumes, and saves a non-empty WebM locally

## M5 — Local live transcription (§16.11–16.13)

- [x] faster-whisper service with authenticated streaming endpoint
- [x] AudioWorklet PCM capture and WebSocket audio transport
- [x] Server-side per-participant streaming sessions
- [x] Overlapping windows + deduplication + provisional/final segments
- [x] Speaker attribution bound server-side
- [x] Live transcript panel with status, search, copy, TXT download
- [x] Segment editing, persistence, clickable timestamps
- [x] Verification: speech transcribed live with names and timestamps

## M6 — Ollama summaries (§16.14–16.15)

- [x] Ollama client with health and structured JSON output
- [x] Zod validation + repair retry, honest failures
- [x] Map-reduce hierarchical summarization with timestamps
- [x] Incremental summaries during meeting
- [x] Automatic final summary after end + retry endpoint
- [x] Meeting detail tabs, summary UI, error/processing states
- [x] Verification: genuine summary from real transcript

## M7 — Dashboard, hardening, docs (§16.16–16.18)

- [x] Dashboard, history, transcripts, and recordings pages
- [x] Responsive UI, error handling, authorization checks
- [x] README with Windows/macOS/Linux setup and troubleshooting
- [x] End-to-end test pass against §17 Definition of Done
- [x] Documented limitations (no TURN, mesh scale, latency, VRAM/CPU)

## Verification record — 2026-10-30

| Check | Result |
| --- | --- |
| `npm run typecheck` (backend + frontend) | Passed |
| `npm run build` (backend compile + Next.js production build) | Passed |
| `node scripts/verify-local.mjs` | All checks passed: signaling, presence, media/recording state, chat, streaming transcript, provisional updates, recording metadata, history, real final Ollama summary |
| `npx playwright test -c e2e/playwright.config.mjs` | 1 passed (2.1 min): three-participant WebRTC, guest join, chat, host crown, screen share, receive-only media enablement, recording pause/resume and local save, live transcript, meeting end, final summary, detail tabs, history |
| Recording pause regression | 3/3 browser runs passed with incremental MediaRecorder chunks and non-empty WebM output |

The temporary recording diagnosis harness and debug scripts were removed after the fix. The shipped
recording changes are: an off-screen document-attached canvas with `captureStream(0)` and explicit
`requestFrame()`, a sub-audible WebAudio keep-alive source, one-second MediaRecorder timeslices,
recording state signaled to all participants, and a real error state for empty recordings.

## Known limitations

See the "Known limitations" section of [README.md](README.md): mesh scaling at six participants, no
TURN relay, per-participant (not acoustic) speaker attribution, near-real-time transcription latency,
probabilistic model summaries, browser-local recordings, single-node signaling, and HTTPS
requirements for remote access.
