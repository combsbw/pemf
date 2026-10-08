/* ===================== part 1: utilities, equation typesetter, charts ===================== */
const C = window.PEMF;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fx(v, d) {                       // fixed-decimals, safe for non-finite
  if (v === Infinity) return '∞'; if (!isFinite(v)) return '–';
  return v.toFixed(d == null ? 2 : d);
}
function sig(v, n) {                      // n significant digits, no sci notation for typical ranges
  if (!isFinite(v)) return v === Infinity ? '∞' : '–'; if (v === 0) return '0';
  const a = Math.abs(v), p = Math.floor(Math.log10(a)), d = Math.max(0, n - 1 - p);
  return v.toFixed(Math.min(d, 6));
}
function eng(v, unit, n) {                // engineering prefix formatting
  if (!isFinite(v)) return '–'; if (v === 0) return '0 ' + unit;
  const pre = [[1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']]; const a = Math.abs(v);
  for (const [m, p] of pre) if (a >= m * 0.9999) return sig(v / m, n || 3) + ' ' + p + unit;
  return sig(v / 1e-9, n || 3) + ' n' + unit;
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
function debounce(fn, ms) { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; }
function niceTicks(lo, hi, n) {
  n = n || 5; const span = hi - lo; if (!(span > 0)) return [lo];
  const s0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(s0))), nm = s0 / mag;
  const step = (nm < 1.5 ? 1 : nm < 3 ? 2 : nm < 7 ? 5 : 10) * mag; const t = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) t.push(+v.toFixed(12));
  return t;
}
function tickFmt(step) { return v => { const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) + 1e-9)); return v.toFixed(d); }; }

/* ---------- equation typesetter: small LaTeX subset -> HTML ---------- */
const SYM = { cdot: '·', times: '×', le: '≤', ge: '≥', approx: '≈', partial: '∂', nabla: '∇', oint: '∮', sum: '∑', int: '∫', infty: '∞', Rightarrow: '⇒', pm: '±', to: '→', mu: 'μ', pi: 'π', rho: 'ρ', alpha: 'α', lambda: 'λ', sigma: 'σ', delta: 'δ', phi: 'φ', theta: 'θ', tau: 'τ', omega: 'ω', varphi: 'φ', Delta: 'Δ', neq: '≠', propto: '∝', in: '∈', Phi: 'Φ', Psi: 'Ψ', psi: 'ψ', kappa: 'κ', eta: 'η', gamma: 'γ', epsilon: 'ε', sim: '∼', ell: 'ℓ', ldots: '…', leftarrow: '←', rightarrow: '→', Sigma: 'Σ', ge2: '≥' };
function tex(src) {
  let i = 0;
  function peek() { return src[i]; }
  function group() {
    while (src[i] === ' ') i++;
    if (src[i] === '{') { i++; const h = expr('}'); i++; return h; }
    return atom(true);
  }
  function word() { let w = ''; while (i < src.length && /[A-Za-z]/.test(src[i])) w += src[i++]; return w; }
  function atom(single, upright) {
    const c = src[i];
    if (c === '\\') {
      i++; const w = word();
      if (!w) { const ch = src[i++]; if (ch === '!') return ''; return ch === ',' ? '<span class="th"></span>' : ch === ';' ? '<span class="sp"></span>' : ch === ' ' ? ' ' : esc(ch || ''); }
      if (w === 'frac') { const a = group(), b = group(); return '<span class="fr"><span class="nu">' + a + '</span><span class="de">' + b + '</span></span>'; }
      if (w === 'sqrt') { const a = group(); return '<span class="sq"><span class="rd">√</span><span class="rb">' + a + '</span></span>'; }
      if (w === 'mathrm' || w === 'text') { const a = group(); return '<span class="up">' + a.replace(/<\/?i>/g, '') + '</span>'; }
      if (w === 'mathcal') { const a = group(); const t = a.replace(/<\/?i>/g, ''); return '<i>' + (t === 'L' ? 'ℒ' : t) + '</i>'; }
      if (w === 'hat') { const a = group(); return '<span class="hat">' + a + '</span>'; }
      if (w === 'vec') { const a = group(); return '<b class="vec">' + a + '</b>'; }
      if (w === 'left' || w === 'right') return '';
      if (w === 'quad') return '<span class="qd"></span>';
      if (w === 'qquad') return '<span class="qd"></span><span class="qd"></span>';
      if (SYM[w]) { const big = (w === 'sum' || w === 'int' || w === 'oint'); return big ? '<span class="big">' + SYM[w] + '</span>' : (/^[a-zA-Z]/.test(SYM[w]) || /[α-ωΔΦΨ]/.test(SYM[w]) ? '<i>' + SYM[w] + '</i>' : SYM[w]); }
      return esc(w);
    }
    i++;
    if (/[A-Za-zα-ωΑ-Ω]/.test(c)) return upright ? c : '<i>' + c + '</i>';
    if (c === '-') return '−';
    if (c === '*') return '·';
    return esc(c);
  }
  function expr(stop) {
    let out = '';
    while (i < src.length && src[i] !== stop) {
      let base = atom(false);
      let sup = null, sub = null;
      for (;;) {
        while (src[i] === ' ') i++;
        if (src[i] === '^') { i++; sup = group(); } else if (src[i] === '_') { i++; sub = group(); } else break;
      }
      if (sup != null && sub != null) base += '<span class="ss"><sup>' + sup + '</sup><sub>' + sub + '</sub></span>';
      else if (sup != null) base += '<sup>' + sup + '</sup>';
      else if (sub != null) base += '<sub>' + sub + '</sub>';
      out += base;
    }
    return out;
  }
  return expr(null);
}

/* ---------- line chart (SVG) with hover read-out ---------- */
class LineChart {
  constructor(el, opt) { this.el = el; this.o = opt; this.uid = 'c' + Math.random().toString(36).slice(2, 7); el.classList.add('chart'); this.ro = null; }
  set(opt) { this.o = Object.assign(this.o, opt); this.draw(); }
  draw() {
    const o = this.o, el = this.el; const W = Math.max(240, el.clientWidth || 320), H = o.height || 190;
    const m = { l: o.ml || 46, r: 14, t: 10, b: 30 };
    const ser = (o.series || []).filter(s => s.pts && s.pts.length);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of ser) for (const p of s.pts) { if (isFinite(p[0])) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); } if (isFinite(p[1])) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } }
    for (const h of (o.hlines || [])) if (isFinite(h.y) && o.includeRefs !== false) { y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y); }
    for (const mk of (o.markers || [])) { x0 = Math.min(x0, mk.x); x1 = Math.max(x1, mk.x); y0 = Math.min(y0, mk.y); y1 = Math.max(y1, mk.y); }
    if (!isFinite(x0)) { el.innerHTML = '<div class="empty">No data</div>'; return; }
    if (o.xDom) { x0 = o.xDom[0]; x1 = o.xDom[1]; }
    if (o.yDom) { y0 = o.yDom[0]; y1 = o.yDom[1]; } else { if (o.yZero !== false) y0 = Math.min(0, y0); const pad = (y1 - y0) * 0.06 || 1; y1 += pad; if (y0 !== 0) y0 -= pad; }
    if (x1 === x0) x1 = x0 + 1; if (y1 === y0) y1 = y0 + 1;
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const X = v => m.l + (v - x0) / (x1 - x0) * pw, Y = v => m.t + ph - (v - y0) / (y1 - y0) * ph;
    const xt = niceTicks(x0, x1, Math.max(3, Math.floor(pw / 80))), yt = niceTicks(y0, y1, 4);
    const xs = xt.length > 1 ? xt[1] - xt[0] : 1, ys = yt.length > 1 ? yt[1] - yt[0] : 1;
    const fX = o.fmtX || tickFmt(xs), fY = o.fmtY || tickFmt(ys);
    let g = '';
    for (const v of yt) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tick" x="${m.l - 6}" y="${Y(v) + 3.5}" text-anchor="end">${fY(v)}</text>`;
    for (const v of xt) g += `<text class="tick" x="${X(v)}" y="${H - m.b + 15}" text-anchor="middle">${fX(v)}</text><line class="axtick" x1="${X(v)}" x2="${X(v)}" y1="${H - m.b}" y2="${H - m.b + 4}"/>`;
    g += `<line class="axis" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>`;
    if (o.xLabel) g += `<text class="axl" x="${m.l + pw / 2}" y="${H - 3}" text-anchor="middle">${esc(o.xLabel)}</text>`;
    if (o.yLabel) g += `<text class="axl" x="11" y="${m.t + ph / 2}" text-anchor="middle" transform="rotate(-90 11 ${m.t + ph / 2})">${esc(o.yLabel)}</text>`;
    for (const h of (o.hlines || [])) if (isFinite(h.y) && h.y >= y0 && h.y <= y1) g += `<line class="ref ${h.cls || ''}" x1="${m.l}" x2="${W - m.r}" y1="${Y(h.y)}" y2="${Y(h.y)}"/><text class="reflab" x="${W - m.r - 3}" y="${Y(h.y) - 4}" text-anchor="end">${esc(h.label || '')}</text>`;
    for (const v of (o.vlines || [])) if (v.x >= x0 && v.x <= x1) g += `<line class="ref" x1="${X(v.x)}" x2="${X(v.x)}" y1="${m.t}" y2="${H - m.b}"/><text class="reflab" x="${X(v.x) + 4}" y="${m.t + 10}">${esc(v.label || '')}</text>`;
    for (const s of ser) {
      const pts = s.pts.filter(p => isFinite(p[0]) && isFinite(p[1]));
      const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(clamp(p[1], y0 - (y1 - y0), y1 + (y1 - y0))).toFixed(1)).join('');
      if (s.area) g += `<path d="${d}L${X(pts[pts.length - 1][0]).toFixed(1)} ${Y(y0)}L${X(pts[0][0]).toFixed(1)} ${Y(y0)}Z" fill="${s.color}" opacity=".10"/>`;
      g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`;
      if (s.dots) for (const p of pts) g += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="3.2" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"/>`;
    }
    for (const mk of (o.markers || [])) g += `<circle cx="${X(mk.x)}" cy="${Y(mk.y)}" r="5" fill="${mk.color || 'var(--ink)'}" stroke="var(--surface)" stroke-width="2"/>` + (mk.label ? `<text class="reflab" x="${X(mk.x) + 8}" y="${Y(mk.y) - 8}">${esc(mk.label)}</text>` : '');
    const legend = ser.filter(s => s.name).map(s => `<span class="lg"><i style="background:${s.color};${s.dash ? 'background:repeating-linear-gradient(90deg,' + s.color + ' 0 4px,transparent 4px 7px)' : ''}"></i>${esc(s.name)}</span>`).join('');
    el.innerHTML = (legend ? `<div class="legend">${legend}</div>` : '') + `<div class="plot"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.title || 'chart')}">${g}<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/><rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg><div class="tip" hidden></div></div>`;
    const svg = $('svg', el), tip = $('.tip', el), xh = $('.xh', svg), hit = $('.hit', svg);
    const self = this;
    const move = ev => {
      const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width);
      const xv = x0 + (px - m.l) / pw * (x1 - x0); let html = `<b>${esc((o.tipX || fX)(xv))}${o.xUnit ? ' ' + o.xUnit : ''}</b>`;
      for (const s of ser) { if (!s.name) continue; const p = s.pts; let best = null; for (let i = 0; i < p.length - 1; i++) if (xv >= p[i][0] && xv <= p[i + 1][0]) { const t = (xv - p[i][0]) / (p[i + 1][0] - p[i][0] || 1); best = p[i][1] + t * (p[i + 1][1] - p[i][1]); break; }
        if (best == null) { const k = p.reduce((a, q) => Math.abs(q[0] - xv) < Math.abs(a[0] - xv) ? q : a, p[0]); if (Math.abs(k[0] - xv) < (x1 - x0) * 0.04) best = k[1]; }
        if (best != null) html += `<div><i style="background:${s.color}"></i>${esc(s.name)} <b>${(o.tipY || fY)(best)}${o.yUnit ? ' ' + o.yUnit : ''}</b></div>`; }
      xh.setAttribute('x1', px); xh.setAttribute('x2', px); xh.style.display = ''; tip.innerHTML = html; tip.hidden = false;
      const tw = tip.offsetWidth; tip.style.left = clamp(px * r.width / W + 10, 0, r.width - tw) + 'px'; tip.style.top = '4px';
    };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { xh.style.display = 'none'; tip.hidden = true; });
    if (!this.ro && window.ResizeObserver) { this.lastW = el.clientWidth; this.ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - this.lastW) > 8) { this.lastW = el.clientWidth; this.draw(); } }); this.ro.observe(el); }
  }
}

/* ---------- colour ramps (sequential blue, validated reference palette) ---------- */
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
function hex2rgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
const RAMP_RGB = RAMP.map(hex2rgb);
function rampColor(t, dark) {             // t in 0..1, magnitude; light mode: high = dark ; dark mode: high = light
  t = clamp(t, 0, 1); if (dark) t = 1 - t;
  const f = t * (RAMP_RGB.length - 1), i = Math.min(RAMP_RGB.length - 2, Math.floor(f)), k = f - i, a = RAMP_RGB[i], b = RAMP_RGB[i + 1];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function isDark() { const t = document.documentElement.getAttribute('data-theme'); if (t) return t === 'dark'; return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches; }
/* marching squares: returns segments [x1,y1,x2,y2] in grid coordinates for the given level */
function contour(grid, nx, ny, level) {
  const segs = [];
  const v = (i, j) => grid[j * nx + i];
  const lerp = (a, b) => { const d = b - a; return d === 0 ? 0.5 : (level - a) / d; };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
    if (!isFinite(a + b + c + d)) continue;
    const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const pts = {
      t: [i + lerp(a, b), j], r: [i + 1, j + lerp(b, c)], bo: [i + lerp(d, c), j + 1], l: [i, j + lerp(a, d)]
    };
    const T = {
      1: ['l', 't'], 2: ['t', 'r'], 3: ['l', 'r'], 4: ['r', 'bo'], 6: ['t', 'bo'], 7: ['l', 'bo'], 8: ['l', 'bo'], 9: ['t', 'bo'], 11: ['r', 'bo'], 12: ['l', 'r'], 13: ['t', 'r'], 14: ['l', 't']
    };
    if (idx === 5) { segs.push([...pts.l, ...pts.t], [...pts.r, ...pts.bo]); continue; }
    if (idx === 10) { segs.push([...pts.t, ...pts.r], [...pts.l, ...pts.bo]); continue; }
    const e = T[idx]; if (e) segs.push([...pts[e[0]], ...pts[e[1]]]);
  }
  return segs;
}
