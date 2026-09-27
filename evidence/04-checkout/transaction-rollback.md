# Multi-document transaction rollback

- **Captured:** 2026-09-27T18:30:52.271Z
- **Shows:** Inside a transaction the charger's stock is decremented, then the phone turns out to be sold out. Aborting rolls the charger back: all-or-nothing (ACID atomicity).
- **Report section:** 7. Characteristics: ACID transactions
- **Command:** `session.startTransaction(); updateOne(charger); updateOne(phone); abortTransaction()`

```text
charger stock before transaction:          108
charger stock inside transaction:          107   (decremented, visible only inside the transaction)
phone decrement matched documents:         0   (sold out -> abort)
charger stock after abortTransaction():    108   (rolled back)
```
