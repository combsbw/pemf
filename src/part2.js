/* ===================== part 2: field maps, profiles, waveform and thermal series ===================== */
const Q = {                       // physical quantity at a point, per ampere -> absolute for the active mode
  B(S, x, y, z, k) { const f = C.fieldAt(S, x, y, z, new Float64Array(6)); return Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]) * k.I; },
  E(S, x, y, z, k) { const f = C.fieldAt(S, x, y, z, new Float64Array(6)); return Math.sqrt(f[3] * f[3] + f[4] * f[4] + f[5] * f[5]) * k.slewF * k.I; }
};
function modeKit(r, P, mode) {                 // current, frequency and slew factor of a mode
  const M = mode === 'a' ? P.acute : P.recov, W = C.WAVES[M.wave], res = mode === 'a' ? r.A : r.R;
  return { I: res.I, f: M.f, W, slewF: W.slew * M.f, M, res };
}
function skinZ(r, P, x) {                      // vertical position of the skin surface above x
  const g = r.geo, off = g.t / 2 + P.standoff, ax = Math.abs(x) - g.gapEff / 2;
  return ax <= 0 ? off : ax * Math.tan(g.th) + off / Math.cos(g.th);
}
function planeSpec(r, P, plane) {
  const g = r.geo, ct = Math.cos(g.th), st = Math.sin(g.th);
  const X = g.gapEff / 2 + g.wx * ct + 0.03, Y = g.ly / 2 + 0.03;
  const zlo = Math.min(0, g.wx * st) - 0.03, zhi = r.zT + 0.035;
  if (plane === 'xz') return { x0: -X, x1: X, y0: zlo, y1: zhi, ax: 'x', ay: 'z', pt: (a, b) => [a, 0, b] };
  if (plane === 'yz') return { x0: -Y, x1: Y, y0: zlo, y1: zhi, ax: 'y', ay: 'z', pt: (a, b) => [0, a, b] };
  if (plane === 'xy') return { x0: -X, x1: X, y0: -Y, y1: Y, ax: 'x', ay: 'y', pt: (a, b) => [a, b, r.zT] };
  return { x0: -X, x1: X, y0: -Y, y1: Y, ax: 'x', ay: 'y', pt: (a, b) => [a, b, skinZ(r, P, a)] };   // 'skin'
}
const PLANE_INFO = {
  xz: 'Transverse section through the target (across the spine)',
  yz: 'Sagittal section on the junction line (along the spine)',
  xy: 'Coronal plane at the target depth, seen from the patient',
  skin: 'Skin surface seen from above'
};
function drawFieldMap(canvas, r, P, opt) {
  const kit = modeKit(r, P, opt.mode), plane = opt.plane, q = opt.q, spec = planeSpec(r, P, plane);
  const wrap = canvas.parentElement; const Wcss = Math.max(260, wrap.clientWidth), dpr = Math.min(2, window.devicePixelRatio || 1);
  const aspect = (spec.y1 - spec.y0) / (spec.x1 - spec.x0);
  const Hcss = clamp(Wcss * aspect, 190, 380), wDom = spec.x1 - spec.x0, hDom = spec.y1 - spec.y0;
  // keep metric aspect: shrink domain drawing width if height clamped
  let drawW = Wcss, drawH = Hcss; const metric = Hcss / hDom; if (wDom * metric < Wcss) { drawW = wDom * metric; }
  canvas.style.width = drawW + 'px'; canvas.style.height = drawH + 'px'; canvas.width = Math.round(drawW * dpr); canvas.height = Math.round(drawH * dpr);
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const nx = 84, ny = clamp(Math.round(nx * drawH / drawW), 24, 84);
  const vals = new Float64Array(nx * ny); const fn = Q[q];
  const refPt = [0, 0, r.geo.t / 2 + P.standoff];
  const Bref = Q.B(r.S, refPt[0], refPt[1], refPt[2], kit), Eref = r.aE * kit.slewF * kit.I;
  const vmax = (q === 'B' ? Bref * 1.15 : Eref * 1.1), vmin = vmax / (q === 'B' ? 40 : 30);
  const lmin = Math.log10(vmin), lmax = Math.log10(vmax); const dark = isDark();
  const img = new ImageData(nx, ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = spec.x0 + (i + 0.5) / nx * wDom, b = spec.y1 - (j + 0.5) / ny * hDom, p = spec.pt(a, b);
    const v = fn(r.S, p[0], p[1], p[2], kit); vals[j * nx + i] = v;
    const t = (Math.log10(Math.max(v, 1e-30)) - lmin) / (lmax - lmin), c = rampColor(t, dark);
    const o = (j * nx + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = nx; off.height = ny; off.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(off, 0, 0, drawW, drawH);
  const PX = a => (a - spec.x0) / wDom * drawW, PY = b => drawH - (b - spec.y0) / hDom * drawH;
  const ink = cssVar('--ink'), surf = cssVar('--surface'), muted = cssVar('--muted');
  // iso-contour at the field value found at the target (for B) or at the E limit
  const lev = q === 'B' ? kit.res.Bpk : P.Elim;
  const segs = contour(vals, nx, ny, lev);
  if (segs.length) {
    ctx.save(); ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath();
    for (const s of segs) { ctx.moveTo(s[0] / nx * drawW, s[1] / ny * drawH); ctx.lineTo(s[2] / nx * drawW, s[3] / ny * drawH); } ctx.stroke(); ctx.restore();
  }
  // geometry overlays
  const g = r.geo, ct = Math.cos(g.th), st = Math.sin(g.th);
  ctx.save(); ctx.lineCap = 'round';
  if (plane === 'xz') {
    for (const sg of (g.nw === 1 ? [1] : [1, -1])) {
      ctx.strokeStyle = surf; ctx.lineWidth = Math.max(3, g.t * (drawH / hDom)) + 3; ctx.beginPath(); ctx.moveTo(PX(sg * g.gapEff / 2), PY(0)); ctx.lineTo(PX(sg * (g.gapEff / 2 + g.wx * ct)), PY(g.wx * st)); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = Math.max(3, g.t * (drawH / hDom)); ctx.beginPath(); ctx.moveTo(PX(sg * g.gapEff / 2), PY(0)); ctx.lineTo(PX(sg * (g.gapEff / 2 + g.wx * ct)), PY(g.wx * st)); ctx.stroke();
    }
    // skin line
    ctx.setLineDash([]);
    for (const [col, lw] of [[surf, 5], [ink, 2]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const x = spec.x0 + i / 60 * wDom; const zz = skinZ(r, P, x); i ? ctx.lineTo(PX(x), PY(zz)) : ctx.moveTo(PX(x), PY(zz)); } ctx.stroke(); }
    ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'left'; const ly0 = PY(skinZ(r, P, spec.x0)) - 7; ctx.fillStyle = surf; ctx.fillRect(22, ly0 - 10, 30, 14); ctx.fillStyle = ink; ctx.fillText('skin', 26, ly0);
  } else if (plane === 'xy' || plane === 'skin') {
    ctx.strokeStyle = ink; ctx.lineWidth = 1.6;
    for (const sg of (g.nw === 1 ? [1] : [1, -1])) {
      const xa = sg * g.gapEff / 2, xb = sg * (g.gapEff / 2 + g.wx * ct);
      ctx.strokeRect(Math.min(PX(xa), PX(xb)), PY(g.ly / 2), Math.abs(PX(xb) - PX(xa)), PY(-g.ly / 2) - PY(g.ly / 2));
      const bi = g.b * ct; const xa2 = sg * (g.gapEff / 2 + bi), xb2 = sg * (g.gapEff / 2 + g.wx * ct - bi);
      ctx.save(); ctx.globalAlpha = 0.5; ctx.setLineDash([3, 3]); ctx.strokeRect(Math.min(PX(xa2), PX(xb2)), PY(g.ly / 2 - g.b), Math.abs(PX(xb2) - PX(xa2)), PY(-g.ly / 2 + g.b) - PY(g.ly / 2 - g.b)); ctx.restore();
    }
  } else {
    ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3]);
    for (const y of [-g.ly / 2, g.ly / 2]) { ctx.beginPath(); ctx.moveTo(PX(y), PY(spec.y0)); ctx.lineTo(PX(y), PY(spec.y0) - 14); ctx.stroke(); }
    ctx.setLineDash([]); ctx.fillStyle = ink; ctx.font = '10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.fillText('coil ends', PX(0), PY(spec.y0) - 5);
  }
  // target marker
  const tx = plane === 'skin' ? null : 0, ty = (plane === 'xz' || plane === 'yz') ? r.zT : 0;
  if (tx !== null) { ctx.setLineDash([]); ctx.strokeStyle = surf; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(PX(0), PY(ty), 6, 0, 7); ctx.stroke(); ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(PX(0), PY(ty), 6, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(PX(0), PY(ty), 1.6, 0, 7); ctx.fillStyle = ink; ctx.fill(); }
  // axes ticks (cm)
  ctx.fillStyle = muted; ctx.strokeStyle = muted; ctx.font = '10px "IBM Plex Mono", monospace'; ctx.lineWidth = 1; ctx.setLineDash([]);
  const cm = v => v * 100;
  const xt = niceTicks(cm(spec.x0), cm(spec.x1), 6), yt = niceTicks(cm(spec.y0), cm(spec.y1), 5);
  ctx.textAlign = 'center'; for (const t of xt) { const x = PX(t / 100); ctx.fillStyle = surf; ctx.globalAlpha = .75; ctx.fillRect(x - 12, drawH - 14, 24, 13); ctx.globalAlpha = 1; ctx.fillStyle = muted; ctx.fillText(t, x, drawH - 4); }
  ctx.textAlign = 'left'; for (const t of yt) { const y = PY(t / 100); ctx.fillStyle = surf; ctx.globalAlpha = .75; ctx.fillRect(0, y - 6, 22, 12); ctx.globalAlpha = 1; ctx.fillStyle = muted; ctx.fillText(t, 2, y + 3.5); }
  ctx.restore();
  return { spec, vmin, vmax, drawW, drawH, kit, q, fn: (a, b) => { const p = spec.pt(a, b); return fn(r.S, p[0], p[1], p[2], kit); } };
}
function colorbarHTML(info, mark) {
  const dark = isDark(), stops = []; for (let i = 0; i <= 12; i++) { const c = rampColor(i / 12, dark); stops.push(`rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0}) ${(i / 12 * 100).toFixed(0)}%`); }
  const lo = Math.log10(info.vmin), hi = Math.log10(info.vmax); const unit = info.q === 'B' ? 'mT' : 'V/m', sc = info.q === 'B' ? 1e3 : 1;
  let ticks = ''; const decs = []; for (let e = Math.ceil(lo + Math.log10(sc)); e <= Math.floor(hi + Math.log10(sc)); e++) decs.push(e);
  for (const e of decs) for (const m of [1, 3]) { const v = m * Math.pow(10, e) / sc, t = (Math.log10(v) - lo) / (hi - lo); if (t >= 0 && t <= 1) ticks += `<span style="left:${t * 100}%">${m * Math.pow(10, e) < 1 ? (m * Math.pow(10, e)).toFixed(2) : m * Math.pow(10, e)}</span>`; }
  let mk = ''; if (mark && mark.v > 0) { const t = (Math.log10(mark.v) - lo) / (hi - lo); if (t >= 0 && t <= 1) mk = `<i class="cbm" style="left:${t * 100}%" title="${esc(mark.label)}"></i>`; }
  return `<div class="cb"><div class="cbbar" style="background:linear-gradient(90deg,${stops.join(',')})">${mk}</div><div class="cbtk">${ticks}</div><div class="cbu">${unit} · log scale · dashed line = ${info.q === 'B' ? 'flux at target' : 'E limit'}</div></div>`;
}
function depthSeries(r, P, mode) {
  const kit = modeKit(r, P, mode), g = r.geo, zs = g.t / 2 + P.standoff; const pts = [], flat = [];
  const gf = C.geometry({ wx: g.wx, ly: g.ly, N: g.N, awg: g.awg, th: 0, b: g.b }, P); const Sf = C.buildSegs(gf, C.makeRings(gf, P.nRings, P.nLay), P);
  const zsf = gf.t / 2 + P.standoff; const Bf = new Float64Array(6);
  for (let d = 0; d <= 0.121; d += 0.004) {
    pts.push([d * 100, Q.B(r.S, 0, 0, zs + d, kit) * 1e3]);
    flat.push([d * 100, Q.B(Sf, 0, 0, zsf + d, kit) * 1e3]);
  }
  return { pts, flat };
}
function waveSeries(r, P, mode) {
  const kit = modeKit(r, P, mode), W = kit.W, M = kit.M, res = kit.res, T = 1 / M.f; const n = 200, cur = [], volt = [];
  const L = r.ind.L, Rt = res.Rhot + res.Rdrive;
  for (let i = 0; i <= n; i++) {
    const tau = i / n * 2, h = 1e-4; const g0 = W.g(tau), dg = (W.g(tau + h) - W.g(tau - h)) / (2 * h);
    const t = tau * T * 1e3; cur.push([t, res.I * g0]); volt.push([t, res.I * (Rt * g0 + L * M.f * dg)]);
  }
  return { cur, volt, T };
}
function thermalSeries(r, P) {
  const out = {};
  for (const m of ['a', 'r']) {
    const res = m === 'a' ? r.A : r.R, M = m === 'a' ? P.acute : P.recov, T = res.T;
    const n = 60, c = [], s = []; for (let i = 0; i <= n; i++) { const t = i / n * M.tsess; c.push([t / 60, T.Tat(t)]); s.push([t / 60, T.skin(T.Tat(t))]); }
    out[m] = { coil: c, skin: s };
  }
  return out;
}
