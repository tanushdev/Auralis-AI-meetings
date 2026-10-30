# [llm.md](http://llm.md) — AI Meeting Platform (College Project)

## 1. Project Goal

Build a fully functional, Zoom/Google Meet-style meeting platform that runs locally for free, with **mandatory real-time transcription and AI-powered meeting summaries**.

Users must be able to create meetings, share meeting links, join using a guest name or account, communicate through real-time video/audio, chat, share screens, record meetings, view transcripts, and generate AI meeting summaries.

The platform must be a working application, not a UI prototype.

### Mandatory features

- Real-time peer-to-peer audio/video meetings.

- Meeting rooms with shareable links.

- Camera and microphone controls.

- Screen sharing.

- Real-time participant list and connection states.

- Real-time text chat.

- Local meeting recording and download.

- **Live speech-to-text transcription during meetings.**

- **Speaker-attributed transcripts with timestamps.**

- **AI-generated meeting summaries.**

- **Key points, decisions, action items, assignees, and deadlines.**

- Meeting history with saved transcripts and summaries.

- Searchable transcripts with clickable timestamps.

- Authentication, guest joining, and meeting management.

- Local-first operation with no mandatory paid APIs or cloud services.

Do not mark transcription or AI summaries as optional, future work, or placeholders.

## 2. Non-Negotiable Rules

1.  Do not use Zoom, Google Meet, Agora, Twilio Video, or paid meeting SDKs.

2.  Do not fake video calls, transcription, participants, or AI outputs.

3.  Use native WebRTC for actual media transport.

4.  Use a WebSocket signaling server for session negotiation and real-time events.

5.  Run speech recognition locally using faster-whisper or whisper.cpp.

6.  Run AI summarization locally using Ollama.

7.  MongoDB must store metadata, transcripts, and summaries, never large video or audio blobs.

8.  Save recordings locally in the browser; do not upload meeting videos.

9.  The application must not require API keys to run its core features.

10. No mandatory cloud AI, cloud transcription, or paid TURN provider.

11. Do not expose secrets to frontend environment variables.

12. Do not silently substitute browser Web Speech API for local transcription because some implementations send audio to external services.

13. Do not return fabricated summaries when transcription or AI processing fails. Show a meaningful error and permit retry.

14. Implement features in the specified build order and verify each stage before proceeding.

15. Never claim a feature is complete until it has been implemented and tested.

## 3. Technology Stack

### Frontend

- Next.js App Router

- React

- TypeScript

- Tailwind CSS

- Native WebRTC browser APIs

- MediaRecorder API

- WebSocket client

- Zustand or React Context for meeting state

### Backend

- Node.js

- Express

- TypeScript

- `ws` WebSocket server

- Mongoose

- bcrypt

- JWT authentication

- Local MongoDB

### Mandatory local AI services

**Speech-to-text**

- Primary: faster-whisper, running as a local Python service.

- Alternative: whisper.cpp.

- Support configurable model sizes.

- Provide CPU-compatible operation and GPU acceleration when supported.

- Transcribe speech continuously during meetings, not only after uploading a recording.

**AI meeting intelligence**

- Ollama running locally.

- Configurable local instruction-following model.

- Use structured JSON output for summaries, decisions, key points, and action items.

- Validate responses before saving them.

### Local service architecture

- Next.js frontend: port 3000.

- Node.js backend and WebSocket signaling: port 5000.

- Local transcription service: port 8000.

- Ollama: local installation, normally port 11434.

- MongoDB: local installation, normally port 27017.

The transcription service must expose authenticated or locally restricted endpoints and must not be accessible to arbitrary external hosts.

## 4. Repository Structure

Create a maintainable monorepo:

```
/
├── package.json
├── README.md
├── llm.md
├── .env.example
├── .gitignore
├── docker-compose.yml
├── frontend/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── login/
│   │   ├── register/
│   │   ├── dashboard/
│   │   ├── meetings/
│   │   ├── meeting/[roomId]/
│   │   ├── recordings/
│   │   ├── transcripts/
│   │   └── settings/
│   ├── components/
│   ├── hooks/
│   │   ├── useWebRTC.ts
│   │   ├── useSignaling.ts
│   │   ├── useMediaDevices.ts
│   │   ├── useRecorder.ts
│   │   └── useLiveTranscript.ts
│   ├── services/
│   ├── store/
│   └── types/
├── backend/
│   └── src/
│       ├── controllers/
│       ├── routes/
│       ├── models/
│       ├── services/
│       │   ├── AIService.ts
│       │   ├── TranscriptionService.ts
│       │   ├── MeetingSummaryService.ts
│       │   └── RecordingService.ts
│       ├── websocket/
│       ├── middleware/
│       └── server.ts
└── transcription/
    ├── app/
    ├── requirements.txt
    ├── Dockerfile
    └── README.md
```

Adjust this structure when necessary, but preserve clear boundaries between media, signaling, persistence, transcription, and summarization.

## 5. Real-Time WebRTC

Implement actual audio/video communication.

Requirements:

- One RTCPeerConnection per remote participant.

- Use an in-memory room registry on the signaling server.

- Exchange SDP offers, answers, and ICE candidates through WebSockets.

- Queue incoming ICE candidates until the remote description is ready.

- Handle connection states, reconnection, disconnections, and cleanup.

- Support microphone and camera toggles without destroying the peer connection.

- Support screen sharing with `getDisplayMedia()` and `RTCRtpSender.replaceTrack()`.

- Restore the camera automatically when screen sharing ends.

- Display a participant avatar when their camera is off.

- Clean up all media tracks, connections, and listeners when leaving.

- Limit mesh meetings to a small number of participants and document scalability constraints.

Use environment-configurable STUN servers. Explain that direct connections are not guaranteed across all networks without TURN.

## 6. Mandatory Live Transcription

**This is a core feature and must be implemented.**

The application must transcribe spoken content while the meeting is happening.

### Required pipeline

1. Capture each participant's microphone audio locally.

2. Process audio in short, configurable chunks suitable for streaming or incremental transcription.

3. Send audio chunks to the local transcription service over a suitable local transport.

4. Run speech recognition using faster-whisper or whisper.cpp.

5. Return recognized text with timestamps and speaker identity.

6. Stream transcript updates to the meeting interface through WebSockets.

7. Persist finalized transcript segments in MongoDB.

8. Continue processing until the participant leaves or transcription is stopped.

Use a practical chunking strategy, overlapping windows when needed, and deduplication of overlapping recognition results.

Do not assume Whisper itself provides instantaneous streaming. Implement incremental transcription with a clear latency/accuracy trade-off.

### Speaker attribution

Prefer processing each participant's microphone stream independently. Associate each stream with the authenticated or guest participant identity on the server.

Do not rely on guessing speakers from a single mixed audio track when individual participant streams are available.

For each transcript segment, save:

- Participant ID, when available.

- Speaker name.

- Start time.

- End time.

- Recognized text.

- Finalized or provisional status.

If speaker attribution is uncertain, represent it honestly instead of inventing identities.

### Live transcript interface

Include:

- Live transcript panel.

- Speaker names.

- Timestamp for each segment.

- Clear indication that transcription is active or unavailable.

- Search within the transcript.

- Copy transcript.

- Download transcript as TXT.

- Clickable timestamps that seek into an available recording.

- Error handling and transcription retry.

- A manual transcript editing or correction capability.

Transcription must not depend on the user manually uploading an audio file after the meeting.

## 7. Mandatory AI Meeting Summaries

**AI meeting summaries must be generated from the actual meeting transcript.**

Use Ollama with a configurable local language model.

### During the meeting

Provide an option to generate incremental summaries from finalized transcript segments. Do not regenerate the entire meeting summary for every incoming audio chunk.

Use a configurable interval or accumulated transcript threshold.

### After the meeting

Automatically initiate final summary generation when the meeting ends, once pending transcription work has been flushed.

Provide a retry option if Ollama is unavailable or summarization fails.

### Required summary structure

```
{
  "executiveSummary": "Concise summary of the meeting",
  "keyPoints": [
    "Important discussion point"
  ],
  "decisions": [
    "Decision explicitly made during the meeting"
  ],
  "actionItems": [
    {
      "task": "Task to complete",
      "assignee": null,
      "deadline": null
    }
  ],
  "importantMoments": [
    {
      "time": 0,
      "description": "Important discussion moment"
    }
  ],
  "openQuestions": [
    "Unresolved question"
  ]
}
```

Validate the generated JSON against a schema.

Rules for accurate summaries:

- Do not invent statements, decisions, participants, or deadlines.

- Distinguish confirmed decisions from suggestions.

- Use null when an assignee or deadline is unknown.

- Preserve important context and disagreements.

- Handle long meetings using transcript chunking and hierarchical summarization.

- Include transcript timestamps when referencing important moments.

- Display a processing state, success state, or actionable error.

- Save summaries to MongoDB and associate them with the correct meeting.

If transcription is incomplete, disclose that the summary is based on an incomplete transcript.

## 8. Local Recording

Implement browser-based recording with MediaRecorder.

Requirements:

- Start, pause where supported, and stop recording.

- Save the recording locally as WebM.

- Provide a download action.

- Display elapsed recording time.

- Check supported MIME types and use a compatible fallback.

- Store recording metadata in MongoDB.

- Use IndexedDB for optional local persistence and playback.

The recording must not be uploaded to the backend.

For whole-meeting recording, combine local and remote audio and render remote video streams to a canvas when appropriate. Clearly document browser limitations.

Keep recording, transcription, and media transport separate so that failure in one does not silently break the others.

## 9. Database Models

Implement appropriate Mongoose models.

### User

- name

- email

- passwordHash

- avatar

- timestamps

### Meeting

- roomId

- hostId

- title

- participants

- startedAt

- endedAt

- duration

- recordingAvailable

- transcriptAvailable

- transcriptionStatus

- summaryStatus

- aiProcessed

- timestamps

### Participant

- meetingId

- userId, optional for guests

- name

- joinedAt

- leftAt

### ChatMessage

- meetingId

- senderId

- senderName

- message

- timestamp

### Transcript

- meetingId

- segments

- language, when known

- transcription provider and model

- timestamps

### MeetingSummary

- meetingId

- executiveSummary

- keyPoints

- decisions

- actionItems

- importantMoments

- openQuestions

- model

- generatedAt

- timestamps

Use suitable indexes, validation, pagination, and authorization checks.

Never store raw passwords, JWT secrets, or video blobs in MongoDB.

## 10. Backend API

Implement:

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me

POST   /api/meetings
GET    /api/meetings
GET    /api/meetings/:id
GET    /api/meetings/room/:roomId
POST   /api/meetings/:id/end

GET    /api/meetings/:id/chat
GET    /api/meetings/:id/transcript
POST   /api/meetings/:id/transcript
POST   /api/meetings/:id/summarize
GET    /api/meetings/:id/summary
POST   /api/meetings/:id/summarize/retry

GET    /api/health
GET    /api/transcription/status
```

The exact endpoint design may change, but all required capabilities must remain implemented.

Use JWT authentication for protected routes. Validate room IDs, request bodies, payload sizes, and permissions. Guests may join meetings but cannot access another user's private history.

## 11. WebSocket Events

Implement validated events for:

- JOIN_ROOM

- LEAVE_ROOM

- ROOM_JOINED

- PEER_JOINED

- PEER_LEFT

- OFFER

- ANSWER

- ICE_CANDIDATE

- MEDIA_STATE

- CHAT_MESSAGE

- TRANSCRIPT_UPDATE

- TRANSCRIPTION_STATUS

- SUMMARY_PROGRESS

- SUMMARY_READY

- ERROR

- ROOM_STATE

Never trust client-provided speaker identities, message sender details, or room membership. Validate and derive these values server-side.

Use heartbeats and exponential-backoff reconnection.

## 12. Frontend and UI

Build a modern, clean, responsive AI SaaS interface.

### Meeting room

- Header with meeting title and timer.

- Responsive participant video grid.

- Microphone and camera controls.

- Screen-share button.

- Chat and participants panels.

- Recording controls.

- Live transcription panel.

- AI summary panel.

- Leave meeting button.

- Connection and processing indicators.

### Meeting details page

Include tabs for:

- Overview

- Transcript

- AI Summary

- Key Points

- Decisions

- Action Items

- Important Moments

- Recording

- Chat

### Dashboard

Include:

- Create meeting.

- Join meeting by link.

- Recent meetings.

- Meeting duration and participant information.

- Transcription status.

- Summary availability.

- Searchable meeting history.

Do not display fake transcripts or placeholder summaries as if they were real.

## 13. Environment Configuration

Create `.env.example` with all required configuration.

```
PORT=5000
HOST=0.0.0.0
MONGO_URI=mongodb://127.0.0.1:27017/ai-meeting
JWT_SECRET=replace-with-a-strong-random-secret
CORS_ORIGINS=http://localhost:3000

NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_WS_URL=ws://localhost:5000
NEXT_PUBLIC_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]

TRANSCRIPTION_URL=http://127.0.0.1:8000
TRANSCRIPTION_PROVIDER=faster-whisper
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

AI_PROVIDER=ollama
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
```

Adjust model configuration to the user's available hardware. Do not promise real-time performance without measuring it.

Secrets must remain backend-only. Do not expose the MongoDB URI, JWT secret, or local AI service credentials through `NEXT_PUBLIC_*`.

Provide startup checks that identify unavailable MongoDB, transcription, and Ollama services.

## 14. Security and Privacy

- Hash passwords using bcrypt.

- Use JWT expiry and secure token handling.

- Validate all HTTP and WebSocket inputs.

- Sanitize displayed content.

- Apply authentication, authorization, and rate limits.

- Restrict local AI service access.

- Avoid exposing internal service ports to the public internet.

- Use secure contexts for camera and microphone access.

- Obtain participant consent before recording and transcription.

- Display clear indicators when recording and transcription are active.

- Explain local data retention and deletion.

- Never claim that processing is local if any audio or transcript is sent to an external service.

## 15. Installation and Running

The project must have a beginner-friendly setup guide for Windows, macOS, and Linux.

Document how to:

1.  Install Node.js.

2.  Install Python.

3.  Install and start MongoDB locally.

4.  Install Ollama and pull the configured model.

5.  Create a Python virtual environment.

6.  Install transcription dependencies.

7.  Install JavaScript dependencies.

8.  Configure environment variables.

9.  Start all services.

10. Open the application.

11. Create a meeting and join from two browsers.

12. Verify live transcription.

13. Generate and inspect the final AI summary.

14. Download a recording and transcript.

15. Troubleshoot unavailable services and browser permissions.

Provide a root development command, such as `npm run dev`, that starts the frontend and backend. Provide a separate documented command for the Python transcription service.

Do not claim that the entire system starts with one command unless all prerequisites and services are actually orchestrated.

## 16. Mandatory Build Order

Implement and test each stage before moving forward.

1.  Create the monorepo, scripts, configuration, and health checks.

2.  Connect local MongoDB and implement authentication.

3.  Implement meeting creation and meeting metadata APIs.

4.  Build the WebSocket signaling server.

5.  Implement local camera/microphone preview and pre-join UI.

6.  Verify real two-peer WebRTC calls.

7.  Add multi-participant support, media toggles, and screen sharing.

8.  Implement reconnection and complete media cleanup.

9.  Implement real-time chat and persistence.

10. Implement local browser recording and download.

11. Implement the local faster-whisper service and audio chunk processing.

12. Integrate live transcript streaming and persistence.

13. Implement speaker attribution, transcript search, and download.

14. Implement Ollama-based summaries, decisions, and action items.

15. Add incremental summaries, final summarization, and retry handling.

16. Build the dashboard and meeting-history views.

17. Complete security, error handling, and responsive UI.

18. Write the README and perform end-to-end tests.

Do not skip transcription or summarization to focus on visual polish.

## 17. Definition of Done

The project is complete only when all applicable checks pass.

- Two real browsers can communicate through WebRTC.

- Camera, microphone, and screen sharing work.

- Meeting chat works and persists.

- Recording can be downloaded locally.

- Spoken words are transcribed during a live meeting.

- Transcript segments have timestamps and speaker attribution when available.

- Live transcript updates appear in the meeting interface.

- Transcripts persist and can be searched and downloaded.

- Ending a meeting triggers final summary generation.

- Ollama generates a genuine summary from the actual transcript.

- Key points, decisions, action items, and important moments are displayed.

- Missing deadlines and assignees are not fabricated.

- Summaries and transcripts persist across application restarts.

- Transcription and AI failures display meaningful errors and allow recovery.

- Core functionality runs without paid API keys.

- Local AI processing is verified rather than merely claimed.

- Documentation explains installation, privacy, performance, and network limitations.

## 18. Instructions to the Coding Agent

First inspect the existing repository, if one exists. Read this entire file before modifying code.

Then provide a short implementation plan and begin building the application in the specified order.

For every stage:

1. Implement working code.

2. Run relevant tests and type checks.

3. Fix errors before proceeding.

4. Document any genuine limitations.

5. Update the README and task checklist.

Never replace required features with mock data, static UI, TODO comments, or simulated API responses.

**Priority:** Working WebRTC + live local transcription + genuine local AI summaries. All three are mandatory. Visual polish comes after functionality.
