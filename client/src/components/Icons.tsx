// Small original line icons (24x24) used in navigation and toolbars.
const paths: Record<string, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 3-5 6-5s6 2 6 5M14 15.5c.6-.3 1.3-.5 2-.5 3 0 6 2 6 5',
  tactics: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  game: 'M6 8h12a4 4 0 0 1 4 4v2a4 4 0 0 1-7 2.6L13.5 15h-3L9 16.6A4 4 0 0 1 2 14v-2a4 4 0 0 1 4-4zM7 11v3M5.5 12.5h3M16 12h.01M18 14h.01',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  select: 'M5 3l13 8-6 1.5L9 19z',
  route: 'M4 19c4 0 3-6 8-6s4-8 8-8M4 19h.01M20 5h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5 9-10',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  stop: 'M6 6h12v12H6z',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.4V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  // Role icons
  role_igl: 'M4 10v4h3l6 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  role_entry: 'M5 12h11M12 6l6 6-6 6',
  role_support: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM12 9v6M9 12h6',
  role_lurker: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  role_awper: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 1v6M12 17v6M1 12h6M17 12h6M12 11v2',
  role_anchor: 'M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 7v14M5 13a7 7 0 0 0 14 0M8 11h8',
  role_rifler: 'M3 12h14l3-2v4l-3-2M7 12v4M11 12l1 3',
};

export function Icon({ name, size = 18, title }: { name: keyof typeof paths | string; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={paths[name] ?? ''} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width={40} height={40} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#2b2b2b" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="#f5a524" strokeWidth="2.5" />
      <path d="M16 3v8M16 21v8M3 16h8M21 16h8" stroke="#eee" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
