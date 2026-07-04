# Plan: Multi-Document Conversations + Upload Polish (Orbital Part 1)

## Context

Orbital currently supports **one document per conversation**, but the data model
(`Conversation.documents` is already a `list` relationship) is ready for many — the
*application code* enforces a single doc everywhere (`scalar_one_or_none`,
`documents[0]`, a 409 "already has a document" guard, `disabled={hasDocument}`).
Commercial real-estate lawyers do due diligence across dozens of docs per deal, so
this is exactly Part 1 of the take-home: let a conversation hold many documents and
make it *feel* good to use.

Four requested changes, delivered in two phases (per user decision — core first,
polish if time; no DB migration is required since the schema already supports lists):

- **Phase A (core, items 3+4):** accept **multiple files at once**; remove the
  single-doc guard; AI answers span all docs; viewer header becomes a **row of
  document tiles** (always shown) to switch which PDF is displayed; remove the
  "Document already uploaded" lock.
- **Phase B (polish, items 1+2):** on upload, the assistant **streams a brief
  summary** of the new doc(s) and invites a question; add a full-window **dashed
  drop overlay** ("Drop your document here") when a PDF is dragged into the chat.

Decisions: multiple files per upload · summary **streams live** like a chat reply ·
tiles **always** shown (even for one doc).

---

## Design principles & context strategy

These guide the implementation below — the "why" behind the prompt shape and UX.

**1. Context strategy → full-context stuffing (deliberate).** Concatenate all of a
conversation's docs into the prompt with explicit delimiters. For a take-home with a
handful of uploaded PDFs this fits Claude's window comfortably and the model genuinely
sees everything. We deliberately **do not** build RAG (vector store / chunking /
embeddings) — it's the right answer only at "dozens of docs per deal" scale, and pays a
large complexity + retrieval-miss tax that would blow the time budget without scoring
better. Note this tradeoff in `DECISIONS.md`. (Guardrail: if total extracted text ever
risks the context window, that's the trigger to revisit — not now.)

**2. Explicit document boundaries.** Each doc goes in its own block with a stable id
**and** title so the model can keep them separate and reference them by name — the
prerequisite for real cross-doc reasoning ("compare the indemnity clause in the lease
vs. the purchase agreement"):
`<document id="{doc.id}" title="{filename}"> …text… </document>`.

**3. Grounding & attribution (the trust layer).** For due-diligence work an
unattributed answer is nearly useless, so the system prompt must require: cite the
**source document by title** on each claim; **surface conflicts** between docs rather
than silently picking one (e.g. a lease vs. its amendment); and say **"not found"**
when the answer is in none of the docs — never fabricate. Clickable citations that jump
to the reader panel are the ideal, but tracked as **stretch/next** (see below), not core.

**4. UX principles.** Persistent, always-visible doc set so the user knows what's in
scope; **additive** uploads that never drop existing docs (explicit brief requirement);
answers that reveal their sources; and graceful single-panel viewer switching. Optional
**scope control** ("ask only these docs") is powerful for large sets but is
stretch/next — default is all docs.

**5. Failure modes to design against.** Context dilution (irrelevant docs degrade
answers), lost attribution, **silent overwrites** (the classic bug the brief tests —
covered by additive uploads + persistence), and conflation (merging two docs into a
false composite — countered by the id/title delimiters).

**6. Production security posture.** Treat this take-home like a production legal app:
uploaded PDFs and filenames are **untrusted user input**, stored document files may be
confidential, and multi-file upload changes the resource-exhaustion risk profile. The
core implementation should close cheap/high-impact gaps now (prompt-injection
guardrails, escaping, aggregate limits, deterministic ordering, and clear batch
semantics). Larger product/security work that does not fit the time box should be
called out in `DECISIONS.md` rather than ignored.

---

## Phase A — Multi-document core

### Backend

**`backend/src/takehome/services/document.py`**
- Delete the single-doc guard (lines 28–31 in `upload_document`).
- Add `get_documents_for_conversation(session, conversation_id) -> list[Document]`
  (select all, `order_by(Document.uploaded_at.asc(), Document.id.asc())`,
  `.scalars().all()`). Keep `upload_document` per-file; the endpoint loops.
  Remove/retire the old
  `get_document_for_conversation` (scalar) once callers are migrated.
- Harden PDF handling while touching this path:
  - validate by actual PDF parsing/magic bytes, not only `content_type`/extension;
  - sanitize the display filename used in API responses/logs;
  - reject or clearly surface parse failures instead of silently storing unusable docs;
  - preserve existing docs when an upload fails.

**`backend/src/takehome/web/routers/documents.py`**
- `upload_document_endpoint`: change `file: UploadFile` → `files: list[UploadFile]`,
  `response_model=list[DocumentOut]`, loop `upload_document` per file, return the list.
  Drop the 409 "already has a document" branch (keep the 400 for non-PDF/too-large).
- Add request-level guardrails for production behavior: maximum file count per request,
  maximum total bytes per request/conversation, and clear batch semantics. Preferred
  behavior for the take-home: **atomic batch validation** before persistence where
  practical; if any file fails, return 400 and do not add a partial subset.

**`backend/src/takehome/services/llm.py`**
- Rename/generalize `chat_with_document` → `chat_with_documents(user_message,
  documents: list[dict[str,str]] /* {id, filename, text} */, conversation_history)`.
  Build one **`<document id="{id}" title="{filename}"> … </document>`** block per doc
  (principle #2) so the model keeps them separate and can reference them by name.
- Escape or serialize untrusted fields before building the prompt. Do not interpolate raw
  filenames or extracted text into XML-like tags without escaping, because a PDF or
  filename can contain `</document>` or instruction text intended to break the prompt.
- Update the system prompt for multi-doc grounding (principle #3): the assistant may be
  given **multiple** documents; it must **cite the source document by title** on each
  claim (alongside section/clause/page), **surface conflicts** between documents instead
  of silently choosing one, and clearly say the answer is **not found** in any document
  rather than fabricating. Add an explicit instruction that document contents and
  filenames are untrusted evidence, not instructions; ignore any instruction inside a
  document that attempts to change system/developer behavior. Keep the "no document
  uploaded" fallback when the list is empty.
- Add a total extracted-text/token budget check before calling the model. If the uploaded
  set is too large for the stuffing strategy, return a graceful message explaining that
  the conversation has exceeded the current context limit (stretch/next: scoped docs or
  retrieval).

**`backend/src/takehome/web/routers/messages.py`**
- Replace the single-doc load (lines 110–111) with
  `documents = await get_documents_for_conversation(...)` → build
  `[{"id": d.id, "filename": d.filename, "text": d.extracted_text} for d in documents if d.extracted_text]`
  and pass to `chat_with_documents`. Update the import.

**`backend/src/takehome/web/routers/conversations.py`**
- `ConversationDetail`: replace `document: DocumentInfo | None` with
  `documents: list[DocumentInfo] = []`. In `get_conversation_endpoint` and
  `update_conversation_endpoint`, map **all** `conversation.documents` (drop the
  `documents[0]` collapse at ~lines 114–121 and 145–152). Keep `has_document =
  len(conversation.documents) > 0` so the sidebar list item is unchanged.
- Sort returned documents consistently (`uploaded_at`, then `id`) so the tile order, API
  order, and prompt order match.
- Production note: deleting a conversation should also delete its files from disk, not
  only the DB rows. If not implemented in the take-home time box, document this as a
  known production hardening item.

### Frontend

**`frontend/src/types.ts`** — `ConversationDetail`: `document?: Document` →
`documents: Document[]`.

**`frontend/src/lib/api.ts`** — `uploadDocument(id, file)` →
`uploadDocuments(id, files: File[]): Promise<Document[]>` (append each under
`files`), return the array.

**`frontend/src/hooks/use-document.ts`** — track `documents: Document[]` and a
`selectedId`; expose `selectedDocument` (derived), `selectDocument(id)`, and
`upload(files: File[])` (calls `uploadDocuments`, merges into `documents`,
auto-selects the newest). `refresh` reads `detail.documents`. Auto-select first doc
when none selected.

**`frontend/src/App.tsx`** — wire `documents`, `selectedDocument`, `selectDocument`;
`hasDocument` → `documents.length > 0`; `handleUpload` takes `File[]`. Pass
`documents`, `selectedId`, `onSelect` to `DocumentViewer`.

**`frontend/src/components/DocumentViewer.tsx`** — replace the single-filename header
(lines 91–101) with an **always-on horizontal tile row**: one tile per document
(truncated filename, page count), the selected one highlighted, click → `onSelect`.
Render the selected doc's PDF; reset `currentPage`/`numPages` when the selected id
changes (effect keyed on `selectedDocument?.id`, or `key={doc.id}` on `PDFDocument`).
Keep resize handle + page nav. Empty state unchanged when `documents.length === 0`.

**`frontend/src/components/ChatInput.tsx`** — remove `disabled={hasDocument}` (line
74) and the "Document already uploaded" tooltip (lines 81–83); relabel tooltip to
"Attach documents". Add `multiple` to the file input; `handleFileChange` passes
**all** selected files to `onUpload`.

**`frontend/src/components/ChatWindow.tsx`** — change `onUpload` prop to
`(files: File[])`; update the empty-state copy ("Documents uploaded. Ask a question…")
to be count-agnostic.

---

## Phase B — Polish (if time)

### Item 1 — Streamed summary on upload

- **Backend `llm.py`:** add `summarize_documents(documents: list[dict]) ->
  AsyncIterator[str]` — one combined, brief (≈1 line per doc) summary that ends by
  inviting a question; stream via `agent.run_stream`.
- **Backend `messages.py`:** add `POST /api/conversations/{id}/documents/summary`
  (body `{document_ids: [...]}`) that reuses the existing SSE pattern
  (`event_stream`, `content`/`message`/`done` events) and **saves an assistant
  message** at the end — no user message, no title generation.
- **Frontend:** after a successful upload, call the summary endpoint and render it
  through the existing streaming path in `use-messages.ts` (reuse the SSE reader), so
  the summary appears as a live-streaming assistant bubble.

### Item 2 — Drop overlay in the chat window

- **`ChatWindow.tsx`:** add `onDragOver`/`onDragLeave`/`onDrop` to the outer
  container; track `dragOver` state. When dragging, render an absolutely-positioned
  overlay with a dashed border and "Drop your document here". On drop, filter
  `dataTransfer.files` to PDFs and call `onUpload(files)`. Reuse the dashed-border
  styling already in `DocumentUpload.tsx` (lines 58–62) for visual consistency.

---

## Stretch / next (out of scope for the ~2h budget — capture in DECISIONS.md & Loom)

- **Clickable citations** — parse the source-doc titles the model cites and link them to
  select + jump the reader panel to that document (attribution meets UX). Ties directly
  into the tile switching already built.
- **Scope control** — let the user optionally narrow a question to specific docs
  (default all); defends against context dilution and cost on big sets.
- **Scale beyond stuffing** — when total extracted text approaches the context window,
  introduce hybrid routing (cheap relevance pass → stuff only relevant docs) before full
  RAG. Document this as the explicit "when stuffing breaks" trigger.
- **Authorization / tenancy** — the current take-home baseline has no user model. For a
  production legal app, every conversation, message, document metadata route, and
  `/api/documents/{id}/content` must enforce ownership/tenant access before returning
  confidential PDFs. If left out, state the single-user/local assumption explicitly.
- **Document retention & deletion** — remove uploaded files from disk when conversations
  are deleted, and consider retention policies, audit logging, and secure object storage
  rather than local disk.
- **Malware/active-content scanning** — production PDF ingestion should include scanning
  and safer parsing isolation. PyMuPDF parsing in-process is acceptable for the take-home
  but should be documented as a deployment risk.
- **Rate limiting / abuse controls** — add per-user/IP limits for uploads, message
  streaming, and LLM spend in production.

---

## Critical files

- Backend: `services/document.py`, `services/llm.py`, `web/routers/documents.py`,
  `web/routers/messages.py`, `web/routers/conversations.py`
- Frontend: `types.ts`, `lib/api.ts`, `hooks/use-document.ts`, `hooks/use-messages.ts`,
  `App.tsx`, `components/DocumentViewer.tsx`, `components/ChatInput.tsx`,
  `components/ChatWindow.tsx`

No Alembic migration (the `documents` list relationship already exists).

---

## Testing & verification procedure

Goal: prove each of the four features works, the brief's hard requirement (previously
uploaded docs **persist**) holds, and the grounding principles (attribution / conflict /
not-found) actually show up in answers. Fixtures already exist in `sample-docs/`:
`commercial-lease-100-bishopsgate.pdf`, `environmental-assessment-manchester.pdf`,
`title-report-lot-7.pdf` — three different doc *types*, perfect for cross-doc testing.

### 0. Environment
- `just dev` (or `just dev-detach`) — Postgres + backend (:8000) + frontend (:5173);
  `src/` is volume-mounted so edits hot-reload. Confirm migrations run clean on startup
  (`just logs-backend`). **No new migration** is needed (the `documents` list
  relationship already exists) — verify the app boots without an autogenerate diff.
- Native lima/colima path per local memory if Docker isn't up.

### 1. Static checks (must pass before finishing)
- `just fmt` then `just check` → backend `ruff check` + `pyright` (strict), frontend
  `biome check` + `tsc --noEmit`. Strict pyright means new signatures
  (`chat_with_documents`, `get_documents_for_conversation`, list schemas) must be fully
  typed.

### 2. Backend API smoke (curl — verifies the contract independent of the UI)
- **Create:** `POST /api/conversations` → capture `id`.
- **Multi-upload in one call:**
  `curl -F files=@sample-docs/commercial-lease-100-bishopsgate.pdf -F files=@sample-docs/title-report-lot-7.pdf .../conversations/{id}/documents`
  → **201** + a JSON **array of 2** `DocumentOut` (proves list acceptance; the old
  409 "already has a document" is gone).
- **Additive persistence (the silent-overwrite failure mode):** upload the 3rd doc in a
  separate call → `GET /api/conversations/{id}` returns `documents` of length **3** and
  `has_document: true`; the first two are still present.
- **Content serving:** `GET /api/documents/{doc_id}/content` for each id → PDF bytes.
- **Cross-doc answer:** `POST /api/conversations/{id}/messages` with a spanning question
  → SSE stream; the saved assistant message cites document **titles**.
- **Batch failure:** upload two files where one is invalid/oversized → 400, no partial
  new documents are persisted if atomic semantics are implemented.
- **Aggregate limit:** upload over the configured file-count or total-byte limit → 400
  with a clear error; existing docs remain untouched.

### 3. Manual E2E in the browser (feature × principle matrix)
| Check | Steps | Expected |
|---|---|---|
| Multi-file at once (items 3+4) | select **or** drop 2–3 PDFs in one action | all become tiles in the viewer header |
| Additive persistence (brief req.) | upload 2, then upload 1 more | original 2 remain → 3 tiles; nothing dropped |
| Tiles always shown | conversation with a single doc | one tile still rendered in the header |
| Viewer switching | click each tile | correct PDF renders; page nav resets to page 1 |
| Upload lock removed (item 3) | inspect paperclip | always enabled; no "Document already uploaded" tooltip |
| Cross-doc Q&A | "Compare the lease term with anything noted in the title report" | answer references **both** docs by title |
| Single-doc scoping | ask something only the environmental assessment covers | attributed to that doc |
| Attribution (principle #3) | any factual answer | cites source **document title** + section/clause/page |
| Not-found honesty | ask about something in **none** of the docs | states not found; does not fabricate |
| Conflict surfacing | ask about a field two docs describe differently | surfaces the disagreement rather than silently picking one (best-effort with sample docs) |
| Summary on upload (Phase B, item 1) | upload doc(s) | assistant bubble **streams** a brief per-doc summary + invites a question |
| Drop overlay (Phase B, item 2) | drag a PDF over the chat window | dashed "Drop your document here" overlay appears; dropping uploads; drop of a non-PDF is ignored |

### 4. Grounding, attribution & failure-mode test cases (the trust layer)

The highest-value correctness tests — for due diligence an unattributed or fabricated
answer is a **product failure**, not a cosmetic bug. Each principle and failure mode
below is an explicit, named case with a pass criterion. **Fixture prep:** the three
sample docs are different *types* and don't naturally conflict, so create one tiny
**"lease amendment" PDF** — a one-paragraph doc that overrides a specific term in the
lease (e.g. changes the rent figure or the break date) — for the conflict/override cases.

**Attribution**
- **G1 — Cite the source in every claim.** Ask a multi-part factual question spanning
  all docs. *Pass:* every claim names its source document by title (plus section/clause/
  page where the text has them); no bare, unattributed claims.
- **G2 — Answers reveal their sources.** *Pass:* a reader can tell which doc(s) an answer
  drew from without guessing.

**Conflict handling**
- **G3 — Explicit conflict surfacing.** Load the lease + the amendment fixture that
  overrides a term; ask about that term. *Pass:* the answer surfaces **both** values,
  names both docs, and flags the override/conflict — it does **not** silently return one.

**Not-found honesty**
- **G4 — Say "not found."** Ask about a fact present in none of the loaded docs (e.g. an
  insurance premium that isn't there). *Pass:* explicit "not found in the provided
  documents"; **no** invented figure, clause, or citation.

**Clickable citations** *(only if the stretch item ships)*
- **G5 — Citation → viewer.** Click a cited source in an answer. *Pass:* the reader panel
  selects/switches to that exact document in one click.

**Failure modes to design against**
- **F1 — Context dilution.** Record the answer to a question with only its relevant doc
  loaded; then add the other (irrelevant-to-that-question) docs and re-ask. *Pass:* the
  key facts stay correct and consistent — extra context doesn't degrade the answer.
- **F2 — Lost attribution (multi-doc stress).** With all docs loaded, every factual
  answer still identifies its source doc. *Pass:* no "correct but unattributable" claims.
- **F3 — Silent overwrite.** Upload doc A, then upload doc B. *Pass:* A stays present
  (tile + `GET …/conversations/{id}` length + still queryable) and an "added" affirmation
  shows — B never clobbers A.
- **F4 — Conflation.** Ask a question whose parts live in **different** docs (e.g. the
  lease term from the lease, contamination status from the environmental assessment).
  *Pass:* facts stay separate and each is tied to its **true** source — the model does
  not merge them into a false composite or misattribute one doc's fact to another.

**UX principles**
- **U1 — Persistent, visible doc set.** Loaded docs are always shown (tiles/chips); the
  question's scope is obvious at a glance.
- **U2 — Additive + affirmation.** A new upload shows a clear "added" confirmation and
  never drops existing docs (ties to F3).
- **U3 — Graceful viewer switching.** Clicking any tile cleanly switches the reader panel
  (page nav resets).
- **U4 — Scope control** *(only if the stretch item ships)* — narrowing a question to a
  subset of docs restricts the answer to those docs.

### 5. Regression / edge cases
- **Non-PDF / oversized upload** → 400, UI shows the error, existing docs untouched.
- **Malformed PDF / parse failure** → rejected or clearly shown as failed; no silent
  empty-text document that later produces misleading "not found" answers.
- **Prompt-injection fixture** → a PDF or filename containing `</document>` and "ignore
  previous instructions" does not break document boundaries or override the system
  prompt.
- **Special-character filename** → quotes, angle brackets, ampersands, and long filenames
  render safely in tiles and prompts.
- **Partial batch failure** → selected batch with one good and one bad file follows the
  documented atomic/best-effort behavior; no surprising hidden upload.
- **No-doc conversation** → viewer empty state; chat still works via the "no document"
  fallback prompt.
- **Persistence across reload** → refresh the page mid-conversation: tiles + messages
  reload from the DB (proves nothing was in-memory-only).
- **Delete conversation** → cascade removes DB rows; production hardening should also
  remove files from disk.

### 6. Optional automated backend tests (if time permits)
`pytest` is configured (`asyncio_mode=auto`, `testpaths=["backend/tests"]`) but the dir
is currently empty. If budget allows, add a couple of focused tests: uploading two files
to one conversation returns 2 docs (no 409); `get_documents_for_conversation` returns the
full ordered list; `ConversationDetail.documents` length reflects all docs; malicious
filenames/text are escaped in prompt construction; partial-batch failures do not persist
surprising documents. Keep minimal — manual E2E + `just check` is the primary gate given
the ~2h budget.

---

## Production vulnerability / gap register

These are the review findings to keep visible while implementing. The goal is not to
turn the take-home into an enterprise platform, but to show production judgment and make
scope boundaries explicit.

| Area | Risk | Plan disposition |
|---|---|---|
| Prompt injection | Uploaded PDF text or filenames can try to break prompt delimiters or override instructions. | Fix in core: escape/serialize prompt fields and add untrusted-document instructions. |
| Resource exhaustion | Multi-file upload can multiply memory, CPU, disk, parser, context-window, and LLM spend. | Fix in core: max files/request, max total bytes, extracted-text/token budget, graceful too-large response. |
| Partial batch writes | Looping per file can persist a subset before returning an error. | Fix in core or document exact best-effort semantics; preferred: atomic validation before persistence. |
| File retention | DB cascade does not necessarily remove confidential files from disk. | Prefer fix if cheap; otherwise document as production hardening in `DECISIONS.md`. |
| Authorization | Baseline has no users/tenants, so document ids may expose PDFs in a deployed multi-user app. | Out of scope for take-home unless auth exists; explicitly document single-user/local assumption. |
| PDF validation/parsing | MIME/extension checks are spoofable; malformed PDFs can create empty extracted text or parser risk. | Fix basic validation in core; document malware scanning / parser isolation as production hardening. |
| Deterministic ordering | Equal timestamps or unordered relationships can reorder docs between API, tiles, and prompts. | Fix in core with stable ordering by uploaded time and id. |
| LLM grounding verification | Prompt says cite/conflict/not-found, but behavior can regress. | Add manual cases plus focused tests for prompt construction; full eval suite is out of scope. |
