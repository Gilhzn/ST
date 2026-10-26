/**
 * Demo "photos" for the Media Vault: small, deterministic SVG scenes (data URIs, no
 * external images). Each scene is a soft-lit sports moment: dusk pitch, floodlit night
 * game, beach volley, city court, a huddle, a ball on the grass. Never contains text.
 */

export type PhotoScene = 'duskPitch' | 'floodlights' | 'beach' | 'court' | 'huddle' | 'ballMacro';

export const PHOTO_SCENES: readonly PhotoScene[] = ['duskPitch', 'floodlights', 'beach', 'court', 'huddle', 'ballMacro'];

const W = 400;
const H = 300;

/** Small seeded PRNG so the same id always yields the same picture. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const f = (n: number) => Math.round(n * 10) / 10;

/** A running / standing silhouette: head, torso, arms and legs as round-capped strokes. */
function person(x: number, y: number, s: number, color: string, stride: number): string {
  const sw = f(5.2 * s);
  const head = `<circle cx="${f(x)}" cy="${f(y - 46 * s)}" r="${f(7 * s)}" fill="${color}"/>`;
  const body = `<path d="M${f(x)} ${f(y - 38 * s)} L${f(x + 2 * s)} ${f(y - 16 * s)}" stroke="${color}" stroke-width="${f(sw * 1.5)}" stroke-linecap="round"/>`;
  const arms = `<path d="M${f(x - 12 * s * stride)} ${f(y - 22 * s)} L${f(x)} ${f(y - 34 * s)} L${f(x + 13 * s * stride)} ${f(y - 26 * s)}" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  const legs = `<path d="M${f(x - 10 * s * stride)} ${f(y)} L${f(x + 2 * s)} ${f(y - 16 * s)} L${f(x + 12 * s * stride)} ${f(y - 2 * s)}" stroke="${color}" stroke-width="${f(sw * 1.15)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  return head + body + arms + legs;
}

function ball(x: number, y: number, r: number): string {
  return `<g><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#fff"/><path d="M${f(x)} ${f(y - r * 0.45)} l${f(r * 0.42)} ${f(r * 0.3)} l${f(-r * 0.16)} ${f(r * 0.5)} h${f(-r * 0.52)} l${f(-r * 0.16)} ${f(-r * 0.5)}z" fill="#1d1b2e"/></g>`;
}

function vignette(id: string, strength = 0.55): string {
  return `<defs><radialGradient id="v${id}" cx="50%" cy="45%" r="75%"><stop offset="55%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${strength}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#v${id})"/>`;
}

function grassStripes(top: number, colors: [string, string], r: () => number): string {
  let out = '';
  const n = 7;
  for (let i = 0; i < n; i++) {
    const y0 = top + ((H - top) * i * i) / (n * n);
    const y1 = top + ((H - top) * (i + 1) * (i + 1)) / (n * n);
    out += `<rect y="${f(y0)}" width="${W}" height="${f(y1 - y0 + 0.5)}" fill="${colors[i % 2]}" opacity="${f(0.9 + r() * 0.1)}"/>`;
  }
  return out;
}

function duskPitch(id: string, r: () => number): string {
  const hue = r() > 0.5;
  const sky = hue ? ['#2B1A5E', '#B8476A', '#FFB46B'] : ['#14254F', '#7C4DBE', '#FF9E7A'];
  const horizon = 168 + r() * 20;
  const players = [0, 1, 2].map((i) => person(90 + i * 105 + r() * 30, horizon + 70 + r() * 30 + i * 6, 1.1 + r() * 0.5, '#120F24', i % 2 ? -1 : 1)).join('');
  return `<defs><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".6" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient><radialGradient id="g${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFE7B0" stop-opacity=".9"/><stop offset="1" stop-color="#FFE7B0" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s${id})"/><circle cx="${f(250 + r() * 80)}" cy="${f(horizon - 14)}" r="70" fill="url(#g${id})"/><circle cx="${f(270 + r() * 40)}" cy="${f(horizon - 10)}" r="18" fill="#FFE2A8"/>
<path d="M0 ${f(horizon)} Q 80 ${f(horizon - 18)} 160 ${f(horizon - 6)} T 400 ${f(horizon - 10)} V ${H} H0Z" fill="#2A2048" opacity=".85"/>
${grassStripes(horizon + 6, ['#1F5B3A', '#246A43'], r)}
<path d="M40 ${f(horizon + 30)} h70 v-34 h-70z" fill="none" stroke="#F4F1FF" stroke-width="3" opacity=".75"/>${players}${ball(230 + r() * 60, H - 30 - r() * 20, 7)}${vignette(id)}`;
}

function floodlights(id: string, r: () => number): string {
  const horizon = 150 + r() * 16;
  const tower = (x: number) =>
    `<path d="M${x} ${f(horizon + 10)} L${x + 4} 40 L${x + 8} ${f(horizon + 10)}z" fill="#0B0A1C"/><rect x="${x - 14}" y="30" width="36" height="16" rx="3" fill="#F9F7FF"/><path d="M${x - 14} 46 L${x - 120} ${H} H${x + 140} L${x + 22} 46z" fill="url(#c${id})"/>`;
  const players = [0, 1, 2, 3].map((i) => person(70 + i * 85 + r() * 30, horizon + 80 + r() * 40, 0.9 + r() * 0.5, '#0E0C20', i % 2 ? 1 : -1)).join('');
  return `<defs><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070616"/><stop offset="1" stop-color="#221A55"/></linearGradient><linearGradient id="c${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9F0FF" stop-opacity=".55"/><stop offset="1" stop-color="#E9F0FF" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s${id})"/>${[...Array(18)].map(() => `<circle cx="${f(r() * W)}" cy="${f(r() * horizon * 0.8)}" r="${f(0.6 + r())}" fill="#fff" opacity="${f(0.3 + r() * 0.5)}"/>`).join('')}
${grassStripes(horizon, ['#1C6B3F', '#21794A'], r)}${tower(46)}${tower(330)}<ellipse cx="200" cy="${f(horizon + 70)}" rx="170" ry="26" fill="none" stroke="#F4F1FF" stroke-width="2.5" opacity=".55"/>${players}${ball(190 + r() * 40, horizon + 110, 6)}${vignette(id, 0.6)}`;
}

function beach(id: string, r: () => number): string {
  const horizon = 120 + r() * 20;
  const players = [0, 1].map((i) => person(110 + i * 170 + r() * 20, 240 + r() * 20, 1.25, '#3A1F2C', i ? -1 : 1)).join('');
  return `<defs><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BB8E8"/><stop offset="1" stop-color="#CFEFFF"/></linearGradient><linearGradient id="w${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1B86C4"/><stop offset="1" stop-color="#5CC6E0"/></linearGradient><linearGradient id="d${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3D9A4"/><stop offset="1" stop-color="#E2B979"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s${id})"/><circle cx="${f(70 + r() * 60)}" cy="${f(40 + r() * 20)}" r="22" fill="#FFF6D6"/>
<rect y="${f(horizon)}" width="${W}" height="${f(60)}" fill="url(#w${id})"/><path d="M0 ${f(horizon + 52)} Q 120 ${f(horizon + 40)} 240 ${f(horizon + 56)} T 400 ${f(horizon + 48)} V${H} H0z" fill="url(#d${id})"/>
<path d="M200 ${f(horizon + 30)} V 250" stroke="#2A2340" stroke-width="3"/><rect x="40" y="${f(horizon + 30)}" width="320" height="22" fill="none" stroke="#F4F1FF" stroke-width="2"/><path d="M40 ${f(horizon + 41)} H360" stroke="#F4F1FF" stroke-width="1" opacity=".7"/>
${players}<circle cx="${f(170 + r() * 60)}" cy="${f(horizon - 10)}" r="9" fill="#FFD84D"/><path d="M${f(162 + r() * 60)} ${f(horizon - 14)} q8 6 16 0" stroke="#2A6FD6" stroke-width="2.5" fill="none"/>${vignette(id, 0.35)}`;
}

function court(id: string, r: () => number): string {
  const palm = (x: number, s: number) =>
    `<path d="M${x} 210 Q ${x + 6 * s} 140 ${x + 2} ${f(90 + 10 * s)}" stroke="#1A1630" stroke-width="${f(6 * s)}" fill="none" stroke-linecap="round"/>${[0, 1, 2, 3, 4].map((k) => `<path d="M${x + 2} ${f(90 + 10 * s)} q ${f((k - 2) * 22 * s)} ${f(-14 * s)} ${f((k - 2) * 42 * s)} ${f(14 * s)}" stroke="#1A1630" stroke-width="${f(5 * s)}" fill="none" stroke-linecap="round"/>`).join('')}`;
  return `<defs><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A5B"/><stop offset=".7" stop-color="#FFC27A"/><stop offset="1" stop-color="#FFE3A1"/></linearGradient><linearGradient id="k${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C2501F"/><stop offset="1" stop-color="#8E3414"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s${id})"/>${palm(50 + r() * 20, 1)}${palm(330 + r() * 30, 0.8)}
<path d="M0 205 H400 V300 H0z" fill="url(#k${id})"/><path d="M60 300 L130 205 M340 300 L270 205 M0 250 H400" stroke="#FCE9DE" stroke-width="3" opacity=".8"/><path d="M150 300 Q200 240 250 300" stroke="#FCE9DE" stroke-width="3" fill="none" opacity=".8"/>
<rect x="190" y="110" width="44" height="30" rx="2" fill="#F8F6FF" opacity=".95"/><path d="M212 140 V205" stroke="#1A1630" stroke-width="5"/><ellipse cx="212" cy="146" rx="12" ry="3" fill="none" stroke="#E25822" stroke-width="2.5"/>
${person(150 + r() * 30, 268, 1.35, '#1A1630', 1)}${person(270 + r() * 20, 262, 1.25, '#1A1630', -1)}<circle cx="${f(220 + r() * 30)}" cy="${f(120 + r() * 20)}" r="8" fill="#E8692E" stroke="#3A1608" stroke-width="1.5"/>${vignette(id, 0.4)}`;
}

function huddle(id: string, r: () => number): string {
  const tone = ['#5B3DF5', '#00A846', '#FF5E1A', '#0B9FD0'][Math.floor(r() * 4)] ?? '#5B3DF5';
  const bokeh = [...Array(14)].map(() => `<circle cx="${f(r() * W)}" cy="${f(r() * 160)}" r="${f(8 + r() * 26)}" fill="#FFF" opacity="${f(0.05 + r() * 0.12)}"/>`).join('');
  // Players seen from behind, arms over each other's shoulders: jerseys, collars, back stripes.
  const xs = [52, 128, 204, 280, 356].map((x) => x + (r() - 0.5) * 8);
  const figures = xs
    .map((x, i) => {
      const top = 196 + Math.abs(i - 2) * 6;
      const hair = ['#1B1424', '#3A2416', '#0F0D18', '#5A3A1E', '#211A2E'][i] ?? '#1B1424';
      return `<path d="M${f(x - 46)} 300 V${f(top + 24)} Q${f(x - 44)} ${f(top)} ${f(x - 18)} ${f(top - 4)} H${f(x + 18)} Q${f(x + 44)} ${f(top)} ${f(x + 46)} ${f(top + 24)} V300z" fill="url(#j${id})"/><path d="M${f(x - 5)} ${f(top + 2)} V300 M${f(x + 5)} ${f(top + 2)} V300" stroke="#FFFFFF" stroke-width="3" opacity=".55"/><path d="M${f(x - 12)} ${f(top - 3)} q12 9 24 0" stroke="#FFFFFF" stroke-width="3" fill="none" opacity=".8"/><rect x="${f(x - 8)}" y="${f(top - 22)}" width="16" height="20" rx="6" fill="#C98D6B"/><circle cx="${f(x)}" cy="${f(top - 34)}" r="21" fill="${hair}"/>`;
    })
    .join('');
  const arms = xs
    .slice(0, -1)
    .map((x, i) => `<path d="M${f(x + 6)} ${f(208 + Math.abs(i - 2) * 6)} Q${f(x + 38)} ${f(188)} ${f((xs[i + 1] ?? x) - 6)} ${f(208 + Math.abs(i - 1.5) * 6)}" stroke="#C98D6B" stroke-width="11" stroke-linecap="round" fill="none"/>`)
    .join('');
  return `<defs><linearGradient id="s${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A1440"/><stop offset=".55" stop-color="#3B2E8C"/><stop offset="1" stop-color="#FF9E7A"/></linearGradient><linearGradient id="j${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}"/><stop offset="1" stop-color="#14112A"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s${id})"/>${bokeh}${figures}${arms}${vignette(id, 0.45)}`;
}

function ballMacro(id: string, r: () => number): string {
  const blades = [...Array(70)]
    .map(() => {
      const x = r() * W;
      const h = 30 + r() * 60;
      return `<path d="M${f(x)} ${H} q ${f((r() - 0.5) * 14)} ${f(-h / 2)} ${f((r() - 0.5) * 20)} ${f(-h)}" stroke="${r() > 0.5 ? '#2E8B4E' : '#3FA35F'}" stroke-width="${f(2 + r() * 2)}" fill="none" stroke-linecap="round"/>`;
    })
    .join('');
  const bokeh = [...Array(12)].map(() => `<circle cx="${f(r() * W)}" cy="${f(r() * 150)}" r="${f(10 + r() * 30)}" fill="#FFF3C4" opacity="${f(0.08 + r() * 0.18)}"/>`).join('');
  return `<defs><linearGradient id="s${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16391F"/><stop offset=".6" stop-color="#2D6B3A"/><stop offset="1" stop-color="#1E4D2A"/></linearGradient><radialGradient id="b${id}" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9C8D8"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#s${id})"/>${bokeh}<ellipse cx="205" cy="262" rx="78" ry="12" fill="#0B1F10" opacity=".55"/>
<circle cx="200" cy="196" r="70" fill="url(#b${id})"/><path d="M200 160 l34 24 -13 40 h-42 l-13 -40z" fill="#1D1B2E"/><path d="M200 160 V126 M234 184 L266 172 M221 224 L240 254 M179 224 L160 254 M166 184 L134 172" stroke="#1D1B2E" stroke-width="5"/>${blades}${vignette(id, 0.5)}`;
}

const SCENES: Record<PhotoScene, (id: string, r: () => number) => string> = { duskPitch, floodlights, beach, court, huddle, ballMacro };

/** The SVG markup of a demo photo. */
export function photoSvg(key: string, scene: PhotoScene): string {
  const seed = hash(key);
  const id = seed.toString(36).slice(0, 6);
  const body = SCENES[scene](id, rng(seed)).replace(/\n/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
}

/** `data:image/svg+xml` URI of a demo photo (rendered with `SvgXml` on every platform). */
export function photoDataUri(key: string, scene: PhotoScene): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(photoSvg(key, scene))}`;
}

/** A scene that suits a sport (decks of 2–3 for variety). */
export function scenesFor(sport: string): PhotoScene[] {
  switch (sport) {
    case 'volleyball':
      return ['beach', 'huddle', 'beach'];
    case 'basketball':
      return ['court', 'huddle', 'court'];
    case 'running':
      return ['duskPitch', 'huddle'];
    default:
      return ['duskPitch', 'floodlights', 'ballMacro', 'huddle'];
  }
}
