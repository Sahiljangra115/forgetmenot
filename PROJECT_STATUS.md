# Project Status

## Current State
* **Next.js Frontend**: Operational with 3-column layout, glassmorphic styling, collapsible logs control, local `face-api.js`/models weight hosting (removing CDN network dependencies), and HMR network allowed dev origins configured. Hover card text is styled in dark blue for high contrast.
* **FastAPI Backend**: Serving latest static export (including the landing page visibility fix, local assets, network dev configurations, and dark blue styling) from `frontend/out`. Cognee Cloud mode is successfully resolved and connected. Dynamic redirect URIs are configured for Google OAuth to support both `localhost` and local network IPs.
* **Static Assets**: Successfully compiled, updated with bin weights, and exported to `frontend/out`.

## Known Issues
* None currently. Local testing in progress.

## Dependencies
* **Backend**: FastAPI, Uvicorn, Cognee, OpenAI/Ollama, Pydantic, Python-dotenv
* **Frontend**: Next.js, React, Tailwind CSS, Radix UI, Lucide Icons, Sonner, face-api.js (loaded locally)
