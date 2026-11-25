import type { MutableRefObject } from 'react';
import { GREETING_SIGNS, type GreetingSignConfig } from '../constants/greeting';

interface GreetingSignsProps {
  hasStarted: boolean;
  currentTime: number;
  activeSignId: string | null;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  onSignTap: (sign: GreetingSignConfig) => void;
}

export function GreetingSigns({
  hasStarted,
  currentTime,
  activeSignId,
  containerRef,
  onSignTap,
}: GreetingSignsProps) {
  if (!hasStarted) return null;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-start justify-center px-6 pt-20 sm:pt-24 lg:pt-24 will-change-transform"
      aria-live="polite"
    >
      {/* Poised single-wish gallery stage above the 3D pulsar mountainscape */}
      <div className="relative w-full max-w-2xl min-h-[124px] sm:min-h-[144px] flex items-center justify-center">
        {GREETING_SIGNS.map((sign) => {
          const isActive = sign.id === activeSignId;
          const hasPassed = sign.endAt !== null && currentTime >= sign.endAt;

          const stateTransform = isActive
            ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
            : hasPassed
              ? 'opacity-0 -translate-y-4 scale-[0.98] pointer-events-none'
              : 'opacity-0 translate-y-5 scale-[0.98] pointer-events-none';

          const isWarmAccent = sign.variant === 'name' || sign.variant === 'love';

          return (
            <button
              key={sign.id}
              type="button"
              disabled={!isActive}
              tabIndex={isActive ? 0 : -1}
              aria-hidden={!isActive}
              onClick={() => onSignTap(sign)}
              className={`absolute inset-0 flex flex-col items-center justify-center text-center focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 rounded-sm transition-all duration-[850ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${stateTransform}`}
            >
              {/* Delicate expanding hairline accent */}
              <span
                aria-hidden="true"
                className={`mb-3 block h-px transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                  isWarmAccent ? 'bg-[#fb7185]/70' : 'bg-white/40'
                } ${isActive ? 'w-11 sm:w-14 opacity-100' : 'w-0 opacity-0'}`}
              />

              {sign.variant === 'numeral' && (
                <span className="font-display text-[clamp(4.25rem,17vw,6.75rem)] leading-[0.86] font-normal tracking-[-0.02em] text-[#fafafa] drop-shadow-[0_4px_24px_rgba(255,255,255,0.2)]">
                  {sign.text}
                </span>
              )}

              {sign.variant === 'greeting' && (
                <span className="font-display text-[clamp(2rem,8.4vw,3.6rem)] leading-[1.06] font-normal tracking-[0.015em] text-[#f5f5f7] [text-wrap:balance] drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)]">
                  {sign.text}
                </span>
              )}

              {sign.variant === 'name' && (
                <span className="font-display text-[clamp(2.35rem,9.6vw,4.1rem)] leading-[1.02] font-semibold tracking-[0.01em] text-white [text-wrap:balance] drop-shadow-[0_4px_24px_rgba(251,113,133,0.24)]">
                  Шурочка{' '}
                  <span className="text-[#fb7185] font-normal tracking-tight">
                    &lt;3
                  </span>
                </span>
              )}

              {sign.variant === 'wish' && (
                <span className="font-display text-[clamp(1.75rem,7.2vw,3.15rem)] leading-[1.12] font-normal tracking-[0.015em] text-[#f3f3f6] max-w-[18ch] sm:max-w-[24ch] [text-wrap:balance] drop-shadow-[0_4px_22px_rgba(0,0,0,0.92)]">
                  {sign.text}
                </span>
              )}

              {sign.variant === 'love' && (
                <span className="font-display italic text-[clamp(2.25rem,9.2vw,4rem)] leading-[1.06] font-normal tracking-[0.02em] text-[#ffe4e8] [text-wrap:balance] drop-shadow-[0_4px_26px_rgba(251,113,133,0.3)]">
                  {sign.text}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
