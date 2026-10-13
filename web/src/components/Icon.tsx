/**
 * Inline stroke icon set (original artwork, 24x24 grid) ported from the
 * liquid-glass prototype's icon paths. No external icon library, no emoji.
 */
export type IconName =
  | "home"
  | "map"
  | "users"
  | "backpack"
  | "smartphone"
  | "bell"
  | "settings"
  | "play"
  | "shirt"
  | "briefcase"
  | "heart-pulse"
  | "zap"
  | "smile"
  | "map-pin"
  | "wallet"
  | "building"
  | "waves"
  | "shopping-bag"
  | "calendar"
  | "messages"
  | "house"
  | "shield-check"
  | "laptop"
  | "store"
  | "eye"
  | "scissors"
  | "user"
  | "monitor"
  | "check"
  | "chevron-right"
  | "sparkles"
  | "utensils"
  | "droplet"
  | "help"
  | "share"
  | "music"
  | "volume"
  | "moon";

const PATHS: Record<IconName, React.JSX.Element> = {
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" />
      <path d="M9 3v15m6-12v15" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="10" cy="7" r="4" />
      <path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  backpack: (
    <>
      <path d="M5 8h14v13H5z" />
      <path d="M9 8V5a3 3 0 0 1 6 0v3M5 13h14M9 13v3h6v-3" />
    </>
  ),
  smartphone: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2z" />
    </>
  ),
  play: <path d="m8 5 11 7-11 7z" />,
  shirt: <path d="m8 4 4 2 4-2 5 4-3 4-2-1v10H8V11l-2 1-3-4z" />,
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2" />
    </>
  ),
  "heart-pulse": (
    <>
      <path d="M20.8 8.7c0 5.2-8.8 11-8.8 11s-8.8-5.8-8.8-11A4.7 4.7 0 0 1 12 6.1a4.7 4.7 0 0 1 8.8 2.6z" />
      <path d="M3.5 12h4l2-3 3 6 2-3h6" />
    </>
  ),
  zap: <path d="m13 2-3 8H5l6 12 3-9h5z" />,
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M3 8h16a2 2 0 0 1 2 2v3h-5a2 2 0 0 1 0-4h5M16 11h.01" />
    </>
  ),
  building: (
    <path d="M3 21h18M5 21V4h9v17M14 9h5v12M8 8h3m-3 4h3m-3 4h3m6-3h1m-1 4h1" />
  ),
  waves: (
    <path d="M2 6c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 12c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 18c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2" />
  ),
  "shopping-bag": (
    <>
      <path d="M5 8h14l1 13H4zM9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M8 14h2m4 0h2m-8 3h2" />
    </>
  ),
  messages: (
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />
  ),
  house: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />,
  "shield-check": (
    <>
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="4" width="16" height="12" rx="1" />
      <path d="M2 20h20l-2-4H4z" />
    </>
  ),
  store: (
    <>
      <path d="M3 10h18l-2-7H5zM5 10v11h14V10M9 21v-6h6v6" />
      <path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="m8.1 8.1 12 12M14.8 9.2 20 4M8.1 15.9 12 12" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a8 8 0 0 1 16 0v1" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  check: <path d="m4 12.5 5 5L20 6.5" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  utensils: (
    <>
      <path d="M6 2v8M4 2v4a2 2 0 0 0 4 0V2M6 10v12" />
      <path d="M18 2c-2.5 0-4 5-4 9v5h4v6M18 2v6" />
    </>
  ),
  droplet: <path d="M12 2s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8M12 17h.01" />
    </>
  ),
  share: (
    <>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 12v9h14v-9" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6l10-2v11" />
      <circle cx="7" cy="18" r="2.5" />
      <circle cx="17" cy="15" r="2.5" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16 9a4 4 0 0 1 0 6" />
    </>
  ),
  moon: <path d="M20 13A8 8 0 1 1 11 4a6.5 6.5 0 0 0 9 9z" />,
  sparkles: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.9 2.9M15.5 15.5l2.9 2.9M5.6 18.4l2.9-2.9M15.5 8.5l2.9-2.9" />
    </>
  ),
};

export function Icon({
  name,
  className,
  size = 20,
}: {
  name: IconName;
  className?: string;
  size?: number;
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name] ?? PATHS.home}
    </svg>
  );
}
