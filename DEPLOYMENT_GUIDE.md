# Deployment & Testing Guide

## What Was Fixed

### 1. Frontend URL Bug (CRITICAL)
**Issue**: Accessing via network IP (e.g., 192.168.x.x:3000) showed different UI from localhost because API calls were hardcoded to localhost:8000.

**Fix**: Both frontend pages now dynamically construct backend URLs using `window.location.hostname` instead of hardcoded localhost.

**Impact**: ✅ Both localhost:3000 and network-IP:3000 now show identical UI with simultaneous backend updates.

---

### 2. User-Configurable LLM API Keys (NEW FEATURE)
**Issue**: No way for users to provide their own LLM API keys; app required server-side key sharing.

**Fix**: Added LLM API Settings panel where users can:
- Select their LLM provider (OpenAI, Anthropic, OpenRouter, DeepSeek, Google, Ollama)
- Enter their API key (stored locally, never persisted)
- Specify model name
- Save configuration to backend

**Impact**: ✅ Hackathon teams can now deploy without sharing API keys.

---

## Quick Start

### Prerequisites
```bash
# Frontend requires Node.js + npm
node --version  # v18+

# Backend requires Python
python3 --version  # 3.9+
```

### Installation

```bash
# 1. Install backend dependencies
pip install -r requirements.txt

# 2. Install frontend dependencies  
cd frontend
npm install
cd ..
```

### Running Locally

**Terminal 1 - Backend**:
```bash
cd backend
uvicorn main:app --reload --port 8000
```

**Terminal 2 - Frontend (Dev)**:
```bash
cd frontend
npm run dev
```

Open browser: http://localhost:3000

---

### Testing on Network

**Terminal 1 - Backend** (same as above):
```bash
cd backend
uvicorn main:app --reload --port 8000
```

**Terminal 2 - Frontend (Dev)**:
```bash
cd frontend
npm run dev
```

Open browser on different machine: http://<YOUR_IP>:3000
(Replace `<YOUR_IP>` with the server's IP, e.g., 192.168.x.x)

✅ **Both should work identically** - backend API calls use same hostname

---

## LLM Provider Setup

### Option 1: OpenAI
1. Get API key from https://platform.openai.com/api-keys
2. Open http://localhost:3000/camera
3. Click "LLM API Settings"
4. Select "OpenAI"
5. Paste API key
6. Model: `gpt-4o-mini` (or your choice)
7. Save

### Option 2: Anthropic (Claude)
1. Get API key from https://console.anthropic.com/
2. Click "LLM API Settings"
3. Select "Anthropic"
4. Paste API key
5. Model: `claude-3-5-sonnet-20241022`
6. Save

### Option 3: OpenRouter (Cheapest for Demos)
1. Get API key from https://openrouter.ai/keys
2. Click "LLM API Settings"
3. Select "OpenRouter"
4. Paste API key
5. Model: `anthropic/claude-3.5-sonnet` (or any OpenRouter model)
6. Save

### Option 4: Ollama (Free, Local)
1. Install Ollama: https://ollama.ai
2. Run: `ollama run mistral` (first time pulls model)
3. Ollama starts at http://localhost:11434
4. Click "LLM API Settings"
5. Select "Ollama"
6. Skip API key (not needed)
7. Model: `mistral` (or your installed model)
8. Save

### Option 5: DeepSeek
1. Get API key from https://platform.deepseek.com/
2. Click "LLM API Settings"
3. Select "DeepSeek"
4. Paste API key
5. Model: `deepseek-chat`
6. Save

### Option 6: Google Gemini
1. Get API key from https://ai.google.dev/
2. Click "LLM API Settings"
3. Select "Google"
4. Paste API key
5. Model: `gemini-2.0-flash`
6. Save

---

## Production Deployment

### Using Docker (Recommended)
```dockerfile
# Dockerfile
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend ./backend
COPY --from=frontend-build /app/frontend/out ./frontend/out

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Environment Variables (Optional)
```bash
# backend/.env or backend/.env.local
# These are read on startup, but frontend config overrides them

# Default LLM (can be changed from UI)
LLM_PROVIDER=openai
SUMMARY_MODEL=gpt-4o-mini

# Backend port (default 8000)
# BACKEND_PORT=8000

# Cognee config
COGNEE_DATABASE_PATH=/app/data/cognee
```

### Network Considerations
- Backend listens on `0.0.0.0:8000` (accessible from any IP)
- Frontend builds to static HTML in `frontend/out/`
- CORS is set to allow `*` (safe for internal networks)

---

## Troubleshooting

### "Cannot connect to backend"
1. Check backend is running: `curl http://localhost:8000/api/status`
2. Check frontend is accessing correct hostname:
   - Browser console → Network tab
   - Look for request to `http://[your-host]:8000`
3. Verify CORS allows origin (should be `*` in our setup)

### "LLM settings not saving"
1. Check console for error message (click "LLM API Settings" to see logs)
2. Verify API key is correct (try pasting into provider's website)
3. Verify model name matches provider's available models

### "Face recognition not working after LLM change"
1. LLM provider only affects text generation (summaries, reminders)
2. Face recognition is always local (doesn't need LLM)
3. Check if models loaded: Look for green checkmark on camera page

### "Transcription not working"
1. Transcription requires OpenAI provider (Whisper API only)
2. Switch LLM provider to "OpenAI" and try again
3. Check microphone permissions in browser

---

## Files Modified

### Frontend
- `frontend/app/camera/page.tsx` - Added LLM settings UI, fixed backend URL
- `frontend/app/login/page.tsx` - Fixed backend URL

### Backend
- `backend/llm.py` - Multi-provider support (OpenAI, Anthropic, OpenRouter, DeepSeek, Google, Ollama)
- `backend/main.py` - Added `/api/llm/config` endpoint, updated CORS
- `requirements.txt` - Added `anthropic` dependency

---

## Verification Checklist

- [ ] Frontend and backend build without errors
- [ ] Accessing localhost:3000 connects to backend
- [ ] Accessing network-IP:3000 connects to backend (shows same UI)
- [ ] LLM API Settings panel appears on camera page
- [ ] Can select different LLM providers
- [ ] Can enter API key for providers that need it
- [ ] Can save configuration
- [ ] Backend receives POST to `/api/llm/config` successfully
- [ ] Subsequent LLM calls use selected provider

---

## Next Steps

For production:
1. Add persistent user settings storage (database)
2. Encrypt API keys at rest (currently only in runtime memory)
3. Add provider health checks
4. Add usage monitoring/billing integration
5. Consider API key rotation/expiration

For immediate use:
1. Deploy backend with HTTPS (for production)
2. Test LLM provider with real data
3. Add rate limiting to `/api/llm/config`
