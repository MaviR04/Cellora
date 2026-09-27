# Live 'active sessions': HyperLogLog union vs summing minutes vs exact

- **Captured:** 2026-09-27T19:33:15.154Z
- **Shows:** PFCOUNT over several per-minute HyperLogLogs returns the size of their UNION, so a session active in several minutes counts once. Summing per-minute counts over-counts. Each HLL is at most ~12 KB however many sessions it holds; the estimate is within ~1% of the exact distinct count from MongoDB.
- **Report section:** 7. Characteristics: Redis data structures (UC1)
- **Command:** `PFCOUNT active:{m} (each) · PFCOUNT active:{m-4} … active:{m} · db.events.distinct('meta.sessionId', {ts ≥ window start})`

```text
active:202609271929    PFCOUNT 15    MEMORY USAGE 160 bytes
active:202609271930    PFCOUNT 18    MEMORY USAGE 160 bytes
active:202609271931    PFCOUNT 17    MEMORY USAGE 160 bytes
active:202609271932    PFCOUNT 16    MEMORY USAGE 160 bytes
active:202609271933    PFCOUNT 5     MEMORY USAGE 112 bytes

sum of per-minute counts (wrong):    71
PFCOUNT of all 5 keys (union):       59
exact distinct sessions (MongoDB):   57
```
