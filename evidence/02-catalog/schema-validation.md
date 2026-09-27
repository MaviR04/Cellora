# Schema validation on the products collection

- **Captured:** 2026-09-27T12:17:19.063Z
- **Shows:** The $jsonSchema validator enforces only the shared base fields (kind, price, stock >= 0...). A new, kind-specific attribute is accepted without a migration, while invalid data is rejected by the database itself.
- **Report section:** 7. Characteristics: schema-on-write vs flexible schema
- **Command:** `db.products.insertOne(<probe document>)  (probes are deleted afterwards)`

```text
valid product with an attribute no other product has     ACCEPTED
negative stock                                           REJECTED (Document failed validation) [properties: variants]
unknown product kind                                     REJECTED (Document failed validation) [properties: kind]
missing required field (no variants)                     REJECTED (Document failed validation) [required: variants]
price as a string                                        REJECTED (Document failed validation) [properties: variants]
```
