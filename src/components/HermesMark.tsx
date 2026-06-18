// HermesCo - the Messenger Seal. An original, authored geometric mark, not
// clip-art. It synthesises the three sponsors into one identity:
//   • Nous Research - ultramarine, a radiating engraving of seed ticks, and a
//     single "messenger node" (the seed/output motif from their generative art).
//   • Stripe - geometric precision and a refined ultramarine→bronze gradient.
//   • NVIDIA - angular, technical wing-strokes that read as forward/ascent.
// Bronze is kept as the money/value accent. The rising twin wings on a central
// staff are a caduceus reimagined as growth - the messenger that compounds.

interface HermesMarkProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  idPrefix?: string;
}

export default function HermesMark({
  size = 40,
  className,
  style,
  title = "HermesCo",
  idPrefix = "hm",
}: HermesMarkProps) {
  const grad = `${idPrefix}-grad`;
  const ringGrad = `${idPrefix}-ring`;
  // Radiating engraving ticks (Nous seed/sunburst motif), alternating length.
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    const inner = i % 3 === 0 ? 24.5 : 26.6;
    const outer = 28;
    const cx = 32;
    const cy = 32;
    return {
      x1: cx + Math.cos(a) * inner,
      y1: cy + Math.sin(a) * inner,
      x2: cx + Math.cos(a) * outer,
      y2: cy + Math.sin(a) * outer,
      strong: i % 3 === 0,
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id={grad} x1="14" y1="14" x2="50" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6E97FF" />
          <stop offset="0.42" stopColor="#3B57E6" />
          <stop offset="1" stopColor="#C8893E" />
        </linearGradient>
        <linearGradient id={ringGrad} x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F7CFF" />
          <stop offset="1" stopColor="#8E5C24" />
        </linearGradient>
      </defs>

      {/* Seal ring + radiating engraving ticks */}
      <circle cx="32" cy="32" r="29" stroke={`url(#${ringGrad})`} strokeWidth="1.4" opacity="0.9" />
      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="#4F7CFF"
          strokeWidth={t.strong ? 1.3 : 0.7}
          strokeLinecap="round"
          opacity={t.strong ? 0.85 : 0.4}
        />
      ))}

      {/* Central staff (bronze) + messenger node (gradient) */}
      <line x1="32" y1="18" x2="32" y2="47" stroke="#C8893E" strokeWidth="2.4" strokeLinecap="round" />
      <line x1="25.5" y1="47" x2="38.5" y2="47" stroke="#C8893E" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="32" cy="13.6" r="4" fill={`url(#${grad})`} />

      {/* Twin rising wings - caduceus reimagined as ascent (gradient strokes) */}
      <path
        d="M32 30 L15.5 20.5 M32 30 L48.5 20.5"
        stroke={`url(#${grad})`}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M32 36.5 L20.5 30 M32 36.5 L43.5 30"
        stroke={`url(#${grad})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  );
}
