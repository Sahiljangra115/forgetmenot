"""Cognee memory adapter with a local JSON fallback.

Wraps cognee's remember/recall/forget calls. If cognee is missing or
unconfigured, memories are kept in a local JSON file so the app still runs.
Cloud mode uses COGNEE_BASE_URL + COGNEE_API_KEY; local mode uses LLM_API_KEY.
"""

import os
import json
import time
import asyncio
from pathlib import Path
from threading import Lock

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)
_FB_FILE = DATA / "fallback_memory.json"
_fb_lock = Lock()

_cognee = None
_READY = False
_MODE = "fallback"
_CALL_TIMEOUT = float(os.getenv("COGNEE_CALL_TIMEOUT", "45"))

# Verified against real Cognee Cloud (2026-07-03): remember/recall scoped by
# session_id never surfaced content even after 40s of polling, and cognee has
# no session-scoped delete (only dataset-scoped). dataset_name-scoped
# remember/recall found content on the first attempt. So every call below
# maps our per-person `session_id` param onto Cognee's `dataset_name`/
# `dataset` -- one Cognee dataset per enrolled person. This also makes
# forget(dataset=pid) actually delete something.

_OPS: list[str] = []
_OPS_MAX = 50


def _log_op(op: str) -> None:
    _OPS.append(f"[{time.strftime('%H:%M:%S')}] {op}")
    del _OPS[:-_OPS_MAX]


def get_ops() -> list[str]:
    return list(_OPS)


def status() -> dict:
    return {"ready": _READY, "mode": _MODE}


async def init() -> None:
    """Import and connect cognee, falling back to local storage on any error.

    Local mode requires LLM_API_KEY to actually work (cognee embeds text via
    an LLM provider). Without it, claiming "ready" would make every
    remember()/recall() call hang retrying failed embeddings instead of
    falling back, so we refuse local mode early in that case.
    """
    global _cognee, _READY, _MODE
    try:
        import cognee
        _cognee = cognee
        base = os.getenv("COGNEE_BASE_URL")
        key = os.getenv("COGNEE_API_KEY")
        if base and key:
            await cognee.serve(url=base, api_key=key)
            _MODE = "cloud"
        elif os.getenv("LLM_API_KEY"):
            _MODE = "local"
        else:
            raise RuntimeError("no COGNEE_BASE_URL/COGNEE_API_KEY and no LLM_API_KEY")
        _READY = True
        print(f"[memory] cognee ready, mode={_MODE}")
    except Exception as e:
        _READY = False
        _MODE = "fallback"
        print(f"[memory] cognee unavailable, using local fallback: {e}")


async def shutdown() -> None:
    if _READY and _MODE == "cloud" and _cognee is not None:
        try:
            await _cognee.disconnect()
        except Exception as e:
            print(f"[memory] disconnect error: {e}")


async def remember(text: str, session_id: str | None = None) -> None:
    """Store a memory. session_id is really a per-person Cognee dataset name."""
    if _READY and _cognee is not None:
        try:
            dataset_name = session_id or "main_dataset"
            await asyncio.wait_for(
                _cognee.remember(text, dataset_name=dataset_name, self_improvement=True),
                timeout=_CALL_TIMEOUT,
            )
            _log_op(f"remember(dataset={dataset_name}, self_improvement=True)")
            return
        except Exception as e:
            print(f"[memory] remember failed, using fallback: {e}")
    _fb_remember(text, session_id)
    _log_op(f"remember(dataset={session_id or 'main_dataset'}, mode=fallback)")


async def recall(query: str, session_id: str | None = None) -> list[str]:
    """Return memory snippets for a query as plain strings."""
    if _READY and _cognee is not None:
        try:
            datasets = [session_id] if session_id else None
            call = _cognee.recall(query, datasets=datasets)
            results = await asyncio.wait_for(call, timeout=_CALL_TIMEOUT)
            _log_op(f"recall(dataset={session_id or 'main_dataset'}) -> {len(results)} result(s)")
            return [_coerce(r) for r in results if _coerce(r)]
        except Exception as e:
            print(f"[memory] recall failed, using fallback: {e}")
    out = _fb_recall(query, session_id)
    _log_op(f"recall(dataset={session_id or 'main_dataset'}, mode=fallback) -> {len(out)} result(s)")
    return out


async def improve(session_id: str) -> bool:
    """Explicit post-distill enrichment: re-index a person's dataset after new facts land.

    Verified 2026-07-03 against this project's Cognee Cloud tenant: its REST
    API (see /openapi.json) exposes only /remember, /recall, /forget -- no
    /improve or /memify route exists server-side yet, so the call below 404s.
    remember() already runs with self_improvement=True (Cognee's own default),
    which performs the equivalent inline enrichment on every call. We still
    attempt the explicit call so this starts working for free the moment the
    tenant adds the route, and log honestly either way.
    """
    if _READY and _cognee is not None:
        try:
            await asyncio.wait_for(_cognee.improve(dataset=session_id), timeout=_CALL_TIMEOUT)
            _log_op(f"improve(dataset={session_id})")
            return True
        except Exception as e:
            print(f"[memory] improve failed: {e}")
            _log_op(
                f"improve(dataset={session_id}) unavailable on this Cloud tenant "
                f"(no /improve route); remember() already self-improved inline"
            )
            return False
    _log_op(f"improve(dataset={session_id}, mode=fallback, no-op)")
    return False


async def forget(dataset: str) -> None:
    if _READY and _cognee is not None:
        try:
            await asyncio.wait_for(_cognee.forget(dataset=dataset), timeout=_CALL_TIMEOUT)
            _log_op(f"forget(dataset={dataset})")
            return
        except Exception as e:
            print(f"[memory] forget failed: {e}")
    _fb_forget(dataset)
    _log_op(f"forget(dataset={dataset}, mode=fallback)")


def _coerce(result) -> str:
    """Reduce a recall result of unknown shape down to its text."""
    if isinstance(result, str):
        return result.strip()
    for attr in ("text", "content", "summary", "value"):
        v = getattr(result, attr, None)
        if isinstance(v, str) and v.strip():
            return v.strip()
    if isinstance(result, dict):
        for k in ("text", "content", "summary", "value"):
            if isinstance(result.get(k), str):
                return result[k].strip()
    return str(result).strip()


def _fb_load() -> dict:
    if _FB_FILE.exists():
        try:
            return json.loads(_FB_FILE.read_text())
        except Exception:
            return {}
    return {}


def _fb_remember(text: str, session_id: str | None) -> None:
    with _fb_lock:
        store = _fb_load()
        bucket = session_id or "_permanent"
        store.setdefault(bucket, []).append(text)
        _FB_FILE.write_text(json.dumps(store, indent=2))


def _fb_forget(dataset: str) -> None:
    with _fb_lock:
        store = _fb_load()
        store.pop(dataset, None)
        _FB_FILE.write_text(json.dumps(store, indent=2))


def _fb_recall(query: str, session_id: str | None) -> list[str]:
    store = _fb_load()
    out: list[str] = []
    if session_id:
        out += store.get(session_id, [])
    out += store.get("_permanent", [])
    words = {w.lower() for w in query.split() if len(w) > 3}
    if words:
        return sorted(
            out,
            key=lambda s: len(words & {w.lower() for w in s.split()}),
            reverse=True,
        )
    return out
