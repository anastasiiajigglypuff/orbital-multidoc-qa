# Project Guidelines — Orbital Take-Home

> This is a timed take-home assessment. The full brief is preserved verbatim at the
> bottom of this file. Keep the work anchored to the goals below.

## gstack

Use the **`/browse`** skill from gstack for all web browsing. **Never** use
`mcp__claude-in-chrome__*` tools.

Available gstack skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`,
`/plan-design-review`, `/design-consultation`, `/design-shotgun`, `/design-html`,
`/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`,
`/connect-chrome`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`,
`/setup-deploy`, `/setup-gbrain`, `/retro`, `/investigate`, `/document-release`,
`/document-generate`, `/codex`, `/cso`, `/autoplan`, `/plan-devex-review`,
`/devex-review`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`,
`/learn`.

## Established Goals & Guardrails

**App:** "Orbital" — legal document Q&A for commercial real estate lawyers doing
due diligence. Backend: FastAPI + PydanticAI (Anthropic), PostgreSQL, Alembic.
Frontend: React + Vite + Tailwind + shadcn/Radix. Today it supports **one document
per conversation**; lawyers need to work across **many** documents per deal.

**We are assessed on three things:**
1. **AI-driven development** — shipping high-quality work using AI tools.
2. **Product thinking** — identifying what's valuable and making smart tradeoffs.
3. **Design taste** — building things that feel refined and intuitive.

**Part 1 (~60 min) — Multi-document conversations.** A conversation can hold many
documents. Users can: upload additional docs to an existing conversation; see which
docs are loaded; ask questions spanning any/all docs; view any doc in the reader
panel. Previously uploaded docs **must persist** when new ones are added. How it
*feels to use* matters as much as whether it works.

**Part 2 (~90 min) — Build something valuable.** Analyze `data/usage_events.csv`
(3-week beta, ~50 users) and `data/customer_feedback.md` (verbatim user quotes).
Pick **ONE** high-value improvement, build it, and write a 2–3 paragraph rationale
(what insight drove it, why over alternatives, what's next) in the README or a
`DECISIONS.md`.

**Hard constraints:**
- **Total time ~2–3 hours.** Focused and polished beats exhaustive. Scope under
  pressure is part of the assessment.
- **New public repo — do NOT fork** the original.
- **Deliverables:** Loom video (2–3 min) linked in README; public GitHub repo;
  written Part 2 rationale.

## Agent Directive — keep me on-goal

Before starting any substantial piece of work, check it against the goals above.
**Actively nudge me (flag it and ask before proceeding) if a request drifts**, e.g.:
- Scope creep beyond Part 1 / Part 2 (extra features not tied to the assessed goals).
- Work that risks blowing the ~2–3 hour budget or over-engineers instead of polishing.
- Gold-plating when a focused MVP + good design taste would score better.
- Anything that violates a hard constraint (forking instead of a new repo; skipping
  the Loom or the Part 2 written rationale).

Don't block me — surface the tradeoff concisely, remind me of the established goal,
and let me decide. This directive is mirrored in local memory (`takehome-goals`,
`nudge-on-goal-drift`).

---

## Full Take-Home Brief (verbatim)

## **Part 2 – Technical Task**

We hope you find this challenge fun, different and somewhere you can unleash your creative flair. To be completely transparent, this is what we'll be assessing you on:

1. **AI Driven Development** — Can you ship high quality work using AI tools?
2. **Product thinking** — Can you identify what's valuable and make smart tradeoffs?
3. **Design taste** — Do you build things that feel refined and intuitive?

We expect you to use AI tools throughout, that's how we work.

---

## The Application

Github link: here

You've received a React application (TypeScript, shadcn/ui, Tailwind CSS) for legal document Q&A. It's a ChatGPT-style interface where users can:

- Create new conversations from a sidebar conversation list
- Upload a document to a conversation
- Ask questions about the document in a chat interface
- View the uploaded document in a reader panel on the right
- Receive AI-generated answers that reference the document

The app is functional but limited, it was built quickly under a tight deadline in order to get a MVP out in front of users. Currently, each conversation only supports **a single document**.

Your users are commercial real estate lawyers doing due diligence. They review leases, title reports, environmental assessments, purchase agreements, and more — often dozens of documents per deal. They need to ask questions across multiple documents, not just one.

> ❗ We're looking for you to create a new repo, do not fork this repo please

**Setup instructions:** See the README.

## Part 1: Multi-Document Conversations

**Time guide:** ~60 minutes

Extend the application so that conversations can contain **multiple documents**. Users should be able to:

- Upload additional documents to an existing conversation
- See which documents are loaded in the current conversation
- Ask questions that can reference any or all uploaded documents
- View any of the uploaded documents in the reader panel

**Requirements:**

- The AI should be able to answer questions that span across uploaded documents
- Previously uploaded documents should persist when new ones are added

**Up to you:**

- How the document list is presented within a conversation
- How users switch between documents in the viewer
- How the upload flow changes
- How the UI communicates which documents are available

We care as much about *how this feels to use* as whether it works.

## Part 2: Build Something Valuable

**Time guide:** ~90 minutes

In the `/data` folder you'll find:

- **`usage_events.csv`** — Raw product analytics from our 3-week beta with ~50 users. Contains page views, document uploads, prompts, AI responses, and session data.
- **`customer_feedback.md`** — Verbatim quotes from beta user interviews and support tickets.

Your task: **Analyse this data, identify a high-value improvement you could make to the product, and build it.**

**Deliverable:**

Your feature implementation, plus a short written explanation (2-3 paragraphs) covering:

- What insight from the data drove your decision
- Why you chose this over other options
- What you'd do next with more time

Include this explanation in your README or as a `DECISIONS.md` file.

## Submission

1. **Loom video (2-3 minutes)** — Walk us through what you built, demonstrate the UX, and explain your reasoning. Paste the link in your README.
    1. **GitHub repository** — Push your code to a public repo, **do not fork the existing repo** *(we don't want other candidates stealing you're brilliant ideas 😉)*
2. **Written explanation** — Your Part 2 rationale in the README or a `DECISIONS.md` file.

---

## FAQ

**Can I change the existing features?**
Yes. If you notice something in the existing app that could be better, feel free to improve it. We'd love to hear why you made those changes.

**What if I run out of time?**
That's fine. In your Loom video, tell us what you'd do next. How you scope under time pressure is part of the assessment.

**How much time should I really spend?**
We mean it — 2-3 hours. We'd rather see a focused, polished 2-hour submission than an exhaustive 6-hour one.
