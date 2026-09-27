# Redis Stream, consumer group and live counters

- **Captured:** 2026-09-27T18:41:18.366Z
- **Shows:** The events:ingest stream with its consumer group (nothing pending = everything acknowledged), and the per-minute counters the worker maintains: INCR counts and a HyperLogLog of distinct sessions, merged across 5 minutes with one PFCOUNT for 'active users now' (UC1).
- **Report section:** 7. Characteristics: Redis data structures / UC1
- **Command:** `XINFO STREAM / XINFO GROUPS events:ingest; GET evt:all:<minute>; PFCOUNT active:<m1> … active:<m5>`

```text
XLEN events:ingest = 20025   (capped with MAXLEN ~ 100000)
group ingest-workers: {"name":"ingest-workers","consumers":1,"pending":0,"last-delivered-id":"1790534475814-7","entries-read":20065,"lag":0}
dead-letter stream events:dead length = 0

last 5 minutes (UTC minute buckets):
  202609271841  events=18  active sessions=1
  202609271840  events=0  active sessions=0
  202609271839  events=0  active sessions=0
  202609271838  events=0  active sessions=0
  202609271837  events=3  active sessions=2

active sessions in the last 5 minutes (PFCOUNT over 5 HyperLogLogs, ~0.81% error): 3
HyperLogLog memory per minute key: 112 bytes
```
