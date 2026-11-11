import { useEffect, useRef } from 'react';
import { imageUrl } from '../lib/api';
import { LEVEL_LABEL, MARKER_LABEL, mapLevels, type Level } from '../lib/constants';
import type { Board, Marker } from '../lib/types';

// Upper/lower switch, shown only for maps that have more than one level.
export function LevelSwitch({ map, level, onChange, board }: { map: string; level: Level; onChange: (l: Level) => void; board?: Board }) {
  const levels = mapLevels(map);
  if (levels.length < 2) return null;
  const count = (l: Level) => (board
    ? board.markers.filter((m) => (m.level ?? 'main') === l).length + board.routes.filter((r) => (r.level ?? 'main') === l).length
    : 0);
  return (
    <div className="segmented level-switch" role="group" aria-label="Map level">
      {levels.map((l) => (
        <button key={l} type="button" className={level === l ? 'on' : ''} aria-pressed={level === l} onClick={() => onChange(l)}>
          {LEVEL_LABEL[l]}{board ? <span className="count">{count(l)}</span> : null}
        </button>
      ))}
    </div>
  );
}

// Level to show first: the one holding the viewer's own items, else the
// one with the most items, else main.
export function preferredLevel(map: string, board: Board, userId?: number | null): Level {
  const levels = mapLevels(map);
  if (levels.length < 2) return 'main';
  const items = [...board.markers, ...board.routes];
  const mine = items.filter((i) => userId != null && i.user_id === userId);
  const pool = mine.length ? mine : items;
  const lower = pool.filter((i) => i.level === 'lower').length;
  return lower > pool.length - lower ? 'lower' : 'main';
}

export const lineupMarkers = (board: Board, userId?: number | null) =>
  board.markers.filter((m) => m.images?.length && (userId === undefined || m.user_id === userId));

export function markerTitle(m: Marker) {
  return `${MARKER_LABEL[m.kind]}${m.label ? ` · ${m.label}` : ''}`;
}

// Large lineup screenshots for a set of markers.
export function LineupGallery({ markers, onOpen, large = false }: { markers: Marker[]; onOpen: (m: Marker, index: number) => void; large?: boolean }) {
  if (!markers.length) return null;
  return (
    <div className={`lineups ${large ? 'large' : ''}`}>
      {markers.map((m) => (
        <figure key={m.id} className="lineup">
          <figcaption><strong>{markerTitle(m)}</strong>{m.level === 'lower' ? <span className="muted"> · lower</span> : null}</figcaption>
          <div className="lineup-images">
            {(m.images ?? []).map((img, i) => (
              <button key={img.image_id} type="button" className="lineup-thumb" onClick={() => onOpen(m, i)}
                aria-label={`Open lineup screenshot ${i + 1} for ${markerTitle(m)}`}>
                <img src={imageUrl(img.image_id)} alt={img.caption || `${markerTitle(m)} lineup ${i + 1}`} loading="lazy" />
                {img.caption ? <span>{img.caption}</span> : null}
              </button>
            ))}
          </div>
        </figure>
      ))}
    </div>
  );
}

// Full-screen viewer for one marker's screenshots.
export function LineupLightbox({ marker, index, onIndex, onClose }: {
  marker: Marker | null; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const images = marker?.images ?? [];
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (marker && !dialog.open) dialog.showModal();
    if (!marker && dialog.open) dialog.close();
  }, [marker]);
  useEffect(() => {
    if (!marker) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') { e.stopPropagation(); onIndex(Math.min(images.length - 1, index + 1)); }
      if (e.key === 'ArrowLeft') { e.stopPropagation(); onIndex(Math.max(0, index - 1)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [marker, index, images.length, onIndex]);
  const img = images[index];
  return (
    <dialog ref={ref} className="lightbox" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {marker && img ? (
        <div className="lightbox-body">
          <div className="row space">
            <strong>{markerTitle(marker)}{images.length > 1 ? ` (${index + 1}/${images.length})` : ''}</strong>
            <button type="button" className="btn small" onClick={onClose} autoFocus>Close</button>
          </div>
          <img src={imageUrl(img.image_id)} alt={img.caption || markerTitle(marker)} />
          {img.caption ? <p className="lightbox-caption">{img.caption}</p> : null}
          {images.length > 1 ? (
            <div className="row">
              <button type="button" className="btn small" disabled={index === 0} onClick={() => onIndex(index - 1)}>Previous</button>
              <button type="button" className="btn small" disabled={index === images.length - 1} onClick={() => onIndex(index + 1)}>Next</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
