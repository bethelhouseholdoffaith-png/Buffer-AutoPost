import React, { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';

interface WelcomeAnimationProps {
  displayName: string;
  isNewUser: boolean;
  onComplete: () => void;
}

interface BubbleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseRadius: number;
  radius: number;
  color: string;
  alpha: number;
  maxAlpha: number;
  age: number;
  lifetime: number;
  pulseFreq: number;
  pulsePhase: number;
  driftFreq: number;
  driftAmp: number;
  angle: number;
}

const MONOCHROME_SHADES = [
  '#ffffff',
  '#f5f5f5',
  '#e5e5e5',
  '#c4c4c4',
  '#9ca3af',
  '#6b7280',
  '#3f3f46',
  '#1f1f23',
  '#000000',
];

export const WelcomeAnimation: React.FC<WelcomeAnimationProps> = ({
  displayName,
  isNewUser,
  onComplete,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLHeadingElement | null>(null);
  const completedRef = useRef(false);

  const [textVisible, setTextVisible] = useState(true);
  const [backdropOpacity, setBackdropOpacity] = useState(1);

  const message = isNewUser
    ? 'Welcome to AutoBuffer Studio!'
    : `Welcome back, ${displayName || 'Creator'}!`;

  useEffect(() => {
    const finishOnce = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      onComplete();
    };

    if (prefersReducedMotion) {
      const textTimer = window.setTimeout(() => {
        setTextVisible(false);
        setBackdropOpacity(0);
      }, 750);
      const doneTimer = window.setTimeout(finishOnce, 1020);
      return () => {
        window.clearTimeout(textTimer);
        window.clearTimeout(doneTimer);
      };
    }

    const canvas = canvasRef.current;
    const textEl = textRef.current;
    if (!canvas || !textEl) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const particles: BubbleParticle[] = [];
    let burstTriggered = false;
    let rafId = 0;
    const mountTime = performance.now();

    const spawnBurstFromText = () => {
      const rect = textEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const spanX = Math.max(rect.width * 0.48, 80);
      const spanY = Math.max(rect.height * 0.34, 16);

      const count = 96;
      for (let i = 0; i < count; i++) {
        // Uniformly cover all 360 degrees (up, down, left, right, every diagonal)
        const baseAngle = (i / count) * Math.PI * 2;
        const angle = baseAngle + (Math.random() - 0.5) * ((Math.PI * 2) / count) * 0.85;

        // Spawn directly inside the text bounding box aligned with burst direction
        const offsetAlongAngle = Math.random();
        const startX =
          centerX +
          Math.cos(angle) * spanX * offsetAlongAngle * (0.35 + Math.random() * 0.65) +
          (Math.random() - 0.5) * (spanX * 0.45);
        const startY =
          centerY +
          Math.sin(angle) * spanY * offsetAlongAngle * (0.4 + Math.random() * 0.6) +
          (Math.random() - 0.5) * (spanY * 0.4);

        const speed = 2.4 + Math.random() * 7.8;
        const sizeRoll = Math.random();
        const baseRadius =
          sizeRoll < 0.45
            ? 3.5 + Math.random() * 6
            : sizeRoll < 0.82
            ? 9 + Math.random() * 11
            : 20 + Math.random() * 13;

        const shade =
          MONOCHROME_SHADES[Math.floor(Math.random() * MONOCHROME_SHADES.length)];

        particles.push({
          x: startX,
          y: startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          baseRadius,
          radius: baseRadius * 0.4,
          color: shade,
          alpha: 0,
          maxAlpha: shade === '#000000' ? 0.92 : 0.78 + Math.random() * 0.22,
          age: 0,
          lifetime: 1050 + Math.random() * 650,
          pulseFreq: 0.006 + Math.random() * 0.008,
          pulsePhase: Math.random() * Math.PI * 2,
          driftFreq: 0.003 + Math.random() * 0.005,
          driftAmp: 0.25 + Math.random() * 0.7,
          angle,
        });
      }
    };

    const HOLD_MS = 750;
    const REVEAL_START_MS = 1280;
    const TOTAL_MS = 2320;
    let lastFrame = mountTime;

    const tick = (now: number) => {
      const elapsed = now - mountTime;
      const dtMs = Math.min(now - lastFrame, 40);
      lastFrame = now;
      const dtFactor = dtMs / 16.667;

      if (!burstTriggered && elapsed >= HOLD_MS) {
        burstTriggered = true;
        setTextVisible(false);
        spawnBurstFromText();
      }

      if (elapsed >= REVEAL_START_MS) {
        const revealProgress = Math.min(
          1,
          (elapsed - REVEAL_START_MS) / (TOTAL_MS - REVEAL_START_MS)
        );
        const eased = 1 - Math.pow(1 - revealProgress, 2.2);
        setBackdropOpacity(Math.max(0, 1 - eased));
      }

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      if (burstTriggered) {
        for (const p of particles) {
          p.age += dtMs;
          const progress = Math.min(1, p.age / p.lifetime);
          if (progress >= 1) continue;

          // Radial burst outward with organic air drag + gentle perpendicular floating drift
          const drag = Math.pow(0.976, dtFactor);
          p.vx *= drag;
          p.vy *= drag;

          const perpAngle = p.angle + Math.PI / 2;
          const drift = Math.sin(p.age * p.driftFreq + p.pulsePhase) * p.driftAmp;

          p.x += p.vx * dtFactor + Math.cos(perpAngle) * drift * dtFactor;
          p.y += p.vy * dtFactor + Math.sin(perpAngle) * drift * dtFactor;

          // Organic bubble expansion & subtle contraction breathing
          const growIn = Math.min(1, p.age / 120);
          const breathe = 1 + 0.16 * Math.sin(p.age * p.pulseFreq + p.pulsePhase);
          p.radius = Math.max(0.5, p.baseRadius * (0.45 + 0.65 * growIn) * breathe);

          // Smooth fade in right after burst, smooth dissipation in second half
          const fadeIn = Math.min(1, p.age / 90);
          const fadeOut = progress > 0.42 ? 1 - Math.pow((progress - 0.42) / 0.58, 1.55) : 1;
          p.alpha = Math.max(0, p.maxAlpha * fadeIn * fadeOut);

          if (p.alpha <= 0.01) continue;

          // Solid-filled monochrome circle ONLY (zero stroke / outline, zero color)
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      if (elapsed >= TOTAL_MS) {
        finishOnce();
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [prefersReducedMotion, onComplete]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="welcome-animation-overlay"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden pointer-events-auto select-none"
      style={{
        backgroundColor: `rgba(0, 0, 0, ${backdropOpacity})`,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      <h1
        ref={textRef}
        data-testid="welcome-animation-text"
        className="relative z-10 px-6 max-w-3xl text-center font-bold tracking-tight text-white"
        style={{
          fontSize: 'clamp(1.75rem, 4.2vw, 3.35rem)',
          lineHeight: 1.12,
          textWrap: 'balance',
          opacity: textVisible ? 1 : 0,
          transform: textVisible ? 'scale(1)' : 'scale(1.03)',
          filter: textVisible ? 'blur(0px)' : 'blur(4px)',
          transition: prefersReducedMotion
            ? 'opacity 220ms ease-out'
            : 'opacity 240ms cubic-bezier(0.16, 1, 0.3, 1), transform 260ms cubic-bezier(0.16, 1, 0.3, 1), filter 260ms ease-out',
        }}
      >
        {message}
      </h1>
    </div>
  );
};
