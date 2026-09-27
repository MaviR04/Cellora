import type { ProductKind } from "@da2/shared";

// Simple line icons, one per product kind. Used in place of product photos.
const paths: Record<ProductKind, React.ReactNode> = {
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M10.5 5h3" />
    </>
  ),
  case: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="3" />
      <rect x="8.5" y="4.5" width="4" height="4" rx="1" />
    </>
  ),
  charging: (
    <>
      <path d="M9 2.5v4M15 2.5v4" />
      <path d="M6.5 6.5h11v4a5.5 5.5 0 0 1-11 0z" />
      <path d="M12 16v5.5" />
    </>
  ),
  audio: (
    <>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4" height="7" rx="1.5" />
      <rect x="17" y="14" width="4" height="7" rx="1.5" />
    </>
  ),
  screen_protector: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M9 11l5-5M9 16l8-8" />
    </>
  ),
  power_bank: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M10 2.5h4" />
      <path d="M12.5 8l-2.5 4.5h4L11.5 17" />
    </>
  ),
  smartwatch: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 6l.8-3.5h4.4L15 6M9 18l.8 3.5h4.4L15 18" />
      <path d="M12 9.5V12l1.5 1.5" />
    </>
  ),
};

export function KindIcon({ kind, className = "size-6" }: { kind: ProductKind; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {paths[kind]}
    </svg>
  );
}
