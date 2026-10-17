'use client';

import { CloudFog, CloudLightning, CloudRain, Waves } from 'lucide-react';
import type { EnvironmentState } from '@/lib/types';

const STATUS = {
  open: { label: 'Open', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  closed: { label: 'Closed', dot: 'bg-red-500', text: 'text-red-400' },
  unknown: { label: 'Unknown', dot: 'bg-slate-500', text: 'text-slate-400' },
} as const;

interface Props {
  environment: EnvironmentState | null;
  onFacilityClick: (lng: number, lat: number) => void;
}

export default function EnvironmentPanel({ environment: env, onFacilityClick }: Props) {
  if (!env) {
    return <section className="rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-xs text-slate-400 backdrop-blur-xl">Loading air quality…</section>;
  }

  const strikesNear = env.lightningTotal;
  // One row per named pool/hall; outdoor courts are summarised.
  const pools = env.facilities.filter((f) => f.kind === 'pool' && f.name !== 'Swimming pool');
  const outdoor = env.facilities.filter((f) => f.kind === 'outdoor');
  const outdoorClosed = outdoor.filter((f) => f.status === 'closed').length;
  const unknown = env.facilities.some((f) => f.status === 'unknown');

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-slate-100 shadow-2xl backdrop-blur-xl">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <CloudFog className="h-4 w-4 text-amber-300" /> Air & Weather · West
        </h2>
        <span className="font-mono text-[11px] text-slate-400">{env.stale ? 'NEA · stale' : 'NEA'}</span>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/5 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">24-hr PSI</div>
          <div className="font-mono text-2xl font-semibold" style={{ color: env.band.color }}>
            {env.psi24h ?? '—'}
          </div>
          <div className="text-[11px]" style={{ color: env.band.color }}>
            {env.band.label}
          </div>
        </div>
        <div className="rounded-xl bg-white/5 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">PM2.5 · 1 hr</div>
          <div className="font-mono text-2xl font-semibold">{env.pm25OneHour ?? '—'}</div>
          <div className="text-[11px] text-slate-400">µg/m³</div>
        </div>
      </div>
      <p className="mb-3 text-[11px] leading-snug text-slate-300">{env.band.advice}</p>

      <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs">
        <CloudRain className={`h-4 w-4 ${env.rainMm ? 'text-sky-300' : 'text-slate-500'}`} />
        {env.rainMm === null ? (
          <span className="text-slate-400">Campus rain gauge unavailable</span>
        ) : (
          <span>{env.rainMm > 0 ? `Raining on campus · ${env.rainMm} mm / 5 min` : 'No rain on campus (NEA S44)'}</span>
        )}
      </div>
      <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs">
        <CloudLightning className={`h-4 w-4 ${strikesNear ? 'text-yellow-300' : 'text-slate-500'}`} />
        {env.lightningOk ? (
          <span>{strikesNear ? `${strikesNear} lightning strikes within 30 km, last ${env.rules.lightningWindowMin} min` : `No lightning in last ${env.rules.lightningWindowMin} min`}</span>
        ) : (
          <span className="text-slate-400">Lightning data unavailable</span>
        )}
      </div>

      <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
        <Waves className="h-3.5 w-3.5" /> Facilities · weather status
      </div>
      <ul className="space-y-1">
        {pools.map((f) => (
          <li key={f.id}>
            <button onClick={() => onFacilityClick(f.longitude, f.latitude)} className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-white/5">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS[f.status].dot}`} />
              <span className="flex-1">
                {f.name}
                {f.status === 'closed' && <span className="block text-[10px] text-red-300/90">{f.reasons.join(' · ')}</span>}
              </span>
              <span className={STATUS[f.status].text}>{STATUS[f.status].label}</span>
            </button>
          </li>
        ))}
        <li className="flex items-center gap-2 px-1.5 py-1 text-xs">
          <span className={`h-2 w-2 rounded-full ${outdoorClosed ? STATUS.closed.dot : unknown ? STATUS.unknown.dot : STATUS.open.dot}`} />
          <span className="flex-1">Outdoor courts & tracks ({outdoor.length})</span>
          <span className={outdoorClosed ? STATUS.closed.text : unknown ? STATUS.unknown.text : STATUS.open.text}>
            {outdoorClosed ? `${outdoorClosed} closed` : unknown ? 'Unknown' : 'Open'}
          </span>
        </li>
      </ul>
      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        NTU rules: outdoor &amp; non-air-conditioned facilities close at 24-hr PSI &gt; {env.rules.hazeOutdoorPsi}; stop outdoor play when raining. Lightning uses a reference {env.rules.lightningWindowMin}-min / {env.rules.lightningRadiusKm} km rule (NTU uses its own siren). Lifeguards &amp; SRC notices have the final say.
      </p>
    </section>
  );
}
