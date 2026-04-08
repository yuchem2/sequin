import type { SongState, SerializedSong, Pattern, TrackGrids } from "../types";
import { TRACK_IDS } from "../types";
import { STEPS } from "../constants";

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
  const m = { vol: 80, pan: 0, mute: false, solo: false, rev: 0, dly: 0 };
  return {
    kick: { ...m },
    snare: { ...m },
    hihat: { ...m },
    clap: { ...m },
    bass: { ...m },
    lead: { ...m },
    pad: { ...m },
  };
}

export function defaultSong(): SongState {
  return {
    bpm: 120,
    patterns: [{ name: "A", tracks: emptyTracks() }],
    arrangement: [{ patIdx: 0, section: "verse", repeats: 4 }],
    mix: defaultMix(),
    master: { vol: 85, reverb: 25, delay: 15, comp: 40 },
  };
}

export function serializeSong(song: SongState): string {
  const pk: SerializedSong = {
    v: 2,
    b: song.bpm,
    p: song.patterns.map((p) => ({ n: p.name, t: {} })),
    a: song.arrangement.map((s) => ({ p: s.patIdx, s: s.section, r: s.repeats || 1 })),
    m: song.mix,
    ms: song.master,
  };
  song.patterns.forEach((pat, pi) => {
    for (const id of TRACK_IDS) {
      const rows = pat.tracks[id].map(packRow);
      if (rows.some((r) => r !== 0)) pk.p[pi]!.t[id] = rows;
    }
  });
  return JSON.stringify(pk);
}

export function deserializeSong(str: string): SongState | null {
  try {
    const d = JSON.parse(str) as SerializedSong;
    if (d.v !== 2) return null;
    const patterns: Pattern[] = d.p.map((pp) => {
      const tracks = emptyTracks();
      for (const id of TRACK_IDS) {
        const saved = pp.t[id];
        if (saved) tracks[id] = saved.map((b) => unpackRow(b));
      }
      return { name: pp.n, tracks };
    });
    return {
      bpm: d.b,
      patterns,
      arrangement: d.a.map((s) => ({ patIdx: s.p, section: s.s, repeats: s.r || 1 })),
      mix: d.m,
      master: d.ms,
    };
  } catch {
    return null;
  }
}
