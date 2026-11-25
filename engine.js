// CopyCat LUT engine: camera log -> Rec.709 (CST), reference colour match in Oklab, .cube baking.
// Pure functions only, so it runs in the browser and under node for tests.

// ---------- small linear algebra ----------
const mul3 = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mul3v = (A, v) => A.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function inv3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [[A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
          [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
          [C / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

// ---------- gamuts (all D65) ----------
export const GAMUTS = {
  rec709: [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]],
  rec2020: [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
  sgamut3cine: [[0.766, 0.275], [0.225, 0.800], [0.089, -0.087]],
  sgamut3: [[0.730, 0.280], [0.140, 0.855], [0.100, -0.050]],
  awg3: [[0.6840, 0.3130], [0.2210, 0.8480], [0.0861, -0.1020]],
  awg4: [[0.7347, 0.2653], [0.1424, 0.8576], [0.0991, -0.0308]],
  vgamut: [[0.730, 0.280], [0.165, 0.840], [0.100, -0.030]],
  cinemagamut: [[0.740, 0.270], [0.170, 1.140], [0.080, -0.100]],
  rwg: [[0.780308, 0.304253], [0.121595, 1.493994], [0.095612, -0.084589]],
  bmdwg5: [[0.7177215, 0.3171181], [0.2280410, 0.8615690], [0.1005841, -0.0820452]],
  dgamut: [[0.71, 0.31], [0.21, 0.88], [0.09, -0.08]],
};
const D65 = [0.3127, 0.3290];
function toXYZ(prim) {
  const xyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];
  const [R, G, B] = prim.map(xyz);
  const M = [[R[0], G[0], B[0]], [R[1], G[1], B[1]], [R[2], G[2], B[2]]];
  const S = mul3v(inv3(M), xyz(D65));
  return M.map(r => r.map((v, j) => v * S[j]));
}
export const gamutTo709 = g => mul3(inv3(toXYZ(GAMUTS.rec709)), toXYZ(GAMUTS[g]));

// ---------- log curves: code value (formula domain) -> scene linear, 0.18 = mid grey ----------
// legal: the formula is written on 10-bit code values / 1023, while a decoded frame holds video levels
// stretched to 0..1, so the value goes back through (v*876+64)/1023 first.
const P10 = x => Math.pow(10, x);
const LOGC4 = (() => {
  const a = (2 ** 18 - 16) / 117.45, b = (1023 - 95) / 1023, c = 95 / 1023;
  const s = (7 * Math.LN2 * 2 ** (7 - 14 * c / b)) / (a * b), t = (2 ** (14 * (-c / b) + 6) - 64) / a;
  return { a, b, c, s, t };
})();
export const CURVES = {
  slog3: { legal: true, decode: v => v >= 171.2102946929 / 1023 ? P10((v * 1023 - 420) / 261.5) * 0.19 - 0.01 : (v * 1023 - 95) * 0.01125 / (171.2102946929 - 95) },
  logc3: { legal: true, decode: v => v > 5.367655 * 0.010591 + 0.092809 ? (P10((v - 0.385537) / 0.247190) - 0.052272) / 5.555556 : (v - 0.092809) / 5.367655 },
  logc4: { legal: true, decode: v => { const k = LOGC4; return v >= 0 ? (2 ** (14 * (v - k.c) / k.b + 6) - 64) / k.a : v * k.s + k.t; } },
  vlog: { legal: true, decode: v => v < 0.181 ? (v - 0.125) / 5.6 : P10((v - 0.598206) / 0.241514) - 0.00873 },
  clog2: { legal: true, decode: v => 0.9 * (v < 0.092864125 ? -(P10((0.035388128 - v) / 0.281863093) - 1) / 87.09937546 : (P10((v - 0.035388128) / 0.281863093) - 1) / 87.09937546) },
  clog3: { legal: true, decode: v => 0.9 * (v < 0.097465473 ? -(P10((0.12783901 - v) / 0.36726845) - 1) / 14.98325 : v <= 0.15277891 ? (v - 0.12512219) / 1.9754798 : (P10((v - 0.12240537) / 0.36726845) - 1) / 14.98325) },
  flog: { legal: true, decode: v => v < 0.100537775223865 ? (v - 0.092864) / 8.735631 : P10((v - 0.790453) / 0.344676) / 0.555556 - 0.009468 / 0.555556 },
  flog2: { legal: true, decode: v => v < 0.100686685370811 ? (v - 0.092864) / 8.799461 : P10((v - 0.384316) / 0.245281) / 5.555556 - 0.064829 / 5.555556 },
  nlog: { legal: true, decode: v => v < 452 / 1023 ? Math.pow(Math.max(v, 0) / (650 / 1023), 3) - 0.0075 : Math.exp((v - 619 / 1023) / (150 / 1023)) },
  applelog: { legal: false, decode: v => { const R0 = -0.05641088, c = 47.28711236, b = 0.00964052, g = 0.08550479, be = 0.69336945; const Pt = c * (0.01 - R0) ** 2; return v >= Pt ? 2 ** ((v - be) / g) - b : v >= 0 ? Math.sqrt(v / c) + R0 : R0; } },
  bmdfilm5: { legal: false, decode: v => v < 8.283605932402494 * 0.005 + 0.09246575342465753 ? (v - 0.09246575342465753) / 8.283605932402494 : Math.exp((v - 0.5300133392291939) / 0.08692876065491224) - 0.005494072432257808 },
  dlog: { legal: false, decode: v => v <= 0.14 ? (v - 0.0929) / 6.025 : (P10(3.89616 * v - 2.27752) - 0.0108) / 0.9892 },
  log3g10: { legal: false, decode: v => v < 0 ? v / 15.1927 - 0.01 : (P10(v / 0.224282) - 1) / 155.975327 - 0.01 },
  // BT.2100 HLG inverse OETF; BT.2408 puts 18% grey at 38% signal, hence the gain.
  hlg: { legal: false, gain: 0.18 / (0.38 * 0.38 / 3), decode: v => v <= 0.5 ? v * v / 3 : (Math.exp((v - 0.55991073) / 0.17883277) + 0.28466892) / 12 },
};

// ---------- camera profiles ----------
export const BRANDS = [
  ['Tidak LOG', [['rec709', 'Rec.709 / sRGB (video biasa, foto, ponsel SDR)', null, null]]],
  ['Sony', [['slog3c', 'S-Log3 / S-Gamut3.Cine', 'slog3', 'sgamut3cine'], ['slog3', 'S-Log3 / S-Gamut3', 'slog3', 'sgamut3'], ['sonyhlg', 'HLG / BT.2020', 'hlg', 'rec2020']]],
  ['Canon', [['clog3cg', 'Canon Log 3 / Cinema Gamut', 'clog3', 'cinemagamut'], ['clog3bt', 'Canon Log 3 / BT.2020', 'clog3', 'rec2020'], ['clog2cg', 'Canon Log 2 / Cinema Gamut', 'clog2', 'cinemagamut']]],
  ['Panasonic', [['vlog', 'V-Log / V-Gamut', 'vlog', 'vgamut'], ['panahlg', 'HLG / BT.2020', 'hlg', 'rec2020']]],
  ['Fujifilm', [['flog', 'F-Log / F-Gamut', 'flog', 'rec2020'], ['flog2', 'F-Log2 / F-Gamut', 'flog2', 'rec2020'], ['fujihlg', 'HLG / BT.2020', 'hlg', 'rec2020']]],
  ['Nikon', [['nlog', 'N-Log / BT.2020', 'nlog', 'rec2020'], ['nikonhlg', 'HLG / BT.2020', 'hlg', 'rec2020']]],
  ['ARRI', [['logc3', 'LogC3 (EI 800) / ARRI Wide Gamut 3', 'logc3', 'awg3'], ['logc4', 'LogC4 / ARRI Wide Gamut 4', 'logc4', 'awg4']]],
  ['RED', [['log3g10', 'Log3G10 / REDWideGamutRGB', 'log3g10', 'rwg']]],
  ['Blackmagic', [['bmd5', 'Blackmagic Film Gen 5 / Wide Gamut Gen 5', 'bmdfilm5', 'bmdwg5']]],
  ['DJI', [['dlog', 'D-Log / D-Gamut', 'dlog', 'dgamut']]],
  ['Apple iPhone', [['applelog', 'Apple Log / BT.2020', 'applelog', 'rec2020']]],
  ['Ponsel HDR', [['phonehlg', 'HLG / BT.2020 (video HDR yang tidak di-tone-map)', 'hlg', 'rec2020']]],
];
export const PROFILES = Object.fromEntries(BRANDS.flatMap(([brand, list]) => list.map(([id, name, curve, gamut]) => [id, { id, brand, name, curve, gamut }])));

/** 'video' or 'full' for log footage, read from the frame itself: a log curve never goes below its own
 *  black code, so dark pixels sitting under that code mean the file was stretched from video levels. */
export function detectLevels(profileId, px, stride = 4) {
  const p = PROFILES[profileId], c = p && p.curve && CURVES[p.curve];
  if (!c) return null;
  let lo = -0.2, hi = 0.6;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (c.decode(m) < 0) lo = m; else hi = m; }
  const full = hi, video = (hi * 1023 - 64) / 876;
  if (full - video < 0.02) return c.legal ? 'video' : 'full';
  const n = Math.floor(px.length / stride), v = new Float32Array(n), k = px instanceof Uint8ClampedArray || px instanceof Uint8Array ? 1 / 255 : 1;
  for (let i = 0; i < n; i++) v[i] = Math.min(px[i * stride], px[i * stride + 1], px[i * stride + 2]) * k;
  v.sort();
  return v[Math.floor(n * 0.002)] < video + 0.8 * (full - video) ? 'video' : 'full';
}

// ---------- transfer helpers ----------
const oetf709 = L => L < 0.018 ? 4.5 * L : 1.099 * Math.pow(L, 0.45) - 0.099;
export const srgbToLin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
export const linToSrgb = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
// Identity up to K, then an exponential shoulder with matching slope that approaches 1: mid grey stays put.
const K = 0.3;
const shoulder = x => x <= K ? x : K + (1 - K) * (1 - Math.exp(-(x - K) / (1 - K)));
// Distance-to-achromatic compression: identity below THR, distance LIM lands on the gamut edge (1).
const THR = 0.75, LIM = 1.4, PW = 1.2, RS = (LIM - THR) / Math.pow(Math.pow((1 - THR) / (LIM - THR), -PW) - 1, 1 / PW);
const rgc = d => d < THR ? d : THR + RS * ((d - THR) / RS) / Math.pow(1 + Math.pow((d - THR) / RS, PW), 1 / PW);

/** Returns (r,g,b,out) => out = Rec.709 display values, for a camera profile. */
export function makeCST(profileId, { exposure = 0, levels = 'auto' } = {}) {
  const p = PROFILES[profileId];
  if (!p || !p.curve) return (r, g, b, o) => { o[0] = r; o[1] = g; o[2] = b; return o; };
  const curve = CURVES[p.curve];
  const legal = levels === 'auto' ? curve.legal : levels === 'video';
  const M = gamutTo709(p.gamut);
  const gain = (curve.gain || 1) * 2 ** exposure;
  const dec = v => curve.decode(legal ? (v * 876 + 64) / 1023 : v) * gain;
  return (r, g, b, o) => {
    const R = dec(r), G = dec(g), B = dec(b);
    let x = M[0][0] * R + M[0][1] * G + M[0][2] * B;
    let y = M[1][0] * R + M[1][1] * G + M[1][2] * B;
    let z = M[2][0] * R + M[2][1] * G + M[2][2] * B;
    // Soft gamut compression (ACES RGC style): ease colours near the gamut edge inward so saturated
    // highlights keep a gradient instead of a channel slamming to 0.
    const ach = Math.max(x, y, z);
    if (ach > 1e-9) { x = ach - ach * rgc((ach - x) / ach); y = ach - ach * rgc((ach - y) / ach); z = ach - ach * rgc((ach - z) / ach); }
    // Anything still out of gamut: pull toward luminance until nothing is negative.
    const Y = Math.max(0, 0.2126 * x + 0.7152 * y + 0.0722 * z);
    const lo = Math.min(x, y, z);
    if (lo < 0) { const t = Y / (Y - lo + 1e-9); x = Y + (x - Y) * t; y = Y + (y - Y) * t; z = Y + (z - Y) * t; }
    // Per-channel shoulder: highlight colour fades toward white like a camera LUT does. A hue-keeping
    // max-RGB shoulder blew codec chroma noise in near-white areas up 5-7x into colour blotches.
    x = shoulder(x); y = shoulder(y); z = shoulder(z);
    o[0] = clamp(oetf709(x), 0, 1); o[1] = clamp(oetf709(y), 0, 1); o[2] = clamp(oetf709(z), 0, 1);
    return o;
  };
}

// ---------- Oklab ----------
export function linToOklab(r, g, b, o) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  o[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  o[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return o;
}
export function oklabToLin(L, a, b, o) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  o[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  o[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  o[2] = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return o;
}
/** Display RGB (0..1, interleaved, stride 3 or 4) -> Float32Array of Oklab triples. */
export function toLab(px, stride = 3, cst = null) {
  const n = Math.floor(px.length / stride), out = new Float32Array(n * 3), t = [0, 0, 0], u = [0, 0, 0];
  const k = px instanceof Uint8ClampedArray || px instanceof Uint8Array ? 1 / 255 : 1;
  for (let i = 0; i < n; i++) {
    let r = px[i * stride] * k, g = px[i * stride + 1] * k, b = px[i * stride + 2] * k;
    if (cst) { cst(r, g, b, t); r = t[0]; g = t[1]; b = t[2]; }
    linToOklab(srgbToLin(r), srgbToLin(g), srgbToLin(b), u);
    out[i * 3] = u[0]; out[i * 3 + 1] = u[1]; out[i * 3 + 2] = u[2];
  }
  return out;
}

// ---------- matching ----------
const ZONES = [0.3, 0.6, 0.85], SIG = 0.14;
function zoneW(L, w) {
  let s = 0;
  for (let k = 0; k < 3; k++) { const d = (L - ZONES[k]) / SIG; w[k] = Math.exp(-0.5 * d * d); s += w[k]; }
  for (let k = 0; k < 3; k++) w[k] /= s;
  return w;
}
const TN = 1024;
function quantiles(lab, ps) {
  const n = lab.length / 3, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = lab[i * 3];
  L.sort();
  return ps.map(p => L[Math.min(n - 1, Math.floor(p * (n - 1)))]);
}
function toneTable(src, ref) {
  const ps = Array.from({ length: 99 }, (_, i) => 0.005 + i * 0.99 / 98);
  const xs = quantiles(src, ps), ys = quantiles(ref, ps);
  const pts = [[0, Math.max(0, ys[0] - xs[0])]];
  for (let i = 0; i < xs.length; i++) pts.push([xs[i], ys[i]]);
  pts.push([1, Math.min(1, ys[ys.length - 1] + (1 - xs[xs.length - 1]))]);
  return curveFrom(pts, xs[49]);
}
/** Monotone, slope-limited, smoothed table through (x, y) points, re-anchored at x = anchor. */
function curveFrom(raw, anchor) {
  const pts = [];
  for (const [x, y] of raw) {
    const last = pts[pts.length - 1];
    if (last && x - last[0] < 1e-3) { last[1] = (last[1] + y) / 2; continue; }
    pts.push([x, y]);
  }
  const T = new Float32Array(TN);
  let j = 0;
  for (let i = 0; i < TN; i++) {
    const x = i / (TN - 1);
    while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
    const [x0, y0] = pts[j], [x1, y1] = pts[Math.min(j + 1, pts.length - 1)];
    T[i] = x1 > x0 ? y0 + (y1 - y0) * clamp((x - x0) / (x1 - x0), 0, 1) : y0;
  }
  // Limit and smooth the slope so the curve never crushes or bands, then re-anchor.
  const dx = 1 / (TN - 1);
  let d = new Float32Array(TN - 1);
  for (let i = 0; i < TN - 1; i++) d[i] = clamp((T[i + 1] - T[i]) / dx, 0.3, 3);
  for (let pass = 0; pass < 2; pass++) {
    const e = new Float32Array(TN - 1), R = 24;
    for (let i = 0; i < TN - 1; i++) { let s = 0, c = 0; for (let k = Math.max(0, i - R); k <= Math.min(TN - 2, i + R); k++) { s += d[k]; c++; } e[i] = s / c; }
    d = e;
  }
  const S = new Float32Array(TN);
  S[0] = T[0];
  for (let i = 1; i < TN; i++) S[i] = S[i - 1] + d[i - 1] * dx;
  const m = Math.round(clamp(anchor, 0, 1) * (TN - 1)), off = T[m] - S[m];
  for (let i = 0; i < TN; i++) S[i] = clamp(S[i] + off, 0, 1);
  return S;
}
const lookupT = (T, L) => { const x = clamp(L, 0, 1) * (TN - 1), i = Math.min(TN - 2, Math.floor(x)), f = x - i; return T[i] + (T[i + 1] - T[i]) * f; };

function zoneStats(lab, mapL) {
  const sum = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], w = [0, 0, 0];
  for (let i = 0; i < lab.length; i += 3) {
    const L = mapL ? mapL(lab[i]) : lab[i];
    if (L < 0.04 || L > 0.97) continue;
    zoneW(L, w);
    for (let k = 0; k < 3; k++) { sum[k][0] += w[k] * lab[i + 1]; sum[k][1] += w[k] * lab[i + 2]; sum[k][2] += w[k]; }
  }
  return sum.map(([a, b, n]) => (n > 1e-6 ? { a: a / n, b: b / n, n } : { a: 0, b: 0, n: 0 }));
}
function covAround(lab, mapL, mu) {
  let xx = 1e-6, xy = 0, yy = 1e-6, n = 0; const w = [0, 0, 0];
  for (let i = 0; i < lab.length; i += 3) {
    const L = mapL ? mapL(lab[i]) : lab[i];
    if (L < 0.04 || L > 0.97) continue;
    zoneW(L, w);
    const a = lab[i + 1] - (w[0] * mu[0].a + w[1] * mu[1].a + w[2] * mu[2].a);
    const b = lab[i + 2] - (w[0] * mu[0].b + w[1] * mu[1].b + w[2] * mu[2].b);
    xx += a * a; xy += a * b; yy += b * b; n++;
  }
  n = Math.max(n, 1);
  return [xx / n, xy / n, yy / n];
}
// 2x2 symmetric helpers: [xx, xy, yy]
const sqrtS = ([a, b, c]) => { const s = Math.sqrt(Math.max(a * c - b * b, 1e-18)), t = Math.sqrt(a + c + 2 * s); return [(a + s) / t, b / t, (c + s) / t]; };
const invS = ([a, b, c]) => { const d = a * c - b * b; return [c / d, -b / d, a / d]; };
const mulS = ([a, b, c], [d, e, f]) => [[a * d + b * e, a * e + b * f], [b * d + c * e, b * e + c * f]];
const mul2 = (A, B) => [[A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]], [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]]];
const sym = M => [M[0][0], (M[0][1] + M[1][0]) / 2, M[1][1]];
/** Monge-Kantorovitch linear map taking covariance Cs to Cr, eigenvalues kept in [lo, hi]. */
function mkl(Cs, Cr, lo = 0.4, hi = 2.2) {
  const Sh = sqrtS(Cs), Shi = invS(Sh);
  const mid = sqrtS(sym(mul2(mulS(Sh, Cr), [[Sh[0], Sh[1]], [Sh[1], Sh[2]]])));
  let A = sym(mul2(mulS(Shi, mid), [[Shi[0], Shi[1]], [Shi[1], Shi[2]]]));
  // eigen clamp
  const [a, b, c] = A, tr = (a + c) / 2, r = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  let l1 = tr + r, l2 = tr - r;
  const th = 0.5 * Math.atan2(2 * b, a - c), cs = Math.cos(th), sn = Math.sin(th);
  l1 = clamp(l1, lo, hi); l2 = clamp(l2, lo, hi);
  A = [l1 * cs * cs + l2 * sn * sn, (l1 - l2) * cs * sn, l1 * sn * sn + l2 * cs * cs];
  return A;
}

/** Builds the look that moves `srcLab` (CST'd footage) toward `refLab`.
 *  'grade' (default) reads only what a grade does to any picture: black and white level, contrast,
 *  the tint carried by near-neutral colours in shadows / mids / highlights, and overall saturation, so
 *  the content of the reference (an orange wall, a green forest) does not leak into the footage.
 *  'scene' matches the full distributions; use it only when both pictures show the same kind of scene. */
export const MATCH = { bk: 0.04, wk: 0.094, mid: 0.8, cpow: 0.724, sig: 0.015, spow: 0.4, smin: 0.6, tint: 0.08, hmax: 0.2, hpow: 0.717 };
export function buildMatch(srcLab, refLab, mode = 'grade', o = MATCH) {
  if (mode === 'scene') {
    const T = toneTable(srcLab, refLab);
    const mapL = L => lookupT(T, L);
    const muS = zoneStats(srcLab, mapL), muR = zoneStats(refLab, null);
    // A zone the reference barely has (e.g. no highlights) borrows the nearest populated zone.
    const fill = mu => { const tot = mu.reduce((s, z) => s + z.n, 0); return mu.map((z, k) => z.n > tot * 0.02 ? z : (mu[1].n > tot * 0.02 ? mu[1] : mu[k === 0 ? 1 : 0])); };
    const mS = fill(muS), mR = fill(muR);
    const A = mkl(covAround(srcLab, mapL, mS), covAround(refLab, null, mR));
    return { T, mS, mR, A };
  }
  const ps = [0.01, 0.25, 0.5, 0.75, 0.99], s = quantiles(srcLab, ps), r = quantiles(refLab, ps);
  const b = s[0] + clamp(r[0] - s[0], -o.bk, o.bk), w = s[4] + clamp(r[4] - s[4], -o.wk, o.wk);
  const m = s[2] + clamp(r[2] - s[2], -(o.mclip ?? 0.1), o.mclip ?? 0.1) * o.mid;
  const c = clamp(Math.pow((r[3] - r[1]) / (s[3] - s[1] + 1e-4), o.cpow), o.cmin ?? 0.8, o.cmax ?? 1.25);
  const q1 = Math.max(b + 0.01, m - (s[2] - s[1]) * c), q3 = Math.min(w - 0.01, m + (s[3] - s[2]) * c);
  const T = curveFrom([[0, Math.max(0, b - s[0])], [s[0], b], [s[1], q1], [s[2], m], [s[3], q3], [s[4], w], [1, Math.min(1, w + (1 - s[4]))]], s[2]);
  if (o.tfull) { const F = toneTable(srcLab, refLab); for (let i = 0; i < T.length; i++) T[i] += o.tfull * (F[i] - T[i]); }
  const mapL = L => lookupT(T, L);
  const nS = neutralStats(srcLab, mapL, o.sig), nR = neutralStats(refLab, null, o.sig);
  // the reference's tint relative to the footage's, capped: a grade tints, it does not repaint
  const mR = nR.map((z, k) => { const da = z.a - nS[k].a, db = z.b - nS[k].b, h = Math.hypot(da, db), k2 = h > o.tint ? o.tint / h : 1; return { a: nS[k].a + da * k2, b: nS[k].b + db * k2, n: z.n }; });
  const sat = clamp(Math.pow((chromaQ(refLab, 0.75) + 1e-3) / (chromaQ(srcLab, 0.75) + 1e-3), o.spow), o.smin ?? 0.7, o.smax ?? 1.3);
  return { T, mS: nS, mR, A: [sat, 0, sat], hue: hueSectors(srcLab, refLab, o) };
}
// Six hue sectors (red, orange/skin, yellow-green, green-cyan, blue, magenta): how the reference turns
// each hue and how saturated it keeps it, from chroma-weighted means of the pixels in that sector.
const SECT = 6;
function sectorStats(lab) {
  const st = Array.from({ length: SECT }, () => ({ x: 0, y: 0, c: 0, n: 0 }));
  for (let i = 0; i < lab.length; i += 3) {
    const a = lab[i + 1], b = lab[i + 2], C = Math.hypot(a, b);
    if (C < 0.03 || lab[i] < 0.08 || lab[i] > 0.97) continue;
    const h = (Math.atan2(b, a) + 2 * Math.PI) % (2 * Math.PI), k = Math.floor(h / (2 * Math.PI) * SECT) % SECT, z = st[k];
    z.x += a; z.y += b; z.c += C; z.n++;
  }
  const tot = lab.length / 3;
  return st.map(z => z.n > tot * 0.01 ? { h: Math.atan2(z.y, z.x), c: z.c / z.n, w: Math.min(1, z.n / (tot * 0.05)) } : null);
}
function hueSectors(srcLab, refLab, o) {
  const S = sectorStats(srcLab), R = sectorStats(refLab);
  return S.map((s, k) => {
    const r = R[k];
    if (!s || !r) return { dh: 0, ks: 1 };
    const dh = Math.atan2(Math.sin(r.h - s.h), Math.cos(r.h - s.h)), w = Math.min(s.w, r.w);
    return { dh: clamp(dh, -o.hmax, o.hmax) * w, ks: 1 + (clamp(Math.pow(r.c / s.c, o.hpow), 0.6, 1.5) - 1) * w };
  });
}
function neutralStats(lab, mapL, sig) {
  const sum = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], w = [0, 0, 0];
  for (let i = 0; i < lab.length; i += 3) {
    const L = mapL ? mapL(lab[i]) : lab[i];
    if (L < 0.03 || L > 0.98) continue;
    const g = Math.exp(-0.5 * (lab[i + 1] ** 2 + lab[i + 2] ** 2) / (sig * sig)) + 1e-4;
    zoneW(L, w);
    for (let k = 0; k < 3; k++) { const q = w[k] * g; sum[k][0] += q * lab[i + 1]; sum[k][1] += q * lab[i + 2]; sum[k][2] += q; }
  }
  const z = sum.map(([a, b, n]) => (n > 1e-6 ? { a: a / n, b: b / n, n } : null));
  const any = z.find(Boolean) || { a: 0, b: 0, n: 0 };
  return z.map((v, k) => v || z[1] || z[k ? k - 1 : 1] || any);
}
function chromaQ(lab, p) {
  const n = lab.length / 3, c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]);
  c.sort();
  return c[Math.floor(p * (n - 1))];
}

// Full transfer by default. Older defaults (tone 0.82, color 0.54, sat 0.63, hue 0.69) read as "no effect".
export const DEFAULTS = { strength: 1, tone: 1, color: 1, sat: 1, hue: 1, skin: 0.55, temp: 0, tint: 0, saturation: 1, contrast: 0 };
/** Same-scene references: match everything. */
export const DEFAULTS_SCENE = { ...DEFAULTS, tone: 1, color: 1, sat: 1, hue: 0, skin: 0.3 };
const SKIN_H = 0.95; // Oklab hue (rad) of typical skin, ~54 deg

/** Applies the look to one Oklab colour in place (o = [L,a,b]). */
export function applyLook(m, p, o) {
  const L0 = o[0], a0 = o[1], b0 = o[2], w = [0, 0, 0];
  let L = m ? L0 + p.tone * (lookupT(m.T, L0) - L0) : L0;
  if (p.contrast) L += (L - 0.565) * p.contrast;
  let a = a0, b = b0;
  if (m) {
    zoneW(L, w);
    const sa = w[0] * m.mS[0].a + w[1] * m.mS[1].a + w[2] * m.mS[2].a, sb = w[0] * m.mS[0].b + w[1] * m.mS[1].b + w[2] * m.mS[2].b;
    const ra = w[0] * m.mR[0].a + w[1] * m.mR[1].a + w[2] * m.mR[2].a, rb = w[0] * m.mR[0].b + w[1] * m.mR[1].b + w[2] * m.mR[2].b;
    const ca = a0 - sa, cb = b0 - sb, k = p.sat;
    const A00 = 1 + k * (m.A[0] - 1), A01 = k * m.A[1], A11 = 1 + k * (m.A[2] - 1);
    a = sa + p.color * (ra - sa) + A00 * ca + A01 * cb;
    b = sb + p.color * (rb - sb) + A01 * ca + A11 * cb;
    if (m.hue && p.hue) {
      const C = Math.hypot(a, b);
      if (C > 1e-5) {
        const h = (Math.atan2(b, a) + 2 * Math.PI) % (2 * Math.PI), f = h / (2 * Math.PI) * SECT - 0.5;
        const k0 = ((Math.floor(f) % SECT) + SECT) % SECT, k1 = (k0 + 1) % SECT, t = f - Math.floor(f);
        const dh = (m.hue[k0].dh * (1 - t) + m.hue[k1].dh * t) * p.hue, ks = 1 + ((m.hue[k0].ks * (1 - t) + m.hue[k1].ks * t) - 1) * p.hue;
        const g = clamp(C / 0.04, 0, 1), h2 = h + dh * g, C2 = C * (1 + (ks - 1) * g);
        a = C2 * Math.cos(h2); b = C2 * Math.sin(h2);
      }
    }
    // Skin protection: hold skin hues near where the camera put them.
    if (p.skin > 0) {
      const C = Math.hypot(a0, b0), h = Math.atan2(b0, a0), dh = Math.atan2(Math.sin(h - SKIN_H), Math.cos(h - SKIN_H));
      const ws = p.skin * Math.exp(-0.5 * (dh / 0.38) ** 2) * clamp((C - 0.015) / 0.03, 0, 1) * clamp((L0 - 0.3) / 0.15, 0, 1);
      a += ws * (a0 - a); b += ws * (b0 - b);
    }
  }
  a = a * p.saturation + p.tint * 0.03 - p.temp * 0.004;
  b = b * p.saturation + p.temp * 0.04;
  // overall strength mixes the whole look against the CST-only picture
  o[0] = L0 + p.strength * (L - L0); o[1] = a0 + p.strength * (a - a0); o[2] = b0 + p.strength * (b - b0);
  return o;
}

/** Full pipeline for one display RGB triple. */
export function makePipeline(cst, match, params) {
  const t = [0, 0, 0], u = [0, 0, 0];
  const p = { ...DEFAULTS, ...params };
  return (r, g, b, o) => {
    cst(r, g, b, t);
    linToOklab(srgbToLin(t[0]), srgbToLin(t[1]), srgbToLin(t[2]), u);
    applyLook(match, p, u);
    oklabToLin(u[0], u[1], u[2], t);
    // soft clip: keep hue when a channel leaves 0..1
    const mx = Math.max(t[0], t[1], t[2]);
    if (mx > 1) { t[0] /= mx; t[1] /= mx; t[2] /= mx; }
    o[0] = linToSrgb(clamp(t[0], 0, 1)); o[1] = linToSrgb(clamp(t[1], 0, 1)); o[2] = linToSrgb(clamp(t[2], 0, 1));
    return o;
  };
}

/** Bakes a size^3 table, red changing fastest (the .cube order). */
export function bakeLUT(fn, size = 33) {
  const n = size, lut = new Float32Array(n * n * n * 3), o = [0, 0, 0];
  let i = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    fn(r / (n - 1), g / (n - 1), b / (n - 1), o);
    lut[i++] = o[0]; lut[i++] = o[1]; lut[i++] = o[2];
  }
  return lut;
}
export function cubeText(lut, size, title) {
  const safe = String(title).replace(/["\r\n]/g, '').replace(/acescct/gi, 'look').slice(0, 80);
  const lines = [`TITLE "${safe}"`, '# Made with CopyCat LUT', `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0'];
  for (let i = 0; i < lut.length; i += 3) lines.push(`${lut[i].toFixed(6)} ${lut[i + 1].toFixed(6)} ${lut[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
}
/** Trilinear lookup of RGBA bytes through a baked table. */
export function applyLUT(lut, size, src, dst) {
  const n = size, s = n - 1, n2 = n * n;
  for (let i = 0; i < src.length; i += 4) {
    const x = src[i] / 255 * s, y = src[i + 1] / 255 * s, z = src[i + 2] / 255 * s;
    const x0 = Math.min(s - 1, x | 0), y0 = Math.min(s - 1, y | 0), z0 = Math.min(s - 1, z | 0);
    const fx = x - x0, fy = y - y0, fz = z - z0;
    const i000 = (z0 * n2 + y0 * n + x0) * 3, i100 = i000 + 3, i010 = i000 + n * 3, i110 = i010 + 3;
    const i001 = i000 + n2 * 3, i101 = i001 + 3, i011 = i001 + n * 3, i111 = i011 + 3;
    for (let c = 0; c < 3; c++) {
      const c00 = lut[i000 + c] + (lut[i100 + c] - lut[i000 + c]) * fx, c10 = lut[i010 + c] + (lut[i110 + c] - lut[i010 + c]) * fx;
      const c01 = lut[i001 + c] + (lut[i101 + c] - lut[i001 + c]) * fx, c11 = lut[i011 + c] + (lut[i111 + c] - lut[i011 + c]) * fx;
      const c0 = c00 + (c10 - c00) * fy, c1 = c01 + (c11 - c01) * fy;
      dst[i + c] = (c0 + (c1 - c0) * fz) * 255 + 0.5;
    }
    dst[i + 3] = src[i + 3];
  }
  return dst;
}

/** k-means palette in Oklab: [{L,a,b,share}] sorted dark to light. */
export function palette(lab, k = 6, iters = 12) {
  const n = lab.length / 3, step = Math.max(1, Math.floor(n / 4000)), pts = [];
  for (let i = 0; i < n; i += step) pts.push([lab[i * 3], lab[i * 3 + 1] * 2, lab[i * 3 + 2] * 2]);
  pts.sort((p, q) => p[0] - q[0]);
  let C = Array.from({ length: k }, (_, j) => pts[Math.floor((j + 0.5) / k * pts.length)].slice());
  const lab2 = new Int32Array(pts.length);
  for (let it = 0; it < iters; it++) {
    const S = C.map(() => [0, 0, 0, 0]);
    pts.forEach((p, i) => {
      let best = 0, bd = Infinity;
      C.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      lab2[i] = best; const s = S[best]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    });
    C = C.map((c, j) => S[j][3] ? [S[j][0] / S[j][3], S[j][1] / S[j][3], S[j][2] / S[j][3]] : c);
  }
  const cnt = C.map(() => 0); lab2.forEach(j => cnt[j]++);
  return C.map((c, j) => ({ L: c[0], a: c[1] / 2, b: c[2] / 2, share: cnt[j] / pts.length })).filter(c => c.share > 0.01).sort((p, q) => p.L - q.L);
}
export function labToCss({ L, a, b }) {
  const o = oklabToLin(L, a, b, [0, 0, 0]).map(v => Math.round(linToSrgb(clamp(v, 0, 1)) * 255));
  return `rgb(${o[0]} ${o[1]} ${o[2]})`;
}

// ---------- tiny zip (stored, no compression) so the .cube can leave a sandboxed page ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipOne(name, text) {
  const enc = new TextEncoder(), nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
  const loc = new DataView(new ArrayBuffer(30)), cen = new DataView(new ArrayBuffer(46)), end = new DataView(new ArrayBuffer(22));
  loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(8, 0, true);
  loc.setUint32(14, crc, true); loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, nm.length, true);
  cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
  cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nm.length, true);
  const cenOff = 30 + nm.length + data.length;
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nm.length, true); end.setUint32(16, cenOff, true);
  return new Blob([loc, nm, data, cen, nm, end], { type: 'application/zip' });
}

// ---------- demo scene (clearly marked as example in the UI) ----------
const SLOG3_ENC = x => x >= 0.01125 ? (420 + Math.log10((x + 0.01) / 0.19) * 261.5) / 1023 : (x * (171.2102946929 - 95) / 0.01125 + 95) / 1023;
function sceneLinear(u, v) {
  const hz = 0.58;
  let c;
  if (v < hz) {
    const t = v / hz;
    c = [0.25 + 0.75 * t, 0.42 + 0.5 * t, 0.85 + 0.05 * t].map(x => x * (0.9 + 0.9 * t));
    const d = (u - 0.72) ** 2 + ((v - 0.42) * 1.3) ** 2;
    const glow = Math.exp(-d / 0.004) * 9 + Math.exp(-d / 0.05) * 0.9;
    c = [c[0] + glow, c[1] + glow * 0.82, c[2] + glow * 0.55];
    const hill = 0.5 + 0.03 * Math.sin(u * 9) + 0.02 * Math.sin(u * 23);
    if (v > hill) c = [0.09, 0.12, 0.16].map(x => x * (1.2 + 0.4 * (v - hill) * 10));
  } else {
    const t = (v - hz) / (1 - hz), n = 0.5 + 0.25 * Math.sin(u * 60 + v * 30) * Math.sin(u * 13 - v * 70);
    c = [0.16 * n + 0.05, 0.2 * n + 0.08, 0.06 * n + 0.03].map(x => x * (1.4 - 0.9 * t));
  }
  // a person: face + jacket, lit from the right
  const fx = (u - 0.34) / 0.045, fy = (v - 0.45) / 0.085;
  if (fx * fx + fy * fy < 1) { const sh = 0.35 + 0.65 * clamp(0.5 + fx * 0.6 - fy * 0.2, 0, 1); c = [0.46, 0.29, 0.21].map(x => x * sh * 1.3); }
  else if (v > 0.55 && Math.abs(u - 0.34) < Math.min(0.1, 0.03 + (v - 0.55) * 1.2)) { const sh = 0.4 + 0.6 * clamp(0.5 + (u - 0.34) * 6, 0, 1); c = [0.05, 0.09, 0.16].map(x => x * sh * 1.5); }
  return c;
}
/** {footage, reference} as RGBA byte arrays w*h: footage in S-Log3/S-Gamut3.Cine, reference graded warm/teal. */
export function demoFrames(w, h) {
  const to709Inv = inv3(gamutTo709('sgamut3cine'));
  const foot = new Uint8ClampedArray(w * h * 4), ref = new Uint8ClampedArray(w * h * 4);
  const u3 = [0, 0, 0];
  const graded = (c) => {
    const m = Math.max(...c, 1e-9), s = shoulder(m * 1.1) / m;
    let d = c.map(x => linToSrgb(clamp(x * s, 0, 1)));
    linToOklab(...d.map(srgbToLin), u3);
    let [L, a, b] = u3;
    L = 0.08 + L * 0.9; L = L + (L - 0.55) * 0.25;
    const sh = clamp((0.6 - L) / 0.4, 0, 1), hi = clamp((L - 0.45) / 0.45, 0, 1);
    a = a * 0.85 - 0.025 * sh + 0.012 * hi; b = b * 0.85 - 0.04 * sh + 0.045 * hi;
    oklabToLin(L, a, b, u3);
    return u3.map(x => linToSrgb(clamp(x, 0, 1)));
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = sceneLinear(x / w, y / h), i = (y * w + x) * 4;
    const sg = mul3v(to709Inv, c).map(v => (SLOG3_ENC(Math.max(v, -0.01)) * 1023 - 64) / 876);
    foot[i] = sg[0] * 255; foot[i + 1] = sg[1] * 255; foot[i + 2] = sg[2] * 255; foot[i + 3] = 255;
    const g = graded(sceneLinear(1 - x / w, y / h)); // mirrored: the reference never has to be the same shot
    ref[i] = g[0] * 255; ref[i + 1] = g[1] * 255; ref[i + 2] = g[2] * 255; ref[i + 3] = 255;
  }
  return { foot, ref };
}
