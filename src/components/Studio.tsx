'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, BadgeCheck, Check, ChevronRight, Clock3, Download, FileAudio2, Gauge, Headphones,
  Info, Keyboard, LoaderCircle, Music2, Pause, Play, RotateCcw, Scissors, Settings2, ShieldCheck,
  Sparkles, Trash2, UploadCloud, WandSparkles, X,
} from 'lucide-react';
import WaveformTimeline from '@/components/WaveformTimeline';
import {
  calculatePeaks, clamp, createDemo, decodeFile, encodeSplicedWav, estimateBpm, formatTime,
  type CutCandidate, type CutMode, type Selection,
} from '@/lib/audio';
import { findCandidates } from '@/lib/smart-cut';

type Result = { url: string; blob: Blob; cut: CutCandidate; seam: number; duration: number };
const modeNames: Record<CutMode, string> = { exact: 'Exact Cut', smart: 'Smart Cut', ballroom: 'Ballroom Mode' };

function SectionTitle({ n, title, detail }: { n: string; title: string; detail?: string }) {
  return <div className="mb-5 flex items-start gap-3">
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-emerald-400/25 bg-emerald-400/10 text-[12px] font-bold text-emerald-300">{n}</span>
    <div><h2 className="text-[17px] font-semibold tracking-[-0.025em] text-white">{title}</h2>{detail && <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>}</div>
  </div>;
}

export default function Studio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const originalAudioRef = useRef<HTMLAudioElement>(null);
  const editedAudioRef = useRef<HTMLAudioElement>(null);
  const previewStopRef = useRef<number | null>(null);
  const originalUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [filename, setFilename] = useState('');
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [mode, setMode] = useState<CutMode>('ballroom');
  const [mpm, setMpm] = useState(32);
  const [beatsPerBar, setBeatsPerBar] = useState<3 | 4>(4);
  const [estimatedBpm, setEstimatedBpm] = useState<number | null>(null);
  const [searchBars, setSearchBars] = useState(1);
  const [fadeMs, setFadeMs] = useState(70);
  const [candidates, setCandidates] = useState<CutCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'load' | 'search' | 'render' | null>(null);
  const [error, setError] = useState('');
  const [originalPlaying, setOriginalPlaying] = useState(false);
  const [editedPlaying, setEditedPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const peaks = useMemo(() => buffer ? calculatePeaks(buffer) : new Float32Array(), [buffer]);
  const chosen = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0] ?? null;
  const deletedLength = selection.end - selection.start;
  const selectedLength = chosen ? chosen.end - chosen.start : deletedLength;
  const estimatedFinal = buffer ? buffer.duration - selectedLength : 0;

  useEffect(() => () => {
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
  }, []);

  const resetResult = useCallback(() => {
    editedAudioRef.current?.pause();
    setEditedPlaying(false);
    previewStopRef.current = null;
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = null;
    setResult(null);
  }, []);

  const updateSelection = useCallback((value: Selection) => {
    setSelection(value); setCandidates([]); setSelectedId(null); resetResult();
  }, [resetResult]);

  const loadDecoded = useCallback((decoded: AudioBuffer, name: string, url: string) => {
    originalAudioRef.current?.pause();
    setOriginalPlaying(false); setPlaybackTime(0);
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    originalUrlRef.current = url;
    setOriginalUrl(url);
    resetResult(); setBuffer(decoded); setFilename(name);
    const t1 = decoded.duration * 0.25;
    const t2 = decoded.duration * 0.55;
    setSelection({ start: t1, end: t2 });
    setCandidates([]); setSelectedId(null);
    const guess = estimateBpm(decoded);
    setEstimatedBpm(guess);
    if (guess) setMpm(clamp(Math.round(guess / beatsPerBar * 10) / 10, 10, 100));
    setError('');
  }, [resetResult, beatsPerBar]);

  const handleFile = useCallback(async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(file.name)) {
      setError('Выбери аудиофайл: WAV, MP3, M4A, AAC, OGG или FLAC (если поддерживается браузером).');
      return;
    }
    setBusy('load'); setError('');
    try {
      const decoded = await decodeFile(file);
      if (decoded.duration < 2) throw new Error('Нужна композиция длиной не менее двух секунд.');
      const url = URL.createObjectURL(file);
      loadDecoded(decoded, file.name, url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Файл не удалось декодировать в браузере.');
    } finally { setBusy(null); }
  }, [loadDecoded]);

  const handleDemo = useCallback(async () => {
    setBusy('load'); setError('');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
      const demo = createDemo();
      const blob = encodeSplicedWav(demo, 0, 0, 0);
      const url = URL.createObjectURL(blob);
      loadDecoded(demo, 'Ballroom demo · 32 MPM (synthetic)', url);
      setMpm(32); setBeatsPerBar(4); setEstimatedBpm(128);
      setSelection({ start: 8, end: 19.25 });
    } catch { setError('Не удалось создать демонстрационную фонограмму.'); }
    finally { setBusy(null); }
  }, [loadDecoded]);

  const handleReset = () => {
    originalAudioRef.current?.pause();
    resetResult(); setBuffer(null); setFilename(''); setOriginalUrl(null); setCandidates([]);
    setSelectedId(null); setEstimatedBpm(null); setPlaybackTime(0);
    if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
    originalUrlRef.current = null;
    if (inputRef.current) inputRef.current.value = '';
  };

  const analyze = async () => {
    if (!buffer || busy) return;
    if (selection.end - selection.start < 0.3) { setError('Выдели участок длиной хотя бы 0,3 секунды.'); return; }
    resetResult(); setBusy('search'); setError('');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
      const matches = findCandidates(buffer, { mode, selection, mpm, beatsPerBar, searchBars });
      setCandidates(matches); setSelectedId(matches[0]?.id ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось найти точки склейки.'); }
    finally { setBusy(null); }
  };

  const renderCut = async () => {
    if (!buffer || busy) return;
    setBusy('render'); setError('');
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
      // Exact mode works immediately even without a prior analysis pass.
      const cut = chosen ?? findCandidates(buffer, { mode, selection, mpm, beatsPerBar, searchBars })[0];
      const blob = encodeSplicedWav(buffer, cut.start, cut.end, fadeMs);
      resetResult();
      const url = URL.createObjectURL(blob);
      resultUrlRef.current = url;
      const seam = cut.start;
      setResult({ url, blob, cut, seam, duration: buffer.duration - (cut.end - cut.start) });
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Не удалось создать WAV.'); }
    finally { setBusy(null); }
  };

  const playOriginal = async () => {
    const audio = originalAudioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    editedAudioRef.current?.pause(); setEditedPlaying(false);
    try { await audio.play(); } catch { setError('Браузер заблокировал воспроизведение. Нажми Play ещё раз.'); }
  };

  const playSeam = async (aroundOnly: boolean) => {
    const audio = editedAudioRef.current;
    if (!audio || !result) return;
    originalAudioRef.current?.pause(); setOriginalPlaying(false);
    if (!audio.paused) { audio.pause(); return; }
    const near = clamp(result.seam - 5, 0, result.duration);
    audio.currentTime = aroundOnly ? near : 0;
    previewStopRef.current = aroundOnly ? Math.min(result.duration, result.seam + 5) : null;
    try { await audio.play(); } catch { setError('Не удалось проиграть результат.'); }
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `${filename.replace(/\.[^.]+$/, '').replace(/[^\w\p{L}\p{N} .-]+/gu, '_') || 'track'}_smartsplice.wav`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  return (
    <main className="min-h-screen pb-20 text-slate-200">
      <input ref={inputRef} type="file" accept="audio/*,.flac" className="hidden" onChange={(event) => void handleFile(event.target.files?.[0])} />
      <div className="mx-auto max-w-[1510px] px-4 sm:px-7 xl:px-12">
        <header className="flex min-h-[90px] items-center justify-between gap-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-300 text-slate-950 shadow-[0_0_32px_rgba(83,206,171,.15)]"><AudioLines size={23} strokeWidth={2.5}/></span>
            <div className="leading-none"><div className="text-[19px] font-bold tracking-[-0.055em] text-white">smart<span className="text-emerald-300">splice</span><span className="font-normal text-white/40">.studio</span></div><p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Music editing workspace</p></div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-300/[0.06] px-4 py-2 text-xs font-medium text-emerald-200 sm:flex"><ShieldCheck size={14}/> Локальная обработка · файлы не загружаются на сервер</div>
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-400">BETA 0.1</span>
        </header>

        <section className="relative overflow-hidden pb-9 pt-12 md:pt-16">
          <div className="pointer-events-none absolute -top-32 right-10 h-72 w-96 rounded-full bg-teal-400/[0.06] blur-[85px]" />
          <div className="relative max-w-[870px]">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.06] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-emerald-200"><Sparkles size={13}/> Умный монтаж музыки</div>
            <h1 className="text-4xl font-semibold leading-[1.1] tracking-[-0.055em] text-white sm:text-5xl lg:text-[60px]">Вырезай лишнее.<br/><span className="text-gradient">Сохраняй музыку.</span></h1>
            <p className="mt-5 max-w-[700px] text-sm leading-7 text-slate-400 sm:text-base">Выдели ненужный фрагмент — SmartSplice предложит места соединения с учётом гармонии, динамики и музыкального счёта. Прослушай и сохрани готовую фонограмму.</p>
          </div>
        </section>

        {error && <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm text-rose-200"><span>{error}</span><button aria-label="Скрыть ошибку" onClick={() => setError('')}><X size={18}/></button></div>}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_355px]">
          <div className="space-y-6">
            <section className="panel p-5 sm:p-7">
              <SectionTitle n="01" title="Исходная композиция" detail="MP3, WAV, M4A и другие форматы, поддерживаемые браузером" />
              {!buffer ? (
                <div
                  className={`relative flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center transition ${isDraggingFile ? 'border-emerald-300 bg-emerald-300/10' : 'border-white/20 bg-[#101a21] hover:border-emerald-300/40'}`}
                  onDragOver={(event) => { event.preventDefault(); setIsDraggingFile(true); }}
                  onDragLeave={(event) => { event.preventDefault(); setIsDraggingFile(false); }}
                  onDrop={(event) => { event.preventDefault(); setIsDraggingFile(false); void handleFile(event.dataTransfer.files[0]); }}
                >
                  <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><UploadCloud size={28}/></span>
                  <h3 className="text-lg font-semibold text-white">Перетащи сюда фонограмму</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">Или выбери файл на компьютере. Мы обработаем его прямо в браузере.</p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button onClick={() => inputRef.current?.click()} disabled={busy !== null} className="primary-button"><UploadCloud size={17}/> {busy === 'load' ? 'Загрузка...' : 'Выбрать аудио'}</button>
                    <button onClick={() => void handleDemo()} disabled={busy !== null} className="secondary-button"><Play size={15}/> Демо-трек</button>
                  </div>
                  <p className="mt-5 text-xs text-slate-500">Лучше использовать Chrome или Edge на компьютере для больших файлов.</p>
                </div>
              ) : (
                <>
                  <div className="mb-6 flex flex-wrap items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.025] px-4 py-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-300/10 text-emerald-300"><FileAudio2 size={21}/></span>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white" title={filename}>{filename}</p><p className="mt-1 text-xs text-slate-500">{formatTime(buffer.duration)} · {(buffer.sampleRate / 1000).toFixed(1)} kHz · {buffer.numberOfChannels === 1 ? 'Mono' : `${buffer.numberOfChannels} канала`}</p></div>
                    <button onClick={playOriginal} className="icon-button" title={originalPlaying ? 'Пауза' : 'Воспроизвести оригинал'}>{originalPlaying ? <Pause size={18}/> : <Play size={18}/>}</button>
                    <button onClick={() => inputRef.current?.click()} className="icon-button" title="Заменить файл"><UploadCloud size={17}/></button>
                    <button onClick={handleReset} className="icon-button hover:!text-rose-300" title="Удалить файл"><Trash2 size={17}/></button>
                  </div>
                  <WaveformTimeline peaks={peaks} duration={buffer.duration} selection={selection} onChange={updateSelection} playbackTime={playbackTime} candidate={chosen ? { start: chosen.start, end: chosen.end } : null}/>
                  <audio ref={originalAudioRef} src={originalUrl ?? undefined} preload="metadata" className="hidden" onTimeUpdate={(e) => setPlaybackTime(e.currentTarget.currentTime)} onPlay={() => setOriginalPlaying(true)} onPause={() => setOriginalPlaying(false)} onEnded={() => setOriginalPlaying(false)}/>
                  <div className="mt-7 grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
                    <div className="time-field"><span>Начало удаления (сек)</span><input type="number" min="0" max={selection.end - 0.3} step="0.1" value={Number(selection.start.toFixed(2))} onChange={(e) => updateSelection({ ...selection, start: clamp(Number(e.target.value) || 0, 0, selection.end - 0.3) })}/><small>{formatTime(selection.start, 1)}</small></div>
                    <div className="time-field"><span>Конец удаления (сек)</span><input type="number" min={selection.start + 0.3} max={buffer.duration} step="0.1" value={Number(selection.end.toFixed(2))} onChange={(e) => updateSelection({ ...selection, end: clamp(Number(e.target.value) || 0, selection.start + 0.3, buffer.duration) })}/><small>{formatTime(selection.end, 1)}</small></div>
                    <div className="time-field"><span>Будет удалено</span><div className="text-[22px] font-semibold tracking-[-0.03em] text-rose-300">{formatTime(deletedLength, 1)}</div><small>Исходные границы</small></div>
                  </div>
                </>
              )}
            </section>

            <section className="panel p-5 sm:p-7">
              <SectionTitle n="02" title="Найти идеальную склейку" detail="Получишь до 3 вариантов с разными точками перехода" />
              <div className="grid gap-3 md:grid-cols-3">
                {(['exact', 'smart', 'ballroom'] as CutMode[]).map((item) => (
                  <button key={item} onClick={() => { setMode(item); setCandidates([]); setSelectedId(null); resetResult(); }} className={`min-h-[132px] rounded-xl border p-4 text-left transition ${mode === item ? 'border-emerald-400/50 bg-emerald-400/[0.08] shadow-[inset_0_0_0_1px_rgba(80,220,178,.12)]' : 'border-white/10 bg-white/[0.025] hover:border-white/25'}`}>
                    <div className="flex items-center justify-between"><span className={mode === item ? 'text-emerald-300' : 'text-slate-400'}>{item === 'exact' ? <Scissors size={20}/> : item === 'smart' ? <WandSparkles size={20}/> : <Music2 size={20}/>}</span>{mode === item && <Check className="text-emerald-300" size={17}/>}</div>
                    <p className="mt-3 text-sm font-semibold text-white">{modeNames[item]}</p>
                    <p className="mt-1.5 text-xs leading-5 text-slate-400">{item === 'exact' ? 'Точно указанный участок, без смещения границ.' : item === 'smart' ? 'Подбор совместимых переходов с точностью до доли.' : 'Целые такты, приоритет танцевального счёта.'}</p>
                  </button>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs text-slate-500"><Info size={15}/> {mode === 'exact' ? 'Применяется короткий кроссфейд на точной границе.' : 'Сдвиг границ ограничен настройкой справа; результат нужно прослушать.'}</span>
                <button disabled={!buffer || busy !== null} onClick={() => void analyze()} className="primary-button min-w-[190px]">{busy === 'search' ? <LoaderCircle size={17} className="animate-spin"/> : <Sparkles size={17}/>} {mode === 'exact' ? 'Проверить точную склейку' : 'Найти варианты'} <ChevronRight size={17}/></button>
              </div>
              {!!candidates.length && <div className="mt-6 border-t border-white/10 pt-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-white">Варианты соединения</h3><span className="text-xs text-slate-500">Оценка сравнительная, не гарантия качества</span></div>
                <div className="grid gap-3 md:grid-cols-3">
                  {candidates.map((candidate, index) => <button key={candidate.id} onClick={() => { setSelectedId(candidate.id); resetResult(); }} className={`rounded-xl border p-4 text-left transition ${chosen?.id === candidate.id ? 'border-amber-300/50 bg-amber-300/[0.07]' : 'border-white/10 hover:border-white/20'}`}>
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-200">Вариант {index + 1}</span>{chosen?.id === candidate.id && <BadgeCheck size={17} className="text-amber-200"/>}</div>
                    <p className="mt-3 text-[21px] font-semibold tracking-tight text-white">{formatTime(candidate.start, 1)} <span className="text-slate-600">→</span> {formatTime(candidate.end, 1)}</p>
                    <div className="mt-2 flex justify-between gap-2 text-[11px] text-slate-400"><span>Удалено {formatTime(candidate.removed, 1)}</span><span>{mode === 'exact' || candidate.score === 0 ? 'Без оценки' : `${candidate.score}/100`}</span></div>
                  </button>)}
                </div>
              </div>}
            </section>

            <section className="panel p-5 sm:p-7">
              <SectionTitle n="03" title="Прослушивание и экспорт" detail="Проверь 10 секунд вокруг точки соединения перед сохранением" />
              {!result ? <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.025] px-6 py-5 text-center"><Headphones className="mb-3 text-slate-600" size={30}/><p className="text-sm font-medium text-slate-300">Готовый результат появится здесь</p><p className="mt-1.5 max-w-sm text-xs leading-5 text-slate-500">Нажми «Склеить фонограмму» справа, когда выберешь вариант.</p></div> : <div className="space-y-4">
                <div className="grid gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.055] p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-300"><Check size={21}/></span><div><p className="text-sm font-semibold text-white">Фонограмма готова</p><p className="mt-1 text-xs text-slate-400">{formatTime(result.duration)} · WAV PCM 16-bit · склейка около {formatTime(result.seam, 1)}</p></div></div><span className="text-xs text-emerald-300">Обработано локально</span></div>
                <audio ref={editedAudioRef} src={result.url} controls preload="metadata" className="w-full accent-emerald-400" onPlay={() => setEditedPlaying(true)} onPause={() => setEditedPlaying(false)} onEnded={() => setEditedPlaying(false)} onTimeUpdate={(event) => { if (previewStopRef.current !== null && event.currentTarget.currentTime >= previewStopRef.current) { event.currentTarget.pause(); previewStopRef.current = null; } }}/>
                <div className="flex flex-wrap gap-3"><button className="secondary-button" onClick={() => void playSeam(true)}>{editedPlaying ? <Pause size={16}/> : <Headphones size={16}/>} Проверить склейку ±5 с</button><button className="primary-button" onClick={download}><Download size={17}/> Скачать WAV</button></div>
              </div>}
            </section>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-6">
            <section className="panel p-5 sm:p-6"><div className="mb-6 flex items-center justify-between"><h2 className="flex items-center gap-2 text-base font-semibold text-white"><Settings2 className="text-emerald-300" size={20}/> Параметры монтажа</h2><span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">CONTROL</span></div>
              <label className="field-label" htmlFor="mpm">Темп, тактов в минуту (MPM)</label>
              <div className="flex items-center gap-3"><div className="relative min-w-0 flex-1"><Gauge size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/><input id="mpm" className="studio-input pl-10" type="number" value={mpm} min={10} max={100} step={0.1} onChange={(e) => { setMpm(clamp(Number(e.target.value) || 32, 10, 100)); setCandidates([]); setSelectedId(null); resetResult(); }}/></div><span className="w-20 text-right text-xs text-slate-500">{(mpm * beatsPerBar).toFixed(1)} BPM</span></div>
              {estimatedBpm && <button className="mt-2 block text-left text-[11px] text-slate-500 hover:text-emerald-200" onClick={() => { setMpm(Math.round(estimatedBpm / beatsPerBar * 10) / 10); setCandidates([]); setSelectedId(null); resetResult(); }}>Автооценка: ≈ {estimatedBpm} BPM · нажми, чтобы применить. Проверь на слух.</button>}
              <div className="mt-5"><label className="field-label">Музыкальный размер</label><div className="grid grid-cols-2 gap-2">{([3,4] as const).map((meter) => <button key={meter} onClick={() => { setBeatsPerBar(meter); setCandidates([]); setSelectedId(null); resetResult(); }} className={`rounded-lg border py-2.5 text-sm font-semibold transition ${beatsPerBar === meter ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/[0.03] text-slate-400 hover:text-white'}`}>{meter}/4 {meter === 3 ? '· Waltz' : '· Tango / Latin'}</button>)}</div></div>
              <div className="mt-6"><div className="mb-2 flex items-center justify-between"><label className="field-label !mb-0" htmlFor="searchBars">Допустимый сдвиг границ</label><span className="text-xs font-semibold text-emerald-200">± {searchBars.toFixed(1)} такта</span></div><input id="searchBars" type="range" className="w-full accent-emerald-400" min={0.25} max={2} step={0.25} value={searchBars} onChange={(e) => { setSearchBars(Number(e.target.value)); setCandidates([]); setSelectedId(null); resetResult(); }}/><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>Точнее</span><span>Больше вариантов</span></div></div>
              <div className="mt-6"><div className="mb-2 flex items-center justify-between"><label className="field-label !mb-0" htmlFor="fade">Длительность кроссфейда</label><span className="text-xs font-semibold text-emerald-200">{fadeMs} мс</span></div><input id="fade" type="range" className="w-full accent-emerald-400" min={10} max={200} step={10} value={fadeMs} onChange={(e) => { setFadeMs(Number(e.target.value)); resetResult(); }}/><div className="mt-2 flex justify-between text-[10px] text-slate-600"><span>Резче</span><span>Мягче</span></div></div>
              <div className="mt-7 border-t border-white/10 pt-6"><div className="mb-4 flex items-center justify-between"><span className="text-xs text-slate-400">Ожидаемая длительность</span><span className="text-lg font-semibold text-white">{buffer ? formatTime(estimatedFinal) : '–:–'}</span></div><button className="primary-button w-full !justify-center py-3.5" onClick={() => void renderCut()} disabled={!buffer || busy !== null}>{busy === 'render' ? <LoaderCircle size={18} className="animate-spin"/> : <Scissors size={18}/>} {busy === 'render' ? 'Создаём фонограмму...' : 'Склеить фонограмму'} <ChevronRight size={18}/></button><p className="mt-3 text-center text-[11px] leading-5 text-slate-500">В Smart / Ballroom режиме границы подбираются автоматически. Исходник не меняется.</p></div>
            </section>
            <section className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-5"><div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><Info size={18}/> Важный момент</div><p className="mt-3 text-xs leading-6 text-slate-400">Этот MVP использует музыкальный анализ и DSP, <strong className="font-medium text-slate-200">не обученную нейросеть</strong>. Неподходящие аккорды или обрезанный вокал могут оставаться заметными. Смещай границы и проверяй результат на слух.</p></section>
            <div className="flex items-center justify-center gap-2 text-[11px] text-slate-600"><Keyboard size={14}/> Всё выполняется в твоём браузере · <Clock3 size={14}/> Без регистрации</div>
          </aside>
        </div>
        <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-7 text-xs text-slate-500"><div className="flex items-center gap-2"><AudioLines size={15} className="text-emerald-300"/> SmartSplice Studio <span className="text-slate-700">/</span> A musical editing tool</div><div className="flex items-center gap-1.5"><RotateCcw size={12}/> Original stays untouched · WAV export</div></footer>
      </div>
    </main>
  );
}
