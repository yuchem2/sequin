import { create } from "zustand";
import type { SongState, TrackId, MasterMix } from "@sequin/shared";
import { defaultSong, emptyTracks, deserializeSong, decompress } from "@sequin/shared";

interface SongStore {
  song: SongState;
  setSong: (song: SongState) => void;
  updateSong: (fn: (s: SongState) => void) => void;
  toggleCell: (activePatIdx: number, tid: TrackId, row: number, col: number) => void;
  setMixVal: (tid: TrackId, k: string, v: number | boolean) => void;
  setMasterVal: (k: keyof MasterMix, v: number) => void;
  addPattern: () => void;
  dupPattern: (activePatIdx: number) => void;
  addArrBlock: (pi: number) => void;
  removeArrBlock: (i: number) => void;
  setArrSection: (i: number, sec: string) => void;
  setArrRepeats: (i: number, r: number) => void;
  moveArrBlock: (i: number, d: number) => void;
  clearAll: () => void;
}

function getInitialSong(): SongState {
  if (typeof window === "undefined") return defaultSong();
  const hash = window.location.hash.slice(1);
  if (hash) {
    const json = decompress(hash);
    const loaded = deserializeSong(json);
    if (loaded) return loaded;
  }
  return defaultSong();
}

export const useSongStore = create<SongStore>((set) => {
  const updateSong = (fn: (s: SongState) => void) =>
    set((state) => {
      const next: SongState = JSON.parse(JSON.stringify(state.song));
      fn(next);
      return { song: next };
    });

  return {
    song: getInitialSong(),
    setSong: (song) => set({ song }),
    updateSong,

    toggleCell: (activePatIdx, tid, row, col) =>
      updateSong((s) => {
        const r = s.patterns[activePatIdx]?.tracks[tid][row];
        if (r) r[col] = !r[col];
      }),

    setMixVal: (tid, k, v) =>
      updateSong((s) => {
        (s.mix[tid] as unknown as Record<string, number | boolean>)[k] = v;
      }),

    setMasterVal: (k, v) =>
      updateSong((s) => {
        s.master[k] = v;
      }),

    addPattern: () =>
      updateSong((s) => {
        if (s.patterns.length >= 12) return;
        s.patterns.push({
          name: String.fromCharCode(65 + s.patterns.length),
          tracks: emptyTracks(),
        });
      }),

    dupPattern: (activePatIdx) =>
      updateSong((s) => {
        if (s.patterns.length >= 12) return;
        const pat = s.patterns[activePatIdx];
        if (!pat) return;
        s.patterns.push({
          name: String.fromCharCode(65 + s.patterns.length),
          tracks: JSON.parse(JSON.stringify(pat.tracks)),
        });
      }),

    addArrBlock: (pi) =>
      updateSong((s) => {
        s.arrangement.push({ patIdx: pi, section: "verse", repeats: 1 });
      }),

    removeArrBlock: (i) =>
      updateSong((s) => {
        if (s.arrangement.length > 1) s.arrangement.splice(i, 1);
      }),

    setArrSection: (i, sec) =>
      updateSong((s) => {
        const b = s.arrangement[i];
        if (b) b.section = sec;
      }),

    setArrRepeats: (i, r) =>
      updateSong((s) => {
        const b = s.arrangement[i];
        if (b) b.repeats = Math.max(1, Math.min(16, r));
      }),

    moveArrBlock: (i, d) =>
      updateSong((s) => {
        const ni = i + d;
        if (ni < 0 || ni >= s.arrangement.length) return;
        const a = s.arrangement[i]!;
        const b = s.arrangement[ni]!;
        s.arrangement[i] = b;
        s.arrangement[ni] = a;
      }),

    clearAll: () => set({ song: defaultSong() }),
  };
});
