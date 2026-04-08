import type { TrackDef } from "../types";

export const STEPS = 16;

export const TRACK_DEFS: TrackDef[] = [
  { id: "kick", name: "KCK", type: "drum", color: "#E8443A" },
  { id: "snare", name: "SNR", type: "drum", color: "#E8923A" },
  { id: "hihat", name: "HHT", type: "drum", color: "#3AE8A0" },
  { id: "clap", name: "CLP", type: "drum", color: "#3A9BE8" },
  {
    id: "bass",
    name: "BAS",
    type: "melody",
    color: "#A83AE8",
    notes: ["C3", "B2", "A2", "G2", "F2", "E2", "D2", "C2"],
  },
  {
    id: "lead",
    name: "LED",
    type: "melody",
    color: "#E83AA8",
    notes: ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"],
  },
  {
    id: "pad",
    name: "PAD",
    type: "melody",
    color: "#3AE8E8",
    notes: ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"],
  },
];

export const DRUM_IDS = TRACK_DEFS.filter((t) => t.type === "drum").map((t) => t.id);
export const MELODY_IDS = TRACK_DEFS.filter((t) => t.type === "melody").map((t) => t.id);

export const BASS_NOTES = ["C3", "B2", "A2", "G2", "F2", "E2", "D2", "C2"] as const;
export const LEAD_NOTES = ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"] as const;
export const PAD_NOTES = ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"] as const;

export const SECTION_TYPES = [
  "intro",
  "verse",
  "prechorus",
  "chorus",
  "bridge",
  "drop",
  "outro",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export const SECTION_COLORS: Record<string, string> = {
  intro: "#3A9BE8",
  verse: "#3AE8A0",
  prechorus: "#E83AA8",
  chorus: "#E8443A",
  bridge: "#A83AE8",
  drop: "#E8923A",
  outro: "#666",
};
