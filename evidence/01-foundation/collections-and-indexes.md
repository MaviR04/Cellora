# Collections, options and indexes

- **Captured:** 2026-09-27T12:05:23.196Z
- **Shows:** The time-series events collection with TTL, the products $jsonSchema validator, and every index from the data model.
- **Report section:** 5. Data model
- **Command:** `db.getCollectionInfos() + db.<collection>.getIndexes()`

```text
audit_log  [collection]
  index _id_: {"_id":1}
  index at_-1: {"at":-1}
  index actorId_1_at_-1: {"actorId":1,"at":-1}

events  [timeseries]
  timeseries={"timeField":"ts","metaField":"meta","granularity":"seconds","bucketMaxSpanSeconds":3600}
  expireAfterSeconds=7776000 (90 days)
  index meta_1_ts_1: {"meta":1,"ts":1}
  index meta.sessionId_1_ts_1: {"meta.sessionId":1,"ts":1}
  index meta.customerId_1_ts_-1: {"meta.customerId":1,"ts":-1}
  index meta.anonymousId_1: {"meta.anonymousId":1}
  index type_1_ts_1: {"type":1,"ts":1}

orders  [collection]
  index _id_: {"_id":1}
  index orderNumber_1: {"orderNumber":1}  unique
  index customerId_1_createdAt_-1: {"customerId":1,"createdAt":-1}
  index sessionId_1: {"sessionId":1}
  index guestEmail_1: {"guestEmail":1}  partial

products  [collection]
  validator=$jsonSchema (required: kind, slug, name, brand, basePrice, variants, isActive)
  index _id_: {"_id":1}
  index slug_1: {"slug":1}  unique
  index variants.sku_1: {"variants.sku":1}  unique
  index kind_1_basePrice_1: {"kind":1,"basePrice":1}
  index brand_1_kind_1: {"brand":1,"kind":1}
  index compatibleModels_1: {"compatibleModels":1}
  index product_text: {"_fts":"text","_ftsx":1}  weights={"brand":5,"description":1,"name":10}

session_notes  [collection]
  index _id_: {"_id":1}
  index sessionId_1_createdAt_1: {"sessionId":1,"createdAt":1}
  index flagged_1_status_1_createdAt_-1: {"flagged":1,"status":1,"createdAt":-1}

session_summaries  [collection]
  index _id_: {"_id":1}
  index customerId_1_startedAt_-1: {"customerId":1,"startedAt":-1}
  index anonymousId_1_startedAt_-1: {"anonymousId":1,"startedAt":-1}
  index hadCheckoutFailure_1_startedAt_-1: {"hadCheckoutFailure":1,"startedAt":-1}

settings  [collection]
  index _id_: {"_id":1}

users  [collection]
  index _id_: {"_id":1}
  index email_1: {"email":1}  unique
  index role_1: {"role":1}
  index anonymousIds_1: {"anonymousIds":1}
```
