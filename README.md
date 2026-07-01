# ForgetMeNot

A memory aid for people living with dementia. Point the camera at someone; the
app recognises them and shows a short, warm reminder of who they are, built
from what it remembers about them. Memory is powered by
[Cognee](https://github.com/topoteretes/cognee).

Faces never leave the browser. Face detection and recognition run client-side
with face-api.js; only the anonymous 128-d descriptor is sent to the backend to
match against enrolled people. The backend stores what you know about each
person in Cognee and turns it into the reminder.

## What it does

- **Recognise** a person in front of the camera and anchor a reminder card to
  their face.
- **Remember** raw observations during a visit in Cognee's fast session tier.
- **Distill** those notes into a durable fact in the permanent knowledge graph,
  so the reminder gets sharper the next time you see the same person.

That distillation step (session memory promoted into the permanent graph) is
the mechanic Cognee's own hackathon briefs say judges look for.

## Run it

```bash
cd forgetmenot
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # add your key(s)
uvicorn backend.main:app --reload --port 8000
```

Open http://localhost:8000, allow camera access, and press **Start camera**.

### Memory modes

Set these in `.env`:

- **Cognee Cloud** (target track): set `COGNEE_BASE_URL` and `COGNEE_API_KEY`.
- **Cognee local**: set `LLM_API_KEY` (an OpenAI key) and leave the cloud vars
  unset.
- **Neither**: the app runs on a local JSON fallback so the demo still works;
  the status pill shows "Cognee offline".

The status pill top-right shows which mode is active.

## Demo flow

1. Face the camera, fill in name + relation + a seed memory, press
   **Capture & enroll**.
2. Look away and back; the reminder card appears anchored to your face.
3. Add a couple of observations in **In view now**.
4. Press **Distill notes → permanent memory** and watch the reminder sharpen.

## Layout

```
backend/
  main.py       FastAPI app: enroll, note, distill, /ws recall loop
  memory.py     Cognee adapter (remember/recall/forget) + JSON fallback
  registry.py   person registry and euclidean face matching
  llm.py        reminder and distillation text
frontend/
  index.html    camera, overlay, controls
  app.js        face-api loop, WebSocket, actions
  styles.css
```

## Notes

- face-api.js and its model weights load from jsDelivr; a first run needs
  network access. Subresource Integrity is intentionally left off the CDN
  script tag for a local demo (pinning a hash to an unversioned CDN URL breaks
  on every upstream update).
- `MATCH_THRESHOLD` (default 0.55) is worth tuning to your camera and lighting.
