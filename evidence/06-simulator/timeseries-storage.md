# Time-series collection vs regular collection storage

- **Captured:** 2026-09-27T18:55:48.788Z
- **Shows:** The same 99,233 events stored as a time-series collection (grouped into 13,480 compressed buckets) and as a regular collection. Buckets average 7.4 events: small, because sessionId in the metaField gives each session its own buckets (the trade-off documented in data-model §4.4).
- **Report section:** 7. Characteristics: time-series collections / 10. Limitations: metaField cardinality
- **Command:** `$collStats storageStats on events vs a $out copy into a regular collection (after fsync)`

```text
                               time-series     regular collection
documents stored                    13480 buckets       99233 documents
data size (uncompressed BSON)         38.97 MB         41.56 MB
storage size on disk                   9.40 MB         12.09 MB
index size                            11.16 MB          2.51 MB   (regular copy: _id index only)

events per bucket (average):   7.4
bucket stats: {"avgBucketSize":3031,"numBucketInserts":13941,"numBucketsClosedDueToCount":0,"numBucketsClosedDueToTimeForward":0,"numBucketsArchivedDueToMemoryThreshold":0}
```
