export const TRACK_IDS = ["kick", "snare", "hihat", "clap", "bass", "lead", "pad"] as const;
export type TrackId = (typeof TRACK_IDS)[number];

export interface TrackDef {
  id: TrackId;
  name: string;
  type: "drum" | "melody";
  color: string;
  notes?: string[];
}

export interface TrackMix {
  vol: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  rev: number;
  dly: number;
}

export interface MasterMix {
  vol: number;
  reverb: number;
  delay: number;
  comp: number;
}

export type TrackGrids = { [K in TrackId]: boolean[][] };
export type MixMap = { [K in TrackId]: TrackMix };

export interface Pattern {
  name: string;
  tracks: TrackGrids;
}

export interface ArrangementBlock {
  patIdx: number;
  section: string;
  repeats: number;
}

export interface SongState {
  bpm: number;
  patterns: Pattern[];
  arrangement: ArrangementBlock[];
  mix: MixMap;
  master: MasterMix;
}

export interface SerializedSong {
  v: number;
  b: number;
  p: { n: string; t: Partial<Record<TrackId, number[]>> }[];
  a: { p: number; s?: string; r?: number }[];
  m?: Partial<Record<TrackId, Partial<TrackMix>>>;
  ms?: Partial<MasterMix>;
}
