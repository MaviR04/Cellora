// Seed catalog: real products with APPROXIMATE specs and Sri Lankan retail prices (LKR).
// Prices are written in whole rupees here and converted to minor units (cents) on insert.
// Accessories reference the phones' `modelKey`s so compatibility queries return real results.
import type { ProductKind } from "@da2/shared";

export interface SeedVariant {
  sku: string;
  label: string;
  attributes: Record<string, unknown>;
  price: number; // whole LKR
  stock?: number;
}
export interface SeedProduct {
  kind: ProductKind;
  slug: string;
  name: string;
  brand: string;
  description: string;
  tags?: string[];
  variants: SeedVariant[];
  [attribute: string]: unknown;
}

const code = (s: string) =>
  s
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Colour × storage variants for a phone. */
function phoneVariants(prefix: string, storage: [gb: number, price: number][], colors: string[]): SeedVariant[] {
  return colors.flatMap((color) =>
    storage.map(([gb, price]) => ({
      sku: `${prefix}-${gb >= 1024 ? `${gb / 1024}T` : gb}-${code(color)}`,
      label: `${gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`} ${color}`,
      attributes: { storageGb: gb, color },
      price,
    })),
  );
}

/** Colour-only variants for accessories. */
function colorVariants(prefix: string, price: number, colors: string[]): SeedVariant[] {
  return colors.map((color) => ({ sku: `${prefix}-${code(color)}`, label: color, attributes: { color }, price }));
}
const single = (sku: string, price: number, label = "Standard"): SeedVariant[] => [{ sku, label, attributes: {}, price }];

// ---------------------------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------------------------
interface PhoneSpec {
  name: string;
  brand: string;
  modelKey: string;
  prefix: string;
  releaseYear: number;
  os: "ios" | "android";
  chipset: string;
  ramGb: number;
  display: { sizeIn: number; panel: string; refreshHz: number };
  cameras: { mainMp: number; ultraWideMp?: number; telephotoMp?: number };
  batteryMah: number;
  maxChargingW: number;
  wirelessCharging: boolean;
  storage: [number, number][];
  colors: string[];
  blurb: string;
}

const phone = (p: PhoneSpec): SeedProduct => ({
  kind: "phone",
  slug: slugify(p.name),
  name: p.name,
  brand: p.brand,
  description: p.blurb,
  modelKey: p.modelKey,
  releaseYear: p.releaseYear,
  os: p.os,
  chipset: p.chipset,
  ramGb: p.ramGb,
  display: p.display,
  cameras: p.cameras,
  batteryMah: p.batteryMah,
  maxChargingW: p.maxChargingW,
  port: "usb-c",
  wirelessCharging: p.wirelessCharging,
  tags: [p.os, `${p.releaseYear}`],
  variants: phoneVariants(p.prefix, p.storage, p.colors),
});

const phones: SeedProduct[] = [
  phone({
    name: "iPhone 16 Pro Max", brand: "Apple", modelKey: "apple-iphone-16-pro-max", prefix: "IP16PM", releaseYear: 2024, os: "ios",
    chipset: "A18 Pro", ramGb: 8, display: { sizeIn: 6.9, panel: "OLED", refreshHz: 120 }, cameras: { mainMp: 48, ultraWideMp: 48, telephotoMp: 12 },
    batteryMah: 4685, maxChargingW: 30, wirelessCharging: true, storage: [[256, 489900], [512, 559900], [1024, 629900]],
    colors: ["Desert Titanium", "Black Titanium"], blurb: "Apple's largest flagship with a 6.9-inch display, 5x telephoto camera and all-day battery life.",
  }),
  phone({
    name: "iPhone 16 Pro", brand: "Apple", modelKey: "apple-iphone-16-pro", prefix: "IP16P", releaseYear: 2024, os: "ios",
    chipset: "A18 Pro", ramGb: 8, display: { sizeIn: 6.3, panel: "OLED", refreshHz: 120 }, cameras: { mainMp: 48, ultraWideMp: 48, telephotoMp: 12 },
    batteryMah: 3582, maxChargingW: 30, wirelessCharging: true, storage: [[128, 399900], [256, 449900], [512, 519900]],
    colors: ["Natural Titanium", "Black Titanium"], blurb: "Pro camera system, titanium design and Camera Control in a 6.3-inch size.",
  }),
  phone({
    name: "iPhone 16", brand: "Apple", modelKey: "apple-iphone-16", prefix: "IP16", releaseYear: 2024, os: "ios",
    chipset: "A18", ramGb: 8, display: { sizeIn: 6.1, panel: "OLED", refreshHz: 60 }, cameras: { mainMp: 48, ultraWideMp: 12 },
    batteryMah: 3561, maxChargingW: 25, wirelessCharging: true, storage: [[128, 289900], [256, 339900]],
    colors: ["Ultramarine", "Black", "Pink"], blurb: "The everyday iPhone with A18, Camera Control and Apple Intelligence.",
  }),
  phone({
    name: "iPhone 16e", brand: "Apple", modelKey: "apple-iphone-16e", prefix: "IP16E", releaseYear: 2025, os: "ios",
    chipset: "A18", ramGb: 8, display: { sizeIn: 6.1, panel: "OLED", refreshHz: 60 }, cameras: { mainMp: 48 },
    batteryMah: 4005, maxChargingW: 20, wirelessCharging: true, storage: [[128, 229900], [256, 269900]],
    colors: ["Black", "White"], blurb: "The most affordable iPhone 16 model, with a single 48MP camera and long battery life.",
  }),
  phone({
    name: "iPhone 15", brand: "Apple", modelKey: "apple-iphone-15", prefix: "IP15", releaseYear: 2023, os: "ios",
    chipset: "A16 Bionic", ramGb: 6, display: { sizeIn: 6.1, panel: "OLED", refreshHz: 60 }, cameras: { mainMp: 48, ultraWideMp: 12 },
    batteryMah: 3349, maxChargingW: 20, wirelessCharging: true, storage: [[128, 239900], [256, 279900]],
    colors: ["Blue", "Black"], blurb: "Dynamic Island, 48MP main camera and USB-C at a lower price.",
  }),
  phone({
    name: "Galaxy S25 Ultra", brand: "Samsung", modelKey: "samsung-galaxy-s25-ultra", prefix: "GS25U", releaseYear: 2025, os: "android",
    chipset: "Snapdragon 8 Elite", ramGb: 12, display: { sizeIn: 6.9, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 200, ultraWideMp: 50, telephotoMp: 50 },
    batteryMah: 5000, maxChargingW: 45, wirelessCharging: true, storage: [[256, 429900], [512, 479900]],
    colors: ["Titanium Silverblue", "Titanium Black"], blurb: "Samsung's top flagship with a 200MP camera, built-in S Pen and Galaxy AI.",
  }),
  phone({
    name: "Galaxy S25", brand: "Samsung", modelKey: "samsung-galaxy-s25", prefix: "GS25", releaseYear: 2025, os: "android",
    chipset: "Snapdragon 8 Elite", ramGb: 12, display: { sizeIn: 6.2, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 12, telephotoMp: 10 },
    batteryMah: 4000, maxChargingW: 25, wirelessCharging: true, storage: [[128, 269900], [256, 289900]],
    colors: ["Navy", "Icyblue", "Mint"], blurb: "Compact flagship power with Snapdragon 8 Elite and seven years of updates.",
  }),
  phone({
    name: "Galaxy A56", brand: "Samsung", modelKey: "samsung-galaxy-a56", prefix: "GA56", releaseYear: 2025, os: "android",
    chipset: "Exynos 1580", ramGb: 8, display: { sizeIn: 6.7, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 12 },
    batteryMah: 5000, maxChargingW: 45, wirelessCharging: false, storage: [[128, 139900], [256, 154900]],
    colors: ["Awesome Graphite", "Awesome Lightgray"], blurb: "Mid-range favourite with a big AMOLED screen, 45W charging and IP67.",
  }),
  phone({
    name: "Galaxy A36", brand: "Samsung", modelKey: "samsung-galaxy-a36", prefix: "GA36", releaseYear: 2025, os: "android",
    chipset: "Snapdragon 6 Gen 3", ramGb: 8, display: { sizeIn: 6.7, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 8 },
    batteryMah: 5000, maxChargingW: 45, wirelessCharging: false, storage: [[128, 109900], [256, 124900]],
    colors: ["Awesome Black", "Awesome Lavender"], blurb: "Affordable Galaxy with a 120Hz AMOLED display and six years of updates.",
  }),
  phone({
    name: "Galaxy Z Flip6", brand: "Samsung", modelKey: "samsung-galaxy-z-flip6", prefix: "GZF6", releaseYear: 2024, os: "android",
    chipset: "Snapdragon 8 Gen 3", ramGb: 12, display: { sizeIn: 6.7, panel: "Foldable AMOLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 12 },
    batteryMah: 4000, maxChargingW: 25, wirelessCharging: true, storage: [[256, 329900], [512, 369900]],
    colors: ["Blue", "Mint"], blurb: "Pocketable foldable with a 3.4-inch cover screen and 50MP camera.",
  }),
  phone({
    name: "Pixel 9 Pro", brand: "Google", modelKey: "google-pixel-9-pro", prefix: "PX9P", releaseYear: 2024, os: "android",
    chipset: "Tensor G4", ramGb: 16, display: { sizeIn: 6.3, panel: "OLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 48, telephotoMp: 48 },
    batteryMah: 4700, maxChargingW: 27, wirelessCharging: true, storage: [[128, 329900], [256, 359900]],
    colors: ["Obsidian", "Porcelain"], blurb: "Google's compact pro phone with a 5x telephoto and Gemini built in.",
  }),
  phone({
    name: "Pixel 9", brand: "Google", modelKey: "google-pixel-9", prefix: "PX9", releaseYear: 2024, os: "android",
    chipset: "Tensor G4", ramGb: 12, display: { sizeIn: 6.3, panel: "OLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 48 },
    batteryMah: 4700, maxChargingW: 27, wirelessCharging: true, storage: [[128, 249900], [256, 279900]],
    colors: ["Obsidian", "Peony"], blurb: "Clean Android, excellent cameras and seven years of OS updates.",
  }),
  phone({
    name: "Pixel 9a", brand: "Google", modelKey: "google-pixel-9a", prefix: "PX9A", releaseYear: 2025, os: "android",
    chipset: "Tensor G4", ramGb: 8, display: { sizeIn: 6.3, panel: "OLED", refreshHz: 120 }, cameras: { mainMp: 48, ultraWideMp: 13 },
    batteryMah: 5100, maxChargingW: 23, wirelessCharging: true, storage: [[128, 169900], [256, 194900]],
    colors: ["Obsidian", "Iris"], blurb: "The best-value Pixel with a big battery and flagship-class processing.",
  }),
  phone({
    name: "OnePlus 13", brand: "OnePlus", modelKey: "oneplus-13", prefix: "OP13", releaseYear: 2025, os: "android",
    chipset: "Snapdragon 8 Elite", ramGb: 12, display: { sizeIn: 6.8, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 50, telephotoMp: 50 },
    batteryMah: 6000, maxChargingW: 100, wirelessCharging: true, storage: [[256, 289900], [512, 329900]],
    colors: ["Black Eclipse", "Arctic Dawn"], blurb: "Huge 6000mAh battery with 100W wired and 50W wireless charging.",
  }),
  phone({
    name: "OnePlus Nord 4", brand: "OnePlus", modelKey: "oneplus-nord-4", prefix: "OPN4", releaseYear: 2024, os: "android",
    chipset: "Snapdragon 7+ Gen 3", ramGb: 12, display: { sizeIn: 6.74, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 8 },
    batteryMah: 5500, maxChargingW: 100, wirelessCharging: false, storage: [[256, 149900]],
    colors: ["Obsidian Midnight", "Mercurial Silver"], blurb: "Metal unibody mid-ranger with 100W SUPERVOOC charging.",
  }),
  phone({
    name: "Xiaomi 15", brand: "Xiaomi", modelKey: "xiaomi-15", prefix: "XM15", releaseYear: 2025, os: "android",
    chipset: "Snapdragon 8 Elite", ramGb: 12, display: { sizeIn: 6.36, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 50, ultraWideMp: 50, telephotoMp: 50 },
    batteryMah: 5240, maxChargingW: 90, wirelessCharging: true, storage: [[256, 279900], [512, 309900]],
    colors: ["Black", "Green"], blurb: "Compact flagship with Leica-tuned triple 50MP cameras.",
  }),
  phone({
    name: "Redmi Note 14 Pro", brand: "Xiaomi", modelKey: "xiaomi-redmi-note-14-pro", prefix: "RN14P", releaseYear: 2025, os: "android",
    chipset: "Helio G100 Ultra", ramGb: 8, display: { sizeIn: 6.67, panel: "AMOLED", refreshHz: 120 }, cameras: { mainMp: 200, ultraWideMp: 8 },
    batteryMah: 5500, maxChargingW: 45, wirelessCharging: false, storage: [[256, 94900]],
    colors: ["Midnight Black", "Ocean Blue"], blurb: "200MP camera and IP64 protection at a budget price.",
  }),
];

// Groups of modelKeys used by accessories
const M = {
  ip16pm: "apple-iphone-16-pro-max",
  ip16p: "apple-iphone-16-pro",
  ip16: "apple-iphone-16",
  ip16e: "apple-iphone-16e",
  ip15: "apple-iphone-15",
  s25u: "samsung-galaxy-s25-ultra",
  s25: "samsung-galaxy-s25",
  a56: "samsung-galaxy-a56",
  a36: "samsung-galaxy-a36",
  flip6: "samsung-galaxy-z-flip6",
  px9p: "google-pixel-9-pro",
  px9: "google-pixel-9",
  px9a: "google-pixel-9a",
  op13: "oneplus-13",
  xm15: "xiaomi-15",
};
const modelName: Record<string, string> = Object.fromEntries(phones.map((p) => [p.modelKey as string, p.name]));
/** SKU fragment unique per phone model, e.g. "apple-iphone-16-pro" -> "IPHONE16PRO". */
const modelCode = (modelKey: string) => modelKey.split("-").slice(1).join("").toUpperCase();

// ---------------------------------------------------------------------------------------------
// Cases: one product per (line, model)
// ---------------------------------------------------------------------------------------------
function caseFor(
  line: { brand: string; name: string; prefix: string; style: "slim" | "rugged" | "wallet"; material: string; magsafe: boolean; price: number; colors: string[]; blurb: string },
  model: string,
): SeedProduct {
  const phoneName = modelName[model];
  const prefix = `${line.prefix}-${modelCode(model)}`;
  return {
    kind: "case",
    slug: slugify(`${line.brand} ${line.name} ${phoneName}`),
    name: `${line.name} for ${phoneName}`,
    brand: line.brand,
    description: line.blurb,
    compatibleModels: [model],
    material: line.material,
    style: line.style,
    magsafe: line.magsafe,
    variants: colorVariants(prefix, line.price, line.colors),
  };
}

const spigenUH = { brand: "Spigen", name: "Ultra Hybrid MagFit", prefix: "SPUH", style: "slim" as const, material: "Polycarbonate/TPU", magsafe: true, price: 8500, colors: ["Clear", "Frost Black"], blurb: "Crystal-clear protection with a built-in magnetic ring and raised camera lip." };
const appleSilicone = { brand: "Apple", name: "Silicone Case with MagSafe", prefix: "APSC", style: "slim" as const, material: "Silicone", magsafe: true, price: 17500, colors: ["Black", "Denim", "Plum"], blurb: "Soft-touch silicone finish with a microfibre lining and MagSafe alignment." };
const otterDefender = { brand: "OtterBox", name: "Defender Series", prefix: "OTDF", style: "rugged" as const, material: "Polycarbonate/Synthetic rubber", magsafe: false, price: 16500, colors: ["Black"], blurb: "Multi-layer rugged protection with port covers and a holster clip." };
const samsungSilicone = { brand: "Samsung", name: "Silicone Case", prefix: "SMSC", style: "slim" as const, material: "Silicone", magsafe: false, price: 9900, colors: ["Black", "Light Blue"], blurb: "Official slim silicone case with a soft-touch finish." };
const spigenTA = { brand: "Spigen", name: "Tough Armor", prefix: "SPTA", style: "rugged" as const, material: "TPU/Polycarbonate", magsafe: false, price: 9500, colors: ["Black", "Gunmetal"], blurb: "Dual-layer protection with a built-in kickstand." };
const ringkeFusion = { brand: "Ringke", name: "Fusion", prefix: "RKFU", style: "slim" as const, material: "Polycarbonate/TPU", magsafe: false, price: 5500, colors: ["Clear", "Matte Black"], blurb: "Lightweight clear case with shock-absorbing bumpers." };
const esrWallet = { brand: "ESR", name: "Wallet Case", prefix: "ESWL", style: "wallet" as const, material: "Vegan leather", magsafe: true, price: 7500, colors: ["Black", "Brown"], blurb: "Folio wallet case with card slots and a stand." };

const cases: SeedProduct[] = [
  caseFor(spigenUH, M.ip16pm),
  caseFor(spigenUH, M.ip16p),
  caseFor(spigenUH, M.ip16),
  caseFor(spigenUH, M.s25u),
  caseFor(spigenUH, M.s25),
  caseFor(appleSilicone, M.ip16p),
  caseFor(appleSilicone, M.ip16),
  caseFor(otterDefender, M.ip16pm),
  caseFor(otterDefender, M.s25u),
  caseFor(samsungSilicone, M.s25u),
  caseFor(samsungSilicone, M.a56),
  caseFor(spigenTA, M.px9p),
  caseFor(ringkeFusion, M.px9),
  caseFor(ringkeFusion, M.px9a),
  caseFor(esrWallet, M.ip15),
  caseFor(ringkeFusion, M.op13),
];

// ---------------------------------------------------------------------------------------------
// Screen protectors
// ---------------------------------------------------------------------------------------------
function protectorFor(
  line: { brand: string; name: string; prefix: string; material: "tempered_glass" | "privacy" | "film"; packCount: number; price: number; blurb: string },
  model: string,
): SeedProduct {
  const phoneName = modelName[model];
  return {
    kind: "screen_protector",
    slug: slugify(`${line.brand} ${line.name} ${phoneName}`),
    name: `${line.name} for ${phoneName}`,
    brand: line.brand,
    description: line.blurb,
    compatibleModels: [model],
    material: line.material,
    packCount: line.packCount,
    variants: single(`${line.prefix}-${modelCode(model)}`, line.price, `${line.packCount}-pack`),
  };
}

const spigenEZ = { brand: "Spigen", name: "EZ Fit GLAS.tR", prefix: "SPEZ", material: "tempered_glass" as const, packCount: 2, price: 6500, blurb: "9H tempered glass with an auto-align installation tray." };
const belkinUG = { brand: "Belkin", name: "UltraGlass 2", prefix: "BLUG", material: "tempered_glass" as const, packCount: 1, price: 9900, blurb: "Ultra-thin, twice-strengthened glass with an easy-align tray." };
const esrPrivacy = { brand: "ESR", name: "Privacy Tempered Glass", prefix: "ESPV", material: "privacy" as const, packCount: 2, price: 5900, blurb: "Keeps your screen private from side angles." };
const whitestoneDome = { brand: "Whitestone", name: "Dome Glass", prefix: "WSDG", material: "tempered_glass" as const, packCount: 1, price: 11900, blurb: "Liquid-adhesive glass that keeps the fingerprint sensor working." };
const samsungFilm = { brand: "Samsung", name: "Anti-Reflecting Film", prefix: "SMAF", material: "film" as const, packCount: 1, price: 4500, blurb: "Official anti-glare film with full ultrasonic fingerprint support." };

const protectors: SeedProduct[] = [
  protectorFor(spigenEZ, M.ip16pm),
  protectorFor(spigenEZ, M.ip16p),
  protectorFor(spigenEZ, M.ip16),
  protectorFor(belkinUG, M.ip16p),
  protectorFor(esrPrivacy, M.ip16),
  protectorFor(esrPrivacy, M.ip15),
  protectorFor(whitestoneDome, M.s25u),
  protectorFor(samsungFilm, M.s25),
  protectorFor(spigenEZ, M.px9p),
  protectorFor(spigenEZ, M.px9),
];

// ---------------------------------------------------------------------------------------------
// Charging: chargers, cables, wireless pads
// ---------------------------------------------------------------------------------------------
const charger = (brand: string, name: string, sku: string, wattage: number, ports: string[], protocols: string[], price: number, blurb: string): SeedProduct => ({
  kind: "charging", subType: "charger", slug: slugify(`${brand} ${name}`), name, brand, description: blurb,
  wattage, ports, protocols, variants: single(sku, price),
});
const cable = (brand: string, name: string, sku: string, from: string, to: string, lengthM: number, wattage: number, price: number, blurb: string): SeedProduct => ({
  kind: "charging", subType: "cable", slug: slugify(`${brand} ${name}`), name, brand, description: blurb,
  connectors: { from, to }, lengthM, wattage, variants: single(sku, price, `${lengthM} m`),
});
const pad = (brand: string, name: string, sku: string, wattage: number, protocols: string[], price: number, blurb: string): SeedProduct => ({
  kind: "charging", subType: "wireless_pad", slug: slugify(`${brand} ${name}`), name, brand, description: blurb,
  wattage, protocols, variants: single(sku, price),
});

const charging: SeedProduct[] = [
  charger("Apple", "20W USB-C Power Adapter", "APL-20W", 20, ["usb-c"], ["PD"], 7900, "Apple's compact fast charger for iPhone."),
  charger("Samsung", "25W Super Fast Charger", "SMS-25W", 25, ["usb-c"], ["PD", "PPS"], 6900, "Super Fast Charging for Galaxy phones."),
  charger("Samsung", "45W Super Fast Charger 2.0", "SMS-45W", 45, ["usb-c"], ["PD", "PPS"], 11900, "The fastest Galaxy charging, for S25 Ultra and A56."),
  charger("Google", "45W USB-C Charger", "GGL-45W", 45, ["usb-c"], ["PD", "PPS"], 11500, "Official fast charger for Pixel phones."),
  charger("Anker", "Nano Charger 30W", "ANK-N30", 30, ["usb-c"], ["PD", "PPS"], 6500, "Tiny GaN charger that fast-charges phones and tablets."),
  charger("Anker", "Prime 67W GaN 3-Port", "ANK-P67", 67, ["usb-c", "usb-c", "usb-a"], ["PD", "PPS"], 16900, "Charge a laptop, phone and earbuds at once."),
  charger("UGREEN", "Nexode 100W 4-Port", "UGR-N100", 100, ["usb-c", "usb-c", "usb-c", "usb-a"], ["PD", "PPS", "QC4+"], 21900, "Desktop GaN charger with 100W for laptops."),
  cable("Apple", "USB-C Woven Charge Cable", "APL-CC1", "usb-c", "usb-c", 1, 60, 5900, "Braided USB-C cable for iPhone 15 and later."),
  cable("Anker", "PowerLine III Flow USB-C to USB-C", "ANK-CC18", "usb-c", "usb-c", 1.8, 100, 4500, "Silky, tangle-free 100W cable."),
  cable("Anker", "PowerLine III USB-C to Lightning", "ANK-CL09", "usb-c", "lightning", 0.9, 20, 3900, "MFi-certified fast-charging cable for older iPhones."),
  cable("Baseus", "CrystalShine 100W USB-C Cable", "BSU-CC2", "usb-c", "usb-c", 2, 100, 3500, "Long 2 m braided cable for desk setups."),
  pad("Apple", "MagSafe Charger (2 m)", "APL-MAGS", 25, ["MagSafe", "Qi2"], 15900, "Snap-on MagSafe charging up to 25W on iPhone 16."),
  pad("Belkin", "BoostCharge Pro 3-in-1 Qi2", "BLK-3IN1", 15, ["Qi2"], 39900, "Charge iPhone, Apple Watch and AirPods together."),
  pad("Samsung", "Wireless Charger Pad 15W", "SMS-WP15", 15, ["Qi"], 12500, "Fast wireless charging for Galaxy phones and Buds."),
  pad("Anker", "MagGo 3-in-1 Station", "ANK-MG3", 15, ["Qi2"], 34900, "Foldable Qi2 station for phone, watch and earbuds."),
];

// ---------------------------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------------------------
const audio = (a: { brand: string; name: string; prefix: string; formFactor: "in_ear" | "over_ear"; anc: boolean; batteryHours: number; codecs: string[]; price: number; colors: string[]; blurb: string }): SeedProduct => ({
  kind: "audio", slug: slugify(`${a.brand} ${a.name}`), name: a.name, brand: a.brand, description: a.blurb,
  formFactor: a.formFactor, wireless: true, anc: a.anc, batteryHours: a.batteryHours, codecs: a.codecs,
  variants: colorVariants(a.prefix, a.price, a.colors),
});

const audioProducts: SeedProduct[] = [
  audio({ brand: "Apple", name: "AirPods Pro 2 (USB-C)", prefix: "APP2", formFactor: "in_ear", anc: true, batteryHours: 6, codecs: ["AAC"], price: 79900, colors: ["White"], blurb: "Adaptive ANC, hearing health features and a USB-C MagSafe case." }),
  audio({ brand: "Apple", name: "AirPods 4 with ANC", prefix: "AP4A", formFactor: "in_ear", anc: true, batteryHours: 5, codecs: ["AAC"], price: 59900, colors: ["White"], blurb: "Open-fit AirPods with active noise cancellation." }),
  audio({ brand: "Samsung", name: "Galaxy Buds3 Pro", prefix: "GB3P", formFactor: "in_ear", anc: true, batteryHours: 6, codecs: ["SSC", "AAC", "SBC"], price: 69900, colors: ["Silver", "White"], blurb: "Blade-light design with adaptive ANC and hi-fi 24-bit audio on Galaxy." }),
  audio({ brand: "Google", name: "Pixel Buds Pro 2", prefix: "PBP2", formFactor: "in_ear", anc: true, batteryHours: 8, codecs: ["AAC", "SBC"], price: 67900, colors: ["Hazel", "Porcelain"], blurb: "Tensor A1-powered ANC and Gemini hands-free." }),
  audio({ brand: "Sony", name: "WF-1000XM5", prefix: "SWF5", formFactor: "in_ear", anc: true, batteryHours: 8, codecs: ["LDAC", "AAC", "SBC"], price: 89900, colors: ["Black", "Silver"], blurb: "Industry-leading noise cancelling in Sony's smallest flagship earbuds." }),
  audio({ brand: "Sony", name: "WH-1000XM5", prefix: "SWH5", formFactor: "over_ear", anc: true, batteryHours: 30, codecs: ["LDAC", "AAC", "SBC"], price: 119900, colors: ["Black", "Silver"], blurb: "Flagship over-ear headphones with 30-hour battery life." }),
  audio({ brand: "Bose", name: "QuietComfort Ultra Earbuds", prefix: "BQCU", formFactor: "in_ear", anc: true, batteryHours: 6, codecs: ["aptX Adaptive", "AAC", "SBC"], price: 99900, colors: ["Black"], blurb: "World-class ANC with immersive spatial audio." }),
  audio({ brand: "JBL", name: "Tune 520BT", prefix: "JT52", formFactor: "over_ear", anc: false, batteryHours: 57, codecs: ["SBC"], price: 16900, colors: ["Black", "Ocean Blue", "White"], blurb: "Lightweight on-ear headphones with 57 hours of playback." }),
  audio({ brand: "Soundcore", name: "Liberty 4 NC", prefix: "SL4N", formFactor: "in_ear", anc: true, batteryHours: 10, codecs: ["LDAC", "AAC", "SBC"], price: 24900, colors: ["Black", "Navy"], blurb: "Adaptive ANC and LDAC at a budget price." }),
  audio({ brand: "Nothing", name: "Ear", prefix: "NTHE", formFactor: "in_ear", anc: true, batteryHours: 8, codecs: ["LDAC", "AAC", "SBC"], price: 39900, colors: ["White", "Black"], blurb: "Transparent design, LDAC and a personalised sound profile." }),
];

// ---------------------------------------------------------------------------------------------
// Power banks
// ---------------------------------------------------------------------------------------------
const bank = (brand: string, name: string, sku: string, capacityMah: number, maxOutputW: number, ports: string[], wireless: boolean, price: number, blurb: string): SeedProduct => ({
  kind: "power_bank", slug: slugify(`${brand} ${name}`), name, brand, description: blurb,
  capacityMah, maxOutputW, ports, wireless, variants: single(sku, price),
});

const powerBanks: SeedProduct[] = [
  bank("Anker", "737 Power Bank (24,000mAh)", "ANK-737", 24000, 140, ["usb-c", "usb-c", "usb-a"], false, 39900, "140W output with a smart display; charges laptops."),
  bank("Anker", "MagGo Power Bank (10K)", "ANK-MGPB", 10000, 27, ["usb-c"], true, 21900, "Qi2 magnetic power bank with a fold-out stand."),
  bank("Baseus", "Blade HD 20,000mAh 100W", "BSU-BLD", 20000, 100, ["usb-c", "usb-c", "usb-a"], false, 27900, "Ultra-slim laptop power bank."),
  bank("Xiaomi", "Power Bank 20,000mAh 22.5W", "XMI-PB20", 20000, 22.5, ["usb-c", "usb-a", "usb-a"], false, 8900, "High-capacity everyday power bank."),
  bank("Samsung", "Battery Pack 10,000mAh 25W", "SMS-BP10", 10000, 25, ["usb-c", "usb-c"], false, 11900, "Super Fast Charging on the go for Galaxy."),
  bank("Belkin", "BoostCharge Pro Magnetic 5K", "BLK-MAG5", 5000, 15, ["usb-c"], true, 14900, "Slim Qi2 magnetic battery for iPhone."),
];

// ---------------------------------------------------------------------------------------------
// Smartwatches
// ---------------------------------------------------------------------------------------------
const watch = (w: { brand: string; name: string; prefix: string; platforms: ("ios" | "android")[]; sizes: [number, number][]; gps: boolean; lte: boolean; batteryDays: number; sensors: string[]; colors: string[]; blurb: string }): SeedProduct => ({
  kind: "smartwatch", slug: slugify(`${w.brand} ${w.name}`), name: w.name, brand: w.brand, description: w.blurb,
  compatiblePlatforms: w.platforms, caseSizesMm: w.sizes.map(([mm]) => mm), gps: w.gps, lte: w.lte, batteryDays: w.batteryDays, sensors: w.sensors,
  variants: w.colors.flatMap((color) =>
    w.sizes.map(([mm, price]) => ({ sku: `${w.prefix}-${mm}-${code(color)}`, label: `${mm}mm ${color}`, attributes: { caseSizeMm: mm, color }, price })),
  ),
});

const watches: SeedProduct[] = [
  watch({ brand: "Apple", name: "Watch Series 10", prefix: "AWS10", platforms: ["ios"], sizes: [[42, 129900], [46, 139900]], gps: true, lte: false, batteryDays: 1.5, sensors: ["heart_rate", "ecg", "spo2", "temperature"], colors: ["Jet Black", "Silver"], blurb: "Thinnest Apple Watch yet with the biggest display." }),
  watch({ brand: "Apple", name: "Watch SE (2nd gen)", prefix: "AWSE", platforms: ["ios"], sizes: [[40, 79900], [44, 89900]], gps: true, lte: false, batteryDays: 1.5, sensors: ["heart_rate"], colors: ["Midnight", "Starlight"], blurb: "Essential Apple Watch features at a great price." }),
  watch({ brand: "Samsung", name: "Galaxy Watch7", prefix: "GW7", platforms: ["android"], sizes: [[40, 84900], [44, 94900]], gps: true, lte: false, batteryDays: 2, sensors: ["heart_rate", "ecg", "spo2", "bioimpedance"], colors: ["Green", "Silver"], blurb: "Galaxy AI health insights and dual-frequency GPS." }),
  watch({ brand: "Samsung", name: "Galaxy Watch Ultra", prefix: "GWU", platforms: ["android"], sizes: [[47, 179900]], gps: true, lte: true, batteryDays: 3, sensors: ["heart_rate", "ecg", "spo2", "bioimpedance"], colors: ["Titanium Gray", "Titanium White"], blurb: "Titanium adventure watch with up to 100 hours of battery." }),
  watch({ brand: "Google", name: "Pixel Watch 3", prefix: "PW3", platforms: ["android"], sizes: [[41, 104900], [45, 119900]], gps: true, lte: false, batteryDays: 1, sensors: ["heart_rate", "ecg", "spo2", "skin_temperature"], colors: ["Obsidian", "Porcelain"], blurb: "Fitbit health tracking with a bigger, brighter domed display." }),
  watch({ brand: "Garmin", name: "Venu 3", prefix: "GV3", platforms: ["ios", "android"], sizes: [[45, 139900]], gps: true, lte: false, batteryDays: 14, sensors: ["heart_rate", "spo2", "hrv"], colors: ["Slate", "Silver"], blurb: "Two-week battery life and advanced fitness metrics; works with iPhone and Android." }),
];

// ---------------------------------------------------------------------------------------------

export const seedProducts: SeedProduct[] = [...phones, ...cases, ...protectors, ...charging, ...audioProducts, ...powerBanks, ...watches];

/**
 * A few SKUs are deliberately seeded with stock = 1 so the checkout race test (Phase 4) and
 * "out of stock" telemetry have something to hit.
 */
export const LOW_STOCK_SKUS = ["IP16PM-1T-DT", "GWU-47-TW", "SWH5-S"];
