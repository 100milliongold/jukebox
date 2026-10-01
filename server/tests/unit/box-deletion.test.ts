import assert from "node:assert/strict";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { Database } from "../../src/types/db";
import {
  BoxNotFoundError,
  NotBoxOwnerError,
  deleteBoxWithSongs,
} from "../../src/box-deletion";

// Same tables and foreign keys as the migrations produce in production.
function createDb() {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, username TEXT NOT NULL);
    CREATE TABLE boxes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE TABLE songs (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT, youtube_id TEXT UNIQUE,
      youtube_url TEXT, duration INTEGER, thumbnail_url TEXT);
    CREATE TABLE box_songs (
      id TEXT PRIMARY KEY,
      box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
      song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      UNIQUE (box_id, song_id));
    CREATE TABLE song_youtube_status (
      id TEXT PRIMARY KEY,
      youtube_id TEXT NOT NULL UNIQUE REFERENCES songs(youtube_id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending', retry_count INTEGER DEFAULT 0,
      error_message TEXT, created_at TEXT, updated_at TEXT);
  `);
  return {
    sqlite,
    db: new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) }),
  };
}

// owner owns box "mine" with songs a, b; box "other" (someone else's) has b, c.
function seed(sqlite: BetterSqlite3.Database) {
  sqlite.exec(`
    INSERT INTO users VALUES ('owner', 'fp-owner', 'Owner'), ('guest', 'fp-guest', 'Guest');
    INSERT INTO boxes VALUES ('box-mine', 'Mine', 'mine', 'owner'), ('box-other', 'Other', 'other', 'guest');
    INSERT INTO songs (id, title, youtube_id) VALUES ('a', 'A', 'yt-a'), ('b', 'B', 'yt-b'), ('c', 'C', 'yt-c');
    INSERT INTO box_songs (id, box_id, song_id, user_id, position) VALUES
      ('m1', 'box-mine', 'a', 'owner', 1), ('m2', 'box-mine', 'b', 'guest', 2),
      ('o1', 'box-other', 'b', 'guest', 1), ('o2', 'box-other', 'c', 'guest', 2);
    INSERT INTO song_youtube_status (id, youtube_id, status) VALUES
      ('s-a', 'yt-a', 'completed'), ('s-b', 'yt-b', 'completed'), ('s-c', 'yt-c', 'completed');
  `);
}

const ids = (sqlite: BetterSqlite3.Database, table: string) =>
  (sqlite.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as { id: string }[]).map(
    (r) => r.id
  );

describe("deleteBoxWithSongs", () => {
  it("deletes the box, its playlist and only the songs no other box uses", async () => {
    const { sqlite, db } = createDb();
    seed(sqlite);
    const deletedAudio: string[] = [];

    const result = await deleteBoxWithSongs({
      db,
      boxIdOrSlug: "mine",
      userId: "owner",
      deleteAudio: async (youtubeId) => {
        deletedAudio.push(youtubeId);
      },
    });

    assert.deepEqual(ids(sqlite, "boxes"), ["box-other"]);
    assert.deepEqual(ids(sqlite, "box_songs"), ["o1", "o2"]);
    // b is still in the other box, so it and its audio stay
    assert.deepEqual(ids(sqlite, "songs"), ["b", "c"]);
    assert.deepEqual(ids(sqlite, "song_youtube_status"), ["s-b", "s-c"]);
    assert.deepEqual(deletedAudio, ["yt-a"]);
    assert.deepEqual(result, { deletedSongs: 1, deletedFiles: 1, failedFiles: 0 });
  });

  it("accepts the box id as well as the slug", async () => {
    const { sqlite, db } = createDb();
    seed(sqlite);

    await deleteBoxWithSongs({
      db,
      boxIdOrSlug: "box-mine",
      userId: "owner",
      deleteAudio: async () => {},
    });

    assert.deepEqual(ids(sqlite, "boxes"), ["box-other"]);
  });

  it("refuses a user who does not own the box and changes nothing", async () => {
    const { sqlite, db } = createDb();
    seed(sqlite);
    let audioCalls = 0;

    for (const userId of ["guest", undefined, ""]) {
      await assert.rejects(
        deleteBoxWithSongs({
          db,
          boxIdOrSlug: "mine",
          userId,
          deleteAudio: async () => {
            audioCalls++;
          },
        }),
        NotBoxOwnerError
      );
    }

    assert.deepEqual(ids(sqlite, "boxes"), ["box-mine", "box-other"]);
    assert.deepEqual(ids(sqlite, "songs"), ["a", "b", "c"]);
    assert.equal(audioCalls, 0);
  });

  it("reports a missing box", async () => {
    const { sqlite, db } = createDb();
    seed(sqlite);

    await assert.rejects(
      deleteBoxWithSongs({
        db,
        boxIdOrSlug: "no-such-box",
        userId: "owner",
        deleteAudio: async () => {},
      }),
      BoxNotFoundError
    );
  });

  it("keeps the database deletion when an audio file cannot be removed", async () => {
    const { sqlite, db } = createDb();
    seed(sqlite);
    sqlite.exec(`
      INSERT INTO songs (id, title, youtube_id) VALUES ('d', 'D', 'yt-d');
      INSERT INTO box_songs (id, box_id, song_id, user_id, position) VALUES ('m3', 'box-mine', 'd', 'owner', 3);
    `);

    const result = await deleteBoxWithSongs({
      db,
      boxIdOrSlug: "mine",
      userId: "owner",
      deleteAudio: async (youtubeId) => {
        if (youtubeId === "yt-a") throw new Error("S3 down");
      },
    });

    assert.deepEqual(ids(sqlite, "songs"), ["b", "c"]);
    assert.deepEqual(result, { deletedSongs: 2, deletedFiles: 1, failedFiles: 1 });
  });

  it("skips the audio step for songs without a YouTube id", async () => {
    const { sqlite, db } = createDb();
    seed(sqlite);
    sqlite.exec(`
      INSERT INTO songs (id, title) VALUES ('e', 'no youtube');
      INSERT INTO box_songs (id, box_id, song_id, user_id, position) VALUES ('m4', 'box-mine', 'e', 'owner', 4);
    `);
    const deletedAudio: string[] = [];

    const result = await deleteBoxWithSongs({
      db,
      boxIdOrSlug: "mine",
      userId: "owner",
      deleteAudio: async (youtubeId) => {
        deletedAudio.push(youtubeId);
      },
    });

    assert.deepEqual(deletedAudio, ["yt-a"]);
    assert.deepEqual(result, { deletedSongs: 2, deletedFiles: 1, failedFiles: 0 });
  });
});
