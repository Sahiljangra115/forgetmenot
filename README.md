# ForgetMeNot

A memory aid for people living with dementia. Point a camera at someone and
the app recognizes them, then surfaces a short, warm reminder of who they
are, built from what it remembers about that person over time. Long-term
memory is powered by [Cognee](https://github.com/topoteretes/cognee).

Privacy is a first-class constraint, not an afterthought. Face detection and
recognition run entirely client-side with `face-api.js`. Only an anonymous
128-dimensional face descriptor, never a raw image, is sent to the backend
for matching against enrolled people.

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Operational Notes](#operational-notes)

## How It Works

1. **Recognize.** The browser detects a face and matches its descriptor
   against enrolled people. A reminder card anchors to the recognized face.
2. **Remember.** Observations made during a visit are captured in Cognee's
   fast session tier, a short-lived working memory.
3. **Distill.** Session notes are promoted into Cognee's permanent knowledge
   graph as a durable fact, so the reminder gets sharper on every subsequent
   encounter.

That promotion step, session memory distilled into permanent memory, is the
core mechanic behind the product and the one Cognee's own hackathon briefs
call out as the signal judges look for.

## Architecture

| Layer    | Stack                                                              |
|----------|---------------------------------------------------------------------|
| Frontend | Next.js (App Router), React, Tailwind CSS, Radix UI, `face-api.js`   |
| Backend  | FastAPI, Uvicorn, WebSockets                                       |
| Memory   | Cognee (cloud or local), JSON fallback                            |
| Auth     | Session-based login, Google OAuth                                  |
| Payments | Razorpay (Standard Checkout)                                      |

The FastAPI backend serves the Next.js static export directly, so the whole
application runs as a single deployable service.

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+

### Installation

```bash
git clone <repo-url> forgetmenot
cd forgetmenot

python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cd frontend && npm install && npm run build && cd ..

cp .env.example .env   # fill in the keys you need, see Configuration
```

### Running Locally

```bash
uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:8000`, grant camera access, and press **Start
camera**.

## Configuration

All configuration is via environment variables in `.env`. See
`.env.example` for the full, annotated list. The memory backend selects
itself automatically based on what is set:

| Mode              | Required variables                              |
|-------------------|--------------------------------------------------|
| Cognee Cloud      | `COGNEE_BASE_URL`, `COGNEE_API_KEY`               |
| Cognee local      | `LLM_API_KEY` (OpenAI-compatible)                 |
| Offline fallback  | none, runs on a local JSON store                  |

The active mode is shown live in the status pill in the top-right of the UI.

Optional integrations (Google OAuth, Razorpay, a local LLM via Ollama) are
each independently optional and degrade gracefully when unset, see
`.env.example` for details on each.

## API Reference

| Method | Endpoint                       | Purpose                              |
|--------|--------------------------------|----------------------------------------|
| GET    | `/api/status`                  | Active memory mode and health          |
| GET    | `/api/people`                  | List enrolled people                   |
| POST   | `/api/enroll`                  | Enroll a new person                    |
| POST   | `/api/note`                    | Add an observation during a visit      |
| POST   | `/api/transcribe`               | Speech-to-text for a note              |
| GET    | `/api/conversation/summary`     | Summarize the current session          |
| POST   | `/api/distill`                 | Promote session notes to permanent memory |
| POST   | `/api/forget/{person_id}`       | Remove a person and their memory       |
| POST   | `/api/threshold`                | Adjust face-match sensitivity          |
| GET    | `/api/ops`                     | Operational metrics                    |
| WS     | `/ws`                          | Real-time recognition and recall loop  |
| POST   | `/api/auth/signup`, `/login`, `/logout` | Session-based auth              |
| GET    | `/api/auth/google/login`, `/callback`   | Google OAuth flow                |
| POST   | `/api/payments/create-order`, `/verify` | Razorpay checkout                |
| POST   | `/api/llm/config`               | Bring-your-own LLM key at runtime       |

## Deployment

The application ships as a single Docker image (`Dockerfile`) that builds
the frontend and serves it from FastAPI, so no split frontend/backend
deployment is required.

- **Render:** `render.yaml` defines a blueprint deploy with a persistent
  disk for backend data. Connect the repository in the Render dashboard and
  it deploys automatically on push.
- **Fly.io:** `fly.toml` defines a scale-to-zero service with a volume for
  backend data.

```bash
# Fly.io
flyctl launch --no-deploy
flyctl volumes create forgetmenot_data --size 1
flyctl deploy
```

Secrets (Cognee, LLM, OAuth, Razorpay keys) are configured per-platform and
are never committed to the repository.

## Project Structure

```
backend/
  main.py       FastAPI app: auth, enroll, note, distill, payments, /ws
  memory.py     Cognee adapter (remember/recall/forget) + JSON fallback
  registry.py   Person registry and Euclidean face matching
  llm.py        Reminder generation and distillation
  auth.py       Session-based authentication and Google OAuth
  payments.py   Razorpay order creation and verification
frontend/
  app/          Next.js routes (landing, camera, login)
  components/   UI components (landing sections, shared UI primitives)
  public/       face-api.js and model weights, served locally
```

## Operational Notes

- `face-api.js` model weights are hosted locally under `frontend/public`,
  not loaded from a CDN, so recognition works without external network
  access at runtime.
- `MATCH_THRESHOLD` (default `0.55`) governs face-match sensitivity and is
  worth tuning per camera and lighting conditions.
- Camera access (`getUserMedia`) requires HTTPS in production; this is
  satisfied automatically on Render and Fly.io deployments.
