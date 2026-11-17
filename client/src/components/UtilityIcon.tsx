// A utility / equipment icon from the shared CS2 mapping (lib/cs2Assets):
// the extracted CS2 icon (white) when it's built, otherwise the app's own
// icon (black, shown inverted). Same identifier, same icon everywhere.
import { useState } from 'react';
import { utilityIconSrc, utilityId, utilityLegacySrc, UTILITY_NAME, type UtilityId } from '../lib/cs2Assets';

export function UtilityIcon({ kind, side, variant, size = 18, className = '', label }: {
  kind: string | UtilityId; side?: string | null; variant?: string | null; size?: number; className?: string; label?: string;
}) {
  const id = utilityId(kind, { side, variant });
  const [stage, setStage] = useState<{ id: UtilityId | null; n: number }>({ id, n: 0 });
  const n = stage.id === id ? stage.n : 0;
  const alt = label ?? (id ? UTILITY_NAME[id] : kind);
  const src = n === 0 ? utilityIconSrc(id) : n === 1 ? utilityLegacySrc(id) : null;
  if (!src) return <span className={`util-icon text ${className}`} title={alt}>{alt}</span>;
  return (
    <img className={`util-icon ${n === 0 ? 'cs2' : 'legacy'} ${className}`} src={src} alt={alt} title={alt} height={size}
      style={{ height: size, width: 'auto', maxWidth: size * 1.6 }} draggable={false} onError={() => setStage({ id, n: n + 1 })} />
  );
}

// For SVG boards: which image to draw (the CS2 icon goes on a dark disc, the
// legacy one on a light disc) and a fallback when the CS2 file is missing.
export function useUtilityGlyph(kind: string, side?: string | null, variant?: string | null) {
  const id = utilityId(kind, { side, variant });
  const [failed, setFailed] = useState<string | null>(null);
  const cs2 = utilityIconSrc(id);
  const useCs2 = Boolean(cs2) && failed !== cs2;
  const href = useCs2 ? cs2 : utilityLegacySrc(id);
  return { href, dark: useCs2, onError: () => setFailed(cs2) } as const;
}
