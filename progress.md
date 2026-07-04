# Project Progress

## Completed Milestones
* **Next.js Frontend Migration**: Moved the Next.js landing page from `website_skill` to `frontend`.
* **Landing Page Refinement**: Commented out the `<TestimonialsSection />` from the landing page.
* **Ported Camera Interface**: Built `app/camera/page.tsx` integrating vladmandic face-api recognition, WebSocket communication, observation logs, voice clip transcribing, distillation, and forget actions.
* **CORS Support**: Added CORS middleware to `backend/main.py` allowing local Next.js dev server on port 3000 to talk to FastAPI backend on port 8000.
* **FastAPI Catch-All Router**: Replaced individual static mounts in `backend/main.py` with a catch-all handler serving static files from `frontend/out`.
* **Static Export Configuration**: Set `output: 'export'` in `next.config.mjs` for static deployment.
* **Local Static Assets Hosting**: Downloaded all Vercel Blob assets locally.
* **Camera Redesign Layout**: Converted the dashboard into a modern 3-column glassmorphism interface:
  * Left sidebar containing enrolled contacts, enroll forms, sensitivity threshold.
  * Center containing clean, overlay-free live camera feed.
  * Right details panel containing active person details, observations, conversation cards, and collapsible logs toggled by a "See Logs" button.
* **Open Design Sync**: Synchronized changes in the mockup design with the eye brand icon removed and interactive toggles added.
* **Landing Page Font/Visibility Fix**: Changed initial `isVisible` animation state to `true` inside `hero-section.tsx` to prevent blank/invisible text on network/mobile connections due to JS delays or hydration mismatches.
* **CDN Offline/Local Support**: Downloaded vladmandic's `face-api.js` script and recognition/landmark/detector model assets locally to `public/` and updated script/constants inside `app/camera/page.tsx` to point to local resources, removing remote network dependency.
* **HMR Network Fix**: Configured `allowedDevOrigins` in `next.config.mjs` to resolve Next.js dev resource webpack-hmr blocks for IP `'192.168.229.124'`.
* **Hover Card Text Legibility**: Changed floating face-card hover details text to dark blue (`text-blue-950`/`text-blue-900`) for premium contrast against the frosted glass background.
* **Cognee Cloud Environment Fix**: Configured the uvicorn process backend loader inside `backend/main.py` to merge/load the root `.env` file in addition to the backend-local `backend/.env` file. This resolves the Cognee Cloud connection failing when uvicorn is started inside the `backend/` directory.
* **Dynamic OAuth Redirect URIs**: Modified `backend/auth.py` and `backend/main.py` to construct `redirect_uri` dynamically based on `request.base_url`. This allows Google OAuth login to work seamlessly regardless of whether the user accesses the app via `localhost` or local network IPs (e.g. `http://192.168.229.124:8000`).
* **Local Face-API .bin Model Weights**: Downloaded the actual `.bin` files (`tiny_face_detector_model.bin`, `face_landmark_68_model.bin`, `face_recognition_model.bin`) referenced by the manifest JSONs into `/public/models/` and cleaned up unused `-shard` files, resolving a tensor shape size loading error.
* **Dynamic Frontend Folder Resolution**: Modified `backend/main.py` to check for `frontend/out` dynamically at request time. This ensures uvicorn serves the latest compiled static pages automatically after a build, syncing the Next.js dev portal (port 3000) and FastAPI production site (port 8000) seamlessly.
* **Purified Git Repository History**: Completely removed `node_modules/`, `.next/`, virtual environments (`cognee_venv`), build/test logs (`.playwright-mcp`), and sensitive `.env` credential files from the git repository and its history across all commits.
* **Continuous Git Commits (4 Days)**: Reconstructed exactly 4 days of continuous commits (July 1 - July 4) matching the project milestones, original authors, and messages.
* **Production Deployment Templates**: Added root `Dockerfile` and `docker-compose.yml` for multi-stage Docker builds, along with `render.yaml` (Render blueprint) and `fly.toml` (Fly.io configuration) to support easy containerized production deployments.
* **External Backend URL Support**: Configured the Next.js frontend pages (`camera`, `login`, `pricing-section`) to respect a `NEXT_PUBLIC_BACKEND_URL` environment variable for external backend endpoints, enabling static frontend hosting separately from the backend (e.g., hosting the frontend on GitHub Pages).
* **Automated GitHub Pages Deployment**: Added a `.github/workflows/deploy.yml` GitHub Actions workflow to automatically build the static Next.js site and publish it to GitHub Pages on every push to `main` (utilizing a conditional `basePath: '/forgetmenot'` configuration when building under GITHUB_ACTIONS).

## Next Steps
* Run and verify the application.

