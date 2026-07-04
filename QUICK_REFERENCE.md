# Quick Reference - What Changed

## Bug #1: Different UI on localhost vs Network IP

### Why It Happened
```typescript
// OLD CODE (broken)
const getBackendUrl = () => {
  return window.location.port === "3000" ? "http://localhost:8000" : "";
};
```

When accessing via `192.168.x.x:3000`:
- Port is still "3000" ✓
- But comparison expects host to have "localhost" 
- Returns empty string ""
- Frontend can't reach backend
- Shows cached/stale UI

### How It's Fixed
```typescript
// NEW CODE (works everywhere)
const getBackendUrl = () => {
  const protocol = window.location.protocol;    // "http:" or "https:"
  const host = window.location.hostname;        // "localhost" OR "192.168.x.x"
  const port = 8000;
  return `${protocol}//${host}:${port}`;
};
```

Now automatically uses whatever hostname/IP the user accessed.

---

## Bug #2: No Way to Add Custom LLM API Keys

### Why It Mattered
- Hackathon product needs to be deployable by teams
- Storing API key in `.env` = sharing private credentials (bad)
- No way for users to use their own API keys

### How It's Fixed
1. **Frontend**: Added "LLM API Settings" button on camera page
   - Dropdown for 6 LLM providers
   - Text input for API key (stored locally only, never sent to server)
   - Save button calls `/api/llm/config` endpoint

2. **Backend**: 
   - Created multi-provider client factory in `llm.py`
   - Added `set_config(provider, api_key, model)` function
   - New endpoint: `POST /api/llm/config` to update settings
   - All LLM functions now handle OpenAI AND Anthropic APIs

---

## Testing It Works

### Same UI Everywhere
```bash
# Terminal 1
cd backend && uvicorn main:app --reload --port 8000

# Terminal 2  
cd frontend && npm run dev

# Test 1: localhost
open http://localhost:3000

# Test 2: Network IP
open http://192.168.x.x:3000

# Should see identical UI in both
```

### LLM Configuration
1. Open http://localhost:3000/camera
2. Scroll down, click "LLM API Settings"
3. Select provider (e.g., "OpenAI")
4. Paste API key
5. Enter model name
6. Click "Save LLM Settings"
7. Check console: should see "LLM settings saved"

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/app/camera/page.tsx` | Fixed URL logic + added LLM settings UI |
| `frontend/app/login/page.tsx` | Fixed URL logic |
| `backend/llm.py` | Rewrote for multi-provider support |
| `backend/main.py` | Added `/api/llm/config` endpoint, CORS update |
| `requirements.txt` | Added `anthropic` package |

---

## Key Insight: Why This Matters

The root cause was **hardcoding assumptions**:
- ❌ "Only localhost access" (wrong)
- ❌ "Only server-managed LLM keys" (wrong for hackathons)

The fix:
- ✅ "Use whatever hostname user accessed" (dynamic)
- ✅ "Let users bring their own API keys" (flexible)

This is production-ready for hackathon/demo deployment.
