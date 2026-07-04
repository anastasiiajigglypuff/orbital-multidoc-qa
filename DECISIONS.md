# Decisions

## Part 1 — Multi-document conversations

The data model already supported many documents per conversation (`Conversation.documents`
is a list relationship); the single-document limit lived entirely in the application code
— a 409 "already has a document" guard, `documents[0]` collapses in the API, and a
`disabled={hasDocument}` lock on the paperclip. Part 1 was therefore about removing those
artificial limits and making a multi-document conversation *feel* good, not a schema
migration. No Alembic migration was needed.

What shipped:

- **Multi-file upload, additive.** The upload endpoint accepts `list[UploadFile]` and
  returns an array of `DocumentOut`. New documents are appended; existing ones are never
  dropped (the silent-overwrite failure mode the brief tests for). The paperclip is always
  enabled and drag-and-drop shows a full-window "Drop your document here" overlay.
- **Always-on document tiles.** The reader panel header is a row of tiles — one per
  document, page count shown, the selected one highlighted — so the question's scope is
  obvious at a glance. Clicking a tile switches the PDF and resets page navigation.
- **Cross-document answers with attribution.** The whole document set is sent to the model
  and the system prompt requires citing the source document by title on every claim,
  surfacing conflicts between documents instead of silently picking one, and saying "not
  found in the provided documents" rather than fabricating.
- **Streamed upload summary.** After an upload the assistant streams a one-line-per-document
  orientation summary that ends by inviting a question, so a fresh conversation isn't a
  blank page.

### Context strategy: full-context stuffing over RAG (deliberate)

Every document's extracted text is concatenated into the prompt, each wrapped in its own
`<document id="…" title="…"> … </document>` block. This is a deliberate choice **not** to
build retrieval-augmented generation (vector store, chunking, embeddings, a retrieval step).

For the scale this take-home operates at — a handful of PDFs per conversation — stuffing is
strictly better: the model genuinely sees every word, so cross-document reasoning ("compare
the rent in the lease vs. the amendment") is exact rather than dependent on whether a
retriever surfaced the right chunks. RAG's whole value is handling corpora too large for the
context window, and it pays for that with real complexity plus a retrieval-miss failure mode
that is especially dangerous in legal due diligence, where a missed clause is a liability,
not a cosmetic gap. At "dozens of documents per deal" that tradeoff flips; stuffing is the
right answer now, and the wrong answer later. I added an explicit character budget
(`max_context_chars`) so that when a conversation's text approaches the window the app
degrades gracefully with a clear message instead of erroring — that overflow is the concrete
trigger to revisit, documented rather than hidden.

The stated next step beyond stuffing is *hybrid routing* (a cheap relevance pass that stuffs
only the relevant documents) before reaching for full RAG — it buys most of the scale
headroom at a fraction of the complexity.

### Production judgment baked into the core

I treated this like a real legal app while staying inside the time box. The core closes the
cheap, high-impact gaps:

- **Prompt-injection defence.** Uploaded PDF text and filenames are untrusted, so both are
  XML-escaped before being interpolated into the `<document>` blocks (a PDF containing
  `</document>` or "ignore previous instructions" can't break the delimiters), and the
  system prompt explicitly treats document content as evidence, not instructions. Verified
  with a malicious fixture: the model extracted the benign fact and ignored the injection.
- **Real PDF validation.** Files are validated by magic bytes and an actual parse, not a
  spoofable MIME type or extension, and a PDF that yields no extractable text is rejected
  rather than stored as an empty document that would later produce misleading "not found"
  answers.
- **Atomic batch uploads + resource limits.** The whole batch is validated before anything
  is persisted, so one bad file returns 400 without adding a partial subset. There are caps
  on file count and total bytes per request.
- **Deterministic ordering** (`uploaded_at`, then `id`) so tile order, API order, and prompt
  order always match.
- **File cleanup on delete.** Deleting a conversation removes its PDFs from disk, not just
  the DB rows.

Deferred, and called out rather than silently skipped: authentication / multi-tenant
authorization (the baseline has no user model — single-user/local assumption), malware
scanning and parser isolation, rate limiting and LLM-spend controls, and clickable citations
that jump the reader panel to the cited document (a natural next step that builds directly on
the tile switching already in place).

## Part 2 — TODO

The data-driven Part 2 feature (analysis of `data/usage_events.csv` and
`data/customer_feedback.md`, one high-value improvement, and its rationale) is not part of
this change and remains to be built.

## Known local-dev note

The Docker dev stack's frontend volume mount (colima/virtiofs on Apple Silicon) doesn't
propagate inotify events, so Vite wasn't hot-reloading edits. `vite.config.ts` now enables
`server.watch.usePolling` so edits reload reliably across mount types.
