# Losing the majority: MongoDB stops accepting writes rather than risk inconsistency

- **Captured:** 2026-09-27T20:14:41.312Z
- **Shows:** Two of the three members are killed. The survivor can't see a majority, so it refuses to become primary (CP behaviour: no split-brain, no conflicting writes). Database-backed requests (catalogue reads, add-to-cart + checkout) fail with HTTP 500 once the 20 s server-selection timeout runs out. Telemetry keeps being accepted, because it is only appended to the Redis stream; the worker's inserts fail, the batch stays pending, and the worker retries it until a primary is back. Once the members return, every accepted event reaches MongoDB.
- **Report section:** 7. Characteristics: CAP / consistency; 9. Strengths: decoupled ingestion; 10. Limitations: availability without a majority
- **Command:** `docker kill mongo2 mongo1 … (30 s) … docker start mongo2 mongo1; same load as failover-under-load`

```text
# before
  host.docker.internal:27017     SECONDARY                  health 1
  host.docker.internal:27018     PRIMARY                    health 1
  host.docker.internal:27019     SECONDARY                  health 1

# kill mongo2 + mongo1 (primary host.docker.internal:27018 and secondary host.docker.internal:27017)
replSetGetStatus through the app connection: no answer (needs a primary)
hello on the survivor host.docker.internal:27019 (direct connection): {"isWritablePrimary":false,"secondary":true,"primary":null}

# restart both → a primary again after 3.3 s
  host.docker.internal:27017     SECONDARY                  health 1
  host.docker.internal:27018     SECONDARY                  health 1
  host.docker.internal:27019     PRIMARY                    health 1

# load results
read       242 sent, 128 failed (HTTP 500), slowest 20375 ms
event      242 sent,   0 failed, slowest 31 ms
checkout    62 sent,  34 failed (HTTP 500), slowest 20188 ms
telemetry: 1210 events accepted by the API (202) → 1210 in MongoDB after recovery (none lost)

# timeline (per second, around the key moments)
t (s)  reads ok/fail max ms    events ok/fail max ms   checkouts ok/fail max ms  
0        3/0       13            3/0       13                                    
1        4/0       17            4/0       19            1/0       97            
…
3        4/0       13            4/0        9            1/0       49            
4        4/0        7            4/0        3            1/0       38            
5        0/2    20008            2/0        7            0/1    20007            ← mongo2 + mongo1 killed
6        0/4    20017            4/0       11            0/1    20019            
7        0/4    20019            4/0       10            0/1    20019            
…
53       4/0     5964            4/0        6            1/0     5476            
54       4/0     4930            4/0        8            1/0     4530            
55       3/0     3886            3/0        5            1/0     3289            ← mongo2 + mongo1 restarted
56       3/0     2808            3/0        4            1/0     2437            
57       4/0     2023            4/0        8            1/0     1584            
58       4/0      987            4/0       23            1/0      257            ← primary available again
59       4/0       27            4/0       27            1/0       75            
60       4/0       11            4/0        9                                    
61       4/0       14            4/0       10            1/0       32            
62       3/0       10            3/0        8            1/0       72            
63       4/0       32            4/0       31            1/0      109            ← load stopped
```
