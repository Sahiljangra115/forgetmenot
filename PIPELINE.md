# ForgetMeNot, system pipeline

Onboarding doc for any model or human working on this codebase. Read this
before touching code. It describes what exists, the exact data flows, module
contracts, and where the remaining work plugs in. Companion docs:
`../forgetmenot_project_plan.md` (why), `../todo.md` (what is left),
`PITCH.md` (judge story), `SUBMISSION.md` (submission form).

## One-paragraph overview

Webcam app for dementia care. Browser detects and embeds faces locally
(face-api.js), sends a 128-float descriptor over a WebSocket. FastAPI backend
matches it against a local JSON registry, asks Cognee (or a local fallback)
what it remembers about that person, turns the memories into a one-line
reminder via an LLM, and returns it. Frontend draws the reminder card
anchored to the face. Notes and voice clips accumulate in per-person session
memory; a distill step promotes them into Cognee's permanent graph.

## File map

```
forgetmenot/
  backend/
    main.py        FastAPI app: all routes, /ws loop, reminder cache, lifespan
    memory.py      ONLY file that talks to Cognee. Cloud/local/fallback modes,
                   timeout backstop on every call
    registry.py    Local face registry: people.json, euclidean match
    llm.py         OpenAI wrapper: one_liner(), distill(), transcribe()
  frontend/
    camera.html    THE app (video + canvas + panels). Uses root styles.css/app.js
    app.js         Detection loop, WS client, enroll/note/mic/distill actions
    styles.css     Dark glassmorphism theme for camera.html
    index.html     Marketing landing (gappy UI port), links to camera.html
    login.html     Demo-only auth (localStorage), no backend calls
    css/, js/      Belong to the landing/login pages, NOT camera.html
  scripts/
    verify_cognee.py   One-shot check: session_id isolates memory between 2 people
  .env.example     All env vars
```

Rule of thumb: memory logic goes in `memory.py`, face logic in `registry.py`,
prompt logic in `llm.py`, wiring in `main.py`. Do not let Cognee imports leak
outside `memory.py`.

## Memory modes (memory.py)

Resolved once at startup in `init()`, in this order:

1. **cloud**: `COGNEE_BASE_URL` + `COGNEE_API_KEY` set, calls `cognee.serve()`
2. **local**: cognee installed + `LLM_API_KEY` set (cognee needs it to embed)
3. **fallback**: neither available, plain JSON store, app still fully demos

Every real cognee call is wrapped in a timeout (`COGNEE_CALL_TIMEOUT`,
default 20s) so a bad key or network flake cannot hang the demo. On timeout
or error, calls degrade to the fallback store. `status()` reports the active
mode; the frontend shows it as a status pill.

Contract (keep these signatures stable, main.py depends on them):

```
memory.remember(text, session_id=None)      -> writes into Cognee dataset `session_id`
                                                (or "main_dataset" if None)
memory.recall(query, session_id=None)       -> list[str] snippets, scoped to that dataset
memory.improve(session_id)                  -> post-write enrichment for that dataset
memory.forget(dataset)                      -> deletes that whole Cognee dataset
memory.status()                             -> {mode, ready, detail}
memory.get_ops()                            -> list[str], rolling log of lifecycle calls
```

Partitioning convention: **one Cognee dataset per person, equal to the
personId** (`dataset_name=personId` under the hood). The `session_id` kwarg
name is kept on `remember`/`recall`/`improve` for call-site stability, but
it maps directly to Cognee's `dataset_name`/`datasets`, not Cognee's own
`session_id` concept.

**This was a deliberate correction, verified against the real Cognee Cloud
tenant on 2026-07-03, not the original design.** The plan originally assumed
Cognee's own `session_id` parameter would isolate and later recall
per-person memory. Live testing showed that path never surfaced content
(polled recall for 40s, still empty) and that `cognee.forget()` has no
session-scoped delete at all (only `dataset`/`data_id`-scoped, confirmed via
`inspect.signature`). Dataset-scoped remember/recall found content on the
first try. So every person's data, raw notes and the distilled permanent
fact alike, lives in that person's own dataset. This is also what makes
`forget(dataset=personId)` a real, complete deletion instead of a partial
one that misses permanent facts sitting in a shared dataset.

## Pipelines

### 1. Enroll

```
camera.html form (name, relation)
  -> app.js grabs current face descriptor (128 floats, face-api.js)
  -> POST /api/enroll {name, relation, descriptor}
  -> registry.add_person() writes people.json, returns personId
  -> memory.remember(seed_fact, session_id=personId)   # starter fact
  -> response {person}; frontend refreshes people list
```

### 2. Live recall (the core loop)

```
app.js detection loop (throttled ~2 fps)
  -> face-api.js detect + embed in browser (image never leaves client)
  -> ws.send {type:"recall", descriptor}
  -> main.py /ws:
       registry.match(descriptor, threshold)      euclidean, lower = closer
       no face/match  -> {type:"none", distance?}
       match:
         cache hit (per-person TTL, RECALL_TTL=30s)  -> cached summary
         cache miss:
           memory.recall("what do I know about <name>", session_id=pid)
           llm.one_liner(person, snippets)   plain-text fallback if no key
           cache it
       -> {type:"match", personId, name, relation, summary, distance}
  -> app.js draws card anchored to face box (mirror-corrected)
```

Cache invalidation: `_invalidate(pid)` in main.py, called on note,
transcribe, and distill. Any new write path MUST call it too.

### 3. Observation note

```
"In view now" panel textarea
  -> POST /api/note {personId, text}
  -> _record_observation(): memory.remember(text, session_id=pid)
                            + registry.add_note(pid, text)   # local distill log
  -> _invalidate(pid)
```

### 4. Voice note (stretch, done)

```
mic button -> MediaRecorder webm clip
  -> POST /api/transcribe (form: person_id, audio)
  -> llm.transcribe() (Whisper API; 422 with clear message if no key)
  -> same _record_observation() path as notes
```

### 5. Distill (the graded mechanic)

```
Distill button
  -> POST /api/distill {personId}
  -> registry notes for pid -> llm.distill(person, notes) -> one clean fact
  -> memory.remember(fact, session_id=pid)   # into that person's dataset
  -> memory.improve(pid)                     # explicit post-distill enrichment
  -> registry.clear_notes(pid), _invalidate(pid)
  -> next recall returns the sharper fact; card visibly improves
```

### 6. Forget (privacy prune, done)

```
"Forget this person" button -> confirm() dialog
  -> POST /api/forget/{personId}
  -> memory.forget(dataset=personId)   # deletes the whole Cognee dataset
  -> registry.remove_person(personId)
  -> _invalidate(personId)
  -> next camera view of that person: no match, "unrecognised"
```

### 7. Threshold tuning

```
UI slider -> POST /api/threshold {value} -> module-level threshold updated
(also settable via MATCH_THRESHOLD env; registry.match takes it as an arg)
```

## WebSocket protocol (/ws)

Client -> server: `{type:"recall", descriptor:[128 floats]}`
Server -> client, one of:

```
{type:"none"}                                   no face registered / no match
{type:"none", distance: 0.xxx}                  best candidate too far
{type:"match", personId, name, relation, summary, distance}
```

## Env vars (.env, never committed)

```
LLM_API_KEY        OpenAI key; enables local cognee mode + one-liner + whisper
OPENAI_API_KEY     alternative to LLM_API_KEY for llm.py
LLM_BASE_URL       point llm.py at any OpenAI-compatible server instead of
                   real OpenAI, e.g. http://localhost:11434/v1 for Ollama.
                   Unrelated to Cognee itself -- Cognee Cloud handles its own
                   embedding/graph LLM server-side regardless of this var.
                   No API key needed once this is set (dummy key auto-used).
COGNEE_BASE_URL    Cognee Cloud instance -> cloud mode
COGNEE_API_KEY     Cognee Cloud key      -> cloud mode
SUMMARY_MODEL      default gpt-4o-mini; must be an exact tag from
                   `ollama list` when using LLM_BASE_URL. Verified live: a
                   reasoning/"thinking" variant (gemma4:e2b) put its answer in
                   a separate `reasoning` field and left `message.content`
                   (what this app reads) empty, burning max_tokens=60 on
                   internal thinking. The "-nothink" variant
                   (gemma4-e2b-nothink) answers directly in `content` and
                   works correctly -- prefer nothink/instruct variants here.
MATCH_THRESHOLD    default 0.55 (euclidean, LOWER is stricter)
RECALL_TTL         reminder cache seconds, default 30
COGNEE_CALL_TIMEOUT  per-call backstop, default 45 (was 20; bumped after a
                     real live remember() call to Cloud took >20s and
                     silently degraded to fallback)
```

## Run and verify

```
pip install -r requirements.txt
cd backend && uvicorn main:app --reload    # serves frontend + API on :8000
open http://localhost:8000/camera.html     # the actual app
python ../scripts/verify_cognee.py         # dataset isolation + real-content check
```

Note: `uvicorn backend.main:app` from the repo root does NOT work — main.py's
top-level `import memory`/`import registry`/`import llm` need `backend/` on
`sys.path`, which only happens if you run from inside `backend/`. There is no
`backend/__init__.py`. Confirmed by hitting this exact `ModuleNotFoundError`
while testing.

verify_cognee.py has passed against real Cognee Cloud (2026-07-03), asserting
actual remembered content comes back, not just that isolation holds.

## Phase 3.5 — status: DONE, verified against real Cognee Cloud (2026-07-03)

All three items built and tested end to end (curl + a real headless-browser
run through the actual UI, enroll -> note -> distill -> forget):

1. **improve() after distill** -- `memory.improve(pid)` calls
   `cognee.improve(dataset=pid)`. Real finding: this Cloud tenant's REST API
   (checked its own `/openapi.json`) only serves `/remember`, `/recall`,
   `/forget` -- no `/improve`/`/memify` route exists server-side, so this
   404s. We call it anyway (free upgrade if the tenant adds the route) and
   log the honest outcome. `remember()` now passes `self_improvement=True`
   explicitly (Cognee's own default) as the real inline-enrichment mechanic.
2. **Forget person** -- `POST /api/forget/{personId}` ->
   `memory.forget(dataset=pid)` + `registry.remove_person(pid)` (added) +
   `_invalidate(pid)`. Frontend: "Forget this person" button + `confirm()`
   dialog in the person panel, wired in `app.js: forgetPerson()`. Verified
   live: person disappears from `/api/people` and the UI immediately.
3. **Memory-ops log panel** -- `GET /api/ops` returns `memory.get_ops()`, a
   rolling in-process log of every remember/recall/improve/forget call with
   dataset name and mode. Frontend polls it every 4s (`app.js: refreshOps()`)
   into a new "Memory ops" card in `camera.html`. Verified live in-browser.

Also fixed while verifying: `/camera.html` and `/login.html` had no route at
all (only `/` and `/static/*` existed) -- a real 404 this doc's own "open
.../camera.html" instruction would have hit. Added explicit routes in
main.py.

Constraints for any agent working here:
- Never commit `.env` or `people.json`.
- Keep the fallback path working; the demo must not depend on network health.
- No em dashes in any file (user rule).
- camera.html is the product; index.html/login.html are marketing shell,
  do not wire backend calls into them.
- After the demo video is recorded, freeze features.
