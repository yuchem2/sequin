import type {
  SongState,
  SerializedSong,
  Pattern,
  TrackGrids,
  TrackMix,
  MasterMix,
  TrackId,
} from "../types";
import { TRACK_IDS } from "../types";
import { STEPS } from "../constants";

const DEFAULT_TRACK_MIX: TrackMix = {
  vol: 80,
  pan: 0,
  mute: false,
  solo: false,
  rev: 0,
  dly: 0,
};
const DEFAULT_MASTER: MasterMix = { vol: 85, reverb: 25, delay: 15, comp: 40 };
const DEFAULT_SECTION = "verse";
const DEFAULT_REPEATS = 1;

function packRow(row: boolean[]): number {
  let b = 0;
  row.forEach((v, i) => {
    if (v) b |= 1 << i;
  });
  return b;
}

function unpackRow(bits: number, len = STEPS): boolean[] {
  return Array.from({ length: len }, (_, i) => !!(bits & (1 << i)));
}

export function emptyTracks(): TrackGrids {
  return {
    kick: [Array(STEPS).fill(false) as boolean[]],
    snare: [Array(STEPS).fill(false) as boolean[]],
    hihat: [Array(STEPS).fill(false) as boolean[]],
    clap: [Array(STEPS).fill(false) as boolean[]],
    bass: Array.from({ length: 8 }, () => Array(STEPS).fill(false) as boolean[]),
    lead: Array.from({ length: 8 }, () => Array(STEPS).fill(false) as boolean[]),
    pad: Array.from({ length: 8 }, () => Array(STEPS).fill(false) as boolean[]),
  };
}

export function defaultMix(): SongState["mix"] {
  return {
    kick: { ...DEFAULT_TRACK_MIX },
    snare: { ...DEFAULT_TRACK_MIX },
    hihat: { ...DEFAULT_TRACK_MIX },
    clap: { ...DEFAULT_TRACK_MIX },
    bass: { ...DEFAULT_TRACK_MIX },
    lead: { ...DEFAULT_TRACK_MIX },
    pad: { ...DEFAULT_TRACK_MIX },
  };
}

export function defaultSong(): SongState {
  return {
    bpm: 120,
    patterns: [{ name: "A", tracks: emptyTracks() }],
    arrangement: [{ patIdx: 0, section: DEFAULT_SECTION, repeats: 4 }],
    mix: defaultMix(),
    master: { ...DEFAULT_MASTER },
  };
}

function diffTrackMix(mix: TrackMix): Partial<TrackMix> {
  const out: Partial<TrackMix> = {};
  (Object.keys(DEFAULT_TRACK_MIX) as (keyof TrackMix)[]).forEach((k) => {
    if (mix[k] !== DEFAULT_TRACK_MIX[k]) {
      (out[k] as TrackMix[typeof k]) = mix[k];
    }
  });
  return out;
}

function diffMaster(master: MasterMix): Partial<MasterMix> {
  const out: Partial<MasterMix> = {};
  (Object.keys(DEFAULT_MASTER) as (keyof MasterMix)[]).forEach((k) => {
    if (master[k] !== DEFAULT_MASTER[k]) out[k] = master[k];
  });
  return out;
}

function isPatternEmpty(pat: Pattern): boolean {
  return TRACK_IDS.every((id) => pat.tracks[id].every((row) => row.every((cell) => !cell)));
}

export function serializeSong(song: SongState): string {
  // Strip trailing empty patterns that aren't referenced by arrangement
  const maxRefIdx = song.arrangement.reduce((m, b) => Math.max(m, b.patIdx), 0);
  let lastKeep = song.patterns.length - 1;
  while (lastKeep > 0 && lastKeep > maxRefIdx && isPatternEmpty(song.patterns[lastKeep]!)) {
    lastKeep--;
  }
  const patterns = song.patterns.slice(0, lastKeep + 1);

  const pk: SerializedSong = {
    v: 3,
    b: song.bpm,
    p: patterns.map((p) => ({ n: p.name, t: {} })),
    a: song.arrangement.map((s) => {
      const block: { p: number; s?: string; r?: number } = { p: s.patIdx };
      if (s.section !== DEFAULT_SECTION) block.s = s.section;
      if ((s.repeats || DEFAULT_REPEATS) !== DEFAULT_REPEATS) block.r = s.repeats;
      return block;
    }),
  };

  patterns.forEach((pat, pi) => {
    for (const id of TRACK_IDS) {
      const rows = pat.tracks[id].map(packRow);
      if (rows.some((r) => r !== 0)) pk.p[pi]!.t[id] = rows;
    }
  });

  const mixDiff: Partial<Record<TrackId, Partial<TrackMix>>> = {};
  let hasMixDiff = false;
  for (const id of TRACK_IDS) {
    const d = diffTrackMix(song.mix[id]);
    if (Object.keys(d).length > 0) {
      mixDiff[id] = d;
      hasMixDiff = true;
    }
  }
  if (hasMixDiff) pk.m = mixDiff;

  const masterDiff = diffMaster(song.master);
  if (Object.keys(masterDiff).length > 0) pk.ms = masterDiff;

  return JSON.stringify(pk);
}

export function deserializeSong(str: string): SongState | null {
  try {
    const d = JSON.parse(str) as SerializedSong;
    if (d.v !== 3) return null;
    const patterns: Pattern[] = d.p.map((pp) => {
      const tracks = emptyTracks();
      for (const id of TRACK_IDS) {
        const saved = pp.t[id];
        if (saved) tracks[id] = saved.map((b) => unpackRow(b));
      }
      return { name: pp.n, tracks };
    });

    const mix = defaultMix();
    if (d.m) {
      for (const id of TRACK_IDS) {
        const partial = d.m[id];
        if (partial) Object.assign(mix[id], partial);
      }
    }

    const master: MasterMix = { ...DEFAULT_MASTER };
    if (d.ms) Object.assign(master, d.ms);

    return {
      bpm: d.b,
      patterns,
      arrangement: d.a.map((s) => ({
        patIdx: s.p,
        section: s.s ?? DEFAULT_SECTION,
        repeats: s.r ?? DEFAULT_REPEATS,
      })),
      mix,
      master,
    };
  } catch {
    return null;
  }
}
