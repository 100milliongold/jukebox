import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EQ_BANDS, EQ_LIMIT_DB, EQ_PRESETS } from "@/lib/equalizer";
import type { EqBand, EqGains } from "@/lib/equalizer";

interface EqualizerPanelProps {
  gains: EqGains;
  presetId: string;
  onBandChange: (band: EqBand, db: number) => void;
  onPresetSelect: (id: string) => void;
}

const formatDb = (db: number) => `${db > 0 ? "+" : ""}${db} dB`;

export default function EqualizerPanel({
  gains,
  presetId,
  onBandChange,
  onPresetSelect,
}: EqualizerPanelProps) {
  const [open, setOpen] = useState(false);
  const presetLabel =
    EQ_PRESETS.find((p) => p.id === presetId)?.label ?? "Custom";

  return (
    <div className="mt-4 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between text-sm font-medium cursor-pointer"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" /> Equalizer
          <span className="text-gray-500 font-normal">{presetLabel}</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <div className="flex flex-wrap gap-2">
            {EQ_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                size="sm"
                variant={preset.id === presetId ? "default" : "neutral"}
                onClick={() => onPresetSelect(preset.id)}
                aria-pressed={preset.id === presetId}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {EQ_BANDS.map(({ band, label, frequency }) => (
              <label key={band} className="space-y-1 text-sm">
                <span className="flex justify-between">
                  <span>
                    {label}{" "}
                    <span className="text-xs text-gray-500">
                      {frequency >= 1000 ? `${frequency / 1000}kHz` : `${frequency}Hz`}
                    </span>
                  </span>
                  <span className="tabular-nums text-gray-600">
                    {formatDb(gains[band])}
                  </span>
                </span>
                <input
                  type="range"
                  min={-EQ_LIMIT_DB}
                  max={EQ_LIMIT_DB}
                  step={1}
                  value={gains[band]}
                  onChange={(e) => onBandChange(band, Number(e.target.value))}
                  aria-label={`${label} gain`}
                  className="w-full accent-main"
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            Applies to this browser only. Boosting a band lowers the overall
            volume a little so loud songs don't distort.
          </p>
        </div>
      )}
    </div>
  );
}
