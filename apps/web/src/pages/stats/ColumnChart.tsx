// Histogramme quotidien d'une métrique (une seule série : pas de légende, le titre la nomme), avec infobulle au survol.
import type { UsageDay } from '@tpassist/shared';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { formatCompact, formatInt, formatUsd, pluralWord } from '../../lib/format';
import { longDay, METRICS, niceStep, shortDay, type Metric } from './metrics';

/** @param days jours avec au moins un appel (les jours vides sont ajoutés à zéro) */
export function ColumnChart({ days, metric }: { days: UsageDay[]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const M = METRICS[metric];
  const values = days.map((d) => M.value(d));
  const step = niceStep(Math.max(...values, 0) / 4);
  const top = Math.max(step, Math.ceil(Math.max(...values, 0) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  // Espacement des dates calculé sur la largeur réelle : ~72 px par étiquette, jamais de chevauchement.
  const axisRef = useRef<HTMLDivElement>(null);
  const [axisW, setAxisW] = useState(640);
  useEffect(() => {
    const el = axisRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAxisW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const slot = axisW / Math.max(1, days.length);
  const labelEvery = Math.max(1, Math.ceil(72 / slot));
  const h = hover !== null ? days[hover] : null;

  return (
    <div>
      <div className="flex gap-2">
        {/* Graduations : discrètes, en texte atténué */}
        <div className="relative h-64 w-16 shrink-0 text-xs text-ink-3 tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / top) * 100}%` }}>
              {M.axis(t)}
            </span>
          ))}
        </div>
        <div className="relative h-64 min-w-0 flex-1" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-line" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end" role="list" aria-label={`${M.label} par jour`}>
            {days.map((d, i) => {
              const v = values[i];
              return (
                <div
                  key={d.day}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${longDay(d.day)} : ${M.format(v)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="flex h-full flex-1 items-end justify-center px-px focus:outline-none"
                >
                  {v > 0 && (
                    <div
                      className={clsx('w-full max-w-6 rounded-t transition-colors', hover === i ? 'bg-blue-600' : 'bg-blue-500')}
                      style={{ height: `${Math.max((v / top) * 100, 1)}%` }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {h && hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-48 -translate-x-1/2 rounded-lg bg-raised px-3 py-2 text-sm shadow-e2"
              style={{ left: `${Math.min(Math.max(((hover + 0.5) / days.length) * 100, 15), 85)}%` }}
              role="status"
            >
              <p className="font-semibold">{M.format(values[hover])}</p>
              <p className="text-ink-3 first-letter:uppercase">{longDay(h.day)}</p>
              <p className="mt-1 text-xs text-ink-3">
                {formatInt(h.calls)} {pluralWord(h.calls, 'appel')} · {formatUsd(h.costUsd)} · {formatCompact(h.inputTokens + h.outputTokens)} jetons
              </p>
            </div>
          )}
        </div>
      </div>
      {/* Étiquettes de dates, espacées pour rester lisibles */}
      <div className="mt-2 flex gap-2 text-xs text-ink-3" aria-hidden>
        <div className="w-16 shrink-0" />
        <div ref={axisRef} className="relative h-4 min-w-0 flex-1">
          {days.map((d, i) => {
            const last = i === days.length - 1;
            // Extrémités ancrées aux bords (jamais de débordement) ; étiquettes intermédiaires centrées, sans chevaucher la dernière.
            const middle = i > 0 && !last && i % labelEvery === 0 && (days.length - 1 - i) * slot >= 88;
            if (i !== 0 && !last && !middle) return null;
            const style = i === 0 ? { left: 0 } : last ? { right: 0 } : { left: `${((i + 0.5) / days.length) * 100}%` };
            return (
              <span key={d.day} className={clsx('absolute whitespace-nowrap', middle && '-translate-x-1/2')} style={style}>
                {last ? 'Aujourd’hui' : shortDay(d.day)}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
