'use client';

import { useCallback, useEffect, useRef } from 'react';
import { clamp, formatTime, type Selection } from '@/lib/audio';

type Props = {
  peaks: Float32Array;
  duration: number;
  selection: Selection;
  onChange: (s: Selection) => void;
  playbackTime?: number;
  candidate?: Selection | null;
};

type DragMode = 'start' | 'end' | 'range' | 'create';

export default function WaveformTimeline({ peaks, duration, selection, onChange, playbackTime = 0, candidate }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; anchor: number; old: Selection } | null>(null);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root || duration <= 0 || !peaks.length) return;
    const rect = root.getBoundingClientRect();
    const w = Math.max(10, rect.width);
    const h = Math.max(10, rect.height);
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.fillStyle = '#111b22'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 1) {
      const p = peaks[Math.min(peaks.length - 1, Math.floor(x / w * peaks.length))] || 0;
      const amp = Math.max(2, p * h * 0.43);
      const time = (x / w) * duration;
      ctx.fillStyle = time >= selection.start && time <= selection.end ? '#b76e70' : '#57c9b4';
      ctx.globalAlpha = time >= selection.start && time <= selection.end ? 0.84 : 0.88;
      ctx.fillRect(x, h / 2 - amp, 1.2, amp * 2);
    }
    ctx.globalAlpha = 1;
    const xStart = selection.start / duration * w;
    const xEnd = selection.end / duration * w;
    ctx.fillStyle = 'rgba(215, 84, 90, 0.14)'; ctx.fillRect(xStart, 0, xEnd - xStart, h);
    ctx.strokeStyle = '#f49a9f'; ctx.lineWidth = 2;
    for (const x of [xStart, xEnd]) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillStyle = '#f49a9f'; ctx.beginPath(); ctx.roundRect(x - 5, 6, 10, 21, 3); ctx.fill();
    }
    if (candidate) {
      ctx.strokeStyle = '#e5c080'; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]);
      for (const x of [candidate.start / duration * w, candidate.end / duration * w]) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#faf5d8'; ctx.lineWidth = 1.5;
    const playX = clamp(playbackTime / duration * w, 0, w);
    ctx.beginPath(); ctx.moveTo(playX, 0); ctx.lineTo(playX, h); ctx.stroke();
    ctx.fillStyle = '#faf5d8'; ctx.beginPath(); ctx.moveTo(playX - 4, 0); ctx.lineTo(playX + 4, 0); ctx.lineTo(playX, 7); ctx.fill();
  }, [peaks, duration, selection, playbackTime, candidate]);

  useEffect(() => {
    repaint();
    const ro = new ResizeObserver(repaint);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => ro.disconnect();
  }, [repaint]);

  const pointToTime = (clientX: number) => {
    const rect = rootRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width * duration, 0, duration);
  };

  return (
    <div className="w-full select-none">
      <div
        ref={rootRef}
        className="relative h-[184px] w-full overflow-hidden rounded-xl border border-white/10 touch-none cursor-crosshair md:h-[220px]"
        onPointerDown={(event) => {
          if (!duration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const t = pointToTime(event.clientX);
          const tolerance = 14 / rect.width * duration;
          let mode: DragMode;
          if (Math.abs(t - selection.start) < tolerance) mode = 'start';
          else if (Math.abs(t - selection.end) < tolerance) mode = 'end';
          else if (t > selection.start && t < selection.end) mode = 'range';
          else mode = 'create';
          dragRef.current = { mode, anchor: t, old: { ...selection } };
          if (mode === 'create') onChange({ start: t, end: Math.min(duration, t + 0.3) });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const current = pointToTime(event.clientX);
          const { old, anchor, mode } = drag;
          const minGap = Math.min(0.3, duration / 5);
          if (mode === 'start') onChange({ start: clamp(current, 0, selectionRef.current.end - minGap), end: selectionRef.current.end });
          else if (mode === 'end') onChange({ start: selectionRef.current.start, end: clamp(current, selectionRef.current.start + minGap, duration) });
          else if (mode === 'range') {
            const delta = clamp(current - anchor, -old.start, duration - old.end);
            onChange({ start: old.start + delta, end: old.end + delta });
          } else onChange({ start: clamp(Math.min(anchor, current), 0, duration - minGap), end: clamp(Math.max(anchor, current), Math.min(anchor, current) + minGap, duration) });
        }}
        onPointerUp={(event) => { dragRef.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { dragRef.current = null; }}
        aria-label="Звуковая волна: перетащите, чтобы выделить фрагмент; можно двигать красные границы"
      ><canvas ref={canvasRef} className="h-full w-full" /></div>
      <div className="mt-3 flex justify-between text-[11px] font-medium tracking-wide text-slate-500">
        {Array.from({ length: 7 }, (_, index) => <span key={index}>{formatTime(duration * index / 6)}</span>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
        <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-rose-400" /> Будет удалено</span>
        <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-amber-300" /> Рекомендованные границы</span>
        <span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-emerald-400" /> Сохранится</span>
      </div>
    </div>
  );
}
