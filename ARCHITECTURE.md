# System Architecture

The ForgetMeNot application consists of a FastAPI backend and a Next.js (shadcn/ui + Tailwind CSS) frontend.

```mermaid
graph TD
    Client[Web Browser - Next.js] -->|HTTP REST| API[FastAPI Backend]
    Client -->|WebSocket| WS[WebSocket Recall Loop]
    API -->|Data Storage| Registry[Local JSON Face Registry]
    API -->|Memory Ops| Cognee[Cognee Cloud / Local Memory Graph]
    API -->|One-liner/Distill| LLM[LLM API / OpenAI / Ollama]
```

## Frontend Components
* **Landing Page (`/`)**: A modern marketing interface highlighting features, how-it-works steps, and metrics.
* **Camera Dashboard (`/camera`)**: The interactive dementia care assistant that reads local video frames, executes client-side face recognition using `face-api.js`, and displays Cognee memory cards anchored to recognised faces.

## Backend Components
* **REST API (`backend/main.py`)**: Handles person enrollment, adding observations to session memory, audio transcription (via Whisper), distillation to permanent memory, and profile deletion.
* **WebSocket Server (`backend/main.py`)**: Connects to the browser's live face descriptor stream (128 floats) at 2 FPS, matches against the local face registry, recalls facts from Cognee, and sends back summaries.
* **Memory Adapter (`backend/memory.py`)**: Interfaces with Cognee Cloud/Local using standard lifecycle methods (`remember`, `recall`, `improve`, `forget`).
* **Face Matching Registry (`backend/registry.py`)**: Stores 128-float descriptors and metadata in `people.json`, performing local Euclidean distance matching.
* **LLM Prompt Manager (`backend/llm.py`)**: Formulates the prompt instructions for distilling raw session notes into permanent memory and generating short one-liner reminders.

## CORS & Static File Serving
* During development, the frontend runs on port 3000 and FastAPI runs on port 8000. CORS middleware is enabled to allow cross-origin requests.
* For production/headless environments, Next.js compiles to static HTML/CSS/JS (`frontend/out`). FastAPI's catch-all route serves these static files directly on port 8000, avoiding CORS completely.
* **Separated Frontend Hosting**: The static frontend can also be built and deployed independently to static hosting services like GitHub Pages (using a GitHub Actions workflow). When doing so, the frontend connects to an external backend using the `NEXT_PUBLIC_BACKEND_URL` environment variable.

## Production Deployments
The application is pre-configured for a variety of production deployments:
1. **Docker / Docker Compose**: Multi-stage build that compiles the frontend and packages the entire app into a single FastAPI-driven Python container.
2. **Fly.io**: Pre-configured `fly.toml` to mount a persistent volume (`forgetmenot_data`) and expose the FastAPI web service on port 8000.
3. **Render**: Pre-configured `render.yaml` blueprint setting up a Web Service using the custom Dockerfile and mapping the persistent `/app/backend/data` path to a Render disk volume.
4. **GitHub Pages (Frontend only)**: Workflows under `.github/workflows/deploy.yml` compile and deploy the Next.js static assets to `<username>.github.io/forgetmenot` automatically upon pushing to `main`.

