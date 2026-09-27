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

/** Store currency. Money is always an integer in minor units (cents). */
export const CURRENCY = "LKR";

export function formatMoney(minor: number): string {
  return `${CURRENCY} ${(minor / 100).toLocaleString("en-LK", { minimumFractionDigits: 2 })}`;
}
