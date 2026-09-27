import type { ProductKind } from "@da2/shared";
import { KindIcon } from "./KindIcon";

/** Stable hue per brand, so each brand gets its own tint without any image assets. */
function hue(brand: string) {
  let h = 0;
  for (const c of brand) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function ProductVisual({ kind, brand, size = "md" }: { kind: ProductKind; brand: string; size?: "md" | "lg" }) {
  const h = hue(brand);
  return (
    <div
      className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl"
      style={{ background: `linear-gradient(145deg, oklch(0.97 0.03 ${h}), oklch(0.88 0.07 ${h}))`, color: `oklch(0.42 0.12 ${h})` }}
    >
      <KindIcon kind={kind} className={size === "lg" ? "size-40" : "size-20"} />
      <span className="absolute bottom-2 left-3 text-xs font-semibold tracking-wide uppercase opacity-60">{brand}</span>
    </div>
  );
}
