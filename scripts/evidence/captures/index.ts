import { foundation } from "./foundation";
import { catalog } from "./catalog";
import { authCart } from "./auth-cart";

export interface EvidenceSet {
  description: string;
  run: () => Promise<void>;
}

// Add one set per phase as features land.
export const sets: Record<string, EvidenceSet> = {
  foundation,
  catalog,
  "auth-cart": authCart,
};
