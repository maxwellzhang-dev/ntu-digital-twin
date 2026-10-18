'use client';

import { Box, Building2, Bus, CloudFog, Satellite, Waves, Zap } from 'lucide-react';
import { PHOTOREAL_AVAILABLE, type LayerVisibility } from '@/components/MapCanvas';

const ITEMS: { key: keyof LayerVisibility; label: string; Icon: typeof Bus }[] = [
  { key: 'photoreal', label: 'Real 3D', Icon: Box },
  { key: 'satellite', label: 'Satellite', Icon: Satellite },
  { key: 'buildings', label: 'Buildings', Icon: Building2 },
  { key: 'transit', label: 'Transit', Icon: Bus },
  { key: 'facilities', label: 'Facilities', Icon: Waves },
  { key: 'haze', label: 'Haze', Icon: CloudFog },
  { key: 'energy', label: 'Energy', Icon: Zap },
];

export default function LayerToggles({ layers, onChange }: { layers: LayerVisibility; onChange: (l: LayerVisibility) => void }) {
  return (
    <div className="flex gap-1 rounded-full border border-white/10 bg-slate-950/75 p-1 backdrop-blur-xl">
      {ITEMS.map(({ key, label, Icon }) => {
        // In Real 3D, Google's mesh replaces our buildings, so that toggle has no effect there.
        const disabled = (key === 'photoreal' && !PHOTOREAL_AVAILABLE) || (key === 'buildings' && layers.photoreal);
        return (
          <button
            key={key}
            disabled={disabled}
            title={
              key === 'photoreal' && !PHOTOREAL_AVAILABLE
                ? 'Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local to enable Google Photorealistic 3D Tiles'
                : disabled
                  ? 'Real 3D shows Google’s buildings instead of ours'
                  : undefined
            }
            onClick={() => onChange({ ...layers, [key]: !layers[key] })}
            aria-pressed={layers[key]}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${layers[key] ? 'bg-sky-500/20 text-sky-200' : 'text-slate-400 hover:text-slate-200'}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        );
      })}
    </div>
  );
}
