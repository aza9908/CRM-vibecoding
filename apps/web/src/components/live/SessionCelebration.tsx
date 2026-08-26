'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { PartyPopper } from 'lucide-react';

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity: number;
};

const COLORS = [
  '#FF4D6D',
  '#FFD166',
  '#06D6A0',
  '#4CC9F0',
  '#F72585',
  '#B5179E',
  '#FFE66D',
  '#FFFFFF',
];

/**
 * Full-screen congrats + fireworks shown to every student when the teacher ends the lesson.
 */
export function SessionCelebration({ homeHref = '/' }: { homeHref?: string }) {
  const t = useTranslations('live');
  const tc = useTranslations('common');
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let raf = 0;
    let running = true;
    const particles: Particle[] = [];
    let lastBurst = 0;
    const start = performance.now();
    const BURST_MS = 5200;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const burst = (cx: number, cy: number) => {
      const count = 48 + Math.floor(Math.random() * 28);
      const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const speed = 2.2 + Math.random() * 5.5;
        particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.2,
          life: 0,
          maxLife: 55 + Math.random() * 45,
          color: Math.random() > 0.25 ? color : COLORS[Math.floor(Math.random() * COLORS.length)]!,
          size: 1.6 + Math.random() * 2.4,
          gravity: 0.045 + Math.random() * 0.03,
        });
      }
    };

    const tick = (now: number) => {
      if (!running) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      const elapsed = now - start;
      if (elapsed < BURST_MS && now - lastBurst > 380) {
        lastBurst = now;
        burst(w * (0.15 + Math.random() * 0.7), h * (0.12 + Math.random() * 0.35));
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]!;
        p.life += 1;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.99;
        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        if (alpha <= 0) {
          particles.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (elapsed < BURST_MS + 2200 || particles.length > 0) {
        raf = requestAnimationFrame(tick);
      }
    };

    // Opening volley so the salutes start immediately.
    burst(window.innerWidth * 0.5, window.innerHeight * 0.28);
    burst(window.innerWidth * 0.28, window.innerHeight * 0.22);
    burst(window.innerWidth * 0.72, window.innerHeight * 0.24);
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-[#0b1020] px-4 py-16 text-white">
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,rgba(88,80,180,0.35),transparent_65%)]"
        aria-hidden
      />

      <div className="celebrate-card relative z-10 w-full max-w-lg">
        <div className="rounded-2xl border border-white/15 bg-white/10 px-6 py-10 text-center shadow-2xl backdrop-blur-md sm:px-10">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/40">
            <PartyPopper className="h-7 w-7" aria-hidden />
          </div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-amber-200/90">
            {t('celebrateEyebrow')}
          </p>
          <h1 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t('celebrateTitle')}
          </h1>
          <p className="mt-4 text-pretty text-base leading-relaxed text-white/85 sm:text-lg">
            {t('celebrateBody')}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button
              asChild
              size="lg"
              className="bg-white text-[#0b1020] hover:bg-white/90"
            >
              <Link href={homeHref}>{tc('back')}</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              <Link href="/join">{t('celebrateJoinAgain')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
