import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import {
  createChartCache,
  fetchWeeklyChart,
  parseChartResponse,
  WeeklyChart,
} from "../../src/youtube-charts";

const fixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "../fixtures/youtube-charts-kr-weekly.json"),
    "utf8"
  )
);

type Call = {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
};

function fakeFetch(
  respond: (url: string) => { ok: boolean; status: number; body: unknown }
) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: Call["init"]) => {
    calls.push({ url, init });
    const r = respond(url);
    return { ok: r.ok, status: r.status, json: async () => r.body };
  };
  return { impl, calls };
}

describe("parseChartResponse", () => {
  it("maps chart entries in rank order", () => {
    const { endDate, entries } = parseChartResponse(fixture);

    assert.equal(endDate, "2026-09-24");
    assert.deepEqual(
      entries.map((e) => e.rank),
      [1, 4, 22, 48]
    );
    assert.deepEqual(entries[0], {
      rank: 1,
      previousRank: 2,
      periodsOnChart: 3,
      title: "퇴사할게여",
      artist: "소연 (SOYEON)",
      youtubeId: "7mDDM0eBWR0",
      viewCount: 6220220,
      thumbnail: entries[0].thumbnail,
      url: "https://www.youtube.com/watch?v=7mDDM0eBWR0",
      duration: "PT0S",
    });
    assert.match(entries[0].thumbnail ?? "", /^https:\/\/yt3\./);
  });

  it("marks entries without a previous rank", () => {
    const { entries } = parseChartResponse(fixture);
    const newEntry = entries.find((e) => e.rank === 4)!;
    const reEntry = entries.find((e) => e.rank === 48)!;

    assert.equal(newEntry.previousRank, null);
    assert.equal(newEntry.periodsOnChart, 1);
    assert.equal(reEntry.previousRank, null);
    assert.equal(reEntry.periodsOnChart, 21);
  });

  it("joins artists and trims titles", () => {
    const { entries } = parseChartResponse(fixture);
    const duet = entries.find((e) => e.rank === 22)!;

    assert.equal(duet.title, "생각을 멈추다 보면");
    assert.equal(duet.artist, "최유리, 진영");
  });

  it("throws when the response no longer has a chart", () => {
    assert.throws(
      () => parseChartResponse({ contents: {} }),
      /chart not found/
    );
  });
});

describe("fetchWeeklyChart", () => {
  it("requests the weekly track chart for the country", async () => {
    const { impl, calls } = fakeFetch(() => ({
      ok: true,
      status: 200,
      body: fixture,
    }));

    await fetchWeeklyChart({ fetchImpl: impl, country: "kr" });

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/charts\.youtube\.com\/youtubei\/v1\/browse/);
    assert.equal(calls[0].init?.method, "POST");
    const body = JSON.parse(calls[0].init?.body ?? "{}");
    // YouTube Charts answers 400 unless both hl and gl are set.
    assert.equal(body.context.client.hl, "ko");
    assert.equal(body.context.client.gl, "KR");
    assert.equal(body.browseId, "FEmusic_analytics_charts_home");
    assert.match(body.query, /chart_params_country_code=kr/);
    assert.match(body.query, /chart_params_chart_type=TRACKS/);
    assert.match(body.query, /chart_params_period_type=WEEKLY/);
  });

  it("fills durations from the YouTube Data API when a key is set", async () => {
    const { impl, calls } = fakeFetch((url) => {
      if (url.startsWith("https://charts.youtube.com")) {
        return { ok: true, status: 200, body: fixture };
      }
      return {
        ok: true,
        status: 200,
        body: {
          items: [
            { id: "7mDDM0eBWR0", contentDetails: { duration: "PT3M5S" } },
            { id: "Lufa9QAFFeY", contentDetails: { duration: "PT2M40S" } },
          ],
        },
      };
    });

    const chart = await fetchWeeklyChart({
      fetchImpl: impl,
      country: "kr",
      apiKey: "test-key",
    });

    const videoCalls = calls.filter((c) =>
      c.url.startsWith("https://www.googleapis.com/youtube/v3/videos")
    );
    assert.equal(videoCalls.length, 1);
    assert.match(videoCalls[0].url, /id=7mDDM0eBWR0%2CLufa9QAFFeY%2Cto3sjq-CAvA%2CsLMK_GYLLE4/);
    // The key goes in a header: fetch errors quote the URL, and those get logged.
    assert.doesNotMatch(videoCalls[0].url, /test-key/);
    assert.equal(videoCalls[0].init?.headers?.["X-Goog-Api-Key"], "test-key");
    assert.equal(chart.entries[0].duration, "PT3M5S");
    assert.equal(chart.entries[1].duration, "PT2M40S");
    assert.equal(chart.entries[2].duration, "PT0S");
  });

  it("asks for durations in batches of 50 ids", async () => {
    const many = structuredClone(fixture);
    const views =
      many.contents.sectionListRenderer.contents[0].musicAnalyticsSectionRenderer
        .content.trackTypes[0];
    views.trackViews = Array.from({ length: 100 }, (_, i) => ({
      ...views.trackViews[0],
      encryptedVideoId: `vid${i}`,
      chartEntryMetadata: { currentPosition: i + 1, periodsOnChart: 1 },
    }));
    const { impl, calls } = fakeFetch((url) =>
      url.startsWith("https://charts.youtube.com")
        ? { ok: true, status: 200, body: many }
        : { ok: true, status: 200, body: { items: [] } }
    );

    await fetchWeeklyChart({ fetchImpl: impl, country: "kr", apiKey: "k" });

    const videoCalls = calls.filter((c) => c.url.includes("/youtube/v3/videos"));
    assert.equal(videoCalls.length, 2);
  });

  it("keeps the chart when the duration lookup fails", async () => {
    const { impl } = fakeFetch((url) =>
      url.startsWith("https://charts.youtube.com")
        ? { ok: true, status: 200, body: fixture }
        : { ok: false, status: 403, body: { error: { message: "quota" } } }
    );

    const chart = await fetchWeeklyChart({
      fetchImpl: impl,
      country: "kr",
      apiKey: "k",
    });

    assert.equal(chart.entries.length, 4);
    assert.ok(chart.entries.every((e) => e.duration === "PT0S"));
  });

  it("fails with the status when the chart request fails", async () => {
    const { impl } = fakeFetch(() => ({ ok: false, status: 429, body: {} }));

    await assert.rejects(
      fetchWeeklyChart({ fetchImpl: impl, country: "kr" }),
      /YouTube Charts request failed: 429/
    );
  });
});

describe("createChartCache", () => {
  const chart = (endDate: string): WeeklyChart => ({
    country: "kr",
    endDate,
    fetchedAt: "",
    stale: false,
    entries: [],
  });

  it("reuses a loaded chart until the TTL passes", async () => {
    let now = 0;
    let loads = 0;
    const cache = createChartCache({
      ttlMs: 1000,
      now: () => now,
      load: async () => chart(`week-${++loads}`),
    });

    assert.equal((await cache.get()).endDate, "week-1");
    now = 999;
    assert.equal((await cache.get()).endDate, "week-1");
    now = 1000;
    assert.equal((await cache.get()).endDate, "week-2");
    assert.equal(loads, 2);
  });

  it("serves the last chart marked stale when a reload fails", async () => {
    let now = 0;
    let fail = false;
    const cache = createChartCache({
      ttlMs: 1000,
      now: () => now,
      load: async () => {
        if (fail) throw new Error("boom");
        return chart("week-1");
      },
    });

    await cache.get();
    now = 5000;
    fail = true;
    const result = await cache.get();

    assert.equal(result.endDate, "week-1");
    assert.equal(result.stale, true);
  });

  it("throws when nothing is cached and the load fails", async () => {
    const cache = createChartCache({
      ttlMs: 1000,
      now: () => 0,
      load: async () => {
        throw new Error("boom");
      },
    });

    await assert.rejects(cache.get(), /boom/);
  });

  it("shares one load between concurrent requests", async () => {
    let loads = 0;
    const cache = createChartCache({
      ttlMs: 1000,
      now: () => 0,
      load: async () => {
        loads++;
        return chart("week-1");
      },
    });

    await Promise.all([cache.get(), cache.get(), cache.get()]);

    assert.equal(loads, 1);
  });
});
