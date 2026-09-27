# Redis cart: guest cart merged on login

- **Captured:** 2026-09-27T12:49:17.648Z
- **Shows:** A guest cart (HASH sku -> qty, 30-day TTL) is folded into the customer's cart with HINCRBY at login. Prices are not stored in Redis; the API joins live prices from MongoDB.
- **Report section:** 6. Implementation: carts in Redis (UC10)
- **Command:** `HGETALL / TTL / EXISTS on cart keys, then GET /api/cart`

```text
# before login (guest)
cart:b9bb9a39-9da7-4872-8846-acd779daa9fd  HASH  {"GS25U-256-TS":"1","SPUH-GALAXYS25ULTRA-C":"2"}  TTL 2592000s

# after login
EXISTS cart:b9bb9a39-9da7-4872-8846-acd779daa9fd -> 0   (guest cart deleted, cid cookie cleared)
cart:u:6ab90f2b8645c10109a7df56  HASH  {"GS25U-256-TS":"1","SPUH-GALAXYS25ULTRA-C":"2"}  TTL 2592000s

# GET /api/cart: Redis quantities joined with MongoDB prices and stock
GS25U-256-TS             x1  Galaxy S25 Ultra (256GB Titanium Silverblue)  unit 429900  stock 34
SPUH-GALAXYS25ULTRA-C    x2  Ultra Hybrid MagFit for Galaxy S25 Ultra (Clear)  unit 8500  stock 39
subtotal 446900 LKR
```
