# Replica set status (rs0)

- **Captured:** 2026-09-27T11:32:16.336Z
- **Shows:** A 3-member replica set with one PRIMARY and two SECONDARY nodes, the basis for replication, failover and multi-document transactions.
- **Report section:** 7. Characteristics: replication & availability
- **Command:** `db.adminCommand({ replSetGetStatus: 1 })`

```text
set: rs0    date: 2026-09-27T11:32:16.333Z

member                      state     health priority uptime
host.docker.internal:27017  PRIMARY   1      2        213s
host.docker.internal:27018  SECONDARY 1      1        207s
host.docker.internal:27019  SECONDARY 1      1        207s
```
