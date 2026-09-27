# Replica set status (rs0)

- **Captured:** 2026-09-27T12:05:23.119Z
- **Shows:** A 3-member replica set with one PRIMARY and two SECONDARY nodes, the basis for replication, failover and multi-document transactions.
- **Report section:** 7. Characteristics: replication & availability
- **Command:** `db.adminCommand({ replSetGetStatus: 1 })`

```text
set: rs0    date: 2026-09-27T12:05:23.115Z

member                      state     health priority uptime
host.docker.internal:27017  PRIMARY   1      2        87s
host.docker.internal:27018  SECONDARY 1      1        80s
host.docker.internal:27019  SECONDARY 1      1        80s
```
