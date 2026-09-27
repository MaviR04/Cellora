# Flag a session, see it in the escalation queue, resolve it (UC14)

- **Captured:** 2026-09-27T19:33:15.594Z
- **Shows:** Notes live in their own session_notes collection (not in events or the rollups, which are append-only / overwritten). The escalation queue query is an equality-equality-sort that the compound index {flagged, status, createdAt} answers without an in-memory sort.
- **Report section:** 6. Implementation: support notes (UC14); indexing (ESR)
- **Command:** `POST /support/sessions/:id/notes {flagged:true} → GET /support/escalations → PATCH /support/notes/:id {status:'resolved'}`

```text
note created:        {"_id":"6ab96f7b0b24ab06401b4bd3","sessionId":"bcdf2145-1e5c-41b6-8329-a64a7ea410f2","customerId":"6ab965798645c10109a832cb","flagged":true,"status":"open"}
open queue:          2 note(s); newest: "Evidence run: out-of-stock complaint, promised restock email."
query plan:          IXSCAN flagged_1_status_1_createdAt_-1; docsExamined 2, nReturned 2
after resolving:     status=resolved, resolvedByName=Dilani Support; open queue now 1
```
