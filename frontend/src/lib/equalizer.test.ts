// The frontend has no test runner; run this file with Node's runner and a
// TypeScript loader, e.g. `node --import tsx --test src/lib/equalizer.test.ts`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EQ_LIMIT_DB,
  EQ_PRESETS,
  EQ_STORAGE_KEY,
  FLAT_GAINS,
  clampGain,
  isFlat,
  loadEqGains,
  preampDb,
  presetIdFor,
  saveEqGains,
} from "./equalizer";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("clampGain", () => {
  it("keeps gains within the slider range and on whole decibels", () => {
    assert.equal(clampGain(20), EQ_LIMIT_DB);
    assert.equal(clampGain(-20), -EQ_LIMIT_DB);
    assert.equal(clampGain(3.4), 3);
    assert.equal(clampGain(Number.NaN), 0);
  });
});

describe("loadEqGains", () => {
  it("starts flat when nothing is stored", () => {
    assert.deepEqual(loadEqGains(memoryStorage()), FLAT_GAINS);
  });

  it("reads stored gains and clamps them", () => {
    const storage = memoryStorage({
      [EQ_STORAGE_KEY]: JSON.stringify({ low: 6, mid: -30, high: 2 }),
    });
    assert.deepEqual(loadEqGains(storage), { low: 6, mid: -12, high: 2 });
  });

  it("fills missing or invalid bands with 0", () => {
    const storage = memoryStorage({
      [EQ_STORAGE_KEY]: JSON.stringify({ low: "loud", high: 4 }),
    });
    assert.deepEqual(loadEqGains(storage), { low: 0, mid: 0, high: 4 });
  });

  it("starts flat on broken JSON or when storage is unavailable", () => {
    assert.deepEqual(
      loadEqGains(memoryStorage({ [EQ_STORAGE_KEY]: "{not json" })),
      FLAT_GAINS
    );
    assert.deepEqual(
      loadEqGains({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
      FLAT_GAINS
    );
    assert.deepEqual(loadEqGains(undefined), FLAT_GAINS);
  });
});

describe("saveEqGains", () => {
  it("stores the gains as JSON", () => {
    const storage = memoryStorage();
    saveEqGains(storage, { low: 6, mid: 0, high: -2 });
    assert.deepEqual(JSON.parse(storage.data[EQ_STORAGE_KEY]), {
      low: 6,
      mid: 0,
      high: -2,
    });
  });

  it("ignores storage that refuses writes", () => {
    assert.doesNotThrow(() =>
      saveEqGains(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        FLAT_GAINS
      )
    );
  });
});

describe("presetIdFor", () => {
  it("names the preset whose gains match", () => {
    for (const preset of EQ_PRESETS) {
      assert.equal(presetIdFor({ ...preset.gains }), preset.id);
    }
  });

  it("calls anything else custom", () => {
    assert.equal(presetIdFor({ low: 1, mid: 2, high: 3 }), "custom");
  });
});

describe("preampDb", () => {
  it("lowers the level by the largest boost so boosted bands do not clip", () => {
    assert.equal(preampDb({ low: 6, mid: 0, high: -2 }), -6);
    assert.equal(preampDb({ low: 2, mid: 4, high: 3 }), -4);
  });

  it("leaves the level alone when nothing is boosted", () => {
    assert.equal(preampDb({ low: -3, mid: 0, high: -1 }), 0);
  });
});

describe("isFlat", () => {
  it("is true only when every band is 0", () => {
    assert.equal(isFlat(FLAT_GAINS), true);
    assert.equal(isFlat({ low: 0, mid: 1, high: 0 }), false);
  });
});
