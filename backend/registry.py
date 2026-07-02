"""Local person registry and face matching.

Each person has one or more 128-d face descriptors (computed client-side by
face-api.js) plus a running list of raw notes awaiting distillation. Matching
is euclidean distance over the descriptors. Persisted to data/registry.json.
"""

import json
import math
import uuid
from pathlib import Path
from threading import Lock

DATA = Path(__file__).parent / "data"
DATA.mkdir(exist_ok=True)
REG_FILE = DATA / "registry.json"
_lock = Lock()


def _load() -> dict:
    if REG_FILE.exists():
        try:
            return json.loads(REG_FILE.read_text())
        except Exception:
            pass
    return {"people": {}}


_state = _load()


def _save() -> None:
    REG_FILE.write_text(json.dumps(_state, indent=2))


def add_person(name: str, relation: str, descriptor: list[float]) -> dict:
    pid = "p_" + uuid.uuid4().hex[:8]
    with _lock:
        _state["people"][pid] = {
            "id": pid,
            "name": name,
            "relation": relation,
            "descriptors": [descriptor],
            "notes": [],
        }
        _save()
        return dict(_state["people"][pid])


def add_descriptor(pid: str, descriptor: list[float]) -> None:
    with _lock:
        if pid in _state["people"]:
            _state["people"][pid]["descriptors"].append(descriptor)
            _save()


def add_note(pid: str, text: str) -> None:
    with _lock:
        if pid in _state["people"]:
            _state["people"][pid]["notes"].append(text)
            _save()


def clear_notes(pid: str) -> None:
    with _lock:
        if pid in _state["people"]:
            _state["people"][pid]["notes"] = []
            _save()


def remove_person(pid: str) -> bool:
    with _lock:
        if pid in _state["people"]:
            del _state["people"][pid]
            _save()
            return True
        return False


def get(pid: str) -> dict | None:
    p = _state["people"].get(pid)
    return dict(p) if p else None


def list_people() -> list[dict]:
    return [
        {"id": p["id"], "name": p["name"], "relation": p["relation"],
         "note_count": len(p["notes"])}
        for p in _state["people"].values()
    ]


def _euclid(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def match(descriptor: list[float], threshold: float) -> tuple[dict | None, float]:
    """Return the closest enrolled person and its distance, or None if too far."""
    best: dict | None = None
    best_d = float("inf")
    for p in _state["people"].values():
        for d in p["descriptors"]:
            if len(d) != len(descriptor):
                continue
            dist = _euclid(descriptor, d)
            if dist < best_d:
                best_d = dist
                best = p
    if best is not None and best_d <= threshold:
        return dict(best), best_d
    return None, best_d
