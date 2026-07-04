# Test the Fixes Now

## TL;DR

**Issue 1: Different UI on localhost vs network IP**
- ✅ FIXED by using `window.location.hostname` instead of hardcoded "localhost"

**Issue 2: No way to provide LLM API keys**
- ✅ FIXED by adding "LLM API Settings" panel on camera page with 6 providers

---

## Test in 5 Minutes

### Step 1: Build Frontend
```bash
cd frontend
npm run build
```
Expected: Build completes with "✓ Compiled successfully"

### Step 2: Start Backend
```bash
cd backend
pip install -r ../requirements.txt
uvicorn main:app --reload --port 8000
```
Expected: Server runs on http://localhost:8000

### Step 3: Start Frontend Dev Server (New Terminal)
```bash
cd frontend
npm run dev
```
Expected: Frontend runs on http://localhost:3000

### Step 4: Test Fix #1 - Same UI Everywhere
```
Option A (localhost):
  Open: http://localhost:3000
  
Option B (Network):
  Find your server IP: hostname -I or ipconfig
  Open: http://192.168.x.x:3000
  
Expected: Both URLs show identical UI and connect to backend
```

Check in browser console:
- Network tab should show requests to http://[your-host]:8000 (not localhost)
- WebSocket should connect to ws://[your-host]:8000/ws

### Step 5: Test Fix #2 - LLM API Settings
```
1. Go to http://localhost:3000/camera
2. Scroll down to bottom of page
3. Look for "LLM API Settings" button (green with settings icon)
4. Click it
5. You should see:
   - Dropdown for provider selection
   - API key input field
   - Model name input field
   - Save button
```

### Step 6: Configure LLM Provider
```
1. Select "OpenAI" from dropdown (or your chosen provider)
2. Paste your API key:
   - Get from https://platform.openai.com/api-keys
3. Enter model name: gpt-4o-mini
4. Click "Save LLM Settings"
5. Check browser console for: "LLM settings saved"
```

If you don't have an API key, test with Ollama:
```
1. Install: https://ollama.ai
2. Run: ollama run mistral
3. Select "Ollama" from dropdown
4. Leave API key blank (not needed)
5. Enter model: mistral
6. Save
```

---

## What Changed

### File 1: frontend/app/camera/page.tsx
- **OLD**: `return window.location.port === "3000" ? "http://localhost:8000" : "";`
- **NEW**: `return `${protocol}//${hostname}:8000`;`

### File 2: frontend/app/login/page.tsx
- Same fix as above

### File 3: backend/llm.py
- Rewrote entire file to support 6 LLM providers
- Can now handle: OpenAI, Anthropic, OpenRouter, DeepSeek, Google, Ollama

### File 4: backend/main.py
- Added endpoint: `POST /api/llm/config`
- Updated CORS to allow all origins

### File 5: requirements.txt
- Added: `anthropic` (for Claude support)

---

## Supported LLM Providers

| Provider | Model Example | API Key | Cost |
|----------|---------------|---------|------|
| OpenAI | gpt-4o-mini | Required | $$$ |
| Anthropic | claude-3-5-sonnet-20241022 | Required | $$ |
| OpenRouter | anthropic/claude-3.5-sonnet | Required | $ (cheapest) |
| DeepSeek | deepseek-chat | Required | $ (cheap) |
| Google | gemini-2.0-flash | Required | Free tier available |
| Ollama | mistral, neural-chat | NOT needed | Free (local) |

---

## Troubleshooting

### "Cannot connect to backend from network IP"
- Check backend is running: `curl http://localhost:8000/api/status`
- Check network isn't blocking port 8000
- Verify frontend is using correct IP in Network tab

### "LLM API Settings button doesn't appear"
- Scroll down on camera page (at bottom)
- Check console for JavaScript errors
- Try refreshing page with Ctrl+Shift+R (hard refresh)

### "Cannot save LLM settings"
- Check API key is correct (paste in provider's website to verify)
- Check model name is valid for that provider
- Look in browser console for error message
- Check backend is running: `curl http://localhost:8000/api/status`

### "LLM functions not working after saving settings"
- Transcription only works with OpenAI provider
- Other providers work for summarization and distillation
- Check browser console for LLM error messages

---

## Success Criteria

- [ ] Frontend builds without errors
- [ ] Backend starts without errors
- [ ] Accessing localhost:3000 connects to backend
- [ ] Accessing network-IP:3000 connects to backend
- [ ] Both URLs show identical UI
- [ ] "LLM API Settings" button visible on camera page
- [ ] Can select different LLM providers
- [ ] Can enter API key and model
- [ ] Saving settings shows success message
- [ ] No TypeScript or Python errors

---

## Next: Deploy to Your Hackathon

1. Copy entire folder to your demo machine
2. Install Python dependencies: `pip install -r requirements.txt`
3. Install Node dependencies: `cd frontend && npm install`
4. Start backend: `uvicorn backend.main:app --host 0.0.0.0 --port 8000`
5. Start frontend: `npm run dev` (in frontend directory)
6. Users connect to: `http://your-server-ip:3000`
7. Users configure their own LLM keys in settings

---

That's it! You now have:
✅ Single codebase for both localhost and network access
✅ User-configurable LLM with 6 major providers
✅ No need to share API keys
✅ Ready for hackathon demo
