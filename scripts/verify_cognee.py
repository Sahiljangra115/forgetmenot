"""Check that session_id actually isolates memory between two people.

The project plan flags this as the single biggest unverified assumption:
that Cognee's session_id can stand in for per-person memory partitioning.
Run this after setting COGNEE_BASE_URL + COGNEE_API_KEY (or LLM_API_KEY for
local mode) in .env. Exits non-zero if one person's session leaks into the
other's recall.
"""

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

import memory


async def main() -> int:
    await memory.init()
    print(f"mode: {memory.status()}")

    await memory.remember("Alice loves painting sunsets.", session_id="verify_alice")
    await memory.remember("Bob collects vintage stamps.", session_id="verify_bob")

    # Cloud mode indexes (cognify) async server-side; content may not be
    # searchable the instant remember() returns. Poll instead of one-shot.
    alice, bob = [], []
    for attempt in range(8):
        alice = await memory.recall("What does Alice like?", session_id="verify_alice")
        bob = await memory.recall("What does Bob like?", session_id="verify_bob")
        alice_text = " ".join(alice).lower()
        bob_text = " ".join(bob).lower()
        if "sunsets" in alice_text and "stamps" in bob_text:
            break
        print(f"  (attempt {attempt + 1}: content not indexed yet, retrying in 5s)")
        await asyncio.sleep(5)

    print("alice recall:", alice)
    print("bob recall:", bob)

    alice_text = " ".join(alice).lower()
    bob_text = " ".join(bob).lower()
    leaked = "stamps" in alice_text or "sunsets" in bob_text
    found = "sunsets" in alice_text and "stamps" in bob_text

    await memory.shutdown()

    if leaked:
        print("FAIL: session_id did not isolate memory between people.")
        return 1
    if not found:
        print("FAIL: recall never returned the actual remembered content "
              "(isolation alone is not proof memory works).")
        return 1
    print("PASS: session_id isolates memory per person, and recall returns real content.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
