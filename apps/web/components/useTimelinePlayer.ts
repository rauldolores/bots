"use client";

// Motor de reproducción de los simuladores (chat y llamada): timeline de
// turnos con efecto de escritura, autoplay, controles (play/pausa, anterior/
// siguiente, reiniciar), timer y progreso. Compartido por ChatSimulator y
// VoiceCallSimulator para que ambos se comporten idéntico.
import { useEffect, useMemo, useRef, useState } from "react";

export type TimelineTurn =
  | { type: "text"; from: "client" | "bot"; text: string }
  | { type: "action"; label: string; detail: string; tone?: string };

export interface TimelineOptions {
  autoplayDelayMs?: number;
  thinkMs?: number;
  clientMs?: number;
  actionMs?: number;
  charRate?: number;
}

interface Ev {
  item: TimelineTurn;
  start: number;
  end: number;
  typing?: { start: number; duration: number };
}

export type RenderTurn =
  | { kind: "text"; from: "client" | "bot"; text: string; dots?: boolean; cursor?: boolean }
  | { kind: "action"; label: string; detail: string; tone: string };

function buildTimeline(
  script: TimelineTurn[],
  thinkMs: number,
  clientMs: number,
  actionMs: number,
  charRate: number,
): { timeline: Ev[]; total: number } {
  const timeline: Ev[] = [];
  let t = 0;
  for (const item of script) {
    if (item.type === "text" && item.from === "bot") {
      const duration = Math.max(thinkMs, (item.text.length / charRate) * 1000);
      timeline.push({
        item,
        start: t,
        end: t + thinkMs + duration,
        typing: { start: t + thinkMs, duration },
      });
      t += thinkMs + duration;
    } else if (item.type === "text") {
      timeline.push({ item, start: t, end: t + clientMs });
      t += clientMs;
    } else {
      timeline.push({ item, start: t, end: t + actionMs });
      t += actionMs;
    }
  }
  return { timeline, total: t };
}

function derive(timeline: Ev[], total: number, e: number): RenderTurn[] {
  const items: RenderTurn[] = [];
  for (const ev of timeline) {
    if (e < ev.start) break;
    const item = ev.item;
    if (item.type === "text") {
      if (ev.typing) {
        if (e < ev.typing.start) {
          items.push({ kind: "text", from: item.from, text: "", dots: true });
        } else {
          const ratio = Math.min(1, Math.max(0, (e - ev.typing.start) / ev.typing.duration));
          items.push({
            kind: "text",
            from: item.from,
            text: item.text.slice(0, Math.floor(ratio * item.text.length)),
          });
        }
      } else {
        items.push({ kind: "text", from: item.from, text: item.text });
      }
    } else {
      items.push({
        kind: "action",
        label: item.label,
        detail: item.detail,
        tone: item.tone ?? "amber",
      });
    }
  }
  // cursor parpadeante al final del último mensaje del bot visible
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "text" && it.from === "bot" && !it.dots) {
      it.cursor = true;
      break;
    }
  }
  void total;
  return items;
}

export function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function useTimelinePlayer(script: TimelineTurn[], options: TimelineOptions = {}) {
  const {
    autoplayDelayMs = 900,
    thinkMs = 900,
    clientMs = 550,
    actionMs = 800,
    charRate = 26,
  } = options;

  const { timeline, total } = useMemo(
    () => buildTimeline(script, thinkMs, clientMs, actionMs, charRate),
    [script, thinkMs, clientMs, actionMs, charRate],
  );

  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const baseRef = useRef(0);
  const lastTickRef = useRef(0);
  const liveRef = useRef(0);
  const interactedRef = useRef(false);

  const items = useMemo(() => derive(timeline, total, elapsed), [timeline, total, elapsed]);
  const finished = elapsed >= total;
  const progress = Math.min(100, Math.round((elapsed / total) * 100));

  // reloj de reproducción
  useEffect(() => {
    if (!playing) return;
    lastTickRef.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const next = Math.min(total, baseRef.current + (now - lastTickRef.current));
      liveRef.current = next;
      setElapsed(next);
      if (next >= total) setPlaying(false);
    }, 100);
    return () => clearInterval(id);
  }, [playing, total]);

  // autoplay al entrar a la página (si el usuario no ha interactuado)
  useEffect(() => {
    const t = setTimeout(() => {
      if (!interactedRef.current) setPlaying(true);
    }, autoplayDelayMs);
    return () => clearTimeout(t);
  }, [autoplayDelayMs]);

  const seek = (target: number) => {
    const t = Math.max(0, Math.min(total, target));
    baseRef.current = t;
    liveRef.current = t;
    lastTickRef.current = performance.now();
    setElapsed(t);
  };

  const play = () => {
    interactedRef.current = true;
    if (finished) seek(0);
    setPlaying(true);
  };
  const pause = () => {
    interactedRef.current = true;
    baseRef.current = liveRef.current;
    setPlaying(false);
  };
  const restart = () => {
    interactedRef.current = true;
    seek(0);
    setPlaying(true);
  };
  const skipBack = () => {
    interactedRef.current = true;
    const cur = liveRef.current;
    let idx = -1;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].start < cur - 60) idx = i;
    }
    seek(idx >= 0 ? timeline[idx].start : 0);
    setPlaying(true);
  };
  const skipForward = () => {
    interactedRef.current = true;
    const cur = liveRef.current;
    let idx = -1;
    for (let i = 0; i < timeline.length; i++) {
      if (timeline[i].start <= cur + 60) idx = i;
      else break;
    }
    if (idx === -1) seek(timeline[0].start);
    else if (idx >= timeline.length - 1) seek(total);
    else seek(timeline[idx + 1].start);
    setPlaying(true);
  };

  return {
    items,
    elapsed,
    playing,
    finished,
    progress,
    total,
    play,
    pause,
    restart,
    skipBack,
    skipForward,
  };
}
