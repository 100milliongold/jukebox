export type RepeatMode = "off" | "all" | "one";

export interface PlaybackMode {
  shuffle: boolean;
  repeat: RepeatMode;
}

/** The fields of a playlist row that decide what plays next. */
export interface QueueSong {
  id: string;
  status?: "queued" | "playing" | "played";
}

export interface NextChoice {
  index: number;
  /**
   * The playlist ran out and repeat-all starts it over: every row except the
   * chosen one should go back to "queued".
   */
  restart: boolean;
}

export const PLAYBACK_STORAGE_KEY = "jukebox-playback-mode";
export const DEFAULT_PLAYBACK_MODE: PlaybackMode = {
  shuffle: false,
  repeat: "off",
};
/** How many played songs the previous button can step back through. */
export const HISTORY_LIMIT = 100;

const REPEAT_ORDER: RepeatMode[] = ["off", "all", "one"];

export function nextRepeatMode(mode: RepeatMode): RepeatMode {
  const index = REPEAT_ORDER.indexOf(mode);
  return REPEAT_ORDER[(index + 1) % REPEAT_ORDER.length] ?? "off";
}

/**
 * Whether a song that just ended should start again instead of advancing.
 * With repeat-all, a one-song playlist restarts the same song.
 */
export function replaysOnEnd(mode: PlaybackMode, songCount: number): boolean {
  return mode.repeat === "one" || (mode.repeat === "all" && songCount === 1);
}

function pickOne(indexes: number[], random: () => number): number | undefined {
  const at = Math.min(
    indexes.length - 1,
    Math.floor(random() * indexes.length)
  );
  return indexes[at];
}

function indexesWhere(
  songs: QueueSong[],
  test: (song: QueueSong, index: number) => boolean
): number[] {
  return songs.flatMap((song, index) => (test(song, index) ? [index] : []));
}

/**
 * Choose the song after the current one, or null when playback should stop.
 * Shuffle picks among rows still queued, so a reload never replays a song
 * that already played. Repeat-one only matters when a song ends; skipping
 * moves on as with repeat off.
 */
export function pickNext(
  songs: QueueSong[],
  currentIndex: number,
  mode: PlaybackMode,
  random: () => number = Math.random
): NextChoice | null {
  if (!mode.shuffle && currentIndex + 1 < songs.length) {
    return { index: currentIndex + 1, restart: false };
  }
  if (mode.shuffle) {
    const waiting = indexesWhere(
      songs,
      (song, index) => index !== currentIndex && song.status === "queued"
    );
    const index = pickOne(waiting, random);
    if (index !== undefined) return { index, restart: false };
  }

  if (mode.repeat !== "all" || songs.length < 2) return null;
  if (!mode.shuffle) return { index: 0, restart: true };
  const others = indexesWhere(songs, (_, index) => index !== currentIndex);
  const index = pickOne(others, random);
  return index === undefined ? null : { index, restart: true };
}

/**
 * Choose the song before the current one. In order it is the row above;
 * shuffled it is the last song played that is still in the list, and the
 * history is cut back to before it.
 */
export function pickPrevious(
  songs: QueueSong[],
  currentIndex: number,
  mode: PlaybackMode,
  history: string[]
): { index: number; history: string[] } | null {
  if (!mode.shuffle) {
    return currentIndex > 0 ? { index: currentIndex - 1, history } : null;
  }
  const currentId = songs[currentIndex]?.id;
  for (let at = history.length - 1; at >= 0; at--) {
    const id = history[at];
    if (id === currentId) continue;
    const index = songs.findIndex((song) => song.id === id);
    if (index !== -1) return { index, history: history.slice(0, at) };
  }
  return null;
}

export function pushHistory(history: string[], id: string): string[] {
  return [...history, id].slice(-HISTORY_LIMIT);
}

export function loadPlaybackMode(
  storage: Pick<Storage, "getItem"> | undefined
): PlaybackMode {
  try {
    const raw = storage?.getItem(PLAYBACK_STORAGE_KEY);
    if (!raw) return DEFAULT_PLAYBACK_MODE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_PLAYBACK_MODE;
    }
    const stored = parsed as Record<string, unknown>;
    const repeat = REPEAT_ORDER.find((mode) => mode === stored.repeat);
    if (typeof stored.shuffle !== "boolean" || !repeat) {
      return DEFAULT_PLAYBACK_MODE;
    }
    return { shuffle: stored.shuffle, repeat };
  } catch {
    // Private windows and blocked site data throw here; start with defaults.
    return DEFAULT_PLAYBACK_MODE;
  }
}

export function savePlaybackMode(
  storage: Pick<Storage, "setItem"> | undefined,
  mode: PlaybackMode
): void {
  try {
    storage?.setItem(PLAYBACK_STORAGE_KEY, JSON.stringify(mode));
  } catch {
    // The setting just won't survive a reload.
  }
}
