"""Email/password + Google OAuth accounts, same local-JSON pattern as
registry.py. Not a real identity provider: good enough for a demo, not for
a real production user base (no email delivery, no password reset flow).

Sessions are opaque tokens in a server-side dict, sent back as an httponly
cookie. No JWT needed since we never verify sessions outside this process.
"""

import hashlib
import hmac
import json
import os
import secrets
import time
import uuid
from pathlib import Path
from threading import Lock

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)
USERS_FILE = DATA / "users.json"
_lock = Lock()

SESSION_COOKIE = "fmn_session"
SESSION_TTL = 60 * 60 * 24 * 14  # 14 days

_sessions: dict[str, tuple[str, float]] = {}  # token -> (user_id, expires_at)


def _load() -> dict:
    if USERS_FILE.exists():
        try:
            return json.loads(USERS_FILE.read_text())
        except Exception:
            pass
    return {"users": {}}


_state = _load()


def _save() -> None:
    USERS_FILE.write_text(json.dumps(_state, indent=2))


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"{salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, _ = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(_hash_password(password, bytes.fromhex(salt_hex)), stored)


def find_by_email(email: str) -> dict | None:
    email = email.strip().lower()
    for u in _state["users"].values():
        if u["email"] == email:
            return dict(u)
    return None


def get(user_id: str) -> dict | None:
    u = _state["users"].get(user_id)
    return dict(u) if u else None


def _public(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "verified": user["verified"],
        "plan": user.get("plan", "starter"),
        "provider": user.get("provider", "password"),
    }


def signup(email: str, password: str, name: str) -> dict:
    if find_by_email(email):
        raise ValueError("An account with that email already exists.")
    uid = "u_" + uuid.uuid4().hex[:10]
    with _lock:
        _state["users"][uid] = {
            "id": uid,
            "email": email.strip().lower(),
            "name": name.strip() or email.split("@")[0],
            "password_hash": _hash_password(password),
            # No SMTP configured for this demo, so verification is simulated
            # instead of blocking signup on an email the app cannot send.
            "verified": True,
            "plan": "starter",
            "provider": "password",
            "created_at": time.time(),
        }
        _save()
        return dict(_state["users"][uid])


def login(email: str, password: str) -> dict:
    user = find_by_email(email)
    if not user or user.get("provider") != "password":
        raise ValueError("Invalid email or password.")
    if not _verify_password(password, user["password_hash"]):
        raise ValueError("Invalid email or password.")
    return user


def upsert_google_user(google_id: str, email: str, name: str) -> dict:
    with _lock:
        for u in _state["users"].values():
            if u.get("google_id") == google_id:
                return dict(u)
        existing = find_by_email(email)
        if existing:
            _state["users"][existing["id"]]["google_id"] = google_id
            _state["users"][existing["id"]]["provider"] = "google"
            _save()
            return dict(_state["users"][existing["id"]])
        uid = "u_" + uuid.uuid4().hex[:10]
        _state["users"][uid] = {
            "id": uid,
            "email": email.strip().lower(),
            "name": name or email.split("@")[0],
            "google_id": google_id,
            "verified": True,
            "plan": "starter",
            "provider": "google",
            "created_at": time.time(),
        }
        _save()
        return dict(_state["users"][uid])


def set_plan(user_id: str, plan: str) -> None:
    with _lock:
        if user_id in _state["users"]:
            _state["users"][user_id]["plan"] = plan
            _save()


def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = (user_id, time.time() + SESSION_TTL)
    return token


def resolve_session(token: str | None) -> dict | None:
    if not token or token not in _sessions:
        return None
    user_id, expires_at = _sessions[token]
    if time.time() > expires_at:
        _sessions.pop(token, None)
        return None
    return get(user_id)


def destroy_session(token: str | None) -> None:
    if token:
        _sessions.pop(token, None)


def public(user: dict) -> dict:
    return _public(user)


# --- Google OAuth (Authorization Code flow) ---
# Needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI in the
# environment. Until those are set, google_login_url() returns None and the
# frontend shows "Google sign-in isn't configured yet" instead of a dead link.

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def google_configured() -> bool:
    return bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))


def google_login_url(state: str, redirect_uri: str | None = None) -> str | None:
    if not google_configured():
        return None
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not redirect_uri:
        redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
    from urllib.parse import urlencode
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def google_exchange_code(code: str, redirect_uri: str | None = None) -> dict:
    """Exchange an auth code for tokens, then fetch the profile. Returns the
    upserted local user dict."""
    import httpx
    if not redirect_uri:
        redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")
    async with httpx.AsyncClient(timeout=10) as client:
        token_res = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": os.getenv("GOOGLE_CLIENT_ID"),
            "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        })
        token_res.raise_for_status()
        access_token = token_res.json()["access_token"]

        profile_res = await client.get(GOOGLE_USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
        profile_res.raise_for_status()
        profile = profile_res.json()

    return upsert_google_user(profile["sub"], profile.get("email", ""), profile.get("name", ""))
