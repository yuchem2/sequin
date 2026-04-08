import * as Tone from "tone";

export interface EffectsChain {
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  comp: Tone.Compressor;
  masterVol: Tone.Volume;
  limiter: Tone.Limiter;
  analyser: Tone.Analyser;
  masterMeter: Tone.Meter;
}

export function buildEffectsChain(): EffectsChain {
  const comp = new Tone.Compressor({ threshold: -16, ratio: 5, attack: 0.002, release: 0.2 });
  const masterVol = new Tone.Volume(0);
  const limiter = new Tone.Limiter(-0.5);
  const reverb = new Tone.Reverb({ decay: 2.8, wet: 1 }).connect(comp);
  const delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.25, wet: 1 }).connect(comp);
  comp.connect(masterVol);
  masterVol.connect(limiter);
  limiter.toDestination();

  const analyser = new Tone.Analyser("waveform", 256);
  limiter.connect(analyser);

  const masterMeter = new Tone.Meter({ smoothing: 0.8 });
  limiter.connect(masterMeter);

  return { reverb, delay, comp, masterVol, limiter, analyser, masterMeter };
}
