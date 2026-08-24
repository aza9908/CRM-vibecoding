import type { Metadata } from 'next';
import { Montserrat } from 'next/font/google';
import { setRequestLocale } from 'next-intl/server';
import { KahootGame } from '@/components/kahoot/kahoot-game';

/**
 * Kahoot sets everything in Montserrat, and the heavy weights are a large part
 * of why the game reads the way it does. Loaded here rather than in the root
 * layout so the rest of the app keeps its own type.
 */
const montserrat = Montserrat({
  subsets: ['latin', 'cyrillic'],
  weight: ['700', '800', '900'],
  variable: '--font-quiz',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Викторина по Дню 1 — Вайб-кодинг с Claude',
  description:
    'Живая викторина по материалам первого дня воркшопа: 7 вопросов, счёт за скорость, таблица лидеров и подиум.',
};

export default async function KahootPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className={montserrat.variable}>
      <KahootGame />
    </div>
  );
}
