import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';


// Tactic editor split: tool rail | square board | divider | right-hand pane.
// The board takes the largest square that fits the window height and leaves
// the pane its minimum width; dragging the divider (or arrow keys on it)
// makes the board smaller to give the pane more room. Below the stacking
// breakpoint the columns stack and the divider is hidden.
const STORE = 'cs-trainer.editorBoardSize';
export const SPLIT = { rail: 150, divider: 10, gap: 12, minBoard: 320, minPane: 340, stackBelow: 1101, step: 24 };

export function splitBounds(layoutWidth: number, heightLimit: number) {
  const byWidth = layoutWidth - SPLIT.rail - SPLIT.divider - SPLIT.minPane - SPLIT.gap * 3;
  return { min: SPLIT.minBoard, max: Math.max(SPLIT.minBoard, Math.floor(Math.min(byWidth, heightLimit))) };
}
export const clampSize = (n: number, b: { min: number; max: number }) => Math.round(Math.min(b.max, Math.max(b.min, n)));

function readStored(): number | null {
  try {
    const v = Number(window.localStorage.getItem(STORE));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeStored(v: number | null) {
  try {
    if (v == null) window.localStorage.removeItem(STORE);
    else window.localStorage.setItem(STORE, String(Math.round(v)));
  } catch {
    // Storage unavailable (private mode): the split just isn't remembered.
  }
}

export function useEditorSplit(reserve = 16) {
  // Callback ref: the layout mounts after the tactic has loaded.
  const [el, setLayout] = useState<HTMLDivElement | null>(null);
  const [chosen, setChosen] = useState<number | null>(() => readStored());
  const [bounds, setBounds] = useState({ min: SPLIT.minBoard, max: 720 });
  const [stacked, setStacked] = useState(false);
  const drag = useRef<{ x: number; size: number } | null>(null);

  useLayoutEffect(() => {
    if (!el) return undefined;
    const measure = () => {
      setStacked(window.innerWidth < SPLIT.stackBelow);
      const top = el.getBoundingClientRect().top + window.scrollY;
      setBounds(splitBounds(el.clientWidth, window.innerHeight - top - reserve));
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, [el, reserve]);

  const size = clampSize(chosen ?? bounds.max, bounds);
  const choose = useCallback((v: number | null) => {
    const next = v == null ? null : clampSize(v, bounds);
    // Dragging to the maximum goes back to "fit the window".
    const stored = next != null && next >= bounds.max ? null : next;
    setChosen(stored);
    writeStored(stored);
  }, [bounds]);

  const dividerProps = {
    role: 'separator',
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-label': 'Resize map and side panel',
    'aria-valuemin': bounds.min,
    'aria-valuemax': bounds.max,
    'aria-valuenow': size,
    title: 'Drag to resize. Double-click to fit the map to the window.',
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, size };
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      choose(drag.current.size + (e.clientX - drag.current.x));
    },
    onPointerUp: () => { drag.current = null; },
    onPointerCancel: () => { drag.current = null; },
    onDoubleClick: () => choose(null),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const step = e.shiftKey ? SPLIT.step * 3 : SPLIT.step;
      const next: Record<string, number> = { ArrowLeft: size - step, ArrowRight: size + step, Home: bounds.min, End: bounds.max };
      if (e.key in next) { e.preventDefault(); e.stopPropagation(); choose(next[e.key]); }
    },
  };

  const style = stacked ? undefined : {
    gridTemplateColumns: `${SPLIT.rail}px ${size}px ${SPLIT.divider}px minmax(${SPLIT.minPane}px, 1fr)`,
  };
  return { setLayout, size, stacked, style, dividerProps };
}
