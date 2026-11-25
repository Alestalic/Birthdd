import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { DisorderAudioEngine } from './audio/audioEngine';
import { ControlDock } from './components/ControlDock';
import { GreetingSigns } from './components/GreetingSigns';
import {
  getActiveGreetingSign,
  type CameraPreset,
  type GreetingSignConfig,
} from './constants/greeting';
import { PulsarCanvas, type SceneHandle } from './scene/PulsarCanvas';

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function App() {
  const audioEngine = useMemo(() => new DisorderAudioEngine(), []);
  const sceneHandleRef = useRef<SceneHandle | null>(null);
  const signsContainerRef = useRef<HTMLDivElement | null>(null);

  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(209);
  const [activeSignId, setActiveSignId] = useState<string | null>(null);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('side');
  const [presetVersion, setPresetVersion] = useState(0);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioEngine.element;
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      setAudioError('Не удалось загрузить аудиодорожку.');
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audioEngine.dispose();
    };
  }, [audioEngine]);

  // Keyboard shortcuts for desktop convenience (Space play/pause, H toggle HUD)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.code === 'Space' && hasStarted) {
        e.preventDefault();
        if (isPlaying) {
          audioEngine.pause();
          setIsPlaying(false);
        } else {
          void audioEngine.play().then((ok) => setIsPlaying(ok));
        }
      } else if (e.key === 'h' || e.key === 'H') {
        if (hasStarted) setDockCollapsed((c) => !c);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [audioEngine, hasStarted, isPlaying]);

  const handleStart = useCallback(async () => {
    setAudioError(null);
    setHasStarted(true);
    sceneHandleRef.current?.triggerRipple(0, 0, 1.55);
    const started = await audioEngine.play();
    setIsPlaying(started);
    if (!started) {
      setAudioError('Нажми на кнопку воспроизведения внизу, чтобы включить звук.');
    }
  }, [audioEngine]);

  const handleTogglePlay = useCallback(async () => {
    setAudioError(null);
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      const ok = await audioEngine.play();
      setIsPlaying(ok);
    }
  }, [audioEngine, isPlaying]);

  const handleReplay = useCallback(async () => {
    setAudioError(null);
    setCurrentTime(0);
    setActiveSignId(null);
    setCameraPreset('side');
    setPresetVersion((v) => v + 1);
    sceneHandleRef.current?.resetWaves();
    sceneHandleRef.current?.triggerRipple(0, 0, 1.5);
    const ok = await audioEngine.replay();
    setIsPlaying(ok);
  }, [audioEngine]);

  const handleSeek = useCallback(
    (seconds: number) => {
      audioEngine.seek(seconds);
      setCurrentTime(seconds);
      const sign = getActiveGreetingSign(seconds);
      setActiveSignId(sign ? sign.id : null);
    },
    [audioEngine],
  );

  const handleSelectCamera = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset);
    setPresetVersion((v) => v + 1);
  }, []);

  const handleSignTap = useCallback((_sign: GreetingSignConfig) => {
    sceneHandleRef.current?.triggerRipple(0, 0, 1.65);
  }, []);

  const handlePlaybackSync = useCallback(
    (state: {
      currentTime: number;
      duration: number;
      isPlaying: boolean;
      activeSignId: string | null;
    }) => {
      setCurrentTime(state.currentTime);
      setDuration(state.duration);
      setIsPlaying(state.isPlaying);
      setActiveSignId(state.activeSignId);
    },
    [],
  );

  return (
    <main className="relative w-full h-[100dvh] overflow-hidden bg-[#050507] text-[#f3f3f5] select-none">
      {/* Full-viewport 3D Unknown Pleasures Radial Music Visualizer */}
      <PulsarCanvas
        audioEngine={audioEngine}
        cameraPreset={cameraPreset}
        presetVersion={presetVersion}
        sceneHandleRef={sceneHandleRef}
        signsContainerRef={signsContainerRef}
        onPlaybackSync={handlePlaybackSync}
      />

      {/* Minimal Top Bar — clean unboxed typography */}
      <header className="pointer-events-none fixed top-0 inset-x-0 z-20 flex items-center justify-between px-5 sm:px-8 safe-top">
        <div className="flex items-center gap-2 text-xs text-neutral-400 tracking-[0.04em] whitespace-nowrap shrink-0">
          <span className="text-neutral-200 font-medium">Unknown Pleasures</span>
          <span aria-hidden="true">·</span>
          <span>19</span>
        </div>

        <div className="font-mono-tabular text-xs text-neutral-400 whitespace-nowrap shrink-0">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </header>

      {/* Initial Minimalist Entrance Screen */}
      {!hasStarted && (
        <div className="fixed inset-x-0 top-0 z-20 flex flex-col items-center justify-start pt-20 sm:pt-24 px-6 text-center pointer-events-none">
          <p className="text-xs sm:text-sm text-neutral-400 tracking-[0.06em] mb-2">
            Joy Division · Disorder
          </p>

          <h1 className="font-display text-[clamp(4.25rem,18vw,7rem)] leading-[0.88] font-normal text-white tracking-[-0.02em] mb-6 drop-shadow-[0_4px_28px_rgba(0,0,0,0.9)]">
            19
          </h1>

          <button
            type="button"
            onClick={() => void handleStart()}
            className="pointer-events-auto inline-flex items-center justify-center gap-2.5 min-h-[48px] px-7 py-3 rounded-full bg-white text-[#050507] text-sm font-semibold tracking-[0.01em] hover:bg-neutral-200 active:scale-[0.97] transition-all shadow-[0_8px_32px_rgba(255,255,255,0.14)] whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#050507]"
          >
            <Play className="w-4 h-4 fill-current translate-x-[1px]" aria-hidden="true" />
            <span>Включить</span>
          </button>

          <p className="mt-4 text-xs text-neutral-500 max-w-xs [text-wrap:balance]">
            Сцену можно вращать пальцем и касаться волн
          </p>
        </div>
      )}

      {/* Ephemeral One-by-One Birthday Wishes (Permanent Closing "Люблю тебя!") */}
      <GreetingSigns
        hasStarted={hasStarted}
        currentTime={currentTime}
        activeSignId={activeSignId}
        containerRef={signsContainerRef}
        onSignTap={handleSignTap}
      />

      {/* Audio playback notice if mobile browser blocks autoplay */}
      {audioError && (
        <div
          role="status"
          className="fixed bottom-28 inset-x-0 z-30 flex justify-center px-4 pointer-events-none"
        >
          <p className="px-4 py-2 rounded-lg bg-[#0d0d13]/95 border border-white/15 text-xs text-neutral-200 text-center">
            {audioError}
          </p>
        </div>
      )}

      {/* Collapsible Unified Bottom Control Dock */}
      <ControlDock
        visible={hasStarted}
        collapsed={dockCollapsed}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        cameraPreset={cameraPreset}
        onToggleCollapse={() => setDockCollapsed((c) => !c)}
        onTogglePlay={() => void handleTogglePlay()}
        onReplay={() => void handleReplay()}
        onSeek={handleSeek}
        onSelectCamera={handleSelectCamera}
      />
    </main>
  );
}
