export default function PaisajeGanadero({ compacto = false, className = '' }) {
  return (
    <svg
      className={`ranch-landscape ${compacto ? 'ranch-landscape-compact' : ''} ${className}`.trim()}
      viewBox="0 0 640 320"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ranchSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dff2e2" />
          <stop offset="1" stopColor="#f7f2df" />
        </linearGradient>
        <linearGradient id="ranchHill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7fa86e" />
          <stop offset="1" stopColor="#416f4b" />
        </linearGradient>
        <linearGradient id="ranchField" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c4d68a" />
          <stop offset="1" stopColor="#8fa65a" />
        </linearGradient>
        <pattern id="ranchRows" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">
          <path d="M0 0V22" stroke="#fff" strokeOpacity=".2" strokeWidth="4" />
        </pattern>
      </defs>
      <rect width="640" height="320" rx="34" fill="url(#ranchSky)" />
      <circle cx="502" cy="69" r="35" fill="#f2cb69" opacity=".9" />
      <path d="M0 167C94 97 164 126 236 159c90 41 133-51 231-39 65 8 118 39 173 72v128H0Z" fill="url(#ranchHill)" />
      <path d="M0 213c121-46 210-17 302 16 118 42 212-32 338-18v109H0Z" fill="url(#ranchField)" />
      <path d="M0 213c121-46 210-17 302 16 118 42 212-32 338-18v109H0Z" fill="url(#ranchRows)" />
      <g className="ranch-fence" fill="none" stroke="#f4ead0" strokeLinecap="round">
        <path d="M54 231c95-21 174-15 256 10 84 25 166 22 276-11" strokeWidth="5" />
        <path d="M54 251c95-21 174-15 256 10 84 25 166 22 276-11" strokeWidth="3" opacity=".72" />
        {[84, 170, 259, 350, 445, 538].map((x, index) => <path key={x} d={`M${x} ${223 + (index % 2) * 5}v49`} strokeWidth="7" />)}
      </g>
      <g className="ranch-cattle" fill="#173f2d">
        <path d="M235 202c8-17 28-24 56-20l43 6c14 2 23 12 23 25v18h-10l-7-20-5 39h-12l-4-34-44 2-8 32h-12l-2-39-10 20h-10l3-23-13-12 5-7 18 13Z" />
        <path d="M368 224c6-12 20-17 40-14l31 5c10 1 16 8 16 17v13h-8l-5-14-3 28h-9l-3-24-31 1-6 23h-9l-1-28-8 14h-7l3-17-10-8 4-5 12 9Z" opacity=".82" />
      </g>
      <g className="ranch-data-nodes">
        <circle cx="270" cy="181" r="8" fill="#fff" />
        <circle cx="270" cy="181" r="18" fill="none" stroke="#fff" strokeOpacity=".35" />
        <path d="M270 173v-34" stroke="#fff" strokeWidth="2" strokeDasharray="4 5" />
        <circle cx="270" cy="132" r="5" fill="#f2cb69" />
        <circle cx="420" cy="207" r="6" fill="#fff" />
        <circle cx="420" cy="207" r="14" fill="none" stroke="#fff" strokeOpacity=".3" />
      </g>
    </svg>
  );
}
