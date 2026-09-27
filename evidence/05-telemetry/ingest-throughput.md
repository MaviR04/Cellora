# Ingestion throughput

- **Captured:** 2026-09-27T18:41:18.332Z
- **Shows:** 20,000 events sent as 400 HTTP batches of 50 (16 concurrent clients). The API only validates and appends to the Redis Stream, so it accepts events faster than they are written to MongoDB; the worker drains the backlog with batched insertMany.
- **Report section:** 9. Strengths: write throughput / 11. Evaluation
- **Command:** `400 x POST /api/events (50 events each) -> wait until all 20000 are in db.events`

```text
API accepted all 20000 events in      660 ms   (30,303 events/s)
all 20000 events stored in MongoDB after 3171 ms   (6,307 events/s end to end)

consumer group after drain: pending=0  lag=0  consumers=1

Single laptop, Docker Desktop, 3-node replica set; numbers are indicative, not a benchmark.
```
