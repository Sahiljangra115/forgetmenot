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

---

## 4. "Try Demo" still lands on camera page directly (reported again after fix) [COMPLETED]

### Current state (verified in source, contradicts the report)

- `frontend/components/landing/navigation.tsx` line ~76 and ~146 already
  read `<Link href="/login?redirect=/camera">`, both desktop and mobile
  buttons. Source code is correct.
- User's screenshot shows landing straight on the camera dashboard
  (`connecting...` state), not the login page.

### Likely root cause: stale static export, not stale source

- `frontend/out` (the exported static site FastAPI actually serves, see
  `backend/main.py`'s catch-all static route) is a build artifact, it does
  not auto-update when `.tsx` source changes. If the deployed backend is
  serving an `frontend/out` built **before** the `/login?redirect=/camera`
  fix landed, it will still ship the old `/camera` link, no matter what
  the source says now.
- Alternative/parallel cause: an already-valid session cookie. If the user
  was logged in from an earlier session, `Try Demo` -> `/login` ->
  immediate redirect to `/camera` happens so fast it looks like it "skipped"
  login. Worth distinguishing from the stale-build cause before assuming
  code is broken.

### Task

1. Rebuild the frontend: `cd frontend && npm run build` (regenerates
   `frontend/out` from current source).
2. Redeploy (or restart the local `uvicorn` process) so it serves the
   fresh `frontend/out`, confirm via browser hard-refresh
   (cache-bypass) that `Try Demo` now hits `/login` first when logged out.
3. Separately, verify the "connecting..." stuck state in the screenshot:
   check that the WebSocket URL the camera page opens (`/ws`) resolves to
   the same host the page was loaded from (already fixed for HTTP calls
   via `window.location.hostname` per `DEPLOYMENT_GUIDE.md`, confirm the
   WebSocket construction uses the same pattern, not a hardcoded
   `localhost:8000`).
4. Test both logged-out (`Try Demo` -> should hit `/login`) and logged-in
   (`Try Demo` -> should skip straight to `/camera`, that's correct
   behavior, not a bug) to avoid re-reporting expected behavior as broken.

---

## 5. Make Ollama base URL editable in the LLM settings panel [COMPLETED]

### Current state (verified in `frontend/app/camera` LLM settings UI +
`backend/llm.py`)

- The provider dropdown includes `Ollama (Local)` (~line 1309 in the
  camera page component), but there's no field for the Ollama server's
  base URL anywhere in the UI, only provider + API key + model.
- Backend hardcodes it: `backend/llm.py` `_get_base_url()` returns
  `os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")` when
  provider is `ollama`. This only works if Ollama is running on the same
  machine as the backend, on the default port. Breaks for:
  - Any user whose laptop runs Ollama but the backend is deployed remotely
    (Render/Fly), `localhost:11434` on the server means the server itself,
    not the user's laptop.
  - Anyone running Ollama on a non-default port or a LAN address.
- This is almost certainly why the demo "assumed Ollama" and failed to
  connect: the deployed backend has no route back to a laptop's local
  Ollama instance, `localhost` from the server's perspective is the server.

### Task

1. Add an "Ollama Base URL" text input to the LLM settings panel, shown
   only when `llmProvider === "ollama"` (same conditional pattern already
   used to hide/show the API key field for Ollama at ~line 1318).
   Default placeholder: `http://localhost:11434/v1`, editable.
   Note: since the backend, not the browser, makes the Ollama call, a
   remotely-deployed backend can never reach a `localhost` on the *user's*
   machine. The base URL field only works end-to-end when backend and
   Ollama are on the same host/network, or the user provides a
   network-reachable Ollama URL (e.g. `http://192.168.x.x:11434/v1`,
   or an ngrok/tunnel URL), that's a networking fact, not a bug, but the
   UI should say so briefly (e.g. helper text: "Must be reachable from the
   server, not just your browser").
2. Include this `base_url` value in the `POST /api/llm/config` request
   body alongside `provider`, `api_key`, `model`.
3. Backend: extend `auth.save_llm_config` / `get_llm_config` (added for
   task 2) to store and return a per-user `base_url` field, defaulting to
   `os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1")` if unset.
4. `backend/llm.py`'s `_get_base_url(user_id)` should read the per-user
   stored `base_url` when provider is `ollama`, instead of only the
   process-wide `OLLAMA_BASE_URL` env var, so two different users on the
   same deployed backend can each point at their own Ollama instance.
5. Same masking/no-op treatment isn't needed for base_url (it's not a
   secret), unlike the API key field, always show and allow editing it
   directly.
