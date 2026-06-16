/**
 * agent-sigil.ts — Deterministic hex-grid sigil generator
 *
 * Generates a unique SVG sigil from an agent ID hash.
 * No external deps — pure math, pure SVG.
 * Embeds in Arweave HTML payload as the "face" of the agent TX.
 */

/** FNV-1a 32-bit → expand to 32 bytes via LCG */
function agentHashBytes(agentId: string): Uint8Array {
  let h = 0x811c9dc5;
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const bytes = new Uint8Array(32);
  let seed = h;
  for (let i = 0; i < 32; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes[i] = seed & 0xff;
  }
  return bytes;
}

export function buildAgentSigil(agentId: string, size = 220): string {
  const b = agentHashBytes(agentId);

  // Color palette from first 3 bytes
  const hue  = Math.round(b[0] * (360 / 255));
  const sat  = 55 + Math.round(b[1] * (20 / 255));
  const lit  = 50 + Math.round(b[2] * (15 / 255));
  const hsl     = `hsl(${hue},${sat}%,${lit}%)`;
  const hslDim  = `hsl(${hue},${sat}%,${Math.round(lit * 0.35)}%)`;
  const hslGlow = `hsl(${hue},${sat}%,${Math.round(lit * 0.12)}%)`;
  const uid = agentId.replace(/[^a-z0-9]/gi, '').slice(0, 8);

  // 8x8 hex grid — 64 bits from bytes 4–11
  const cols = 8, rows = 8;
  const hexR  = Math.round(size * 0.05);
  const hexW  = hexR * Math.sqrt(3);
  const hexH  = hexR * 2;
  const gridW = cols * hexW + hexW / 2;
  const gridH = rows * hexH * 0.75 + hexH * 0.25;
  const offX  = (size - gridW) / 2 + hexW / 2;
  const offY  = (size - gridH) / 2 + hexH / 2;

  const hexPts = (cx: number, cy: number): string =>
    Array.from({ length: 6 }, (_, a) => {
      const ang = (Math.PI / 180) * (60 * a - 30);
      return `${(cx + hexR * Math.cos(ang)).toFixed(1)},${(cy + hexR * Math.sin(ang)).toFixed(1)}`;
    }).join(' ');

  const filled: { x: number; y: number }[] = [];
  let hexes = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const bitIdx  = row * cols + col;
      const bit     = (b[4 + Math.floor(bitIdx / 8)] >> (bitIdx % 8)) & 1;
      const x = offX + col * hexW + (row % 2 === 1 ? hexW / 2 : 0);
      const y = offY + row * hexH * 0.75;
      if (bit) filled.push({ x, y });
      const fill    = bit ? hsl : hslDim;
      const opacity = bit ? '0.82' : '0.10';
      hexes += `<polygon points="${hexPts(x, y)}" fill="${fill}" opacity="${opacity}" stroke="${hslDim}" stroke-width="0.4"/>`;
    }
  }

  // Circuit traces — 3 dashed lines between filled cells (bytes 12–17)
  let traces = '';
  for (let t = 0; t < 3 && filled.length >= 2; t++) {
    const i1 = b[12 + t * 2] % filled.length;
    const i2 = b[13 + t * 2] % filled.length;
    if (i1 !== i2) {
      const p1 = filled[i1], p2 = filled[i2];
      traces += `<line x1="${p1.x.toFixed(1)}" y1="${p1.y.toFixed(1)}" x2="${p2.x.toFixed(1)}" y2="${p2.y.toFixed(1)}" stroke="${hsl}" stroke-width="1.2" opacity="0.45" stroke-dasharray="3,2"/>`;
    }
  }

  // Center seal glyph
  const cx = size / 2, cy = size / 2;
  const center = [
    `<circle cx="${cx}" cy="${cy}" r="${size * 0.025}" fill="${hsl}" opacity="0.95"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${size * 0.045}" fill="none" stroke="${hsl}" stroke-width="1" opacity="0.4"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${size * 0.068}" fill="none" stroke="${hsl}" stroke-width="0.5" opacity="0.2"/>`,
  ].join('');

  // Outer rings
  const rings = [
    `<circle cx="${cx}" cy="${cy}" r="${size / 2 - 4}" fill="none" stroke="${hsl}" stroke-width="0.8" opacity="0.18"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${size / 2 - 9}" fill="none" stroke="${hsl}" stroke-width="0.4" stroke-dasharray="4,10" opacity="0.25"/>`,
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg_${uid}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${hslGlow}"/>
      <stop offset="100%" stop-color="#080810"/>
    </radialGradient>
    <filter id="glow_${uid}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" rx="10" fill="url(#bg_${uid})"/>
  ${rings}
  <g filter="url(#glow_${uid})">
    ${hexes}
    ${traces}
    ${center}
  </g>
</svg>`;
}
