# Redis persistence configuration

- **Captured:** 2026-09-27T11:32:16.365Z
- **Shows:** Redis runs with append-only-file persistence, fsync every second (at most ~1 s of data at risk).
- **Report section:** 10. Limitations: Redis durability
- **Command:** `CONFIG GET append*  /  INFO persistence`

```text
appendonly = yes
appenddirname = appendonlydir
appendfsync = everysec
appendfilename = appendonly.aof

loading:0
rdb_last_save_time:1790508523
aof_enabled:1
aof_rewrite_in_progress:0
aof_last_write_status:ok
```
