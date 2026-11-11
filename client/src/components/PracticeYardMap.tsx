// "Practice Yard": an original schematic map drawn for CS-Trainer (not a
// reproduction of any official map). Drawn in a 1000x1000 space; board
// annotations are stored as 0..1 fractions of that space.
const FLOOR = '#4a525c';
const EDGE = '#2a2f36';

const floors: [number, number, number, number][] = [
  [380, 840, 240, 120], // T spawn
  [460, 600, 80, 240], // T ramp
  [420, 380, 160, 220], // mid
  [470, 150, 60, 230], // CT to mid
  [400, 40, 200, 110], // CT spawn
  [600, 80, 60, 80], // CT to A
  [620, 860, 100, 60], // T to A long
  [700, 300, 80, 620], // A long
  [640, 120, 260, 180], // A site
  [580, 440, 120, 60], // connector
  [280, 860, 100, 60], // T to B tunnels
  [220, 380, 80, 540], // B tunnels
  [100, 150, 260, 230], // B site
  [340, 80, 60, 120], // CT to B
  [300, 470, 120, 50], // window
];

const zones: { x: number; y: number; w: number; h: number; color: string }[] = [
  { x: 390, y: 850, w: 220, h: 100, color: '#4cc38a' },
  { x: 410, y: 50, w: 180, h: 90, color: '#5b9cf5' },
  { x: 700, y: 150, w: 160, h: 120, color: '#e8833a' },
  { x: 130, y: 190, w: 190, h: 150, color: '#e8833a' },
];

const labels: [string, number, number][] = [
  ['T SPAWN', 500, 935],
  ['CT SPAWN', 500, 125],
  ['MID', 500, 495],
  ['A LONG', 740, 640],
  ['B TUNNELS', 260, 660],
  ['CONNECTOR', 640, 475],
  ['WINDOW', 360, 500],
];

const COLS = 'ABCDEFGHIJKLMNOP';

export function PracticeYardMap() {
  return (
    <g aria-hidden="true">
      <rect width="1000" height="1000" fill="#0d0e10" />
      <g stroke="#1d2126" strokeWidth="1">
        {Array.from({ length: 17 }, (_, i) => (
          <g key={i}>
            <line x1={i * 62.5} y1="0" x2={i * 62.5} y2="1000" />
            <line x1="0" y1={i * 62.5} x2="1000" y2={i * 62.5} />
          </g>
        ))}
      </g>
      <g fill="#3a414a" fontSize="14" fontFamily="system-ui, sans-serif">
        {COLS.split('').map((c, i) => (
          <text key={c} x={i * 62.5 + 26} y="16">{c}</text>
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <text key={i} x="4" y={i * 62.5 + 38}>{i + 1}</text>
        ))}
      </g>
      <g fill={FLOOR} stroke={EDGE} strokeWidth="3">
        {floors.map(([x, y, w, h]) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} />)}
      </g>
      <g fill={FLOOR}>
        {/* Seams so joined areas read as one walkable floor. */}
        {floors.map(([x, y, w, h]) => <rect key={`s${x}-${y}`} x={x + 2} y={y + 2} width={w - 4} height={h - 4} />)}
      </g>
      {zones.map((z) => (
        <rect key={`${z.x}-${z.y}`} x={z.x} y={z.y} width={z.w} height={z.h} fill="none" stroke={z.color} strokeWidth="4" rx="4" opacity="0.85" />
      ))}
      <g fontFamily="system-ui, sans-serif" fontWeight="700" textAnchor="middle" fill="#e8833a" opacity="0.5">
        <text x="780" y="232" fontSize="90">A</text>
        <text x="225" y="300" fontSize="90">B</text>
      </g>
      <g fontFamily="system-ui, sans-serif" fontSize="18" fontWeight="600" textAnchor="middle" fill="#c9d0d8" opacity="0.75" letterSpacing="1">
        {labels.map(([t, x, y]) => <text key={t} x={x} y={y}>{t}</text>)}
      </g>
    </g>
  );
}
