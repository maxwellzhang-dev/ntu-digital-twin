'use client';

import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import type { CampusBuilding } from '@/lib/types';

const euiColor = (eui: number) => (eui < 160 ? '#10B981' : eui <= 200 ? '#F59E0B' : '#EF4444');

interface Props {
  buildings: CampusBuilding[];
  onSelect: (b: CampusBuilding) => void;
}

export default function CampusEnergyChart({ buildings, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const ranked = useMemo(() => {
    // Several OSM ways can share a name (e.g. wings of North Spine); keep one bar per name.
    const byName = new Map<string, CampusBuilding>();
    for (const b of buildings) if (!byName.has(b.name)) byName.set(b.name, b);
    return [...byName.values()].sort((a, b) => a.eui.annualTotal - b.eui.annualTotal);
  }, [buildings]);
  const max = Math.max(1, ...ranked.map((b) => b.eui.annualTotal));
  const shown = ranked
    .map((b, i) => ({ b, rank: i + 1 }))
    .filter(({ b }) => b.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="flex max-h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-slate-100 shadow-2xl backdrop-blur-xl">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <Zap className="h-4 w-4 text-emerald-400" /> Campus Energy Efficiency
        </h2>
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">simulated</span>
      </header>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${ranked.length} buildings…`}
        className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs outline-none placeholder:text-slate-500 focus:border-sky-400/60"
      />
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {shown.map(({ b, rank }) => (
          <li key={b.id}>
            <button onClick={() => onSelect(b)} className="group w-full rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5">
              <div className="mb-0.5 flex items-baseline gap-2 text-[11px]">
                <span className="w-6 font-mono text-slate-500">#{rank}</span>
                <span className="flex-1 truncate group-hover:text-white">{b.name}</span>
                <span className="font-mono text-slate-300">{b.eui.annualTotal}</span>
              </div>
              <div className="ml-8 h-1.5 rounded-full bg-white/5">
                <div className="h-full rounded-full" style={{ width: `${(b.eui.annualTotal / max) * 100}%`, background: euiColor(b.eui.annualTotal) }} />
              </div>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[10px] text-slate-500">EUI in kWh/m²/yr · lower is better · click to fly</p>
    </section>
  );
}
