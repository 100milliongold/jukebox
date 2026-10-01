import { Kysely, sql } from "kysely";
import { Database } from "./types/db";

export class BoxNotFoundError extends Error {
  constructor() {
    super("Box not found");
  }
}

export class NotBoxOwnerError extends Error {
  constructor() {
    super("Only the user who created this box can delete it");
  }
}

export interface BoxDeletionResult {
  deletedSongs: number;
  deletedFiles: number;
  failedFiles: number;
}

/**
 * Delete a box together with the songs that no other box uses, and their
 * downloaded audio.
 *
 * The database rows go first, in one transaction: deleting the box cascades
 * to its box_songs, and deleting a song cascades to its download status.
 * Audio files are removed afterwards. A file that fails to delete is only
 * counted: a leftover file is overwritten when the song is downloaded again,
 * whereas a song row whose file is gone would never be downloaded again.
 */
export async function deleteBoxWithSongs(options: {
  db: Kysely<Database>;
  boxIdOrSlug: string;
  userId: string | undefined;
  deleteAudio: (youtubeId: string) => Promise<void>;
}): Promise<BoxDeletionResult> {
  const { db, boxIdOrSlug, userId, deleteAudio } = options;

  const box = await db
    .selectFrom("boxes")
    .select(["id", "user_id"])
    .where(sql<boolean>`id = ${boxIdOrSlug} OR slug = ${boxIdOrSlug}`)
    .executeTakeFirst();
  if (!box) throw new BoxNotFoundError();
  // The user id comes from the browser fingerprint, so this guards against
  // deleting someone else's box by mistake, not against a deliberate attempt.
  if (!userId || box.user_id !== userId) throw new NotBoxOwnerError();

  const orphanedSongs = await db.transaction().execute(async (trx) => {
    const songIds = (
      await trx
        .selectFrom("box_songs")
        .select("song_id")
        .where("box_id", "=", box.id)
        .execute()
    ).map((r) => r.song_id);

    await trx.deleteFrom("boxes").where("id", "=", box.id).execute();
    if (songIds.length === 0) return [];

    const orphans = await trx
      .selectFrom("songs")
      .select(["id", "youtube_id"])
      .where("id", "in", songIds)
      .where("id", "not in", trx.selectFrom("box_songs").select("song_id"))
      .execute();
    if (orphans.length > 0) {
      await trx
        .deleteFrom("songs")
        .where(
          "id",
          "in",
          orphans.map((s) => s.id)
        )
        .execute();
    }
    return orphans;
  });

  let deletedFiles = 0;
  let failedFiles = 0;
  for (const song of orphanedSongs) {
    if (!song.youtube_id) continue;
    try {
      await deleteAudio(song.youtube_id);
      deletedFiles++;
    } catch (error) {
      failedFiles++;
      console.error(`Failed to delete audio for ${song.youtube_id}:`, error);
    }
  }

  return { deletedSongs: orphanedSongs.length, deletedFiles, failedFiles };
}
