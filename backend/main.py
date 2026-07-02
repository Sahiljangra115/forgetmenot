"""ForgetMeNot backend.

Serves the frontend, handles enroll/note/transcribe/distill, and runs the
live recall loop over a WebSocket. Faces are matched locally; memory lives
in Cognee. Run with: uvicorn backend.main:app --reload --port 8000
"""

import os
import time
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import auth
import memory
import payments
import registry
import llm

load_dotenv()
# Load project root env to fetch Cognee credentials if uvicorn is run from backend directory
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

def get_frontend_dir() -> Path:
    base = Path(__file__).resolve().parent.parent / "frontend"
    out_dir = base / "out"
    if out_dir.exists() and out_dir.is_dir():
        return out_dir
    return base

MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.55"))
RECALL_TTL = float(os.getenv("RECALL_TTL", "30"))

_reminder_cache: dict[str, tuple[str, float]] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await memory.init()
    yield
    await memory.shutdown()


app = FastAPI(title="ForgetMeNot", lifespan=lifespan)

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EnrollBody(BaseModel):
    name: str
    relation: str
    descriptor: list[float]
    seed: str | None = None


class NoteBody(BaseModel):
    person_id: str
    text: str


class DistillBody(BaseModel):
    person_id: str


class ThresholdBody(BaseModel):
    value: float


class SignupBody(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginBody(BaseModel):
    email: str
    password: str


class CreateOrderBody(BaseModel):
    plan: str


class VerifyPaymentBody(BaseModel):
    order_id: str
    payment_id: str
    signature: str
    plan: str


async def _record_observation(person: dict, text: str) -> None:
    """Write one raw observation to session memory and the local note log."""
    registry.add_note(person["id"], text)
    await memory.remember(f"Observation about {person['name']}: {text}",
                          session_id=person["id"])
    _invalidate(person["id"])


def _cached_reminder(pid: str) -> str | None:
    """Non-blocking cache check, so the face label never waits on it."""
    cached = _reminder_cache.get(pid)
    if cached and (time.time() - cached[1]) < RECALL_TTL:
        return cached[0]
    return None


async def _recall_reminder(person: dict) -> str:
    """Recall a person's memory into one reminder, cached for RECALL_TTL."""
    pid = person["id"]
    cached = _cached_reminder(pid)
    if cached is not None:
        return cached
    query = f"What should I remember about {person['name']} my {person['relation']}?"
    snippets = await memory.recall(query, session_id=pid)
    summary = await llm.one_liner(person, snippets)
    _reminder_cache[pid] = (summary, time.time())
    return summary


def _invalidate(pid: str) -> None:
    _reminder_cache.pop(pid, None)


@app.get("/api/status")
async def status():
    return {"memory": memory.status(), "threshold": MATCH_THRESHOLD}


@app.get("/api/people")
async def people():
    return {"people": registry.list_people()}


@app.post("/api/enroll")
async def enroll(body: EnrollBody):
    if len(body.descriptor) != 128:
        return JSONResponse({"error": "descriptor must be 128 floats"}, status_code=400)
    person = registry.add_person(body.name.strip(), body.relation.strip(), body.descriptor)
    if body.seed and body.seed.strip():
        fact = f"About {person['name']} ({person['relation']}): {body.seed.strip()}"
        await memory.remember(fact, session_id=person["id"])
    _invalidate(person["id"])
    return {"person": {"id": person["id"], "name": person["name"],
                       "relation": person["relation"]}}


@app.post("/api/note")
async def note(body: NoteBody):
    person = registry.get(body.person_id)
    if not person:
        return JSONResponse({"error": "unknown person"}, status_code=404)
    text = body.text.strip()
    if not text:
        return JSONResponse({"error": "empty note"}, status_code=400)
    await _record_observation(person, text)
    return {"ok": True, "note_count": len(registry.get(person["id"])["notes"])}


@app.post("/api/transcribe")
async def transcribe(person_id: str = Form(...), audio: UploadFile = File(...)):
    """Transcribe a short clip and log it as an observation for person_id.

    No diarization: the whole clip is attributed to whoever is currently
    matched, which is the plan's explicit stand-in for speaker separation.
    """
    person = registry.get(person_id)
    if not person:
        return JSONResponse({"error": "unknown person"}, status_code=404)
    data = await audio.read()
    text = await llm.transcribe(data, audio.filename or "clip.webm")
    if not text:
        return JSONResponse(
            {"error": "transcription unavailable (no OPENAI_API_KEY, or empty audio)"},
            status_code=422,
        )
    await _record_observation(person, text)
    return {"ok": True, "transcript": text,
            "note_count": len(registry.get(person["id"])["notes"])}


@app.get("/api/conversation/summary")
async def conversation_summary(person_id: str):
    """Short summary + bullets from a person's pending session notes, for the
    live 'view more details' card on the demo page."""
    person = registry.get(person_id)
    if not person:
        return JSONResponse({"error": "unknown person"}, status_code=404)
    result = await llm.summarize_conversation(person, person.get("notes", []))
    return result


@app.post("/api/threshold")
async def set_threshold(body: ThresholdBody):
    global MATCH_THRESHOLD
    MATCH_THRESHOLD = max(0.2, min(1.0, body.value))
    return {"threshold": MATCH_THRESHOLD}


@app.post("/api/distill")
async def distill(body: DistillBody):
    """Promote a person's raw session notes into one durable graph fact."""
    person = registry.get(body.person_id)
    if not person:
        return JSONResponse({"error": "unknown person"}, status_code=404)
    fact = await llm.distill(person, person.get("notes", []))
    if not fact:
        return JSONResponse({"error": "no notes to distill"}, status_code=400)
    await memory.remember(fact, session_id=person["id"])
    await memory.improve(person["id"])
    registry.clear_notes(person["id"])
    _invalidate(person["id"])
    summary = await _recall_reminder(person)
    return {"ok": True, "distilled": fact, "reminder": summary}


@app.post("/api/forget/{person_id}")
async def forget_person(person_id: str):
    person = registry.get(person_id)
    if not person:
        return JSONResponse({"error": "unknown person"}, status_code=404)
    await memory.forget(dataset=person_id)
    registry.remove_person(person_id)
    _invalidate(person_id)
    return {"ok": True, "forgotten": person_id}


@app.get("/api/ops")
async def ops():
    return {"ops": memory.get_ops()}


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            msg = await websocket.receive_json()
            if msg.get("type") != "recall":
                continue
            descriptor = msg.get("descriptor")
            if not isinstance(descriptor, list) or len(descriptor) != 128:
                await websocket.send_json({"type": "none"})
                continue
            person, dist = registry.match(descriptor, MATCH_THRESHOLD)
            if person is None:
                await websocket.send_json({"type": "none", "distance": round(dist, 3)})
                continue
            pid = person["id"]
            # Face match is local and instant; recall+LLM are the slow part.
            # Send the label immediately, backfill the summary once ready, so
            # switching between people never looks stuck waiting on a network
            # round trip just to show a name.
            cached = _cached_reminder(pid)
            await websocket.send_json({
                "type": "match",
                "person_id": pid,
                "name": person["name"],
                "relation": person["relation"],
                "summary": cached,
                "distance": round(dist, 3),
            })
            if cached is None:
                summary = await _recall_reminder(person)
                await websocket.send_json({"type": "summary", "person_id": pid, "summary": summary})
    except WebSocketDisconnect:
        return
    except Exception as e:
        print(f"[ws] error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass


def _current_user(request: Request) -> dict | None:
    return auth.resolve_session(request.cookies.get(auth.SESSION_COOKIE))


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.SESSION_COOKIE, token, max_age=auth.SESSION_TTL,
        httponly=True, samesite="lax",
    )


@app.post("/api/auth/signup")
async def auth_signup(body: SignupBody, response: Response):
    try:
        user = auth.signup(body.email, body.password, body.name)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    token = auth.create_session(user["id"])
    _set_session_cookie(response, token)
    return {"ok": True, "user": auth.public(user)}


@app.post("/api/auth/login")
async def auth_login(body: LoginBody, response: Response):
    try:
        user = auth.login(body.email, body.password)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=401)
    token = auth.create_session(user["id"])
    _set_session_cookie(response, token)
    return {"ok": True, "user": auth.public(user)}


@app.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response):
    auth.destroy_session(request.cookies.get(auth.SESSION_COOKIE))
    response.delete_cookie(auth.SESSION_COOKIE)
    return {"ok": True}


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = _current_user(request)
    if not user:
        return JSONResponse({"error": "not signed in"}, status_code=401)
    return {"user": auth.public(user)}


@app.get("/api/auth/status")
async def auth_status():
    return {"google_configured": auth.google_configured(), "payments_configured": payments.configured()}


@app.get("/api/auth/google/login")
async def auth_google_login(request: Request):
    base_url = str(request.base_url).rstrip("/")
    redirect_uri = f"{base_url}/api/auth/google/callback"
    url = auth.google_login_url(state=os.urandom(8).hex(), redirect_uri=redirect_uri)
    if not url:
        return JSONResponse({"error": "Google sign-in is not configured on this server."}, status_code=400)
    return RedirectResponse(url)


@app.get("/api/auth/google/callback")
async def auth_google_callback(request: Request, code: str, response: Response):
    try:
        base_url = str(request.base_url).rstrip("/")
        redirect_uri = f"{base_url}/api/auth/google/callback"
        user = await auth.google_exchange_code(code, redirect_uri=redirect_uri)
    except Exception as e:
        print(f"[auth] google callback failed: {e}")
        return RedirectResponse("/login?error=google_failed")
    token = auth.create_session(user["id"])
    redirect = RedirectResponse("/camera")
    _set_session_cookie(redirect, token)
    return redirect


@app.post("/api/payments/create-order")
async def payments_create_order(body: CreateOrderBody, request: Request):
    user = _current_user(request)
    if not user:
        return JSONResponse({"error": "sign in first"}, status_code=401)
    try:
        order = payments.create_order(body.plan, user["id"])
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except payments.NotConfiguredError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    except RuntimeError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    return order


@app.post("/api/payments/verify")
async def payments_verify(body: VerifyPaymentBody, request: Request):
    user = _current_user(request)
    if not user:
        return JSONResponse({"error": "sign in first"}, status_code=401)
    try:
        ok = payments.verify_payment(body.order_id, body.payment_id, body.signature)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    except payments.NotConfiguredError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    # Signature mismatch: 400, and the plan is deliberately NOT recorded —
    # only a verified signature marks the account as paid.
    if not ok:
        return JSONResponse({"error": "signature verification failed"}, status_code=400)
    auth.set_plan(user["id"], body.plan)
    return {"ok": True, "plan": body.plan}


@app.post("/api/llm/config")
async def llm_config(body: dict, request: Request):
    """Update LLM provider configuration from frontend."""
    user = _current_user(request)
    if not user:
        return JSONResponse({"error": "sign in first"}, status_code=401)
    
    try:
        provider = body.get("provider", "openai")
        api_key = body.get("api_key", "")
        model = body.get("model", "gpt-4o-mini")
        
        valid_providers = ["openai", "anthropic", "ollama", "openrouter", "deepseek", "google"]
        if provider not in valid_providers:
            return JSONResponse({"error": f"Invalid provider. Must be one of: {', '.join(valid_providers)}"}, status_code=400)
        
        if provider != "ollama" and not api_key:
            return JSONResponse({"error": f"API key required for {provider}"}, status_code=400)
        
        if not model:
            return JSONResponse({"error": "Model name is required"}, status_code=400)
        
        llm.set_config(provider, api_key, model)
        
        return {"success": True, "message": f"LLM configured to use {provider} with model {model}"}
    except Exception as e:
        print(f"[llm] config error: {e}")
        return JSONResponse({"error": str(e)}, status_code=400)


@app.get("/{file_path:path}")
async def serve_static_file(file_path: str):
    # If the file path is empty, serve the landing page index.html
    if not file_path:
        file_path = "index.html"
    
    frontend_dir = get_frontend_dir()
    # Try serving the file directly
    p = frontend_dir / file_path
    if p.exists() and p.is_file():
        return FileResponse(str(p))
    
    # Try adding .html (e.g. /camera -> camera.html)
    p_html = frontend_dir / f"{file_path}.html"
    if p_html.exists() and p_html.is_file():
        return FileResponse(str(p_html))

    # Try directory index (e.g. /camera -> /camera/index.html)
    p_index = frontend_dir / file_path / "index.html"
    if p_index.exists() and p_index.is_file():
        return FileResponse(str(p_index))
        
    # Fallback to main index.html for client-side routing
    p_main = frontend_dir / "index.html"
    if p_main.exists():
        return FileResponse(str(p_main))
    
    return JSONResponse({"error": "not found"}, status_code=404)
