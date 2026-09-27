# Live 'active sessions': HyperLogLog union vs summing minutes vs exact

- **Captured:** 2026-09-27T20:06:36.737Z
- **Shows:** PFCOUNT over several per-minute HyperLogLogs returns the size of their UNION, so a session active in several minutes counts once. Summing per-minute counts over-counts. Each HLL is at most ~12 KB however many sessions it holds; the estimate matches the exact distinct count from MongoDB. (Members can't be removed from an HLL: sessions erased in the window, e.g. by the erasure test of a run less than 5 minutes earlier, stay counted until the key expires.)
- **Report section:** 7. Characteristics: Redis data structures (UC1)
- **Command:** `PFCOUNT active:{m} (each) · PFCOUNT active:{m-4} … active:{m} · db.events.distinct('meta.sessionId', {ts ≥ window start})`

```text
active:202609272002    PFCOUNT 13    MEMORY USAGE 160 bytes
active:202609272003    PFCOUNT 14    MEMORY USAGE 160 bytes
active:202609272004    PFCOUNT 15    MEMORY USAGE 160 bytes
active:202609272005    PFCOUNT 14    MEMORY USAGE 160 bytes
active:202609272006    PFCOUNT 11    MEMORY USAGE 160 bytes

sum of per-minute counts (wrong):    67
PFCOUNT of all 5 keys (union):       57
exact distinct sessions (MongoDB):   57
```
