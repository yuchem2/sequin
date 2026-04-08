import type * as Tone from "tone";
import type { TrackId, TrackGrids } from "@sequin/shared";
import { TRACK_IDS, BASS_NOTES, LEAD_NOTES, PAD_NOTES } from "@sequin/shared";
import { buildEffectsChain } from "./effects";
import type { EffectsChain } from "./effects";
import { createChannel, createSynths, createMeters } from "./synths";
import type { SynthMap, EngineChannels } from "./synths";

export interface AudioEngine extends EffectsChain {
  synths: SynthMap;
  channels: { [K in TrackId]: EngineChannels };
  meters: { [K in TrackId]: Tone.Meter };
}

export function buildEngine(): AudioEngine {
  const effects = buildEffectsChain();

  const channels = {} as { [K in TrackId]: EngineChannels };
  for (const id of TRACK_IDS) {
    channels[id] = createChannel(effects.comp, effects.reverb, effects.delay);
  }

  const synths = createSynths(channels);
  const meters = createMeters(channels);

  return { ...effects, synths, channels, meters };
}

export function playStep(e: AudioEngine, tracks: TrackGrids, s: number, time: number): void {
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
}
