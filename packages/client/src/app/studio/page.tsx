"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import * as Tone from "tone";

/* ═══════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════ */
const TRACK_IDS = ["kick", "snare", "hihat", "clap", "bass", "lead", "pad"] as const;
type TrackId = (typeof TRACK_IDS)[number];

interface TrackDef {
  id: TrackId;
  name: string;
  type: "drum" | "melody";
  color: string;
  notes?: string[];
}

interface TrackMix {
  vol: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  rev: number;
  dly: number;
}

interface MasterMix {
  vol: number;
  reverb: number;
  delay: number;
  comp: number;
}

type TrackGrids = { [K in TrackId]: boolean[][] };
type MixMap = { [K in TrackId]: TrackMix };

interface Pattern {
  name: string;
  tracks: TrackGrids;
}
interface ArrangementBlock {
  patIdx: number;
  section: string;
  repeats: number;
}

interface SongState {
  bpm: number;
  patterns: Pattern[];
  arrangement: ArrangementBlock[];
  mix: MixMap;
  master: MasterMix;
}

interface EngineChannels {
  ch: Tone.Channel;
  rg: Tone.Gain;
  dg: Tone.Gain;
}

interface AudioEngine {
  synths: {
    kick: Tone.MembraneSynth;
    snare: Tone.NoiseSynth;
    hihat: Tone.MetalSynth;
    clap: Tone.NoiseSynth;
    bass: Tone.MonoSynth;
    lead: Tone.PolySynth;
    pad: Tone.PolySynth;
  };
  channels: { [K in TrackId]: EngineChannels };
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  comp: Tone.Compressor;
  masterVol: Tone.Volume;
  limiter: Tone.Limiter;
  analyser: Tone.Analyser;
  meters: { [K in TrackId]: Tone.Meter };
  masterMeter: Tone.Meter;
}

interface SerializedSong {
  v: number;
  b: number;
  p: { n: string; t: Record<string, number[]> }[];
  a: { p: number; s: string; r: number }[];
  m: MixMap;
  ms: MasterMix;
}

/* ═══════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════ */
const STEPS = 16;

const TRACK_DEFS: TrackDef[] = [
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

const SECTION_COLORS: Record<string, string> = {
  intro: "#3A9BE8",
  verse: "#3AE8A0",
  chorus: "#E8443A",
  bridge: "#A83AE8",
  drop: "#E8923A",
  outro: "#666",
  prechorus: "#E83AA8",
};
const SECTION_TYPES = Object.keys(SECTION_COLORS);

const BASS_NOTES = ["C3", "B2", "A2", "G2", "F2", "E2", "D2", "C2"] as const;
const LEAD_NOTES = ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"] as const;
const PAD_NOTES = ["C5", "B4", "A4", "G4", "F4", "E4", "D4", "C4"] as const;

/* ═══ Compression ═══ */
function compress(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  } catch {
    return "";
  }
}

function decompress(encoded: string): string {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

/* ═══ Serialization ═══ */
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

function serializeSong(song: SongState): string {
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

function deserializeSong(str: string): SongState | null {
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

/* ═══ Defaults ═══ */
function emptyTracks(): TrackGrids {
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

function defaultMix(): MixMap {
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

function defaultSong(): SongState {
  return {
    bpm: 120,
    patterns: [{ name: "A", tracks: emptyTracks() }],
    arrangement: [{ patIdx: 0, section: "verse", repeats: 4 }],
    mix: defaultMix(),
    master: { vol: 85, reverb: 25, delay: 15, comp: 40 },
  };
}

/* ═══ Audio Engine ═══ */
function buildEngine(): AudioEngine {
  const comp = new Tone.Compressor({ threshold: -16, ratio: 5, attack: 0.002, release: 0.2 });
  const masterVol = new Tone.Volume(0);
  const limiter = new Tone.Limiter(-0.5);
  const reverb = new Tone.Reverb({ decay: 2.8, wet: 1 }).connect(comp);
  const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.25, wet: 1 }).connect(comp);
  comp.connect(masterVol);
  masterVol.connect(limiter);
  limiter.toDestination();

  const mkCh = () => {
    const ch = new Tone.Channel({ volume: 0, pan: 0 }).connect(comp);
    const rg = new Tone.Gain(0).connect(reverb);
    const dg = new Tone.Gain(0).connect(delay);
    ch.connect(rg);
    ch.connect(dg);
    return { ch, rg, dg };
  };

  const channels: AudioEngine["channels"] = {
    kick: mkCh(),
    snare: mkCh(),
    hihat: mkCh(),
    clap: mkCh(),
    bass: mkCh(),
    lead: mkCh(),
    pad: mkCh(),
  };

  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 7,
    oscillator: { type: "sine" },
    envelope: { attack: 0.001, decay: 0.35, sustain: 0.01, release: 0.3 },
  }).connect(channels.kick.ch);
  const snare = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0, release: 0.1 },
  }).connect(channels.snare.ch);
  const hihat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.05, release: 0.008 },
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4500,
    octaves: 1.5,
  }).connect(channels.hihat.ch);
  hihat.volume.value = -12;
  const clap = new Tone.NoiseSynth({
    noise: { type: "pink" },
    envelope: { attack: 0.004, decay: 0.13, sustain: 0, release: 0.07 },
  }).connect(channels.clap.ch);
  const bass = new Tone.MonoSynth({
    oscillator: { type: "sawtooth" },
    filter: { Q: 3, type: "lowpass", rolloff: -24 },
    envelope: { attack: 0.008, decay: 0.25, sustain: 0.5, release: 0.2 },
    filterEnvelope: {
      attack: 0.015,
      decay: 0.15,
      sustain: 0.2,
      release: 0.2,
      baseFrequency: 80,
      octaves: 3,
    },
  }).connect(channels.bass.ch);
  bass.volume.value = -3;
  const lead = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "square8" },
    envelope: { attack: 0.015, decay: 0.2, sustain: 0.25, release: 0.4 },
  }).connect(channels.lead.ch);
  lead.volume.value = -5;
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.5, decay: 0.6, sustain: 0.7, release: 1.5 },
  }).connect(channels.pad.ch);
  pad.volume.value = -10;

  const synths: AudioEngine["synths"] = { kick, snare, hihat, clap, bass, lead, pad };
  const analyser = new Tone.Analyser("waveform", 256);
  limiter.connect(analyser);

  const mkMeter = (id: TrackId) => {
    const m = new Tone.Meter({ smoothing: 0.8 });
    channels[id].ch.connect(m);
    return m;
  };
  const meters: AudioEngine["meters"] = {
    kick: mkMeter("kick"),
    snare: mkMeter("snare"),
    hihat: mkMeter("hihat"),
    clap: mkMeter("clap"),
    bass: mkMeter("bass"),
    lead: mkMeter("lead"),
    pad: mkMeter("pad"),
  };
  const masterMeter = new Tone.Meter({ smoothing: 0.8 });
  limiter.connect(masterMeter);

  return {
    synths,
    channels,
    reverb,
    delay,
    comp,
    masterVol,
    limiter,
    analyser,
    meters,
    masterMeter,
  };
}

/* ═══════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════ */
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

export default function StudioPage() {
  const [song, setSong] = useState<SongState>(getInitialSong);
  const [activePatIdx, setActivePatIdx] = useState(0);
  const [activeTrack, setActiveTrack] = useState<TrackId>("kick");
  const [tab, setTab] = useState("seq");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState("song");
  const [currentStep, setCurrentStep] = useState(-1);
  const [currentArrIdx, setCurrentArrIdx] = useState(-1);
  const [initialized, setInitialized] = useState(false);
  const [shareMsg, setShareMsg] = useState("");
  const [trackMeters, setTrackMeters] = useState<Partial<Record<TrackId, number>>>({});
  const [masterLevel, setMasterLevel] = useState(-60);
  const [songProgress, setSongProgress] = useState(0);

  const engineRef = useRef<AudioEngine | null>(null);
  const songRef = useRef(song);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  songRef.current = song;

  const pat = song.patterns[activePatIdx] ?? song.patterns[0]!;

  // URL sync
  useEffect(() => {
    const t = setTimeout(() => {
      const encoded = compress(serializeSong(song));
      if (encoded) window.history.replaceState(null, "", "#" + encoded);
    }, 500);
    return () => clearTimeout(t);
  }, [song]);

  // Init audio
  const initAudio = useCallback(async () => {
    if (initialized) return;
    await Tone.start();
    engineRef.current = buildEngine();
    setInitialized(true);
  }, [initialized]);

  // Sync mix
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const hasSolo = TRACK_IDS.some((id) => song.mix[id].solo);
    for (const id of TRACK_IDS) {
      const ch = e.channels[id];
      const m = song.mix[id];
      const on = hasSolo ? m.solo : !m.mute;
      ch.ch.volume.value = on ? Tone.gainToDb(m.vol / 100) : -Infinity;
      ch.ch.pan.value = m.pan / 100;
      ch.rg.gain.value = m.rev / 100;
      ch.dg.gain.value = m.dly / 100;
    }
    e.masterVol.volume.value = Tone.gainToDb(song.master.vol / 100);
    e.reverb.decay = 1 + (song.master.reverb / 100) * 5;
    e.delay.feedback.value = (song.master.delay / 100) * 0.6;
    e.comp.ratio.value = 1 + (song.master.comp / 100) * 8;
  }, [song.mix, song.master]);

  useEffect(() => {
    Tone.getTransport().bpm.value = song.bpm;
  }, [song.bpm]);

  // Waveform draw
  const drawLoop = useCallback(() => {
    const c = canvasRef.current;
    const e = engineRef.current;
    if (!c || !e) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width,
      h = c.height;
    const vals = e.analyser.getValue() as Float32Array;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#E8443A");
    grad.addColorStop(0.4, "#E83AA8");
    grad.addColorStop(0.7, "#A83AE8");
    grad.addColorStop(1, "#3AE8A0");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const sw = w / vals.length;
    for (let i = 0; i < vals.length; i++) {
      const y = ((vals[i]! + 1) / 2) * h;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * sw, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = 0; i < vals.length; i++) {
      const y = ((vals[i]! + 1) / 2) * h;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * sw, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const lvl: Partial<Record<TrackId, number>> = {};
    for (const id of TRACK_IDS) lvl[id] = e.meters[id].getValue() as number;
    setTrackMeters(lvl);
    setMasterLevel(e.masterMeter.getValue() as number);
    animRef.current = requestAnimationFrame(drawLoop);
  }, []);

  useEffect(() => {
    if (isPlaying && initialized) animRef.current = requestAnimationFrame(drawLoop);
    else {
      cancelAnimationFrame(animRef.current);
      const ctx = canvasRef.current?.getContext("2d");
      if (ctx && canvasRef.current)
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying, initialized, drawLoop]);

  // Playback
  const playStep = (e: AudioEngine, tracks: TrackGrids, s: number, time: number) => {
    if (tracks.kick[0]?.[s]) e.synths.kick.triggerAttackRelease("C1", "8n", time);
    if (tracks.snare[0]?.[s]) e.synths.snare.triggerAttackRelease("8n", time);
    if (tracks.hihat[0]?.[s]) e.synths.hihat.triggerAttackRelease("32n", time, 0.4);
    if (tracks.clap[0]?.[s]) e.synths.clap.triggerAttackRelease("16n", time);
    const bi = tracks.bass.findIndex((r) => r[s]);
    if (bi !== -1) e.synths.bass.triggerAttackRelease(BASS_NOTES[bi]!, "16n", time);
    const ln: string[] = [];
    tracks.lead.forEach((r, i) => {
      if (r[s]) ln.push(LEAD_NOTES[i]!);
    });
    if (ln.length) e.synths.lead.triggerAttackRelease(ln, "16n", time);
    const pn: string[] = [];
    tracks.pad.forEach((r, i) => {
      if (r[s]) pn.push(PAD_NOTES[i]!);
    });
    if (pn.length) e.synths.pad.triggerAttackRelease(pn, "8n", time);
  };

  const togglePlay = async () => {
    await initAudio();
    if (isPlaying) {
      Tone.getTransport().stop();
      Tone.getTransport().cancel();
      setIsPlaying(false);
      setCurrentStep(-1);
      setCurrentArrIdx(-1);
      setSongProgress(0);
      return;
    }
    Tone.getTransport().cancel();
    if (playMode === "pattern") {
      let step = 0;
      new Tone.Sequence(
        (time) => {
          const s = step % STEPS;
          setCurrentStep(s);
          const p = songRef.current.patterns[activePatIdx];
          if (p && engineRef.current) playStep(engineRef.current, p.tracks, s, time);
          step++;
        },
        [...Array(STEPS).keys()],
        "16n",
      ).start(0);
    } else {
      const sng = songRef.current;
      const flat: { ai: number; s: number; pi: number }[] = [];
      sng.arrangement.forEach((block, ai) => {
        if (!sng.patterns[block.patIdx]) return;
        for (let r = 0; r < (block.repeats || 1); r++)
          for (let s = 0; s < STEPS; s++) flat.push({ ai, s, pi: block.patIdx });
      });
      if (!flat.length) return;
      let pos = 0;
      new Tone.Sequence(
        (time) => {
          const cur = flat[pos % flat.length]!;
          setCurrentStep(cur.s);
          setCurrentArrIdx(cur.ai);
          setSongProgress(((pos % flat.length) / flat.length) * 100);
          const p = songRef.current.patterns[cur.pi];
          if (p && engineRef.current) playStep(engineRef.current, p.tracks, cur.s, time);
          pos++;
        },
        [...Array(flat.length).keys()],
        "16n",
      ).start(0);
    }
    Tone.getTransport().start();
    setIsPlaying(true);
  };

  // Mutations
  const updateSong = (fn: (s: SongState) => void) =>
    setSong((prev) => {
      const next: SongState = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });

  const toggleCell = (tid: TrackId, row: number, col: number) =>
    updateSong((s) => {
      const r = s.patterns[activePatIdx]?.tracks[tid][row];
      if (r) r[col] = !r[col];
    });

  const setMixVal = (tid: TrackId, k: string, v: number | boolean) =>
    updateSong((s) => {
      (s.mix[tid] as unknown as Record<string, number | boolean>)[k] = v;
    });

  const setMasterVal = (k: keyof MasterMix, v: number) =>
    updateSong((s) => {
      s.master[k] = v;
    });

  const addPattern = () => {
    if (song.patterns.length >= 12) return;
    updateSong((s) => {
      s.patterns.push({ name: String.fromCharCode(65 + s.patterns.length), tracks: emptyTracks() });
    });
    setActivePatIdx(song.patterns.length);
  };

  const dupPattern = () => {
    if (song.patterns.length >= 12) return;
    updateSong((s) => {
      s.patterns.push({
        name: String.fromCharCode(65 + s.patterns.length),
        tracks: JSON.parse(JSON.stringify(pat.tracks)),
      });
    });
    setActivePatIdx(song.patterns.length);
  };

  const addArrBlock = (pi: number) =>
    updateSong((s) => {
      s.arrangement.push({ patIdx: pi, section: "verse", repeats: 1 });
    });
  const removeArrBlock = (i: number) =>
    updateSong((s) => {
      if (s.arrangement.length > 1) s.arrangement.splice(i, 1);
    });
  const setArrSection = (i: number, sec: string) =>
    updateSong((s) => {
      const b = s.arrangement[i];
      if (b) b.section = sec;
    });
  const setArrRepeats = (i: number, r: number) =>
    updateSong((s) => {
      const b = s.arrangement[i];
      if (b) b.repeats = Math.max(1, Math.min(16, r));
    });
  const moveArrBlock = (i: number, d: number) =>
    updateSong((s) => {
      const ni = i + d;
      if (ni < 0 || ni >= s.arrangement.length) return;
      const a = s.arrangement[i]!,
        b = s.arrangement[ni]!;
      s.arrangement[i] = b;
      s.arrangement[ni] = a;
    });

  const shareURL = () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setShareMsg("복사됨!");
        setTimeout(() => setShareMsg(""), 2000);
      })
      .catch(() => setShareMsg("주소창에서 복사"));
  };
  const clearAll = () => {
    setSong(defaultSong());
    setActivePatIdx(0);
  };

  // Helpers
  const trkDef = TRACK_DEFS.find((t) => t.id === activeTrack)!;
  const isMelody = trkDef.type === "melody";
  const grid = pat.tracks[activeTrack];
  const noteLabels = isMelody ? (trkDef.notes ?? []) : [trkDef.name];
  const dbH = (db: number) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  const totalBars = song.arrangement.reduce((s, b) => s + (b.repeats || 1), 0);
  const totalSec = ((totalBars * STEPS) / ((song.bpm / 60) * 4)).toFixed(0);
  const currentSectionName =
    currentArrIdx >= 0 ? (song.arrangement[currentArrIdx]?.section ?? "") : "";
  const mx = song.mix[activeTrack];

  /* ═══ RENDER ═══ */
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#08080A",
        color: "#C8C4D0",
        fontFamily: "'IBM Plex Mono',monospace",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&family=Syne:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:#111}
        ::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes sectionPulse{0%{opacity:.7}50%{opacity:1}100%{opacity:.7}}
        input[type=range]{-webkit-appearance:none;background:transparent;cursor:pointer}
        input[type=range]::-webkit-slider-track{height:3px;background:#1A1A1E;border-radius:2px}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:10px;height:10px;border-radius:50%;background:#777;margin-top:-3.5px}
        input[type=range]:hover::-webkit-slider-thumb{background:#fff}
        .hbtn:hover{filter:brightness(1.3)}
      `}</style>

      {/* HEADER */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid #151518",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h1 style={{ fontFamily: "'Syne'", fontWeight: 800, fontSize: 17, color: "#fff" }}>
            <span style={{ color: "#E83AA8" }}>♬</span>{" "}
            <span style={{ color: "#E8443A" }}>Sequin</span>
          </h1>
          <span style={{ fontSize: 8, color: "#333", letterSpacing: 1 }}>STUDIO</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              display: "flex",
              borderRadius: 4,
              overflow: "hidden",
              border: "1px solid #222",
            }}
          >
            {(["pattern", "song"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPlayMode(m)}
                style={{
                  padding: "3px 8px",
                  background: playMode === m ? "#1E1E24" : "transparent",
                  border: "none",
                  color: playMode === m ? "#fff" : "#444",
                  fontSize: 8,
                  cursor: "pointer",
                  fontFamily: "'Syne'",
                  fontWeight: 600,
                }}
              >
                {m === "pattern" ? "패턴" : "곡"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <button
              onClick={() =>
                updateSong((s) => {
                  s.bpm = Math.max(60, s.bpm - 5);
                })
              }
              style={tBtn}
            >
              -
            </button>
            <span
              style={{
                fontFamily: "'Syne'",
                fontWeight: 700,
                fontSize: 15,
                color: "#fff",
                width: 30,
                textAlign: "center",
              }}
            >
              {song.bpm}
            </span>
            <button
              onClick={() =>
                updateSong((s) => {
                  s.bpm = Math.min(200, s.bpm + 5);
                })
              }
              style={tBtn}
            >
              +
            </button>
          </div>
          <button
            onClick={togglePlay}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: `2px solid ${isPlaying ? "#E8443A" : "#3AE8A0"}`,
              background: "transparent",
              color: isPlaying ? "#E8443A" : "#3AE8A0",
              fontSize: 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isPlaying ? "■" : "▶"}
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            onClick={clearAll}
            className="hbtn"
            style={{ ...hBtn, fontSize: 7, padding: "3px 6px" }}
          >
            CLEAR
          </button>
          <button onClick={shareURL} className="hbtn" style={hBtn}>
            {shareMsg || "🔗"}
          </button>
        </div>
      </header>

      {/* WAVEFORM */}
      <div
        style={{
          height: 36,
          background: "#0A0A0C",
          borderBottom: "1px solid #151518",
          position: "relative",
        }}
      >
        <canvas
          ref={canvasRef}
          width={1000}
          height={36}
          style={{ width: "100%", height: "100%" }}
        />
        {isPlaying && playMode === "song" && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              height: 2,
              background: "linear-gradient(90deg,#E8443A,#E83AA8,#A83AE8)",
              width: `${songProgress}%`,
              transition: "width .1s",
            }}
          />
        )}
        {isPlaying && currentSectionName && (
          <div
            style={{
              position: "absolute",
              top: 4,
              left: 10,
              fontSize: 9,
              fontWeight: 700,
              color: SECTION_COLORS[currentSectionName] ?? "#666",
              fontFamily: "'Syne'",
              letterSpacing: 2,
              textTransform: "uppercase",
              animation: "sectionPulse 1.5s infinite",
            }}
          >
            {currentSectionName}
          </div>
        )}
        {isPlaying && (
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 6,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#E8443A",
              animation: "blink 1s infinite",
            }}
          />
        )}
      </div>

      {/* TABS */}
      <div style={{ display: "flex", borderBottom: "1px solid #151518" }}>
        {(["seq", "arrange", "mixer"] as const).map((k) => {
          const labels = { seq: "🎹 시퀀서", arrange: "📐 어레인지", mixer: "🎚 믹서" } as const;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                flex: 1,
                padding: "6px 0",
                background: tab === k ? "#111114" : "transparent",
                border: "none",
                borderBottom: tab === k ? "2px solid #E8443A" : "2px solid transparent",
                color: tab === k ? "#fff" : "#444",
                fontSize: 8,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: 1.5,
                fontFamily: "'Syne'",
              }}
            >
              {labels[k]}
            </button>
          );
        })}
      </div>

      {/* SEQUENCER */}
      {tab === "seq" && (
        <div style={{ padding: "10px 14px", animation: "fadeIn .2s" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 7, color: "#333", letterSpacing: 2, marginRight: 2 }}>
              PAT
            </span>
            {song.patterns.map((p, i) => (
              <button
                key={i}
                onClick={() => setActivePatIdx(i)}
                className="hbtn"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'Syne'",
                  background: i === activePatIdx ? "#E8443A" : "#111",
                  border: i === activePatIdx ? "none" : "1px solid #1E1E22",
                  color: i === activePatIdx ? "#fff" : "#555",
                }}
              >
                {p.name}
              </button>
            ))}
            <button
              onClick={addPattern}
              style={{ ...tBtn, width: 26, height: 26, borderStyle: "dashed" as const }}
            >
              +
            </button>
            <button onClick={dupPattern} style={{ ...tBtn, width: 26, height: 26, fontSize: 7 }}>
              ⊕
            </button>
          </div>
          <div style={{ display: "flex", gap: 2, marginBottom: 8, flexWrap: "wrap" }}>
            {TRACK_DEFS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTrack(t.id)}
                className="hbtn"
                style={{
                  padding: "4px 8px",
                  borderRadius: 3,
                  fontSize: 8,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'Syne'",
                  background: activeTrack === t.id ? t.color + "20" : "#0C0C0E",
                  border: `1px solid ${activeTrack === t.id ? t.color + "55" : "#161619"}`,
                  color: activeTrack === t.id ? t.color : "#444",
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <div
              style={{
                display: "flex",
                paddingLeft: 40,
                marginBottom: 2,
                minWidth: STEPS * 34 + 40,
              }}
            >
              {Array.from({ length: STEPS }, (_, i) => (
                <div
                  key={i}
                  style={{
                    width: 31,
                    minWidth: 31,
                    textAlign: "center",
                    fontSize: 7,
                    color: i % 4 === 0 ? "#3A3A3E" : "#1A1A1E",
                  }}
                >
                  {i + 1}
                </div>
              ))}
            </div>
            {noteLabels.map((label, row) => (
              <div
                key={label + row}
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginBottom: 1,
                  minWidth: STEPS * 34 + 40,
                }}
              >
                <div
                  style={{
                    width: 36,
                    fontSize: 7,
                    color: trkDef.color + "88",
                    fontWeight: 500,
                    textAlign: "right",
                    paddingRight: 4,
                    flexShrink: 0,
                  }}
                >
                  {label}
                </div>
                {Array.from({ length: STEPS }, (_, col) => {
                  const on = grid[row]?.[col] ?? false;
                  const cur = col === currentStep && isPlaying;
                  return (
                    <div
                      key={col}
                      onClick={() => toggleCell(activeTrack, row, col)}
                      style={{
                        width: 29,
                        height: isMelody ? 18 : 29,
                        margin: "0 1px",
                        borderRadius: 2,
                        cursor: "pointer",
                        background: on
                          ? trkDef.color + (cur ? "" : "BB")
                          : cur
                            ? "rgba(255,255,255,.04)"
                            : col % 4 < 2
                              ? "#0C0C0E"
                              : "#0E0E12",
                        border: on ? `1px solid ${trkDef.color}` : "1px solid #141417",
                        boxShadow: on && cur ? `0 0 5px ${trkDef.color}33` : "none",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {/* Quick mix */}
          <div
            style={{
              marginTop: 8,
              padding: "8px 10px",
              background: "#0C0C0E",
              borderRadius: 4,
              border: "1px solid #141417",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 7, color: trkDef.color, letterSpacing: 2, fontWeight: 600 }}>
              {trkDef.name}
            </span>
            {(["vol", "pan", "rev", "dly"] as const).map((k) => {
              const L = { vol: "VOL", pan: "PAN", rev: "REV", dly: "DLY" } as const;
              const mn = { vol: 0, pan: -100, rev: 0, dly: 0 } as const;
              const mxx = { vol: 100, pan: 100, rev: 100, dly: 100 } as const;
              return (
                <Knob
                  key={k}
                  label={L[k]}
                  value={mx[k]}
                  min={mn[k]}
                  max={mxx[k]}
                  onChange={(v) => setMixVal(activeTrack, k, v)}
                  color={trkDef.color}
                />
              );
            })}
            <button
              onClick={() => setMixVal(activeTrack, "mute", !mx.mute)}
              style={{
                ...mBtn,
                background: mx.mute ? "#E8443A18" : "#08080A",
                borderColor: mx.mute ? "#E8443A44" : "#1A1A1E",
                color: mx.mute ? "#E8443A" : "#333",
              }}
            >
              M
            </button>
            <button
              onClick={() => setMixVal(activeTrack, "solo", !mx.solo)}
              style={{
                ...mBtn,
                background: mx.solo ? "#E8923A18" : "#08080A",
                borderColor: mx.solo ? "#E8923A44" : "#1A1A1E",
                color: mx.solo ? "#E8923A" : "#333",
              }}
            >
              S
            </button>
          </div>
        </div>
      )}

      {/* ARRANGEMENT */}
      {tab === "arrange" && (
        <div style={{ padding: "10px 14px", animation: "fadeIn .2s" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 8, color: "#555", letterSpacing: 2 }}>SONG STRUCTURE</span>
            <span style={{ fontSize: 7, color: "#333" }}>
              {totalBars} bars · ~{totalSec}s @ {song.bpm}bpm
            </span>
          </div>
          <div
            style={{
              display: "flex",
              gap: 1,
              marginBottom: 14,
              overflowX: "auto",
              paddingBottom: 6,
            }}
          >
            {song.arrangement.map((block, i) => {
              const p = song.patterns[block.patIdx];
              const w = Math.max(32, (block.repeats || 1) * 36);
              const cur = isPlaying && playMode === "song" && i === currentArrIdx;
              const sc = SECTION_COLORS[block.section] ?? "#666";
              return (
                <div
                  key={i}
                  style={{
                    width: w,
                    minWidth: 32,
                    height: 32,
                    borderRadius: 3,
                    background: sc + (cur ? "44" : "15"),
                    border: `1px solid ${sc}${cur ? "99" : "33"}`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    color: sc,
                    fontWeight: 600,
                    fontFamily: "'Syne'",
                    flexShrink: 0,
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                  onClick={() => {
                    setActivePatIdx(block.patIdx);
                    setTab("seq");
                  }}
                >
                  <span>{p?.name ?? "?"}</span>
                  <span style={{ fontSize: 6, opacity: 0.5 }}>×{block.repeats || 1}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {song.arrangement.map((block, i) => {
              const sc = SECTION_COLORS[block.section] ?? "#666";
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px",
                    background: "#0C0C0E",
                    borderRadius: 3,
                    border: "1px solid #141417",
                    borderLeft: `3px solid ${sc}`,
                    opacity: isPlaying && playMode === "song" && i === currentArrIdx ? 1 : 0.7,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: "#fff",
                      fontFamily: "'Syne'",
                      width: 12,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div style={{ display: "flex", gap: 2 }}>
                    {song.patterns.map((p, pi) => (
                      <button
                        key={pi}
                        onClick={() =>
                          updateSong((s) => {
                            const b = s.arrangement[i];
                            if (b) b.patIdx = pi;
                          })
                        }
                        className="hbtn"
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 2,
                          fontSize: 8,
                          fontWeight: 700,
                          cursor: "pointer",
                          fontFamily: "'Syne'",
                          background: block.patIdx === pi ? "#E8443A" : "#111",
                          border: block.patIdx === pi ? "none" : "1px solid #1E1E22",
                          color: block.patIdx === pi ? "#fff" : "#444",
                        }}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <select
                    value={block.section}
                    onChange={(e) => setArrSection(i, e.target.value)}
                    style={{
                      background: "#0A0A0C",
                      border: "1px solid #1E1E22",
                      color: sc,
                      borderRadius: 2,
                      padding: "1px 3px",
                      fontSize: 8,
                      fontFamily: "'IBM Plex Mono'",
                      cursor: "pointer",
                    }}
                  >
                    {SECTION_TYPES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <button onClick={() => setArrRepeats(i, (block.repeats || 1) - 1)} style={tBtn}>
                      -
                    </button>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: "#888",
                        width: 14,
                        textAlign: "center",
                      }}
                    >
                      {block.repeats || 1}
                    </span>
                    <button onClick={() => setArrRepeats(i, (block.repeats || 1) + 1)} style={tBtn}>
                      +
                    </button>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                    <button onClick={() => moveArrBlock(i, -1)} style={tBtn}>
                      ↑
                    </button>
                    <button onClick={() => moveArrBlock(i, 1)} style={tBtn}>
                      ↓
                    </button>
                    <button
                      onClick={() => removeArrBlock(i)}
                      style={{ ...tBtn, color: "#E8443A66", borderColor: "#1E1215" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 3, marginTop: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontSize: 7,
                color: "#333",
                display: "flex",
                alignItems: "center",
                marginRight: 2,
              }}
            >
              추가:
            </span>
            {song.patterns.map((p, i) => (
              <button
                key={i}
                onClick={() => addArrBlock(i)}
                className="hbtn"
                style={{
                  padding: "3px 10px",
                  borderRadius: 2,
                  background: "#111",
                  border: "1px dashed #2A2A2E",
                  color: "#666",
                  fontSize: 8,
                  cursor: "pointer",
                  fontFamily: "'Syne'",
                  fontWeight: 600,
                }}
              >
                + {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MIXER */}
      {tab === "mixer" && (
        <div style={{ padding: "10px 14px", animation: "fadeIn .2s" }}>
          <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 6 }}>
            {TRACK_DEFS.map((t) => {
              const m = song.mix[t.id];
              const lvl = dbH(trackMeters[t.id] ?? -60);
              return (
                <div
                  key={t.id}
                  style={{
                    width: 72,
                    minWidth: 72,
                    background: "#0C0C0E",
                    borderRadius: 4,
                    border: "1px solid #141417",
                    padding: "8px 5px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <span
                    style={{
                      fontSize: 7,
                      fontWeight: 700,
                      color: t.color,
                      letterSpacing: 1,
                      fontFamily: "'Syne'",
                    }}
                  >
                    {t.name}
                  </span>
                  <div
                    style={{
                      width: 5,
                      height: 70,
                      background: "#08080A",
                      borderRadius: 3,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        width: "100%",
                        borderRadius: 3,
                        height: `${lvl}%`,
                        background: `linear-gradient(to top,${t.color}55,${t.color})`,
                        transition: "height .05s",
                      }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={m.vol}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setMixVal(t.id, "vol", +e.target.value)
                    }
                    style={{ width: 45, accentColor: t.color }}
                  />
                  <span style={{ fontSize: 6, color: "#333" }}>PAN</span>
                  <input
                    type="range"
                    min={-100}
                    max={100}
                    value={m.pan}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setMixVal(t.id, "pan", +e.target.value)
                    }
                    style={{ width: 45 }}
                  />
                  <div style={{ display: "flex", gap: 4 }}>
                    <div style={{ textAlign: "center" as const }}>
                      <span style={{ fontSize: 5, color: "#3A9BE855" }}>RV</span>
                      <br />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={m.rev}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setMixVal(t.id, "rev", +e.target.value)
                        }
                        style={{ width: 20 }}
                      />
                    </div>
                    <div style={{ textAlign: "center" as const }}>
                      <span style={{ fontSize: 5, color: "#E8923A55" }}>DL</span>
                      <br />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={m.dly}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setMixVal(t.id, "dly", +e.target.value)
                        }
                        style={{ width: 20 }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button
                      onClick={() => setMixVal(t.id, "mute", !m.mute)}
                      style={{
                        ...smBtn,
                        background: m.mute ? "#E8443A15" : "#08080A",
                        borderColor: m.mute ? "#E8443A33" : "#161619",
                        color: m.mute ? "#E8443A" : "#2A2A2E",
                      }}
                    >
                      M
                    </button>
                    <button
                      onClick={() => setMixVal(t.id, "solo", !m.solo)}
                      style={{
                        ...smBtn,
                        background: m.solo ? "#E8923A15" : "#08080A",
                        borderColor: m.solo ? "#E8923A33" : "#161619",
                        color: m.solo ? "#E8923A" : "#2A2A2E",
                      }}
                    >
                      S
                    </button>
                  </div>
                </div>
              );
            })}
            {/* Master */}
            <div
              style={{
                width: 80,
                minWidth: 80,
                background: "#0C0C12",
                borderRadius: 4,
                border: "1px solid #E8443A15",
                padding: "8px 5px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
              }}
            >
              <span
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: 2,
                  fontFamily: "'Syne'",
                }}
              >
                MST
              </span>
              <div
                style={{
                  width: 7,
                  height: 70,
                  background: "#08080A",
                  borderRadius: 3,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    bottom: 0,
                    width: "100%",
                    borderRadius: 3,
                    height: `${dbH(masterLevel)}%`,
                    background: "linear-gradient(to top,#3AE8A055,#E8443A)",
                    transition: "height .05s",
                  }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={song.master.vol}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  setMasterVal("vol", +e.target.value)
                }
                style={{ width: 50, accentColor: "#E8443A" }}
              />
              {(
                [
                  ["reverb", "RVB", "#3A9BE8"],
                  ["delay", "DLY", "#E8923A"],
                  ["comp", "CMP", "#A83AE8"],
                ] as const
              ).map(([k, l, c]) => (
                <div
                  key={k}
                  style={{ display: "flex", alignItems: "center", gap: 3, width: "100%" }}
                >
                  <span style={{ fontSize: 5, color: c + "66", width: 18 }}>{l}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={song.master[k]}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setMasterVal(k, +e.target.value)
                    }
                    style={{ flex: 1, accentColor: c }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          padding: "12px 14px",
          fontSize: 7,
          color: "#1E1E22",
          lineHeight: 1.8,
        }}
      >
        ♬ {song.patterns.length} patterns · {song.arrangement.length} sections · ~{totalSec}s
        <br />
        그리드를 클릭해 비트를 찍고 ▶ 를 누르세요
      </div>
    </div>
  );
}

/* ── Sub-components ── */
interface KnobProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  color?: string;
}
function Knob({ label, value, min = 0, max = 100, onChange, color = "#888" }: KnobProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
      <span style={{ fontSize: 5, color: color + "66", letterSpacing: 1 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(+e.target.value)}
        style={{ width: 45, accentColor: color }}
      />
    </div>
  );
}

/* ── Style constants ── */
const tBtn: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 2,
  background: "#0E0E10",
  border: "1px solid #1E1E22",
  color: "#555",
  fontSize: 9,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const hBtn: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 3,
  background: "#0E0E10",
  border: "1px solid #161619",
  color: "#555",
  fontSize: 11,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const mBtn: CSSProperties = {
  width: 22,
  height: 18,
  borderRadius: 2,
  fontSize: 7,
  fontWeight: 700,
  cursor: "pointer",
  border: "1px solid #1A1A1E",
  fontFamily: "'Syne'",
};
const smBtn: CSSProperties = {
  width: 20,
  height: 16,
  borderRadius: 2,
  fontSize: 6,
  fontWeight: 700,
  cursor: "pointer",
  border: "1px solid #141417",
  fontFamily: "'Syne'",
};
