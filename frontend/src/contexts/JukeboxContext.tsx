import {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useParams } from "react-router-dom";
import type { components } from "@/sdk/api";
import {
  getBox,
  getBoxSongs,
  getSongsByIds,
  createSong,
  createBoxSong,
  updateBoxSong,
  getUser,
  createUser,
  updateUser as updateUserSDK,
} from "@/sdk";
import { usePlayerSongs, type SongRow, type PlayerSong } from "@/lib/player";
import {
  loadPlaybackMode,
  pickNext,
  pickPrevious,
  pushHistory,
  savePlaybackMode,
  type PlaybackMode,
} from "@/lib/playback";
import { JukeboxContext } from "@/hooks/useJukeboxContext";
import fingerprintjs from "@fingerprintjs/fingerprintjs";
import { usernames } from "@/assets/cool-names";

type Box = components["schemas"]["Box"];
type User = components["schemas"]["User"];

function getStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export interface JukeboxContextValue {
  box?: Box;
  rows: SongRow[];
  setRows: Dispatch<SetStateAction<SongRow[]>>;
  songs: PlayerSong[];
  loading: boolean;
  slug?: string;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  addSong: (songData: {
    title: string;
    artist: string;
    youtube_id: string;
    youtube_url: string;
    thumbnail_url: string;
    duration: number;
  }) => Promise<void>;
  updateUser: (data: {
    username?: string;
    fingerprint?: string;
  }) => Promise<void>;
  currentSongIndex: number;
  setCurrentSongId: Dispatch<SetStateAction<string | null>>;
  /** Go to the previous song in the playlist */
  goToPrevious: () => void;
  /** Go to the next song in the playlist */
  goToNext: () => void;
  /** Check if there is a previous song available */
  hasPrevious: boolean;
  /** Check if there is a next song available */
  hasNext: boolean;
  /** Shuffle and repeat settings for this browser */
  playbackMode: PlaybackMode;
  setPlaybackMode: Dispatch<SetStateAction<PlaybackMode>>;
  user?: User;
}

export function JukeboxProvider({ children }: { children: ReactNode }) {
  const { boxSlug } = useParams<{ boxSlug: string }>();
  const [box, setBox] = useState<Box | undefined>(undefined);
  const [rows, setRows] = useState<SongRow[]>([]);
  const songs = usePlayerSongs(rows);
  const [loading, setLoading] = useState(true);
  // Track the current song by id, not by position in the list: dragging or
  // inserting rows would otherwise move the player onto a different song.
  const [currentSongId, setCurrentSongId] = useState<string | null>(null);
  const currentSongIndex =
    currentSongId === null
      ? -1
      : songs.findIndex((song) => song.id === currentSongId);
  const [page, setPage] = useState(0);
  const [fingerprint, setFingerprint] = useState<string | undefined>();
  const [user, setUser] = useState<User | undefined>();
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(() =>
    loadPlaybackMode(getStorage())
  );
  // Songs played in this session, so the previous button can step back
  // through a shuffled order.
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    savePlaybackMode(getStorage(), playbackMode);
  }, [playbackMode]);

  const fetchBox = useCallback(async () => {
    if (!boxSlug) return;
    try {
      const fetched = await getBox(boxSlug);
      setBox(fetched);
    } catch (error) {
      console.error("Error loading box data:", error);
      setBox(undefined);
    }
  }, [boxSlug]);

  const fetchBoxSongs = useCallback(async () => {
    if (!boxSlug) return;
    setLoading(true);
    try {
      // There is no paging UI, so load the whole playlist. Rows past the
      // first page were never listed or played.
      const limit = 1000;
      const offset = page * limit;
      const response = await getBoxSongs(box?.id ?? "", { limit, offset });

      if (!response.data || response.data.length === 0) {
        setRows((prevRows) => {
          // Only clear if we actually had rows before
          return prevRows.length > 0 ? [] : prevRows;
        });
        return;
      }

      // Get all unique song IDs from the box songs
      const songIds = response.data
        .map((boxSong) => boxSong.song_id)
        .filter((id): id is string => Boolean(id));

      // Fetch song details for these IDs
      const songs = await getSongsByIds(songIds);
      const songMap = new Map(songs.map((song) => [song.id, song]));

      const userIds = response.data
        .map((boxSong) => boxSong.user_id)
        .filter((id): id is string => Boolean(id));

      const users = await Promise.all(
        userIds.map((id) => getUser(id).catch(() => undefined))
      );
      const userMap = new Map(users.map((user) => [user?.id || "", user]));

      // Convert box songs to SongRow format
      const newSongRows: SongRow[] = response.data
        .map((boxSong) => {
          const song = songMap.get(boxSong.song_id || "");
          const user = userMap.get(boxSong.user_id || "");
          if (!song) return null;

          return {
            id: boxSong.id || "",
            position: boxSong.position ?? 0,
            title: song.title || "",
            artist: song.artist || "",
            youtube_id: song.youtube_id || "",
            youtube_url: song.youtube_url || "",
            thumbnail_url: song.thumbnail_url || "",
            duration: song.duration || 0,
            status: boxSong.status ?? "queued",
            user,
          };
        })
        .filter(
          (row): row is NonNullable<typeof row> => row !== null
        ) as SongRow[];
      setRows((prevRows) => {
        return newSongRows.map((newRow, idx) => {
          const prevRow = prevRows[idx];
          if (
            prevRow &&
            prevRow.id === newRow.id &&
            prevRow.position === newRow.position &&
            prevRow.title === newRow.title &&
            prevRow.artist === newRow.artist &&
            prevRow.youtube_id === newRow.youtube_id &&
            prevRow.youtube_url === newRow.youtube_url &&
            prevRow.thumbnail_url === newRow.thumbnail_url &&
            prevRow.duration === newRow.duration &&
            prevRow.status === newRow.status
          ) {
            return prevRow; // keep reference if unchanged
          }
          return newRow;
        });
      });

      // Start from the first playing or queued song; keep the current song
      // as long as it is still in the playlist.
      const firstActive =
        newSongRows.find(
          (row) => row.status === "playing" || row.status === "queued"
        ) ?? newSongRows[0];
      if (firstActive) {
        setCurrentSongId((prevId) =>
          prevId && newSongRows.some((row) => row.id === prevId)
            ? prevId
            : firstActive.id
        );
      }
    } catch (error) {
      console.error("Error loading box songs:", error);
      setRows((prevRows) => {
        // Only clear on error if we had rows before
        return prevRows.length > 0 ? [] : prevRows;
      });
    } finally {
      setLoading(false);
    }
  }, [box?.id, boxSlug, page]);

  useEffect(() => {
    const storedFingerprint = localStorage.getItem("jukebox-fingerprint");
    if (storedFingerprint) {
      setFingerprint(storedFingerprint);
    } else {
      fingerprintjs.load().then((fp) => {
        fp.get().then((result) => {
          const fingerprintValue = result.visitorId;
          setFingerprint(fingerprintValue);
          localStorage.setItem("jukebox-fingerprint", fingerprintValue);
        });
      });
    }
  }, []);

  useEffect(() => {
    if (!fingerprint) return;

    const fetchOrCreateUser = async () => {
      try {
        const existingUser = await getUser(fingerprint);
        setUser(existingUser);
      } catch (error) {
        // If user not found, create a new one
        if (error instanceof Error && error.message.includes("404")) {
          try {
            const randomUsername =
              usernames[Math.floor(Math.random() * usernames.length)];
            if (!randomUsername) {
              console.error("Could not get a random username");
              return;
            }
            const newUser = await createUser({
              fingerprint,
              username: randomUsername,
            });
            setUser(newUser);
          } catch (createError) {
            console.error("Error creating user:", createError);
          }
        } else {
          console.error("Error fetching user:", error);
        }
      }
    };

    fetchOrCreateUser();
  }, [fingerprint]);

  useEffect(() => {
    fetchBox();
  }, [fetchBox]);

  useEffect(() => {
    fetchBoxSongs();

    const refetchInterval = setInterval(() => {
      fetchBoxSongs();
    }, 2000);

    return () => clearInterval(refetchInterval);
  }, [fetchBoxSongs]);

  const addSong = useCallback(
    async (songData: {
      title: string;
      artist: string;
      youtube_id: string;
      youtube_url: string;
      thumbnail_url: string;
      duration: number;
    }) => {
      if (!boxSlug || !user?.id) return;
      // Optimistically add a temporary SongRow immediately
      const tempId = `temp-${Date.now()}-${Math.random()}`;
      const optimisticRow: SongRow = {
        id: tempId,
        position: 9999,
        title: songData.title,
        artist: songData.artist,
        youtube_id: songData.youtube_id,
        youtube_url: songData.youtube_url,
        thumbnail_url: songData.thumbnail_url,
        duration: songData.duration,
        status: "queued",
        user,
      };
      setRows((prev) => {
        if (prev.some((row) => row.youtube_id === songData.youtube_id)) {
          return prev;
        }
        return [...prev, optimisticRow];
      });
      try {
        let song;
        try {
          const foundSongs = await getSongsByIds([songData.youtube_id]);
          if (foundSongs && foundSongs.length > 0) {
            song = foundSongs[0];
          } else {
            song = await createSong(songData);
          }
        } catch {
          song = await createSong(songData);
        }
        const relation = await createBoxSong({
          box_id: boxSlug,
          song_id: song.id || "",
          user_id: user.id,
          status: "queued",
        });

        const newRow: SongRow = {
          id: relation.id || "",
          position: relation.position ?? 0,
          title: song.title,
          artist: song.artist,
          youtube_id: song.youtube_id,
          youtube_url: song.youtube_url,
          thumbnail_url: song.thumbnail_url,
          duration: song.duration,
          status: relation.status ?? "queued",
          user,
        };

        setRows((prev) => {
          // Remove the optimistic row and add the real one (unless already present)
          const filtered = prev.filter(
            (row) => row.id !== tempId && row.youtube_id !== newRow.youtube_id
          );
          // Avoid duplicate if already present (e.g. from polling)
          if (filtered.some((row) => row.id === newRow.id)) {
            return filtered;
          }
          return [...filtered, newRow];
        });
      } catch (error) {
        // Remove the optimistic row on error
        setRows((prev) => prev.filter((row) => row.id !== tempId));
        console.error("Error adding YouTube song:", error);
        throw error;
      }
    },
    [boxSlug, user]
  );

  const updateUser = useCallback(
    async (data: { username?: string; fingerprint?: string }) => {
      if (!user?.id) {
        console.error("No user to update");
        return;
      }
      try {
        const updatedUser = await updateUserSDK(user.id, data);
        setUser(updatedUser);
      } catch (error) {
        console.error("Error updating user:", error);
        throw error;
      }
    },
    [user]
  );

  // Mark the row played here as well as on the server, so shuffle does not
  // pick a song skipped moments ago before the next refetch.
  const markPlayed = useCallback((id: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id && row.status !== "played"
          ? { ...row, status: "played" }
          : row
      )
    );
    updateBoxSong(id, { status: "played" }).catch((error) => {
      console.error("Failed to update song status to played:", error);
    });
  }, []);

  // Navigation functions for previous/next songs
  const goToPrevious = useCallback(() => {
    const choice = pickPrevious(songs, currentSongIndex, playbackMode, history);
    if (!choice) return;
    const currentSong = songs[currentSongIndex];
    if (currentSong) markPlayed(currentSong.id);
    const previousSong = songs[choice.index];
    if (previousSong) {
      setHistory(choice.history);
      setCurrentSongId(previousSong.id);
    }
  }, [songs, currentSongIndex, playbackMode, history, markPlayed]);

  // Repeat-all starts the list over: every row waits again, so songs added
  // from now on are placed among them as on a first pass instead of after
  // the whole list.
  const restartPlaylist = useCallback(
    (nextSongId: string) => {
      const toReset = rows.filter(
        (row) => row.id !== nextSongId && row.status !== "queued"
      );
      setRows((prev) =>
        prev.map((row) =>
          row.id === nextSongId || row.status === "queued"
            ? row
            : { ...row, status: "queued" }
        )
      );
      Promise.all(
        toReset.map((row) => updateBoxSong(row.id, { status: "queued" }))
      ).catch((error) => {
        console.error("Failed to set songs back to queued:", error);
      });
    },
    [rows]
  );

  const goToNext = useCallback(() => {
    const choice = pickNext(songs, currentSongIndex, playbackMode);
    if (!choice) return;
    const currentSong = songs[currentSongIndex];
    const nextSong = songs[choice.index];
    if (!nextSong) return;
    if (choice.restart) {
      // The current song goes back to queued with the rest, so it is not
      // marked played here.
      restartPlaylist(nextSong.id);
    } else if (currentSong) {
      markPlayed(currentSong.id);
    }
    if (currentSong) {
      setHistory((prev) => pushHistory(prev, currentSong.id));
    }
    setCurrentSongId(nextSong.id);
  }, [currentSongIndex, songs, playbackMode, restartPlaylist, markPlayed]);

  // Helper properties to check if navigation is available
  const hasPrevious =
    pickPrevious(songs, currentSongIndex, playbackMode, history) !== null;
  const hasNext = pickNext(songs, currentSongIndex, playbackMode) !== null;

  // Expose context value
  return (
    <JukeboxContext.Provider
      value={{
        box,
        rows,
        setRows,
        songs,
        loading,
        slug: boxSlug,
        page,
        setPage,
        addSong,
        currentSongIndex,
        setCurrentSongId,
        goToPrevious,
        goToNext,
        hasPrevious,
        hasNext,
        playbackMode,
        setPlaybackMode,
        user,
        updateUser,
      }}
    >
      {children}
    </JukeboxContext.Provider>
  );
}
