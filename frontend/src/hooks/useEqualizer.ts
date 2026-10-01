import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  EQ_BANDS,
  EQ_PRESETS,
  clampGain,
  isFlat,
  loadEqGains,
  preampDb,
  presetIdFor,
  saveEqGains,
} from "@/lib/equalizer";
import type { EqBand, EqGains } from "@/lib/equalizer";

interface EqGraph {
  ctx: AudioContext;
  preamp: GainNode;
  filters: Record<EqBand, BiquadFilterNode>;
  source: MediaElementAudioSourceNode | null;
  element: HTMLMediaElement | null;
}

function getStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function createGraph(): EqGraph | null {
  if (typeof window.AudioContext !== "function") return null;
  const ctx = new AudioContext();
  const preamp = ctx.createGain();
  let previous: AudioNode = preamp;
  const filters = {} as Record<EqBand, BiquadFilterNode>;
  for (const { band, type, frequency, q } of EQ_BANDS) {
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    if (q !== undefined) filter.Q.value = q;
    previous.connect(filter);
    previous = filter;
    filters[band] = filter;
  }
  previous.connect(ctx.destination);
  return { ctx, preamp, filters, source: null, element: null };
}

function applyGains(graph: EqGraph, gains: EqGains) {
  for (const { band } of EQ_BANDS) {
    graph.filters[band].gain.value = gains[band];
  }
  graph.preamp.gain.value = Math.pow(10, preampDb(gains) / 20);
}

/**
 * Bass/mid/treble equalizer for the player's <audio> element.
 *
 * Once an element feeds a MediaElementSource, its sound only comes out
 * through the AudioContext, and browsers keep a context suspended until the
 * user interacts with the page. Connecting early would mute an autoplaying
 * song, so the element is connected only after the context is running.
 */
export function useEqualizer(audioRef: RefObject<HTMLMediaElement | null>) {
  const [gains, setGains] = useState<EqGains>(() => loadEqGains(getStorage()));
  const graphRef = useRef<EqGraph | null>(null);
  const gainsRef = useRef(gains);
  // One source per element: createMediaElementSource throws on a second call.
  const sourcesRef = useRef(
    new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  );

  const connect = useCallback(
    (graph: EqGraph) => {
      const element = audioRef.current;
      if (!element || graph.element === element) return;
      try {
        let source = sourcesRef.current.get(element);
        if (!source) {
          source = graph.ctx.createMediaElementSource(element);
          sourcesRef.current.set(element, source);
        }
        graph.source?.disconnect();
        source.connect(graph.preamp);
        graph.source = source;
        graph.element = element;
      } catch (error) {
        // The element keeps playing directly, just without the equalizer.
        console.error("Failed to connect the equalizer:", error);
      }
    },
    [audioRef]
  );

  /** Route the player through the equalizer once the browser lets audio run. */
  const attach = useCallback(() => {
    if (!audioRef.current) return;
    let graph = graphRef.current;
    if (!graph) {
      graph = createGraph();
      if (!graph) return;
      applyGains(graph, gainsRef.current);
      graphRef.current = graph;
    }
    const current = graph;
    current.ctx
      .resume()
      .catch(() => {})
      .then(() => {
        if (current.ctx.state === "running") connect(current);
      });
  }, [audioRef, connect]);

  useEffect(() => {
    gainsRef.current = gains;
    saveEqGains(getStorage(), gains);
    if (graphRef.current) applyGains(graphRef.current, gains);
  }, [gains]);

  useEffect(
    () => () => {
      void graphRef.current?.ctx.close();
      graphRef.current = null;
    },
    []
  );

  const setBand = useCallback(
    (band: EqBand, db: number) => {
      setGains((prev) => ({ ...prev, [band]: clampGain(db) }));
      attach();
    },
    [attach]
  );

  const applyPreset = useCallback(
    (id: string) => {
      const preset = EQ_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      setGains(preset.gains);
      attach();
    },
    [attach]
  );

  /**
   * For the play button and song changes. Leaves the audio path alone until
   * the equalizer is in use. Outside a click the context may stay suspended;
   * the element then keeps playing directly until the next click.
   */
  const attachIfInUse = useCallback(() => {
    if (!isFlat(gainsRef.current) || graphRef.current) attach();
  }, [attach]);

  return {
    gains,
    presetId: presetIdFor(gains),
    setBand,
    applyPreset,
    attachIfInUse,
  };
}
