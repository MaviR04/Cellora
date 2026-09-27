export const PRODUCT_KINDS = [
  "phone",
  "case",
  "charging",
  "audio",
  "screen_protector",
  "power_bank",
  "smartwatch",
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const KIND_LABELS: Record<ProductKind, string> = {
  phone: "Phones",
  case: "Cases",
  charging: "Chargers & Cables",
  audio: "Audio",
  screen_protector: "Screen Protectors",
  power_bank: "Power Banks",
  smartwatch: "Smartwatches",
};

/** Store currency. Money is always an integer in minor units (cents). */
export const CURRENCY = "LKR";

/** Format minor units for display. Shows cents only when there are any: "LKR 399,900". */
export function formatMoney(minor: number): string {
  const digits = minor % 100 === 0 ? 0 : 2;
  return `${CURRENCY} ${(minor / 100).toLocaleString("en-LK", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
