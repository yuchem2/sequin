import * as Tone from "tone";
import type { TrackId } from "@sequin/shared";

export interface EngineChannels {
  ch: Tone.Channel;
  rg: Tone.Gain;
  dg: Tone.Gain;
}

export type SynthMap = {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hihat: Tone.MetalSynth;
  clap: Tone.NoiseSynth;
  bass: Tone.MonoSynth;
  lead: Tone.PolySynth;
  pad: Tone.PolySynth;
};

export function createChannel(
  comp: Tone.Compressor,
  reverb: Tone.Reverb,
  delay: Tone.FeedbackDelay,
): EngineChannels {
  const ch = new Tone.Channel({ volume: 0, pan: 0 }).connect(comp);
  const rg = new Tone.Gain(0).connect(reverb);
  const dg = new Tone.Gain(0).connect(delay);
  ch.connect(rg);
  ch.connect(dg);
  return { ch, rg, dg };
}

export function createSynths(channels: { [K in TrackId]: EngineChannels }): SynthMap {
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

  return { kick, snare, hihat, clap, bass, lead, pad };
}

export function createMeters(channels: { [K in TrackId]: EngineChannels }): {
  [K in TrackId]: Tone.Meter;
} {
  const ids: TrackId[] = ["kick", "snare", "hihat", "clap", "bass", "lead", "pad"];
  const meters = {} as { [K in TrackId]: Tone.Meter };
  for (const id of ids) {
    const m = new Tone.Meter({ smoothing: 0.8 });
    channels[id].ch.connect(m);
    meters[id] = m;
  }
  return meters;
}
