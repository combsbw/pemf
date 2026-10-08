/* ===================== part 4: tabs (field, optimum, lagrangian) ===================== */
const card = (title, body, cls, sub) => `<section class="card ${cls || ''}">${title ? `<h3>${title}</h3>` : ''}${sub ? `<p class="note">${sub}</p>` : ''}${body}</section>`;
const modeColor = () => cssVar(S.mode === 'a' ? '--c1' : '--c2');
const CAT = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];
const LOCK_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const UNLOCK_SVG = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.4-1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const TABS = {};

/* ---------------- field tab ---------------- */
TABS.field = {
  build(h) {
    h.innerHTML = `
      <div class="toolrow"><div class="seg" id="planeSeg" role="group" aria-label="Plane">
        <button type="button" data-p="xz">Across spine</button><button type="button" data-p="yz">Along spine</button><button type="button" data-p="xy">At target depth</button><button type="button" data-p="skin">Skin surface</button></div>
        <div class="seg" id="qSeg" role="group" aria-label="Quantity"><button type="button" data-q="B">Flux density</button><button type="button" data-q="E">Induced E-field</button></div></div>
      <section class="card"><p class="note" id="mapCap"></p><div class="mapwrap" id="mapwrap"><canvas id="mapC" role="img" aria-label="Field map"></canvas><div class="maptip" id="mapTip" hidden></div></div><div id="cbar"></div></section>
      <div class="grid2">
        ${card('Flux versus depth', '<div id="chDepth"></div><p class="note" id="depthNote"></p>')}
        ${card('Temperature during the session', '<div id="chTherm"></div><p class="note" id="thermNote"></p>')}
        ${card('Coil current', '<div id="chCur"></div>')}
        ${card('Terminal voltage', '<div id="chVolt"></div><p class="note" id="voltNote"></p>')}
      </div>`;
    this.ch = { depth: new LineChart($('#chDepth'), { height: 200 }), therm: new LineChart($('#chTherm'), { height: 200 }), cur: new LineChart($('#chCur'), { height: 170 }), volt: new LineChart($('#chVolt'), { height: 170 }) };
    $('#planeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.plane = b.dataset.p; this.update(); } });
    $('#qSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.q = b.dataset.q; this.update(); } });
    const cv = $('#mapC'), tip = $('#mapTip');
    const mv = ev => {
      if (!this.info) return; const rc = cv.getBoundingClientRect(), info = this.info, sp = info.spec;
      const a = sp.x0 + (ev.clientX - rc.left) / rc.width * (sp.x1 - sp.x0), b = sp.y1 - (ev.clientY - rc.top) / rc.height * (sp.y1 - sp.y0);
      const v = info.fn(a, b); const unit = info.q === 'B' ? eng(v, 'T', 3) : sig(v, 3) + ' V/m';
      tip.innerHTML = `<b>${unit}</b><span>${sp.ax} ${fx(a * 100, 1)} cm · ${sp.ay} ${fx(b * 100, 1)} cm</span>`; tip.hidden = false;
      tip.style.left = clamp(ev.clientX - rc.left + 12, 0, rc.width - tip.offsetWidth - 2) + 'px'; tip.style.top = clamp(ev.clientY - rc.top - 34, 0, rc.height - 36) + 'px';
    };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerdown', mv); cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  },
  update() {
    const r = S.r, P = S.P, m = S.mode, res = m === 'a' ? r.A : r.R, M = m === 'a' ? P.acute : P.recov;
    $$('#planeSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.p === S.plane));
    $$('#qSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.q === S.q));
    const info = drawFieldMap($('#mapC'), r, P, { plane: S.plane, q: S.q, mode: m }); this.info = info;
    $('#cbar').innerHTML = colorbarHTML(info, { v: S.q === 'B' ? res.Bpk : P.Elim, label: S.q === 'B' ? 'flux at target' : 'E limit' });
    $('#mapCap').innerHTML = `${esc(PLANE_INFO[S.plane])}. ${S.q === 'B' ? 'Peak flux density' : 'Peak induced E-field (E = −∂A/∂t)'} for the <b>${m === 'a' ? 'acute' : 'recovery'}</b> setting (${fx(res.I, 1)} A, ${M.f} Hz). Ring marks the target; distances in cm.`;
    const c = modeColor(), mutedC = cssVar('--muted');
    const ds = depthSeries(r, P, m); const tgt = ds.pts.reduce((a, p) => Math.abs(p[0] - P.depth * 100) < Math.abs(a[0] - P.depth * 100) ? p : a, ds.pts[0]), tf = ds.flat.reduce((a, p) => Math.abs(p[0] - P.depth * 100) < Math.abs(a[0] - P.depth * 100) ? p : a, ds.flat[0]);
    this.ch.depth.set({ series: [{ name: `Bent ${fx(r.geo.th * 180 / Math.PI, 1)}°`, color: c, pts: ds.pts, area: true }, { name: 'Same coil, flat', color: mutedC, dash: '5 4', pts: ds.flat, w: 1.6 }], markers: [{ x: P.depth * 100, y: res.Bpk * 1e3, color: cssVar('--ink') }], xLabel: 'cm below skin', yLabel: 'mT', yUnit: 'mT', xUnit: 'cm' });
    const gain = (tgt[1] / tf[1] - 1) * 100;
    $('#depthNote').innerHTML = Math.abs(r.geo.th) < 0.004 ? 'The wings are flat. Bending them toward the body usually raises flux at depth.' : `At the target, bending the wings ${gain >= 0 ? 'raises' : 'lowers'} flux by <b>${fx(Math.abs(gain), 0)}%</b> compared with the same coil laid flat.`;
    const ts = thermalSeries(r, P);
    this.ch.therm.set({
      series: [{ name: 'Acute, coil', color: cssVar('--c1'), pts: ts.a.coil }, { name: 'Acute, skin', color: cssVar('--c1'), dash: '5 4', pts: ts.a.skin }, { name: 'Recovery, coil', color: cssVar('--c2'), pts: ts.r.coil }, { name: 'Recovery, skin', color: cssVar('--c2'), dash: '5 4', pts: ts.r.skin }],
      hlines: [{ y: P.thermal.Tmax, label: 'coil limit' }, { y: P.thermal.Tskin, label: 'skin limit' }], yZero: false, xLabel: 'minutes', yLabel: '°C', yUnit: '°C', xUnit: 'min', fmtX: v => v.toFixed(v < 10 ? 1 : 0)
    });
    const T = res.T; $('#thermNote').innerHTML = `Time constant <b>${isFinite(T.tau) ? fx(T.tau / 60, 0) + ' min' : 'runaway'}</b>, steady state ${isFinite(T.Tss) ? fx(T.Tss, 0) + ' °C' : 'not reached'}. ${T.runaway ? 'Copper resistance rises faster than the coil can shed heat.' : ''}`;
    const w = waveSeries(r, P, m);
    this.ch.cur.set({ series: [{ name: m === 'a' ? 'Acute i(t)' : 'Recovery i(t)', color: c, pts: w.cur }], hlines: [{ y: P.drive.Isw, label: 'switch limit' }, { y: -P.drive.Isw, label: '' }], yZero: false, xLabel: 'ms', yLabel: 'A', yUnit: 'A', xUnit: 'ms', fmtX: v => v.toFixed(v < 20 ? 1 : 0) });
    this.ch.volt.set({ series: [{ name: 'v(t) = R i + L di/dt', color: c, pts: w.volt }], hlines: [{ y: res.Vav, label: 'available' }, { y: -res.Vav, label: '' }], yZero: false, xLabel: 'ms', yLabel: 'V', yUnit: 'V', xUnit: 'ms', fmtX: v => v.toFixed(v < 20 ? 1 : 0) });
    $('#voltNote').innerHTML = `Needs <b>${fx(res.Vreq, 1)} V</b> peak of <b>${fx(res.Vav, 1)} V</b> available (${fx(P.drive.Dmax * 100, 0)}% max duty, ${fx(P.supply.Voc, 0)} V source, sag at ${fx(res.Ibus, 1)} A). Inductance ${fx(r.ind.L * 1e6, 0)} µH, resistance ${fx(res.Rhot * 1e3, 0)} mΩ hot.`;
  }
};

/* ---------------- optimum tab ---------------- */
const STEP = { Tc_a: [1, '°C', 1], Ts_a: [1, '°C', 1], Tc_r: [1, '°C', 1], Ts_r: [0.5, '°C', 1], E_a: [0.1, 'V/m', 1], E_r: [0.1, 'V/m', 1], V_a: [1, 'V', 1], V_r: [1, 'V', 1], P_a: [10, 'W', 1], P_r: [10, 'W', 1], I_a: [5, 'A', 1], I_r: [5, 'A', 1], W: [10, 'mm', 1e-3], Ln: [10, 'mm', 1e-3], H: [1, 'mm', 1e-3], mCu: [0.1, 'kg', 1], Pcap: [1, 'W', 1], Eb_a: [10, 'Wh', 1], Eb_r: [10, 'Wh', 1], Breq: [1, 'mT', 1e-3] };
function shadow(i) {
  const c = CN[i], lam = S.sol ? S.sol.lam[i] : 0; if (!(lam > 1e-4) || !STEP[c.id]) return '';
  const [step, unit, si] = STEP[c.id], scl = S.r.scl[i], minP = S.P.objective === 'minP';
  if (c.id === 'Breq') return minP ? `+${fx(10 * lam / S.P.BaReq * step * si, 2)} W per +${step} ${unit}` : '';
  if (minP) return `−${fx(10 * lam / scl * step * si, 2)} W per +${step} ${unit}`;
  return `+${fx(1e-3 * lam / scl * step * si * 1e3, 3)} mT per +${step} ${unit}`;
}
function fillFrac(i) {
  const c = CN[i], r = S.r, v = r.val[i], l = r.lim[i], Ta = S.P.thermal.Ta;
  if (!isFinite(l)) return 0;
  if (c.id.startsWith('Tc_') || c.id.startsWith('Ts_')) return (v - Ta) / (l - Ta);
  if (c.id === 'Breq') return l > 0 ? l / v : 0;
  return v / l;
}
function fmtVal(i) {
  const c = CN[i], v = S.r.val[i], l = S.r.lim[i];
  const u = x => c.unit === 'mm' ? fx(x * 1e3, 0) : c.unit === 'mT' ? fx(x * 1e3, 2) : c.unit === 'kg' ? fx(x, 2) : c.unit === '°C' ? fx(x, 1) : c.unit === 'V/m' ? fx(x, 2) : c.unit === '' ? fx(x, 0) : fx(x, 1);
  if (c.id === 'bw' || c.id === 'bl') return `band ${fx(v * 1e3, 0)} of ${fx(l * 1e3, 0)} mm`;
  return `${u(v)} / ${isFinite(l) ? u(l) : '∞'} ${c.unit}`;
}
TABS.opt = {
  build(h) {
    h.innerHTML = card('Design variables', '<div id="vars"></div><div class="btnrow"><button type="button" class="btn ghost" id="relBtn">Release all holds</button><button type="button" class="btn" id="globBtn">Search from several starts</button></div>',
      '', 'Drag a slider to hold that variable. The solver re-optimizes everything else around it. A padlock marks a held value.') +
      card('Constraint ledger', '<div id="ledger"></div><label class="chk sm"><input type="checkbox" id="showAll"> Show slack constraints</label>', '', 'Each limit is a constraint g ≤ 0. The multiplier λ is its price: how much the objective improves per unit the limit is relaxed.') +
      card('Optimality check', '<div id="kktBox"></div>');
    $('#vars').innerHTML = VAR.map((v, i) => `<div class="vrow" data-i="${i}"><div class="vname"><label for="vs${i}">${esc(v.label)}</label><small id="vb${i}"></small></div><div class="vsl"><input type="range" id="vs${i}" data-v="${i}" min="0" max="1000" step="1"><div class="vend"><span>${fx(v.lo * v.sc, v.dec)}</span><span>${fx(v.hi * v.sc, v.dec)} ${esc(v.unit)}</span></div></div><div class="vval"><b id="vv${i}"></b> <span>${esc(v.unit)}</span></div><button type="button" class="lockb" data-lock="${i}" aria-pressed="false" aria-label="Hold ${esc(v.label)}"></button></div>`).join('');
    $('#vars').addEventListener('input', e => {
      const t = e.target; if (t.dataset.v == null) return; const i = +t.dataset.v, u = C.toU(S.x).slice(); u[i] = +t.value / 1000; const x = C.toX(u);
      S.lock[i] = x[i]; S.x[i] = x[i]; quickEval(); this.paintVars(i); renderReadout(); this.paintLedger(); this.paintKkt(); solveSoon(); saveSoon();
    });
    $('#vars').addEventListener('click', e => {
      const b = e.target.closest('[data-lock]'); if (!b) return; const i = +b.dataset.lock;
      S.lock[i] = S.lock[i] == null ? S.x[i] : null; this.paintVars(); solveSoon(); saveSoon();
    });
    $('#relBtn').addEventListener('click', () => { S.lock.fill(null); this.paintVars(); solveNow(); saveSoon(); });
    $('#globBtn').addEventListener('click', () => solveNow({ global: true }));
    $('#showAll').addEventListener('change', e => { S.showAll = e.target.checked; this.paintLedger(); });
  },
  paintVars(skip) {
    const u = C.toU(S.x);
    VAR.forEach((v, i) => {
      const sl = $('#vs' + i); if (i !== skip && document.activeElement !== sl) sl.value = Math.round(clamp(u[i], 0, 1) * 1000);
      $('#vv' + i).textContent = fx(S.x[i] * v.sc, v.dec);
      const locked = S.lock[i] != null, bnd = S.sol ? S.sol.atBound[i] : '';
      const lb = $(`[data-lock="${i}"]`); lb.setAttribute('aria-pressed', locked); lb.innerHTML = locked ? LOCK_SVG : UNLOCK_SVG; lb.title = locked ? 'Held. Click to let the solver choose.' : 'Free. Click to hold the current value.';
      const note = locked ? 'held by you' : bnd === 'lo' ? 'at its lower bound' : bnd === 'hi' ? 'at its upper bound' : 'chosen by solver';
      const el = $('#vb' + i); el.textContent = note; el.className = locked ? 'held' : bnd ? 'atb' : '';
    });
  },
  paintLedger() {
    const rows = CN.map((c, i) => ({ c, i, l: S.sol ? S.sol.lam[i] : 0, f: fillFrac(i) })).filter(o => isFinite(S.r.lim[o.i]) && !(o.c.id === 'Breq' && S.P.objective !== 'minP'));
    rows.sort((a, b) => (b.l > 1e-3) - (a.l > 1e-3) || b.f - a.f);
    const shown = rows.filter(o => S.showAll || o.l > 1e-3 || o.f > 0.6 || S.r.g[o.i] > 1e-3);
    $('#ledger').innerHTML = shown.map(o => {
      const gv = S.r.g[o.i], over = gv > 1e-3, act = o.l > 1e-3 || gv > -0.01; const f = clamp(o.f, 0, 1.25);
      const sh = shadow(o.i);
      return `<div class="lrow ${over ? 'over' : act ? 'act' : ''}"><div class="ln"><span>${esc(o.c.label)}</span><em>${over ? '<b class="tag">over</b>' : act ? '<b class="tag">binding</b>' : ''}</em></div><div class="lb"><div class="bar"><i style="width:${(f / 1.25 * 100).toFixed(1)}%"></i><u style="left:${(1 / 1.25 * 100).toFixed(1)}%"></u></div></div><div class="lv">${esc(fmtVal(o.i))}</div><div class="ll">${o.l > 1e-3 ? `<span class="lam">λ ${o.l < 10 ? o.l.toFixed(3) : o.l.toFixed(1)}</span>${sh ? `<span class="sh">${esc(sh)}</span>` : ''}` : '<span class="mut">slack</span>'}</div></div>`;
    }).join('') || '<p class="note">Nothing is near a limit.</p>';
  },
  paintKkt() {
    const s = S.sol; if (!s) { $('#kktBox').innerHTML = ''; return; }
    const act = CN.map((c, i) => ({ c, l: s.lam[i] })).filter(o => o.l > 1e-3), tr = s.trace || [];
    const held = S.lock.filter(v => v != null).length;
    $('#kktBox').innerHTML = `<div class="kgrid">
      <div><span>Stationarity ‖∇ₓℒ‖</span><b>${s.kkt.stat.toExponential(1)}</b></div>
      <div><span>Worst constraint violation</span><b>${s.kkt.viol.toExponential(1)}</b></div>
      <div><span>Complementarity max |λ·g|</span><b>${s.kkt.comp.toExponential(1)}</b></div>
      <div><span>Active constraints</span><b>${act.length}</b></div>
      <div><span>Model evaluations</span><b>${s.evals}</b></div>
      <div><span>Multiplier iterations</span><b>${tr.length}</b></div></div>
      <p class="note">${held ? `${held} variable${held > 1 ? 's are' : ' is'} held, so this is the best design with those values fixed. ` : ''}${S.P.objective === 'minP' ? 'Heat mode: objective is coil dissipation.' : 'Flux mode: objective is −B at the target.'} When the stationarity residual is near zero, the objective gradient is exactly balanced by the multiplier-weighted constraint gradients: ∇f + Σ λᵢ ∇gᵢ = 0.</p>`;
  },
  update() { this.paintVars(); this.paintLedger(); this.paintKkt(); }
};

/* ---------------- Lagrangian slice tab ---------------- */
function sliceCompute() {
  const tok = ++sliceTok, n = 34, i = S.slice.i, j = S.slice.j, u0 = C.toU(S.x), m = CN.length;
  const data = { n, i, j, val: new Float64Array(n * n), G: new Float64Array(n * n * m), done: 0 }; S.sliceData = data;
  let row = 0;
  const step = () => {
    if (tok !== sliceTok) return;
    const t0 = performance.now();
    while (row < n && performance.now() - t0 < 14) {
      for (let a = 0; a < n; a++) {
        const u = u0.slice(); u[i] = (a + 0.5) / n; u[j] = (row + 0.5) / n; const r = C.evaluate(C.toX(u), S.P);
        data.val[row * n + a] = S.P.objective === 'minP' ? r.A.Pcoil : r.A.Bpk * 1e3;
        for (let k = 0; k < m; k++) data.G[(row * n + a) * m + k] = r.g[k];
      }
      row++;
    }
    data.done = row; TABS.lag.paintSlice();
    if (row < n) setTimeout(step, 0);
  };
  step();
}
let sliceTok = 0;
TABS.lag = {
  build(h) {
    const opts = VAR.map((v, i) => `<option value="${i}">${esc(v.label)}</option>`).join('');
    h.innerHTML = card('Constraint landscape', `<div class="toolrow"><label class="sel">Horizontal<select id="slI">${opts}</select></label><label class="sel">Vertical<select id="slJ">${opts}</select></label></div>
      <div class="mapwrap sq" id="slwrap"><canvas id="slC" role="img" aria-label="Objective landscape with constraint boundaries"></canvas><div class="maptip" id="slTip" hidden></div></div><div id="slLegend" class="slleg"></div><p class="note" id="slNote"></p>`,
      '', 'A two-variable slice through the design space, all other variables at their current values. Colour is the objective; hatched area breaks at least one limit; each line is one limit being exactly met.') +
      `<div class="grid2">${card('Force balance at the optimum', '<div id="forceBox"></div>', '', 'The two arrows are ∇B (the pull of the objective) and Σ λᵢ ∇gᵢ (the push of the active limits) projected onto this slice. At a true optimum they are equal and opposite.')}
      ${card('How the multipliers converged', '<div id="chConv"></div><div id="chConv2"></div>', '', 'Each point is one outer iteration of the augmented Lagrangian: λ is updated, the penalty grows if needed, and the violation falls toward zero.')}</div>
      ${card('Lagrangian at the solution', '<div id="lagBox"></div>')}`;
    $('#slI').value = S.slice.i; $('#slJ').value = S.slice.j;
    const ch = () => { S.slice.i = +$('#slI').value; S.slice.j = +$('#slJ').value; if (S.slice.i === S.slice.j) { S.slice.j = (S.slice.i + 1) % NV; $('#slJ').value = S.slice.j; } sliceCompute(); };
    $('#slI').addEventListener('change', ch); $('#slJ').addEventListener('change', ch);
    this.conv = [new LineChart($('#chConv'), { height: 150 }), new LineChart($('#chConv2'), { height: 150 })];
    const cv = $('#slC'), tip = $('#slTip');
    const pos = ev => { const rc = cv.getBoundingClientRect(); return [clamp((ev.clientX - rc.left) / rc.width, 0, 1), clamp(1 - (ev.clientY - rc.top) / rc.height, 0, 1), rc]; };
    cv.addEventListener('pointermove', ev => {
      const [a, b, rc] = pos(ev), u = C.toU(S.x).slice(); u[S.slice.i] = a; u[S.slice.j] = b; const x = C.toX(u), vi = VAR[S.slice.i], vj = VAR[S.slice.j];
      tip.innerHTML = `<b>${fx(x[S.slice.i] * vi.sc, vi.dec)} ${esc(vi.unit)} · ${fx(x[S.slice.j] * vj.sc, vj.dec)} ${esc(vj.unit)}</b><span>click to hold both</span>`; tip.hidden = false;
      tip.style.left = clamp(ev.clientX - rc.left + 12, 0, rc.width - tip.offsetWidth - 2) + 'px'; tip.style.top = clamp(ev.clientY - rc.top - 34, 0, rc.height - 36) + 'px';
    });
    cv.addEventListener('pointerleave', () => { tip.hidden = true; });
    cv.addEventListener('click', ev => {
      const [a, b] = pos(ev), u = C.toU(S.x).slice(); u[S.slice.i] = a; u[S.slice.j] = b; const x = C.toX(u);
      S.lock[S.slice.i] = x[S.slice.i]; S.lock[S.slice.j] = x[S.slice.j]; S.x[S.slice.i] = x[S.slice.i]; S.x[S.slice.j] = x[S.slice.j]; quickEval(); renderReadout(); this.update(true); solveSoon(); saveSoon();
    });
  },
  update(keep) {
    if (!keep || !S.sliceData || S.sliceStale) { S.sliceStale = false; sliceCompute(); } else this.paintSlice();
    this.paintSide();
  },
  tracked() {
    const lam = S.sol ? S.sol.lam : [], out = [];
    CN.forEach((c, i) => { if (c.id === 'Breq' && S.P.objective !== 'minP') return; const l = lam[i] || 0; if (l > 1e-3 || (S.r.g[i] > -0.3 && S.r.g[i] < 0.3 && isFinite(S.r.lim[i]))) out.push({ i, l }); });
    out.sort((a, b) => b.l - a.l || Math.abs(S.r.g[a.i]) - Math.abs(S.r.g[b.i])); return out.slice(0, 6);
  },
  paintSlice() {
    const d = S.sliceData, cv = $('#slC'); if (!d || !cv) return;
    const wrap = $('#slwrap'), W = Math.max(260, Math.min(wrap.clientWidth, 560)), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = W + 'px'; cv.style.height = W * 0.8 + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(W * 0.8 * dpr);
    const H = W * 0.8, ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = d.n, m = CN.length, dark = isDark(), surf = cssVar('--surface'), ink = cssVar('--ink'), muted = cssVar('--muted');
    let vmin = Infinity, vmax = -Infinity; const rows = d.done;
    for (let k = 0; k < rows * n; k++) { const v = d.val[k]; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
    if (!(vmax > vmin)) { vmin = 0; vmax = 1; }
    const minP = S.P.objective === 'minP';
    const img = new ImageData(n, n), mask = new ImageData(n, n);
    for (let jj = 0; jj < n; jj++) for (let a = 0; a < n; a++) {
      const row = n - 1 - jj, k = row * n + a, o = (jj * n + a) * 4; const done = row < rows;
      let t = done ? (d.val[k] - vmin) / (vmax - vmin) : 0.5; if (minP) t = 1 - t;
      const c = rampColor(done ? t : 0.5, dark); img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = done ? 255 : 90;
      let mg = -Infinity; if (done) for (let q = 0; q < m; q++) { if (CN[q].id === 'Breq' && !minP) continue; const g = d.G[k * m + q]; if (g > mg) mg = g; }
      const sc = hex2rgb(surf.length === 7 ? surf : '#ffffff'); mask.data[o] = sc[0]; mask.data[o + 1] = sc[1]; mask.data[o + 2] = sc[2]; mask.data[o + 3] = (done && mg > 1e-6) ? 175 : 0;
    }
    const mk = (id) => { const c = document.createElement('canvas'); c.width = n; c.height = n; c.getContext('2d').putImageData(id, 0, 0); return c; };
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(mk(img), 0, 0, W, H); ctx.drawImage(mk(mask), 0, 0, W, H);
    // hatch over infeasible region
    const hat = document.createElement('canvas'); hat.width = Math.round(W * dpr); hat.height = Math.round(H * dpr); const hc = hat.getContext('2d'); hc.setTransform(dpr, 0, 0, dpr, 0, 0);
    hc.strokeStyle = ink; hc.globalAlpha = 0.28; hc.lineWidth = 1; for (let k = -H; k < W; k += 7) { hc.beginPath(); hc.moveTo(k, H); hc.lineTo(k + H, 0); hc.stroke(); }
    hc.setTransform(1, 0, 0, 1, 0, 0); hc.globalCompositeOperation = 'destination-in'; hc.imageSmoothingEnabled = true; hc.drawImage(mk(mask), 0, 0, hat.width, hat.height);
    ctx.drawImage(hat, 0, 0, W, H);
    // constraint boundaries (g = 0)
    const tr = this.tracked(); const PXg = gx => (gx + 0.5) / n * W, PYg = gy => H - (n - 1 - gy + 0.5) / n * H;
    const flip = gy => (n - 1 - gy);
    tr.forEach((o, ci) => {
      const grid = new Float64Array(n * n); for (let k = 0; k < n * n; k++) grid[k] = d.G[k * m + o.i];
      const segs = contour(grid, n, n, 0); ctx.strokeStyle = cssVar(CAT[ci % CAT.length]); ctx.lineWidth = 2.4; ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.beginPath();
      for (const s of segs) { ctx.moveTo((s[0] + 0.5) / n * W, H - (s[1] + 0.5) / n * H); ctx.lineTo((s[2] + 0.5) / n * W, H - (s[3] + 0.5) / n * H); } ctx.stroke();
    });
    // path of outer iterations + current design
    const u = C.toU(S.x), X = v => v * W, Y = v => H - v * H, ti = S.slice.i, tj = S.slice.j;
    const trc = S.sol && S.sol.trace ? S.sol.trace : [];
    if (trc.length) {
      ctx.strokeStyle = surf; ctx.lineWidth = 4; ctx.beginPath(); trc.forEach((t, k) => k ? ctx.lineTo(X(t.u[ti]), Y(t.u[tj])) : ctx.moveTo(X(t.u[ti]), Y(t.u[tj]))); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.6; ctx.beginPath(); trc.forEach((t, k) => k ? ctx.lineTo(X(t.u[ti]), Y(t.u[tj])) : ctx.moveTo(X(t.u[ti]), Y(t.u[tj]))); ctx.stroke();
      trc.forEach((t, k) => { ctx.beginPath(); ctx.arc(X(t.u[ti]), Y(t.u[tj]), 3, 0, 7); ctx.fillStyle = ink; ctx.fill(); });
    }
    this.arrows = this.forces(); const A = this.arrows;
    const ax = X(u[ti]), ay = Y(u[tj]);
    if (A) {
      const sc = 46 / Math.max(A.fMag, A.cMag, 1e-12);
      const arrow = (vx, vy, col) => { const ex = ax + vx * sc, ey = ay - vy * sc; ctx.strokeStyle = surf; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); const an = Math.atan2(ey - ay, ex - ax); ctx.lineTo(ex - 7 * Math.cos(an - 0.45), ey - 7 * Math.sin(an - 0.45)); ctx.moveTo(ex, ey); ctx.lineTo(ex - 7 * Math.cos(an + 0.45), ey - 7 * Math.sin(an + 0.45)); ctx.stroke(); };
      if (A.fMag * sc > 3) arrow(A.f[0], A.f[1], cssVar('--c1')); if (A.cMag * sc > 3) arrow(A.c[0], A.c[1], cssVar('--c2'));
    }
    ctx.beginPath(); ctx.arc(ax, ay, 6.5, 0, 7); ctx.fillStyle = surf; ctx.fill(); ctx.lineWidth = 2.2; ctx.strokeStyle = ink; ctx.stroke(); ctx.beginPath(); ctx.arc(ax, ay, 2.2, 0, 7); ctx.fillStyle = ink; ctx.fill();
    // axes labels
    const vi = VAR[ti], vj = VAR[tj]; ctx.fillStyle = muted; ctx.font = '10px "IBM Plex Mono", monospace';
    const tickVals = [0, 0.25, 0.5, 0.75, 1];
    ctx.textAlign = 'center'; tickVals.forEach(tv => { const uu = u.slice(); uu[ti] = tv; const xx = C.toX(uu)[ti] * vi.sc; const px = clamp(X(tv), 14, W - 14); ctx.fillStyle = surf; ctx.globalAlpha = .7; ctx.fillRect(px - 16, H - 14, 32, 13); ctx.globalAlpha = 1; ctx.fillStyle = muted; ctx.fillText(fx(xx, vi.dec), px, H - 4); });
    ctx.textAlign = 'left'; tickVals.forEach(tv => { const uu = u.slice(); uu[tj] = tv; const yy = C.toX(uu)[tj] * vj.sc; const py = clamp(Y(tv), 10, H - 18); ctx.fillStyle = surf; ctx.globalAlpha = .7; ctx.fillRect(0, py - 6, 30, 12); ctx.globalAlpha = 1; ctx.fillStyle = muted; ctx.fillText(fx(yy, vj.dec), 2, py + 3.5); });
    $('#slLegend').innerHTML = `<span class="lg"><i class="sq" style="background:linear-gradient(90deg,${rampHex(0)},${rampHex(1)})"></i>${minP ? 'coil heat' : 'flux at target'} ${fx(vmin, 1)} to ${fx(vmax, 1)} ${minP ? 'W' : 'mT'}</span><span class="lg"><i class="hatch"></i>breaks a limit</span>` + tr.map((o, k) => `<span class="lg"><i style="background:${cssVar(CAT[k % CAT.length])}"></i>${esc(CN[o.i].label)}</span>`).join('') + `<span class="lg"><i class="dot"></i>solver path</span>`;
    $('#slNote').innerHTML = rows < n ? 'Computing the landscape…' : `Horizontal: <b>${esc(vi.label)}</b> (${esc(vi.unit)}). Vertical: <b>${esc(vj.label)}</b> (${esc(vj.unit)}). Click anywhere to hold both values and re-optimize the rest.`;
  },
  forces() {
    if (!S.sol) return null; const ti = S.slice.i, tj = S.slice.j, u0 = C.toU(S.x), h = 2e-4, m = CN.length;
    const ev = (a, b) => { const u = u0.slice(); u[ti] = clamp(a, 0, 1); u[tj] = clamp(b, 0, 1); return C.evaluate(C.toX(u), S.P); };
    const pa = ev(u0[ti] + h, u0[tj]), ma = ev(u0[ti] - h, u0[tj]), pb = ev(u0[ti], u0[tj] + h), mb = ev(u0[ti], u0[tj] - h);
    const d = (rp, rm, hh) => { const f = -(rp.f - rm.f) / (2 * hh); let c = 0; for (let k = 0; k < m; k++) c -= S.sol.lam[k] * (rp.g[k] - rm.g[k]) / (2 * hh); return [f, c]; };
    const [fx_, cx] = d(pa, ma, h), [fy, cy] = d(pb, mb, h);
    return { f: [fx_, fy], c: [cx, cy], fMag: Math.hypot(fx_, fy), cMag: Math.hypot(cx, cy) };
  },
  paintSide() {
    const A = this.arrows || this.forces(); const minP = S.P.objective === 'minP';
    if (A) {
      const dot = (A.f[0] * A.c[0] + A.f[1] * A.c[1]) / ((A.fMag * A.cMag) || 1), bal = A.fMag > 0 ? Math.hypot(A.f[0] + A.c[0], A.f[1] + A.c[1]) / A.fMag : 0;
      $('#forceBox').innerHTML = `<div class="kgrid"><div><span><i class="sw" style="background:${cssVar('--c1')}"></i>${minP ? '−∇P' : '∇B'} (objective pull)</span><b>${A.fMag.toExponential(2)}</b></div><div><span><i class="sw" style="background:${cssVar('--c2')}"></i>−Σ λᵢ ∇gᵢ (limits push back)</span><b>${A.cMag.toExponential(2)}</b></div><div><span>Alignment (−1 = opposite)</span><b>${fx(dot, 3)}</b></div><div><span>Unbalanced share of pull</span><b>${fx(bal * 100, 1)}%</b></div></div>`;
    }
    const tr = S.sol && S.sol.trace ? S.sol.trace : [];
    const pts = tr.map((t, k) => [k + 1, Math.log10(Math.max(t.viol, 1e-8))]), pb = tr.map((t, k) => [k + 1, t.B * 1e3]);
    this.conv[0].set({ series: [{ name: 'log₁₀ worst violation', color: cssVar('--c2'), pts, dots: true }], xLabel: 'outer iteration', yLabel: 'log₁₀ g', yZero: false, fmtX: v => v.toFixed(0), yDom: [-8, 1] });
    this.conv[1].set({ series: [{ name: minP ? 'flux (mT)' : 'flux at target (mT)', color: cssVar('--c1'), pts: pb, dots: true }], xLabel: 'outer iteration', yLabel: 'mT', fmtX: v => v.toFixed(0) });
    const r = S.r, lam = S.sol ? S.sol.lam : [], f = r.f; let sum = 0, parts = [];
    CN.forEach((c, i) => { if (lam[i] > 1e-3) { const t = lam[i] * r.g[i]; sum += t; parts.push(`λ<sub>${esc(c.id)}</sub> g = ${(lam[i]).toFixed(3)} × ${r.g[i].toFixed(4)}`); } });
    $('#lagBox').innerHTML = `<div class="eqline">${tex('\\mathcal{L}(x,\\lambda)=f(x)+\\sum_i \\lambda_i\\,g_i(x)')}</div><p class="note">f = ${minP ? 'P/10 W' : '−B/1 mT'} = <b>${fx(f, 4)}</b> · Σ λᵢ gᵢ = <b>${sum.toExponential(1)}</b> (zero by complementary slackness) · ℒ = <b>${fx(f + sum, 4)}</b>.${parts.length ? '<br>' + parts.join(' · ') : ''}</p>`;
  }
};
function rampHex(t) { const c = rampColor(t, isDark()); return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; }
