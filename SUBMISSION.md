# ForgetMeNot — hackathon submission draft

Fill in the bracketed parts before submitting. This is written to speak
directly to the four judging criteria on
https://www.wemakedevs.org/hackathons/cognee.

## Problem

People living with dementia lose the ability to recognise the people closest
to them, family, caregivers, old friends, long before they lose anything
else. That moment (a familiar face, no memory to attach to it) is one of the
most disorienting parts of the disease, for the patient and for the person
standing in front of them.

## Solution

ForgetMeNot is a webcam app that recognises a person's face and shows a short,
warm reminder of who they are: their name, their relationship, and something
true and specific about them, generated from what the app has learned over
past encounters.

- Face recognition runs entirely in the browser (face-api.js). No image is
  ever uploaded, only an anonymous numeric descriptor.
- Memory runs on **Cognee**: raw observations from a visit go into Cognee's
  fast session tier, and are then explicitly **distilled** into Cognee's
  permanent knowledge graph, so the reminder gets sharper the more the person
  is seen. This is the same session-memory-to-permanent-graph pattern Cognee
  highlights across its own hackathon briefs.
- The "AR" is a transparent card drawn on the webcam canvas, anchored to the
  detected face, not a hardware requirement.

## Potential impact

This is not a generic "AI that remembers things" demo. It targets one
specific, painful, underserved moment in dementia care, and the mechanism
(recognise → recall → remind) maps directly onto it. The same mechanism
generalizes to caregivers meeting a new patient, or anyone managing a large
number of relationships they cannot keep straight (which is closer to the
"anything goes" framing of the hackathon).

## Creativity & innovation

The distinguishing piece is the **distillation loop**: it is not a one-shot
remember-then-recall chatbot. Raw notes accumulate in session memory during
an encounter and get explicitly promoted into the permanent graph on demand,
visibly changing what the app says about a person the next time they're
recognised. [Add: the specific moment in your recording where you demonstrate
this, e.g. "at 1:40 in the demo, we show the reminder before and after
distilling a new note."]

## Technical excellence

- One FastAPI backend, memory adapter isolates all Cognee calls to one file
  (`backend/memory.py`), with a local fallback so the app degrades gracefully
  instead of breaking if Cognee is briefly unreachable (verified live: a
  transient DNS blip to the Cloud tenant mid-demo-test caused one write to
  fall back silently and the app kept working without crashing).
- Face matching stays entirely local (`backend/registry.py`), no third-party
  service sees a face image.
- Runs on **Cognee Cloud** (`COGNEE-35` developer credit), targeting the
  "Best Use of Cognee Cloud" track. [Paste your Cognee Cloud
  dashboard/project link here.]
- We didn't assume the multi-tenancy model, we verified it against the real
  API and changed course when the data disagreed. The original plan assumed
  Cognee's `session_id` parameter would isolate and later retrieve each
  enrolled person's memory. Live testing showed session-scoped recall never
  surfaced content (tested up to 40s of polling) and `forget()` has no
  session-scoped delete at all, only dataset-scoped. We switched every
  person's memory to live in its own Cognee **dataset**
  (`dataset_name=personId`), confirmed this returns real content on the
  first recall, and confirmed `forget(dataset=personId)` genuinely deletes
  it. `scripts/verify_cognee.py` encodes this as a real assertion (checks
  the actual remembered text comes back, not just that isolation holds).

## Presentation

- Demo video: [link]
- Repo: [link]
- Team: [names]

## How Cognee is used, precisely

All four named lifecycle operations are exercised, not just implied. Every
call is logged live in the app's "Memory ops" panel so judges can watch each
one fire during the demo, not just take our word for it.

| Cognee call | Where in code | Where in demo | Why |
|---|---|---|---|
| `remember(text, dataset_name=personId, self_improvement=True)` | `memory.remember()`, called from `/api/enroll`, `/api/note`, `/api/transcribe`, `/api/distill` | enrolling someone; adding a note | every write lands in that person's own Cognee dataset; `self_improvement=True` (Cognee's own default) runs inline enrichment on each call |
| `recall(query, datasets=[personId])` | `memory.recall()`, called from the `/ws` live-match loop | camera recognises someone, reminder card appears | scoped lookup, one person's dataset only |
| `improve(dataset=personId)` | `memory.improve()`, called right after distill in `POST /api/distill` | after hitting "Distill notes" | explicit post-distill enrichment call, named in the rules text. **Honest finding**: this Cloud tenant's REST API (confirmed via its own `/openapi.json`) currently only serves `/remember`, `/recall`, `/forget` — no `/improve`/`/memify` route is deployed yet, so this call 404s. We call it anyway (starts working for free the moment the tenant adds the route) and log the real outcome either way, rather than silently pretending success. `remember()`'s own `self_improvement=True` already performs the equivalent inline enrichment on every write. |
| `forget(dataset=personId)` | `memory.forget()`, called from `POST /api/forget/{personId}` | "Forget this person" button, confirmed live: person vanishes from the registry, camera shows unrecognised on next view | genuine per-person deletion, verified end to end (not just wired, actually run against the real Cloud tenant) |

**A verified architecture correction, not an assumption carried through**:
the original plan assumed `session_id` would double as a per-person
partition Cognee could later recall from. Testing against the real Cloud
tenant showed that path never surfaced content. We caught it, diagnosed it
(dataset-scoped calls worked on the first try), and rewired `memory.py`
around Cognee's actual behavior before it ever reached the demo.

## AI-tooling disclosure

This project was built with **Claude Code** (Anthropic's CLI agent), used for
architecture, implementation, debugging (including diagnosing the
session_id-vs-dataset issue above by testing directly against the live
Cognee Cloud API), and this submission document. No other AI coding
assistant was used. Disclosed per the hackathon's AI-tooling rule.
