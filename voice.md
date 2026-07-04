# Voice-to-Notes Pipeline Documentation

This document describes the end-to-end flow of how the voice capture pipeline works in the **ForgetMeNot** application, from raw audio recording in the browser to persistent knowledge graphs in the backend memory tier.

---

## Pipeline Overview

The voice capture pipeline provides a near-real-time simulated streaming speech-to-text experience. Instead of maintaining a complex WebRTC/WebSocket audio streaming server, it segments the microphone audio into standard `8-second` chunks locally, uploads them via HTTP POST, transcribes them using OpenAI's Whisper API, and appends them as memory observations.

```
       [Web Browser Client]                       [FastAPI Backend Server]
+---------------------------------+          +---------------------------------+
|                                 |          |                                 |
|  1. Mic Capture                 |          |                                 |
|     (navigator.mediaDevices)    |          |                                 |
|               |                 |          |                                 |
|               v                 |          |                                 |
|  2. MediaRecorder (audio/webm)  |          |                                 |
|     - Segment into 8s clips     |          |                                 |
|               |                 |          |                                 |
|               v                 |          |                                 |
|  3. POST /api/transcribe  -------------->  |  4. Receive multipart/form-data  |
|     (Form: person_id, audio)    |          |     - audio: WebM buffer        |
|                                 |          |               |                 |
|                                 |          |               v                 |
|                                 |          |  5. llm.transcribe()            |
|                                 |          |     - Calls Whisper API         |
|                                 |          |               |                 |
|                                 |          |               v                 |
|                                 |          |  6. _record_observation()       |
|                                 |          |     - Save note in registry    |
|                                 |          |     - Add session fact in Cognee|
|                                 |          |               |                 |
|  7. Refresh UI <--------------------------------- Return response            |
|     - Fetch updated summary     |          |                                 |
+---------------------------------+          +---------------------------------+
```

---

## 1. Entry Point & Recording (Frontend)

* **Trigger Location**: The voice capture is managed automatically in the Camera Dashboard (`frontend/app/camera/page.tsx`).
* **Active Check**: Audio recording starts only when:
  1. The camera is active and streaming (`streaming` is `true`).
  2. A person has been successfully recognized (`activePerson` is set).
  3. The microphone is not manually muted (`micMuted` is `false`).
* **Mic Access**: Uses the standard browser API:
  ```javascript
  navigator.mediaDevices.getUserMedia({ audio: true })
  ```
* **Recording Loop**:
  - Uses the native browser **`MediaRecorder`** API.
  - Recording format is `audio/webm`.
  - Every `8000ms` (8 seconds), the recorder chunk is automatically stopped and restarted.
  - Upon stopping, the compiled chunks are wrapped in a `Blob` of type `audio/webm` and passed to the upload function.

---

## 2. API Endpoint & Upload (Network)

* **Request**:
  - Sent via a `POST` request to `${getBackendUrl()}/api/transcribe`.
  - Content-Type is `multipart/form-data`.
  - Parameters:
    - `person_id`: The ID of the currently matched person (`activePersonIdRef.current`).
    - `audio`: The WebM audio blob, uploaded with filename `clip.webm`.
* **No Diarization Limitation**:
  - There is **no speaker separation/diarization**.
  - Since the audio is uploaded as a single stream, the entire chunk is attributed directly to whichever person is currently matched by the facial recognition system at that instant.

---

## 3. Transcription & Backend Processing

* **Endpoint handler**: `transcribe()` in `backend/main.py` (line ~171).
* **Transcription Provider**: `llm.transcribe()` in `backend/llm.py` passes the raw audio bytes to the **OpenAI Whisper API** (`whisper-1`).
* **Failures & Fallbacks**:
  - If the `OPENAI_API_KEY` is missing or empty audio is received, the backend returns an `HTTP 422 Unprocessable Entity` status with a clear error payload. The system handles this cleanly without crashing.
  - **Ollama/Local Warning**: Local Ollama deployments do not support Speech-to-Text (STT) transcription. If Ollama is selected as the LLM provider, `transcribe()` automatically returns `None` (fails closed) with an appropriate warning log in the console.

---

## 4. Observation Storage & Memory Integration

* **Immediate Observation**:
  - The transcription text is written to the database using `_record_observation()`.
  - It saves the text locally in `backend/data/users.json` / `registry.py` under the person's profile notes.
  - It pushes the observation to the **Cognee Graph Memory** (or local JSON fallback) using `memory.remember()`.
* **Distillation**:
  - A voice-sourced observation behaves identically to a typed observation.
  - Later, when the user triggers the distillation process (`POST /api/distill`), all raw notes for that person are compressed by the LLM into a single durable memory fact, populated back into the Cognee graph database.

---

## 5. Dependency Details

The voice capture stack relies on:
1. **MediaRecorder Browser API**: Fully native Web API (no external NPM dependencies needed).
2. **openai Python SDK (version 2.44.0)**: Used in the backend `backend/llm.py` to talk to OpenAI's Whisper API.

---

## 6. Text-to-Speech (TTS) Status

* **Status**: **NOT IMPLEMENTED**
* **Details**: There is currently no Text-to-Speech (TTS) pipeline in the application. Reminder texts (such as one-liner notes retrieved upon face match) are only displayed visually in the UI cards and are not read aloud. No `speechSynthesis` or other browser speech audio synthesis APIs are utilized.
