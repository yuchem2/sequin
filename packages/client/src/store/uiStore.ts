import { create } from "zustand";
import type { TrackId } from "@sequin/shared";

export type TabType = "seq" | "arrange" | "mixer";
export type PlayMode = "pattern" | "song";

interface UiStore {
  activePatIdx: number;
  activeTrack: TrackId;
  tab: TabType;
  isPlaying: boolean;
  playMode: PlayMode;
  currentStep: number;
  currentArrIdx: number;
  initialized: boolean;
  shareMsg: string;
  trackMeters: Partial<Record<TrackId, number>>;
  masterLevel: number;
  songProgress: number;

  setActivePatIdx: (i: number) => void;
  setActiveTrack: (t: TrackId) => void;
  setTab: (t: TabType) => void;
  setIsPlaying: (v: boolean) => void;
  setPlayMode: (m: PlayMode) => void;
  setCurrentStep: (s: number) => void;
  setCurrentArrIdx: (i: number) => void;
  setInitialized: (v: boolean) => void;
  setShareMsg: (msg: string) => void;
  setTrackMeters: (m: Partial<Record<TrackId, number>>) => void;
  setMasterLevel: (v: number) => void;
  setSongProgress: (v: number) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  activePatIdx: 0,
  activeTrack: "kick",
  tab: "seq",
  isPlaying: false,
  playMode: "song",
  currentStep: -1,
  currentArrIdx: -1,
  initialized: false,
  shareMsg: "",
  trackMeters: {},
  masterLevel: -60,
  songProgress: 0,

  setActivePatIdx: (i) => set({ activePatIdx: i }),
  setActiveTrack: (t) => set({ activeTrack: t }),
  setTab: (t) => set({ tab: t }),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setPlayMode: (m) => set({ playMode: m }),
  setCurrentStep: (s) => set({ currentStep: s }),
  setCurrentArrIdx: (i) => set({ currentArrIdx: i }),
  setInitialized: (v) => set({ initialized: v }),
  setShareMsg: (msg) => set({ shareMsg: msg }),
  setTrackMeters: (m) => set({ trackMeters: m }),
  setMasterLevel: (v) => set({ masterLevel: v }),
  setSongProgress: (v) => set({ songProgress: v }),
}));
