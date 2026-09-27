import { foundation } from "./foundation";

export interface EvidenceSet {
  description: string;
  run: () => Promise<void>;
}

// Add one set per phase as features land.
export const sets: Record<string, EvidenceSet> = {
  foundation,
};
