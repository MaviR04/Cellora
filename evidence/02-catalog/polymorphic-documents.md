# Two product kinds in one collection

- **Captured:** 2026-09-27T12:49:07.278Z
- **Shows:** A phone (22 top-level fields) and a screen protector (14 fields) stored side by side in `products`. Each document carries only its own attributes: no NULL columns, no EAV table, no migration per product type.
- **Report section:** 7. Characteristics: flexible schema
- **Command:** `db.products.findOne({ slug: "galaxy-s25-ultra" }) / findOne({ kind: "screen_protector", ... })`

```json
// phone
{
  "_id": "6ab907966a3a769b4bcccd1d",
  "slug": "galaxy-s25-ultra",
  "name": "Galaxy S25 Ultra",
  "brand": "Samsung",
  "description": "Samsung's top flagship with a 200MP camera, built-in S Pen and Galaxy AI.",
  "images": [],
  "tags": [
    "android",
    "2025"
  ],
  "variants": [
    {
      "sku": "GS25U-256-TS",
      "label": "256GB Titanium Silverblue",
      "attributes": {
        "storageGb": 256,
        "color": "Titanium Silverblue"
      },
      "price": 42990000,
      "stock": 34
    }
  ],
  "isActive": true,
  "kind": "phone",
  "modelKey": "samsung-galaxy-s25-ultra",
  "releaseYear": 2025,
  "os": "android",
  "chipset": "Snapdragon 8 Elite",
  "ramGb": 12,
  "display": {
    "sizeIn": 6.9,
    "panel": "AMOLED",
    "refreshHz": 120
  },
  "cameras": {
    "mainMp": 200,
    "ultraWideMp": 50,
    "telephotoMp": 50
  },
  "batteryMah": 5000,
  "maxChargingW": 45,
  "port": "usb-c",
  "wirelessCharging": true,
  "basePrice": 42990000
}

// screen_protector
{
  "_id": "6ab907966a3a769b4bcccd3f",
  "slug": "whitestone-dome-glass-galaxy-s25-ultra",
  "name": "Dome Glass for Galaxy S25 Ultra",
  "brand": "Whitestone",
  "description": "Liquid-adhesive glass that keeps the fingerprint sensor working.",
  "images": [],
  "tags": [],
  "variants": [
    {
      "sku": "WSDG-GALAXYS25ULTRA",
      "label": "1-pack",
      "price": 1190000,
      "stock": 11
    }
  ],
  "isActive": true,
  "kind": "screen_protector",
  "compatibleModels": [
    "samsung-galaxy-s25-ultra"
  ],
  "material": "tempered_glass",
  "packCount": 1,
  "basePrice": 1190000
}
```
