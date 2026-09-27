# Redis persistence configuration

- **Captured:** 2026-09-27T12:05:23.208Z
- **Shows:** Redis runs with append-only-file persistence, fsync every second (at most ~1 s of data at risk).
- **Report section:** 10. Limitations: Redis durability
- **Command:** `CONFIG GET append*  /  INFO persistence`

```text
appendfilename = appendonly.aof
appendonly = yes
appendfsync = everysec
appenddirname = appendonlydir

loading:0
rdb_last_save_time:1790510635
aof_enabled:1
aof_rewrite_in_progress:0
aof_last_write_status:ok
```
