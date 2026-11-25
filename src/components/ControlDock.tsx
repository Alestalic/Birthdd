import { ChevronDown, ChevronUp, Pause, Play, RotateCcw } from 'lucide-react';
import {
  CAMERA_PRESETS,
  GREETING_SIGNS,
  type CameraPreset,
} from '../constants/greeting';

interface ControlDockProps {
  visible: boolean;
  collapsed: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  cameraPreset: CameraPreset;
  onToggleCollapse: () => void;
  onTogglePlay: () => void;
  onReplay: () => void;
  onSeek: (seconds: number) => void;
  onSelectCamera: (preset: CameraPreset) => void;
}

export function ControlDock({
  visible,
  collapsed,
  isPlaying,
  currentTime,
  duration,
  cameraPreset,
  onToggleCollapse,
  onTogglePlay,
  onReplay,
  onSeek,
  onSelectCamera,
}: ControlDockProps) {
  if (!visible) return null;

  const safeDuration = duration > 0 ? duration : 209;
  const progressPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 flex flex-col items-center pointer-events-none safe-bottom px-3 sm:px-5">
      {/* Cinema / Zen Mode collapse handle */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Показать панель' : 'Скрыть панель'}
        className="pointer-events-auto mb-1.5 inline-flex items-center gap-1.5 min-h-[30px] px-3 py-1 rounded-t-lg rounded-b-md bg-[#0b0b10]/92 border border-white/12 text-[11px] font-medium tracking-[0.02em] text-neutral-300 hover:text-white transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
      >
        {collapsed ? (
          <>
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Панель</span>
          </>
        ) : (
          <>
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Скрыть</span>
          </>
        )}
      </button>

      {/* Collapsible Unified Bottom Dock (solid surface, zero backdrop-filter over WebGL) */}
      <div
        className={`pointer-events-auto w-full max-w-[540px] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          collapsed
            ? 'translate-y-[120%] opacity-0 pointer-events-none h-0 overflow-hidden'
            : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="rounded-2xl bg-[#0b0b10]/94 border border-white/12 px-3 py-2.5 shadow-[0_12px_36px_rgba(0,0,0,0.65)]">
          {/* Scrubber row with subtle wish-cadence milestone marks */}
          <div className="relative flex items-center h-5 mb-1.5 px-1">
            <div className="relative w-full h-[3px] rounded-full bg-white/14">
              <div
                className="absolute left-0 top-0 bottom-0 rounded-full bg-white/85"
                style={{ width: `${progressPct}%` }}
              />
              {GREETING_SIGNS.map((sign) => {
                const leftPct = Math.min(
                  98,
                  Math.max(1, (sign.startAt / safeDuration) * 100),
                );
                const passed = currentTime >= sign.startAt;
                const isWarm = sign.variant === 'name' || sign.variant === 'love';
                return (
                  <span
                    key={sign.id}
                    aria-hidden="true"
                    className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-[1.5px] rounded-full transition-colors ${
                      isWarm ? 'h-2.5' : 'h-2'
                    } ${
                      passed
                        ? isWarm
                          ? 'bg-[#fb7185]'
                          : 'bg-white'
                        : 'bg-white/30'
                    }`}
                    style={{ left: `${leftPct}%` }}
                  />
                );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={safeDuration}
              step={0.1}
              value={Math.min(currentTime, safeDuration)}
              onChange={(e) => onSeek(Number(e.target.value))}
              aria-label="Перемотка трека"
              className="pulsar-scrubber absolute inset-0 w-full h-full opacity-100"
            />
          </div>

          {/* Primary controls + Camera view switcher */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onTogglePlay}
                aria-label={isPlaying ? 'Пауза' : 'Воспроизвести'}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white text-[#050507] hover:bg-neutral-200 active:scale-[0.96] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" aria-hidden="true" />
                ) : (
                  <Play className="w-4 h-4 fill-current translate-x-[1px]" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={onReplay}
                aria-label="Начать сначала"
                title="Начать сначала"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-white/[0.06] text-neutral-200 hover:bg-white/[0.12] hover:text-white active:scale-[0.96] transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div
              role="group"
              aria-label="Ракурс камеры"
              className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.05] border border-white/[0.07]"
            >
              {CAMERA_PRESETS.map((preset) => {
                const active = cameraPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => onSelectCamera(preset.id)}
                    className={`min-h-[36px] px-2.5 sm:px-3.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 ${
                      active
                        ? 'bg-white text-[#050507]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
