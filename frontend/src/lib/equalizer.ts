export type EqBand = "low" | "mid" | "high";
export type EqGains = Record<EqBand, number>;

export const EQ_LIMIT_DB = 12;
export const EQ_STORAGE_KEY = "jukebox-eq";

export const EQ_BANDS: {
  band: EqBand;
  label: string;
  type: BiquadFilterType;
  frequency: number;
  q?: number;
}[] = [
  { band: "low", label: "Bass", type: "lowshelf", frequency: 250 },
  { band: "mid", label: "Mid", type: "peaking", frequency: 1000, q: 0.8 },
  { band: "high", label: "Treble", type: "highshelf", frequency: 4000 },
];

export const FLAT_GAINS: EqGains = { low: 0, mid: 0, high: 0 };

export const EQ_PRESETS: { id: string; label: string; gains: EqGains }[] = [
  { id: "flat", label: "Flat", gains: FLAT_GAINS },
  { id: "bass", label: "Bass Boost", gains: { low: 6, mid: 0, high: 0 } },
  { id: "vocal", label: "Vocal", gains: { low: -2, mid: 4, high: 2 } },
  { id: "treble", label: "Treble Boost", gains: { low: 0, mid: 0, high: 6 } },
];

export function clampGain(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(-EQ_LIMIT_DB, Math.min(EQ_LIMIT_DB, Math.round(db)));
}

export function isFlat(gains: EqGains): boolean {
  return EQ_BANDS.every(({ band }) => gains[band] === 0);
}

export function presetIdFor(gains: EqGains): string {
  const preset = EQ_PRESETS.find((p) =>
    EQ_BANDS.every(({ band }) => p.gains[band] === gains[band])
  );
  return preset?.id ?? "custom";
}

/**
 * Overall level change, in dB, applied before the filters. Boosting a band
 * can push loud passages past full scale, so the level drops by the largest
 * boost and the boosted band ends up at its original peak.
 */
export function preampDb(gains: EqGains): number {
  const maxBoost = Math.max(0, ...EQ_BANDS.map(({ band }) => gains[band]));
  return maxBoost === 0 ? 0 : -maxBoost;
}

export function loadEqGains(
  storage: Pick<Storage, "getItem"> | undefined
): EqGains {
  try {
    const raw = storage?.getItem(EQ_STORAGE_KEY);
    if (!raw) return FLAT_GAINS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return FLAT_GAINS;
    const stored = parsed as Record<string, unknown>;
    return {
      low: clampGain(Number(stored.low)),
      mid: clampGain(Number(stored.mid)),
      high: clampGain(Number(stored.high)),
    };
  } catch {
    // Private windows and blocked site data throw here; start flat.
    return FLAT_GAINS;
  }
}

export function saveEqGains(
  storage: Pick<Storage, "setItem"> | undefined,
  gains: EqGains
): void {
  try {
    storage?.setItem(EQ_STORAGE_KEY, JSON.stringify(gains));
  } catch {
    // The setting just won't survive a reload.
  }
}
