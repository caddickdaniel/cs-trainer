import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

// Searchable single-choice dropdown (ARIA combobox with a listbox popup).
// Typing filters immediately; ↑/↓ move, Enter selects, Escape closes, and
// Tab keeps the current value. An extra value not in the options (a legacy
// free-text entry) is shown as the current choice until replaced.
export function Combobox({ label, options, value, onChange, placeholder = 'Type to search…', allowClear = true, emptyLabel = 'Any' }: {
  label: string; options: string[]; value: string; onChange: (v: string) => void; placeholder?: string; allowClear?: boolean; emptyLabel?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const legacy = value && !options.includes(value) ? value : null;
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    // Options starting with the query come first.
    return q ? [...base.filter((o) => o.toLowerCase().startsWith(q)), ...base.filter((o) => !o.toLowerCase().startsWith(q))] : base;
  }, [options, query]);

  const choose = (v: string) => { onChange(v); setOpen(false); setQuery(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(items.length - 1, open ? a + 1 : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); if (items[active]) choose(items[active]); }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    else if (e.key === 'Home' && open) { setActive(0); }
    else if (e.key === 'End' && open) { setActive(Math.max(0, items.length - 1)); }
  };
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  return (
    <div className="combobox">
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="combobox-field">
        <input id={`${id}-input`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? optionId(active) : undefined}
          value={open ? query : value} placeholder={open ? (value || placeholder) : (value ? '' : placeholder)}
          onFocus={() => { setOpen(true); setQuery(''); setActive(Math.max(0, items.indexOf(value))); }}
          onBlur={() => setTimeout(() => { setOpen(false); setQuery(''); }, 120)}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }} onKeyDown={onKey} autoComplete="off" />
        {allowClear && value ? (
          <button type="button" className="combobox-clear" aria-label={`Clear ${label}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose('')}>×</button>
        ) : null}
      </div>
      {legacy && !open ? <span className="muted small">“{legacy}” was entered before this list existed. Pick an option to replace it.</span> : null}
      {open ? (
        <ul id={listId} ref={listRef} role="listbox" className="combobox-list" aria-label={label}>
          {allowClear && !query ? (
            <li role="option" aria-selected={!value} className="muted" onMouseDown={(e) => { e.preventDefault(); choose(''); }}>{emptyLabel}</li>
          ) : null}
          {items.map((o, i) => (
            <li key={o} id={optionId(i)} role="option" aria-selected={o === value} className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(o); }}>{o}</li>
          ))}
          {!items.length ? <li className="muted" aria-disabled="true">No matches</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
