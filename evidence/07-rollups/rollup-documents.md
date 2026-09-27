# Rollup documents: a session summary and a day of hourly activity

- **Captured:** 2026-09-27T19:06:36.228Z
- **Shows:** session_summaries gives Support one small document per session (landing page, device, funnel steps reached, orders). metrics_hourly gives the Analyst ready-made time series; here the evening peak in Sri Lanka is visible.
- **Report section:** 5. Data model: materialised views
- **Command:** `db.session_summaries.findOne({ "reached.orderPlaced": true }); db.metrics_hourly.find({ "_id.type": "page_view", day 2026-09-27 })`

```text
{
  "_id": "b3314ce1-23b8-495c-9722-658157c3fb8d",
  "anonymousId": "af760aef-b114-4c0b-a888-4b47d724a2eb",
  "customerId": "6ab965798645c10109a8321a",
  "startedAt": "2026-09-27T16:27:53.000Z",
  "endedAt": "2026-09-27T16:33:49.500Z",
  "eventCount": 24,
  "device": {
    "type": "desktop",
    "os": "Windows",
    "browser": "Chrome"
  },
  "hadCheckoutFailure": false,
  "durationSec": 356,
  "landingPath": "/",
  "reached": {
    "productView": true,
    "addToCart": true,
    "checkoutStarted": true,
    "orderPlaced": true
  },
  "orderIds": [
    "6ab96589eb6a16ca9b295980"
  ],
  "simulated": true
}

page views per hour on 2026-09-27 (Sri Lanka time)
  00:00    35  ████
  01:00    37  ████
  02:00    47  █████
  03:00    42  █████
  04:00    35  ████
  05:00    49  ██████
  06:00    66  ███████
  07:00    79  █████████
  08:00   197  ██████████████████████
  09:00   162  ██████████████████
  10:00   169  ███████████████████
  11:00   254  █████████████████████████████
  12:00   270  ███████████████████████████████
  13:00   182  █████████████████████
  14:00   221  █████████████████████████
  15:00   253  █████████████████████████████
  16:00   235  ███████████████████████████
  17:00   353  ████████████████████████████████████████
  18:00   285  ████████████████████████████████
  19:00   336  ██████████████████████████████████████
  20:00   310  ███████████████████████████████████
  21:00   293  █████████████████████████████████
  22:00   205  ███████████████████████
  23:00    76  █████████
```
