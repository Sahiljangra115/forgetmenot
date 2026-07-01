# ForgetMeNot, the pitch

This is the judge-facing narrative: the problem we are solving and how we
solve it, told the way we would say it out loud. SUBMISSION.md is the
form-style companion (links, criteria mapping, API table). This file is the
story. Use it as the demo video script and as the opening of the README.

---

## The problem

Meet Margaret. She is 78, she has mid-stage dementia, and every morning her
daughter Priya lets herself into the house with a key Margaret gave her
thirty years ago.

Some mornings Margaret lights up. Other mornings she stands in the hallway
looking at Priya with polite, frightened blankness, because the face in front
of her has come loose from everything she knows about it. The name, the
relationship, the memory of last Tuesday's visit, all of it is there
somewhere, but she cannot reach it in the moment she needs it.

This is one of the earliest and cruelest losses in dementia: not the memories
themselves, but access to them at the right moment. The person is standing
right there. The context is missing.

Now notice something. This is exactly the disease this hackathon is named
after. An LLM has the same condition: every request is stateless, every
session starts blank, the context that would make sense of the moment is
gone. "The Hangover Part AI: Where's My Context?" is a joke about agents, but
for 55 million people living with dementia worldwide it is Tuesday morning.

We built the cure for both at once.

## The solution

ForgetMeNot is a memory prosthetic. A camera looks at whoever is in front of
the user, recognizes the face, asks its memory "what do I know about this
person," and overlays a short, warm reminder card anchored to their face:

> **Priya. Your daughter.** She visited Tuesday and brought tomatoes from her
> garden. Ask her about Aarav's football match.

No headset, no hardware. A webcam and a browser. The card is drawn on a
canvas over the live video, standing in for the smart-glasses version of this
product the way a wireframe stands in for a building.

### How it remembers: the full Cognee lifecycle

The memory layer is Cognee, and we use the whole lifecycle, not a slice of
it. Each of the four operations is a beat in Margaret's day:

**1. remember(), the encounter.** When Priya visits, observations from the
visit ("mentioned her garden again", a transcribed voice note) go into
Cognee's fast session memory, scoped to Priya. Raw, cheap, immediate.

**2. recall(), the hallway moment.** Next time the camera sees Priya's face,
the app calls recall scoped to her. Cognee routes the query across its
hybrid graph and vector store and returns what matters, and an LLM turns it
into the one line Margaret needs. Median path: face in frame to card on
screen in about a second.

**3. improve()/memify, the sleep cycle.** Raw session notes are noisy. On
distillation, the accumulated observations are promoted into Cognee's
permanent knowledge graph as clean, durable facts, then enriched with
memify. This is the part we are proudest of: the reminder card is visibly
sharper the second time you meet someone than the first. The system does not
just store, it consolidates, the way a human brain does overnight.

**4. forget(), the hard goodbye.** People leave our lives. A caregiver
changes jobs, a friend passes, a family asks for someone's data to be
removed. One button surgically deletes that person: their dataset is pruned
from Cognee and their face leaves the local registry. Point the camera at
them afterward and the system honestly says it does not know them. Forgetting
on purpose is a feature; only forgetting by accident is a disease.

Every one of these calls is printed live in a memory-ops panel on screen
during the demo. You are not asked to trust that the lifecycle runs. You
watch it run.

### What we deliberately did NOT do

- **Faces never leave the browser.** Recognition runs client-side
  (face-api.js); only an anonymous 128-number descriptor is sent to the
  backend. No face image is stored or uploaded anywhere. For a product aimed
  at a vulnerable population, this is not a nice-to-have.
- **Cognee is not misused as a face database.** Cognee stores knowledge about
  people; a small local registry maps faces to identities. Right tool, right
  job.
- **No fake AR hardware claims.** The webcam overlay is the honest demo of a
  glasses-shaped future.

## Why this matters (the impact case)

Dementia care is a caregiver-burnout crisis wrapped around a patient-dignity
crisis. The moment ForgetMeNot targets, "who is this person in front of me,"
is small, concrete, and it happens dozens of times a day. A one-line reminder
at the right second does not cure anything, but it converts a moment of fear
into a moment of connection, and it does so without asking the patient to
learn any new behavior. They just look.

And the mechanism generalizes. The same loop (recognize, recall, remind,
consolidate, forget) works for a nurse meeting forty patients a week, a
teacher with two hundred students, or anyone whose relationships have
outgrown their recall. We built it for Margaret first because if the memory
layer is good enough for someone who cannot compensate for its failures, it
is good enough for everyone else.

## The 30-second version

ForgetMeNot is a webcam app for dementia care. It recognizes the face in
front of you and shows a one-line reminder of who they are and what matters
about them right now. Faces stay in the browser; the memory lives in Cognee,
and we use its entire lifecycle: encounters go into session memory
(remember), face matches query it (recall), distillation promotes clean
facts into the permanent graph so reminders sharpen with every visit
(improve/memify), and a person can be surgically removed on request
(forget). AI agents wake up every session with amnesia. So does Margaret.
We built the memory layer that hands both of them their context back.

---

*Built during the WeMakeDevs x Cognee hackathon, June 29 to July 5, 2026,
with AI assistance (Claude Code), declared per the hackathon rules.*
