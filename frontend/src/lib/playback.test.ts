// The frontend has no test runner; run this file with Node's runner and a
// TypeScript loader, e.g. `node --import tsx --test src/lib/playback.test.ts`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PLAYBACK_MODE,
  HISTORY_LIMIT,
  PLAYBACK_STORAGE_KEY,
  loadPlaybackMode,
  nextRepeatMode,
  pickNext,
  pickPrevious,
  pushHistory,
  replaysOnEnd,
  savePlaybackMode,
  type PlaybackMode,
  type QueueSong,
} from "./playback";

const off: PlaybackMode = { shuffle: false, repeat: "off" };
const all: PlaybackMode = { shuffle: false, repeat: "all" };
const one: PlaybackMode = { shuffle: false, repeat: "one" };
const shuffleOff: PlaybackMode = { shuffle: true, repeat: "off" };
const shuffleAll: PlaybackMode = { shuffle: true, repeat: "all" };

function songs(...statuses: QueueSong["status"][]): QueueSong[] {
  return statuses.map((status, i) => ({ id: `s${i}`, status }));
}

// Always takes the first candidate, or the last one with `last`.
const first = () => 0;
const last = () => 0.999;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe("pickNext in order", () => {
  it("moves to the next row", () => {
    const list = songs("played", "playing", "queued");
    assert.deepEqual(pickNext(list, 1, off), { index: 2, restart: false });
  });

  it("stops after the last row without repeat", () => {
    const list = songs("played", "playing");
    assert.equal(pickNext(list, 1, off), null);
    assert.equal(pickNext(list, 1, one), null);
  });

  it("starts the list over with repeat all", () => {
    const list = songs("played", "played", "playing");
    assert.deepEqual(pickNext(list, 2, all), { index: 0, restart: true });
  });

  it("does not restart a one-song list", () => {
    assert.equal(pickNext(songs("playing"), 0, all), null);
  });

  it("returns null for an empty list", () => {
    assert.equal(pickNext([], -1, all), null);
  });
});

describe("pickNext shuffled", () => {
  it("picks only rows that are still queued", () => {
    const list = songs("played", "queued", "playing", "played", "queued");
    assert.deepEqual(pickNext(list, 2, shuffleOff, first), {
      index: 1,
      restart: false,
    });
    assert.deepEqual(pickNext(list, 2, shuffleOff, last), {
      index: 4,
      restart: false,
    });
  });

  it("never picks the current row, even if it still reads queued", () => {
    const list = songs("queued", "queued");
    assert.deepEqual(pickNext(list, 0, shuffleOff, first), {
      index: 1,
      restart: false,
    });
  });

  it("stops when nothing is queued without repeat", () => {
    assert.equal(pickNext(songs("played", "playing"), 1, shuffleOff), null);
  });

  it("restarts with any other row under repeat all", () => {
    const list = songs("played", "playing", "played");
    assert.deepEqual(pickNext(list, 1, shuffleAll, first), {
      index: 0,
      restart: true,
    });
    assert.deepEqual(pickNext(list, 1, shuffleAll, last), {
      index: 2,
      restart: true,
    });
  });

  it("keeps the pick in range when random returns 1", () => {
    const list = songs("playing", "queued", "queued");
    assert.deepEqual(
      pickNext(list, 0, shuffleOff, () => 1),
      {
        index: 2,
        restart: false,
      }
    );
  });
});

describe("pickPrevious", () => {
  it("moves to the row above in order", () => {
    const list = songs("played", "playing");
    assert.deepEqual(pickPrevious(list, 1, off, ["s0"]), {
      index: 0,
      history: ["s0"],
    });
    assert.equal(pickPrevious(list, 0, off, []), null);
  });

  it("goes back through what was played when shuffled", () => {
    const list = songs("played", "played", "playing");
    assert.deepEqual(pickPrevious(list, 2, shuffleOff, ["s0", "s1"]), {
      index: 1,
      history: ["s0"],
    });
  });

  it("skips history entries that left the list or are current", () => {
    const list = songs("played", "playing");
    assert.deepEqual(pickPrevious(list, 1, shuffleOff, ["s0", "gone", "s1"]), {
      index: 0,
      history: [],
    });
  });

  it("returns null with no history when shuffled", () => {
    assert.equal(
      pickPrevious(songs("played", "playing"), 1, shuffleOff, []),
      null
    );
  });
});

describe("pushHistory", () => {
  it("appends without changing the input", () => {
    const history = ["a"];
    assert.deepEqual(pushHistory(history, "b"), ["a", "b"]);
    assert.deepEqual(history, ["a"]);
  });

  it("keeps only the latest entries", () => {
    const full = Array.from({ length: HISTORY_LIMIT }, (_, i) => `s${i}`);
    const next = pushHistory(full, "new");
    assert.equal(next.length, HISTORY_LIMIT);
    assert.equal(next[0], "s1");
    assert.equal(next[next.length - 1], "new");
  });
});

describe("repeat mode", () => {
  it("cycles off, all, one", () => {
    assert.equal(nextRepeatMode("off"), "all");
    assert.equal(nextRepeatMode("all"), "one");
    assert.equal(nextRepeatMode("one"), "off");
  });

  it("replays on end for repeat one, or repeat all with one song", () => {
    assert.equal(replaysOnEnd(one, 3), true);
    assert.equal(replaysOnEnd(all, 1), true);
    assert.equal(replaysOnEnd(all, 2), false);
    assert.equal(replaysOnEnd(off, 1), false);
  });
});

describe("playback mode storage", () => {
  it("round-trips a saved mode", () => {
    const storage = memoryStorage();
    savePlaybackMode(storage, shuffleAll);
    assert.deepEqual(loadPlaybackMode(storage), shuffleAll);
  });

  it("falls back to the default for missing or broken values", () => {
    assert.deepEqual(loadPlaybackMode(undefined), DEFAULT_PLAYBACK_MODE);
    assert.deepEqual(loadPlaybackMode(memoryStorage()), DEFAULT_PLAYBACK_MODE);
    assert.deepEqual(
      loadPlaybackMode(memoryStorage({ [PLAYBACK_STORAGE_KEY]: "{oops" })),
      DEFAULT_PLAYBACK_MODE
    );
    assert.deepEqual(
      loadPlaybackMode(
        memoryStorage({
          [PLAYBACK_STORAGE_KEY]: JSON.stringify({
            shuffle: "yes",
            repeat: "x",
          }),
        })
      ),
      DEFAULT_PLAYBACK_MODE
    );
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    assert.deepEqual(loadPlaybackMode(throwing), DEFAULT_PLAYBACK_MODE);
    assert.doesNotThrow(() => savePlaybackMode(throwing, shuffleAll));
  });
});
