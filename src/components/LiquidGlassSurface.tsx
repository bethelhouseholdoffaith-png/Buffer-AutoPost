import React, { useId, useMemo } from 'react';
import { useReducedMotion } from 'motion/react';

interface LiquidGlassSurfaceProps {
  enabled?: boolean;
  isLight?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Reusable opt-in Liquid Glass surface.
 * - Uses a unique per-instance SVG filter ID so multiple mounted surfaces never collide.
 * - Keeps decorative refractive overlays strictly `pointer-events-none`.
 * - Falls back cleanly to CSS `backdrop-filter` or flat monochrome surface when disabled or under reduced-motion.
 */
export const LiquidGlassSurface: React.FC<LiquidGlassSurfaceProps> = ({
  enabled = false,
  isLight = false,
  className = '',
  children,
}) => {
  const rawId = useId();
  const filterId = `liquid-glass-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const prefersReducedMotion = useReducedMotion();

  // Lightweight procedural SVG bevel displacement map for refractive edge shimmer
  const displacementDataUri = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><radialGradient id="g" cx="50%" cy="50%" r="50%"><stop offset="65%" stop-color="#808080"/><stop offset="92%" stop-color="#a8a8ff"/><stop offset="100%" stop-color="#5858a8"/></radialGradient></defs><rect width="256" height="256" fill="url(#g)"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }, []);

  if (!enabled) {
    return (
      <div
        className={`relative border shadow-2xl ${
          isLight
            ? 'bg-white border-neutral-200 text-neutral-900'
            : 'bg-[#0c0d10] border-[#22242a] text-[#e5e5e5]'
        } ${className}`}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden border shadow-2xl liquid-glass-backdrop ${
        isLight
          ? 'bg-white/75 border-black/15 text-neutral-900 shadow-[0_24px_60px_rgba(0,0,0,0.12)]'
          : 'bg-[#0e1015]/75 border-white/15 text-[#f0f0f2] shadow-[0_24px_60px_rgba(0,0,0,0.65)]'
      } ${className}`}
    >
      {/* Shared SVG filter scoped by unique filterId; disabled automatically if reduced-motion is preferred */}
      {!prefersReducedMotion && (
        <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
          <defs>
            <filter id={filterId} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feImage
                href={displacementDataUri}
                x="0"
                y="0"
                width="100%"
                height="100%"
                preserveAspectRatio="none"
                result="dispMap"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="dispMap"
                scale="10"
                xChannelSelector="R"
                yChannelSelector="G"
                result="displaced"
              />
              <feColorMatrix
                in="displaced"
                type="saturate"
                values="1.15"
                result="saturated"
              />
              <feGaussianBlur in="saturated" stdDeviation="0.4" result="blurred" />
              <feBlend in="SourceGraphic" in2="blurred" mode="normal" />
            </filter>
          </defs>
        </svg>
      )}

      {/* Decorative refractive rim layer (pointer-events-none, behind foreground UI) */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-[inherit] ${
          isLight
            ? 'bg-gradient-to-br from-white/50 via-transparent to-black/[0.03] ring-1 ring-inset ring-white/70'
            : 'bg-gradient-to-br from-white/[0.09] via-transparent to-white/[0.02] ring-1 ring-inset ring-white/15'
        }`}
        style={
          !prefersReducedMotion
            ? { filter: `url(#${filterId})`, opacity: 0.45 }
            : undefined
        }
      />

      {/* Interactive foreground layer */}
      <div className="relative z-10">{children}</div>
    </div>
  );
};
