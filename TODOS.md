# TODOS


## Extract shared SSE persist/emit helper (from /plan-eng-review 2026-07-04)
- **What:** `send_message` (messages.py:144-238) and `summarize_uploaded_documents` (:266-315) duplicate ~70 lines of event_stream + fresh-session save + final message/done emit.
- **Why:** DRY; "make the change easy then make the easy change." The Verified Citations work touches both endpoints.
- **Pros:** One place to change SSE save/emit; smaller future diffs.
- **Cons:** Refactor with its own blast radius; not required for the feature.
- **Context:** Deferred out of the Verified Citations PR to protect the ~90-min box. Do it as a standalone refactor before the next SSE change.
- **Depends on:** none (do before or after the citations PR, not during).
