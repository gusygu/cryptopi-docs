// src/core/features/moo-aux/schema.ts
export type MnName = "inj" | "drn" | "trl" | "rev" | "wnd" | "emg" | "std" | "stb" | "flo";
export type Greek = "α" | "β" | "γ" | "δ" | "ε" | "ζ" | "η" | "θ" | "ι" | "κ";

export type TierBand = { min: number; max: number; weight: number; label?: string };
export type TierRegistry = {
  GFMdelta: TierBand[];
  vSwap:    TierBand[];
  Inertia:  TierBand[];
  Disrupt:  TierBand[];
  Amp:      TierBand[];
  Volt:     TierBand[];
};

export type MoodSelection = {
  mn: MnName;
  seqWeights?: number[];         // user sequencing weights override
  greekHint?: Greek;             // optional preference
};

export type MoodInputs = {
  GFMdelta: number | null;
  vSwap:    number | null;
  Inertia:  number | null;
  Disrupt:  number | null;
  Amp:      number | null;
  Volt:     number | null;
  id_pct?:  number | null;       // optional, if you couple MEA to id_pct
};

export type MoodOutput = {
  mnLabel: string;               // e.g., "inj.3.β-42"
  weight: number;                // final combined weight [0..1] or your custom scale
  components: Record<keyof MoodInputs, { value: number | null; tier?: TierBand }>;
  greek: Greek;
  seq: number[];                 // resolved sequencing weights
};

