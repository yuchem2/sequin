"use client";

import { useEffect, useRef, useCallback } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import * as Tone from "tone";

import type { TrackId } from "@sequin/shared";
import { TRACK_IDS, TRACK_DEFS, STEPS, SECTION_COLORS, SECTION_TYPES } from "@sequin/shared";
import { serializeSong, compress } from "@sequin/shared";

import { buildEngine, playStep } from "@/engine";
import type { AudioEngine } from "@/engine";
import { useSongStore } from "@/store/songStore";
import { useUiStore } from "@/store/uiStore";

/* ═══════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════ */
export default function StudioPage() {
  /* ── Stores ── */
  const {
    song,
    toggleCell,
    setMixVal,
    setMasterVal,
    addPattern,
    dupPattern,
    addArrBlock,
    removeArrBlock,
    setArrSection,
    setArrRepeats,
    moveArrBlock,
    clearAll,
    updateSong,
  } = useSongStore();

  const {
    activePatIdx,
    setActivePatIdx,
    activeTrack,
    setActiveTrack,
    tab,
    setTab,
    isPlaying,
    setIsPlaying,
    playMode,
    setPlayMode,
    currentStep,
    setCurrentStep,
    currentArrIdx,
    setCurrentArrIdx,
    initialized,
    setInitialized,
    shareMsg,
    setShareMsg,
    trackMeters,
    setTrackMeters,
    masterLevel,
    setMasterLevel,
    songProgress,
    setSongProgress,
  } = useUiStore();

  /* ── Refs ── */
  const engineRef = useRef<AudioEngine | null>(null);
  const songRef = useRef(song);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef(0);
  songRef.current = song;

  const pat = song.patterns[activePatIdx] ?? song.patterns[0]!;

  /* ── URL sync ── */
  useEffect(() => {
    const t = setTimeout(() => {
      const encoded = compress(serializeSong(song));
      if (encoded) window.history.replaceState(null, "", "#" + encoded);
    }, 500);
    return () => clearTimeout(t);
  }, [song]);

  /* ── Init audio ── */
  const initAudio = useCallback(async () => {
    if (initialized) return;
    await Tone.start();
    engineRef.current = buildEngine();
    setInitialized(true);
  }, [initialized, setInitialized]);

  /* ── Sync mix ── */
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

  /* ── Waveform draw ── */
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
  }, [setTrackMeters, setMasterLevel]);

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

  /* ── Playback ── */
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

  /* ── Actions ── */
  const shareURL = () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => {
        setShareMsg("복사됨!");
        setTimeout(() => setShareMsg(""), 2000);
      })
      .catch(() => setShareMsg("주소창에서 복사"));
  };

  const handleClearAll = () => {
    clearAll();
    setActivePatIdx(0);
  };

  /* ── Helpers ── */
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
            onClick={handleClearAll}
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
              onClick={() => {
                addPattern();
                setActivePatIdx(song.patterns.length);
              }}
              style={{ ...tBtn, width: 26, height: 26, borderStyle: "dashed" as const }}
            >
              +
            </button>
            <button
              onClick={() => {
                dupPattern(activePatIdx);
                setActivePatIdx(song.patterns.length);
              }}
              style={{ ...tBtn, width: 26, height: 26, fontSize: 7 }}
            >
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
                      onClick={() => toggleCell(activePatIdx, activeTrack, row, col)}
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
