# Project Status

## Current State
* **Next.js Frontend**: Operational with 3-column layout, glassmorphic styling, collapsible logs control, local `face-api.js`/models weight hosting (removing CDN network dependencies), and HMR network allowed dev origins configured. Hover card text is styled in dark blue for high contrast. Supports a dynamic `NEXT_PUBLIC_BACKEND_URL` environment variable for external backend hosting.
* **FastAPI Backend**: Serving latest static export (including the landing page visibility fix, local assets, network dev configurations, and dark blue styling) from `frontend/out`. Cognee Cloud mode is successfully resolved and connected. Dynamic redirect URIs are configured for Google OAuth to support both `localhost` and local network IPs.
* **Deployment & CI/CD**: Production-ready. Includes a root `Dockerfile` and `docker-compose.yml` for containerized runs, `fly.toml` for Fly.io, and `render.yaml` for Render blueprint deploys. The static frontend is configured for automated builds and deployment to GitHub Pages via a `.github/workflows/deploy.yml` workflow.
* **Repository Health**: The Git history has been purified to completely remove large build folders (`node_modules`, `.next`, `out`, `cognee_venv`), local secrets (`.env`), and logs, reducing repository size and preventing credential leaks. Commits are continuously structured over the last 4 days.

## Known Issues
* None currently. Local testing and cloud deploy configurations verified.

## Dependencies
* **Backend**: FastAPI, Uvicorn, Cognee, OpenAI/Ollama, Pydantic, Python-dotenv, Razorpay, Anthropic
* **Frontend**: Next.js, React, Tailwind CSS, Radix UI, Lucide Icons, Sonner, face-api.js (loaded locally)

