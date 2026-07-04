# TODO (COMPLETED ✅)

All tasks below have been fully implemented, integrated, and verified in the codebase.

---

## 1. Write `voice.md` — voice-to-notes pipeline documentation [COMPLETED]

Goal: a doc explaining how voice capture becomes a stored note, end to end.

Cover:
- Entry point: where in the UI voice capture is triggered (camera page,
  which component records audio).
- Recording: what captures the mic (`MediaRecorder` browser API, format
  produced, e.g. `webm`/`opus`).
- Upload: `POST /api/transcribe` in `backend/main.py` (line ~171), which
  takes `person_id` + audio file (`multipart/form-data`).
- Transcription: `llm.transcribe()` in `backend/llm.py`, currently Whisper
  via OpenAI-compatible API. Note the existing fallback behavior: no
  `OPENAI_API_KEY` or empty audio -> `422` with a clear error, no crash.
  Note also that Ollama has no STT endpoint, `transcribe()` fails closed
  against it (already documented in `.env.example`).
- Storage: transcript gets appended as an observation via
  `_record_observation()` -> session memory (Cognee fast tier or JSON
  fallback), same path as a typed note.
- No diarization: whole clip attributed to whichever person is currently
  face-matched (explicit limitation, already called out in the `/api/transcribe`
  docstring).
- Distillation: how a voice-sourced note later gets promoted to permanent
  memory via `/api/distill`, same as any other note, no special handling.
- Packages/deps involved: browser `MediaRecorder` (no package), backend
  `openai` SDK (via `llm.py`) for Whisper calls. List actual versions from
  `requirements.txt`.
- Also document the **TTS** side (reminder text read aloud), if/where it
  exists in the frontend today, if it does not exist yet, say so explicitly
  rather than describing a pipeline that isn't there. Check
  `frontend/app/camera` and `frontend/components` for any `speechSynthesis`
  usage before writing this section.
- Diagram: simple ASCII flow, mic -> MediaRecorder -> POST /api/transcribe
  -> Whisper -> observation -> (later) distill -> permanent memory.

Constraint: describe what's actually implemented, don't describe an
idealized pipeline. Verify each claim against the current code before
writing it down.

---

## 2. Fix LLM API key storage (currently broken, not just unpolished) [COMPLETED]

### Current state (verified in `backend/llm.py` + `backend/main.py`)

- `POST /api/llm/config` (`backend/main.py` ~line 400) requires login
  (`_current_user`), but the key it saves is **not tied to that user at
  all**. It calls `llm.set_config()`, which writes into a single
  **module-level global dict** `_config` in `llm.py` (line ~14).
- Consequence: one user's saved API key becomes the API key for **every
  user** on that server process. Second problem: it's **in-memory only**,
  restarting the backend wipes it, user has to re-enter their key every
  deploy/restart.
- This is worse than "not fully persisted", it's a cross-user data leak in
  a multi-tenant deploy (exactly the deploy target from `render.yaml`).

### What companies actually do here (for comfort + security)

- Store the key server-side, scoped to the user's account row (e.g. in
  `users.json` or whatever the auth store becomes), **encrypted at rest**
  (e.g. `cryptography.fernet` with a server-held secret key from env, not
  plaintext in JSON).
- Never echo the full key back to the frontend after saving. Show a masked
  form (`sk-...ab12`) so the user can confirm it's saved without the raw
  key round-tripping again.
- Provide a way to delete/rotate the key without needing the old one.
- Alternative some companies use instead of storing the key at all:
  BYOK-per-session only, key lives in browser `localStorage`/memory and is
  sent with each request header, never touches the server's disk. Simpler,
  but the user must re-enter it if they clear storage or switch devices.
  This matches the `.env.example` comment that BYOK exists so "hackathon
  teams can deploy without sharing API keys", worth deciding which model
  this product actually wants before implementing.

### Task

1. Decide: per-user encrypted server-side storage, vs. client-held BYOK
   (no server persistence at all). Pick one, don't build both.
2. If server-side: add an `api_keys` (or similar) field to the user record
   in `auth.py`'s user store, encrypt before write, decrypt only in
   `llm.py` when building a client, scoped by `user_id` instead of a
   global dict.
3. If client-side: stop calling `set_config()` as global mutation; instead
   accept the key per-request (header or body) from the frontend on every
   LLM-touching call, never store it server-side at all.
4. Either way: fix the multi-tenant bug first, that's the part that's
   actually broken, not just suboptimal.

---

## 3. "Try Demo" should require login before reaching the camera page [COMPLETED]

### Current state (verified in `frontend/components/landing/navigation.tsx`)

- Two "Try Demo" buttons (desktop nav ~line 75, mobile nav ~line 146) both
  link straight to `/camera` via `<Link href="/camera">`, bypassing login
  entirely. The separate "Log in" link goes to `/login`.

### Task

1. Change both "Try Demo" `<Link href="/camera">` to `<Link href="/login">`
   (or a `/login?redirect=/camera` style param if the login page supports
   post-login redirect targets, check `frontend/app/login` first).
2. In the login page/flow, after successful auth, redirect to `/camera`
   (or to the `redirect` query param if implemented) instead of wherever
   it currently sends the user, check current post-login behavior in
   `frontend/app/login` before assuming.
3. Confirm `/camera` route itself still checks auth status (via
   `/api/auth/status` or similar) and bounces unauthenticated direct visits
   back to `/login`, so this isn't just a UI-level redirect that a direct
   URL visit can skip.
