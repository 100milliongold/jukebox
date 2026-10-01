import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Loader2, Plus } from "lucide-react";
import { formatDuration, parseYouTubeDuration } from "@/lib/youtube";
import { getYouTubeCharts } from "@/sdk";
import type { ChartEntry, WeeklyChart } from "@/sdk";
import { useJukebox } from "@/hooks/useJukeboxContext";

interface TopChartProps {
  onSongSelect: (song: {
    title: string;
    artist: string;
    youtube_id: string;
    youtube_url: string;
    thumbnail_url: string;
    duration: number;
  }) => void;
}

const compactViews = new Intl.NumberFormat("en", { notation: "compact" });

function RankChange({ entry }: { entry: ChartEntry }) {
  if (entry.previousRank === null) {
    // No previous rank: either first week on the chart or back after a gap
    return (
      <span className="text-xs font-semibold text-blue-600">
        {entry.periodsOnChart <= 1 ? "NEW" : "RE"}
      </span>
    );
  }
  const change = entry.previousRank - entry.rank;
  if (change > 0) {
    return <span className="text-xs text-green-600">▲{change}</span>;
  }
  if (change < 0) {
    return <span className="text-xs text-red-600">▼{-change}</span>;
  }
  return <span className="text-xs text-gray-400">-</span>;
}

export default function TopChart({ onSongSelect }: TopChartProps) {
  const { rows } = useJukebox();
  const [chart, setChart] = useState<WeeklyChart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getYouTubeCharts()
      .then((data) => {
        if (!cancelled) setChart(data);
      })
      .catch((err) => {
        console.error("Failed to load YouTube chart:", err);
        if (!cancelled) setError("Couldn't load the YouTube chart right now.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAdd = (entry: ChartEntry) => {
    setAddingIds((prev) => new Set(prev).add(entry.youtubeId));
    try {
      onSongSelect({
        title: entry.title,
        artist: entry.artist,
        youtube_id: entry.youtubeId,
        youtube_url: entry.url,
        thumbnail_url:
          entry.thumbnail ??
          `https://i.ytimg.com/vi/${entry.youtubeId}/mqdefault.jpg`,
        duration: parseYouTubeDuration(entry.duration),
      });
    } finally {
      setAddingIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.youtubeId);
        return next;
      });
    }
  };

  return (
    <Card className="bg-white text-foreground">
      <CardContent>
        <div className="space-y-3">
          <h3 className="text-lg font-semibold">YouTube Top Songs</h3>
          <p className="text-sm text-muted-foreground">
            Most-viewed songs on YouTube in Korea
            {chart?.endDate && <> for the week ending {chart.endDate}</>}
            {chart?.stale && <> (couldn't refresh, showing the last chart)</>}
          </p>

          {error && (
            <div className="text-red-600 text-sm p-2 bg-red-50 rounded-md">
              {error}
            </div>
          )}

          {!chart && !error && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading chart...
            </div>
          )}

          {chart && (
            <ol className="grid gap-2 max-h-96 overflow-y-auto scrollbar">
              {chart.entries.map((entry) => {
                const inPlaylist = rows.some(
                  (row) => row.youtube_id === entry.youtubeId
                );
                const adding = addingIds.has(entry.youtubeId);
                return (
                  <li
                    key={entry.youtubeId}
                    className="flex items-center justify-between gap-3 rounded-md border p-2"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 shrink-0 text-center">
                        <div className="font-bold">{entry.rank}</div>
                        <RankChange entry={entry} />
                      </div>
                      {entry.thumbnail && (
                        <img
                          src={entry.thumbnail}
                          alt=""
                          className="w-12 h-12 object-cover rounded shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <h4 className="font-medium text-sm truncate" title={entry.title}>
                          {entry.title}
                        </h4>
                        <p className="text-xs text-gray-600 truncate" title={entry.artist}>
                          {entry.artist}
                        </p>
                        <p className="text-xs text-gray-500">
                          {compactViews.format(entry.viewCount)} views this week
                          {entry.duration !== "PT0S" &&
                            ` · ${formatDuration(parseYouTubeDuration(entry.duration))}`}
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleAdd(entry)}
                      disabled={inPlaylist || adding}
                      className="flex items-center gap-1 shrink-0"
                    >
                      {inPlaylist ? (
                        <Check className="h-3 w-3" />
                      ) : adding ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      {inPlaylist ? "Added" : adding ? "Adding..." : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
