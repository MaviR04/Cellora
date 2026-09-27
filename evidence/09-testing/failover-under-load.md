# Replica set failover under load: primary killed, new primary elected, old one rejoins

- **Captured:** 2026-09-27T20:13:37.386Z
- **Shows:** While reads, telemetry and checkouts run continuously, the primary's container is killed (a crash, not a clean shutdown). The two remaining members still form a majority and elect a new primary; the MongoDB driver discovers it by itself. Requests in flight during the election wait (up to the 20 s server-selection timeout) and then complete: no request fails. Telemetry is never slowed, because the API only appends to the Redis stream. The old node rejoins as a secondary.
- **Report section:** 8. Strengths: high availability; 7. CAP (availability with a majority); 10. Evaluation: testing
- **Command:** `docker kill mongo1 … docker start mongo1; load: GET /api/products every 250 ms, POST /api/events (5 events) every 250 ms, checkout every 1 s`

```text
# before
  host.docker.internal:27017     PRIMARY                    health 1
  host.docker.internal:27018     SECONDARY                  health 1
  host.docker.internal:27019     SECONDARY                  health 1

# kill mongo1 (host.docker.internal:27017) → new primary host.docker.internal:27018 after 10.7 s
  host.docker.internal:27017     (not reachable/healthy)    health 0
  host.docker.internal:27018     PRIMARY                    health 1
  host.docker.internal:27019     SECONDARY                  health 1

# docker start mongo1 → back as SECONDARY after 0.8 s
  host.docker.internal:27017     SECONDARY                  health 1
  host.docker.internal:27018     PRIMARY                    health 1
  host.docker.internal:27019     SECONDARY                  health 1

# load results
read       113 sent,   0 failed, slowest 10072 ms
event      113 sent,   0 failed, slowest 36 ms
checkout    29 sent,   0 failed, slowest 10185 ms
telemetry: 565 events accepted by the API (202) → 565 in MongoDB after the worker caught up (none lost)

# timeline (per second, around the key moments)
t (s)  reads ok/fail max ms    events ok/fail max ms   checkouts ok/fail max ms  
0        3/0       19            3/0       36                                    
1        4/0        4            4/0        3            1/0       44            
…
3        4/0       12            4/0        9            1/0       43            
4        4/0       11            4/0       10            1/0       41            
5        3/0    10072            3/0        9            1/0    10185            ← mongo1 (primary) killed
6        3/0     9316            3/0       11            1/0     9233            
7        4/0     8522            4/0       26            1/0     8215            
…
13       4/0     2583            4/0       14            1/0     2277            
14       4/0     1504            4/0        9            1/0     1154            
15       4/0      465            4/0       24            1/0      179            ← new primary 27018 elected
16       4/0        5            4/0        6            1/0       29            
17       3/0        8            3/0        7            1/0       70            
…
23       3/0       12            3/0       10            1/0       40            
24       4/0        9            4/0        6            1/0       39            
25       3/0        7            3/0        8            1/0       32            ← mongo1 restarted
26       4/0        4            4/0        4            1/0       35            ← rejoined as SECONDARY
27       4/0        9            4/0        9            1/0       31            
28       4/0       10            4/0        7            1/0       30            
29       4/0       10            4/0        9            1/0       54
```
