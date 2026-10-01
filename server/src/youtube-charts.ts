// Weekly "Top songs" chart from YouTube Charts (charts.youtube.com), ranked by
// weekly views. There is no public API for it: this calls the same internal
// endpoint the charts page uses, so a format change on YouTube's side shows
// up here as a "chart not found" error.

const CHARTS_URL = "https://charts.youtube.com/youtubei/v1/browse?alt=json";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
const VIDEOS_BATCH = 50;
const UNKNOWN_DURATION = "PT0S";

export interface ChartEntry {
  rank: number;
  previousRank: number | null;
  periodsOnChart: number;
  title: string;
  artist: string;
  youtubeId: string;
  viewCount: number;
  thumbnail: string | null;
  url: string;
  duration: string;
}

export interface WeeklyChart {
  country: string;
  endDate: string | null;
  fetchedAt: string;
  stale: boolean;
  entries: ChartEntry[];
}

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface TrackView {
  name?: string;
  viewCount?: string;
  encryptedVideoId?: string;
  thumbnail?: { thumbnails?: { url?: string }[] };
  artists?: { name?: string }[];
  chartEntryMetadata?: {
    currentPosition?: number;
    previousPosition?: number;
    periodsOnChart?: number;
  };
}

function findTrackChart(
  body: unknown
): { endDate?: string; trackViews: TrackView[] } | undefined {
  const sections = (body as any)?.contents?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return undefined;
  for (const section of sections) {
    const trackTypes =
      section?.musicAnalyticsSectionRenderer?.content?.trackTypes;
    if (!Array.isArray(trackTypes)) continue;
    const chart = trackTypes.find((t: any) => Array.isArray(t?.trackViews));
    if (chart) return chart;
  }
  return undefined;
}

export function parseChartResponse(body: unknown): {
  endDate: string | null;
  entries: ChartEntry[];
} {
  const chart = findTrackChart(body);
  if (!chart) {
    throw new Error("YouTube Charts response format changed: chart not found");
  }

  const entries = chart.trackViews
    .filter((t) => t.encryptedVideoId && t.chartEntryMetadata?.currentPosition)
    .map((t) => {
      const meta = t.chartEntryMetadata!;
      const youtubeId = t.encryptedVideoId!;
      return {
        rank: meta.currentPosition!,
        previousRank: meta.previousPosition ?? null,
        periodsOnChart: meta.periodsOnChart ?? 1,
        title: (t.name ?? "").trim(),
        artist: (t.artists ?? [])
          .map((a) => a.name)
          .filter(Boolean)
          .join(", "),
        youtubeId,
        viewCount: Number(t.viewCount ?? 0),
        thumbnail: t.thumbnail?.thumbnails?.[0]?.url ?? null,
        url: `https://www.youtube.com/watch?v=${youtubeId}`,
        duration: UNKNOWN_DURATION,
      };
    })
    .sort((a, b) => a.rank - b.rank);

  return { endDate: chart.endDate ?? null, entries };
}

async function fetchDurations(
  fetchImpl: FetchLike,
  apiKey: string,
  ids: string[]
): Promise<Map<string, string>> {
  const durations = new Map<string, string>();
  for (let i = 0; i < ids.length; i += VIDEOS_BATCH) {
    const params = new URLSearchParams({
      part: "contentDetails",
      id: ids.slice(i, i + VIDEOS_BATCH).join(","),
    });
    // The key goes in a header, not the URL: fetch errors quote the URL and
    // those errors end up in the server log.
    const response = await fetchImpl(`${VIDEOS_URL}?${params}`, {
      headers: { "X-Goog-Api-Key": apiKey },
    });
    if (!response.ok) {
      throw new Error(`YouTube videos request failed: ${response.status}`);
    }
    const data = (await response.json()) as {
      items?: { id: string; contentDetails?: { duration?: string } }[];
    };
    for (const item of data.items ?? []) {
      if (item.contentDetails?.duration) {
        durations.set(item.id, item.contentDetails.duration);
      }
    }
  }
  return durations;
}

export async function fetchWeeklyChart(options: {
  fetchImpl: FetchLike;
  country: string;
  apiKey?: string;
}): Promise<WeeklyChart> {
  const { fetchImpl, country, apiKey } = options;
  const response = await fetchImpl(CHARTS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://charts.youtube.com/",
    },
    body: JSON.stringify({
      // Both hl and gl are required; without either the endpoint answers 400.
      context: {
        client: {
          clientName: "WEB_MUSIC_ANALYTICS",
          clientVersion: "2.0",
          hl: "ko",
          gl: country.toUpperCase(),
        },
      },
      browseId: "FEmusic_analytics_charts_home",
      query:
        "perspective=CHART_DETAILS" +
        `&chart_params_country_code=${country}` +
        "&chart_params_chart_type=TRACKS" +
        "&chart_params_period_type=WEEKLY",
    }),
  });
  if (!response.ok) {
    throw new Error(`YouTube Charts request failed: ${response.status}`);
  }
  const { endDate, entries } = parseChartResponse(await response.json());

  let withDurations = entries;
  if (apiKey && entries.length > 0) {
    try {
      const durations = await fetchDurations(
        fetchImpl,
        apiKey,
        entries.map((e) => e.youtubeId)
      );
      withDurations = entries.map((e) => ({
        ...e,
        duration: durations.get(e.youtubeId) ?? UNKNOWN_DURATION,
      }));
    } catch (error) {
      // Durations only fill in the song length; the ranking stays usable.
      console.error("YouTube Charts duration lookup failed:", error);
    }
  }

  return {
    country,
    endDate,
    fetchedAt: new Date().toISOString(),
    stale: false,
    entries: withDurations,
  };
}

export function createChartCache(options: {
  ttlMs: number;
  load: () => Promise<WeeklyChart>;
  now?: () => number;
}) {
  const { ttlMs, load } = options;
  const now = options.now ?? Date.now;
  let cached: { chart: WeeklyChart; loadedAt: number } | undefined;
  let pending: Promise<WeeklyChart> | undefined;

  const reload = async (): Promise<WeeklyChart> => {
    try {
      const chart = await load();
      cached = { chart, loadedAt: now() };
      return chart;
    } catch (error) {
      // Keep showing last week's chart rather than an empty card.
      if (cached) return { ...cached.chart, stale: true };
      throw error;
    } finally {
      pending = undefined;
    }
  };

  return {
    get(): Promise<WeeklyChart> {
      if (cached && now() - cached.loadedAt < ttlMs) {
        return Promise.resolve(cached.chart);
      }
      pending ??= reload();
      return pending;
    },
  };
}
