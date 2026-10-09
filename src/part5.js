/* ===================== part 5: trade-offs, equations, build sheet, wiring ===================== */

/* ---------------- trade-offs ---------------- */
const AXES = {
  Imax: { label: 'Peak current budget', unit: 'A', vals: [3, 5, 7, 10, 14, 20, 28, 40, 60], set: (P, v) => { P.drive.Isw = v; }, cons: 'I_a', k: 1 },
  Pcap: { label: 'Heat budget (acute)', unit: 'W', vals: [4, 7, 10, 14, 20, 28, 40, 55, 75], set: (P, v) => { P.size.Pcap = v; }, cons: 'Pcap', k: 1 },
  Tmax: { label: 'Coil temperature limit', unit: '°C', vals: [40, 45, 50, 55, 60, 65, 70, 75, 80], set: (P, v) => { P.thermal.Tmax = v; }, cons: 'Tc_a', k: 1 },
  tsess: { label: 'Acute session length', unit: 'min', vals: [2, 5, 8, 12, 17, 23, 30, 45, 60], set: (P, v) => { P.acute.tsess = v * 60; } },
  duty: { label: 'Acute burst duty', unit: '%', vals: [20, 30, 40, 50, 60, 70, 80, 90, 100], set: (P, v) => { P.acute.duty = v / 100; } },
  depth: { label: 'Target depth', unit: 'cm', vals: [3, 4, 5, 6, 7, 8, 9, 10, 11], set: (P, v) => { P.depth = v / 100; } },
  mmax: { label: 'Copper mass limit', unit: 'kg', vals: [0.4, 0.7, 1, 1.4, 1.8, 2.4, 3, 3.6, 4.4], set: (P, v) => { P.size.mmax = v; }, cons: 'mCu', k: 1 },
  Hmax: { label: 'Profile height limit', unit: 'mm', vals: [10, 13, 16, 20, 24, 28, 33, 38, 45], set: (P, v) => { P.size.Hmax = v / 1e3; }, cons: 'H', k: 1e-3 },
  Elim: { label: 'Induced E-field limit', unit: 'V/m', vals: [0.3, 0.45, 0.6, 0.8, 1.1, 1.5, 2, 2.6, 3.3], set: (P, v) => { P.Elim = v; }, cons: 'E_a', k: 1 }
};
function axisCurrent(key) {
  const P = S.P;
  return { Imax: P.drive.Isw, Pcap: P.size.Pcap, Tmax: P.thermal.Tmax, tsess: P.acute.tsess / 60, duty: P.acute.duty * 100, depth: P.depth * 100, mmax: P.size.mmax, Hmax: P.size.Hmax * 1e3, Elim: P.Elim }[key];
}
const metric = res => obj().fromSol(res);
const metricName = () => [obj().name, obj().unit];
let sweepTimer = null;
function sweepSoon() { clearTimeout(sweepTimer); sweepTimer = setTimeout(runTrade, 600); }
function runTrade() {
  if (!S.sol) return;
  const key = S.sweep.axis, ax = AXES[key], P0 = clonePSafe(S.P);
  const jobs = ax.vals.map((v, k) => { const P = clonePSafe(P0); ax.set(P, v); return { P, warm: k > 0, opt: Object.assign({ lock: lockFor(P), maxOuter: 8, maxInner: 60 }, k === 0 ? { starts: [S.sol.u], lam0: S.sol.lam } : {}) }; });
  S.sweep.busy = true; S.sweep.stale = false; S.sweep.data = { key, pts: [] }; const data = S.sweep.data;
  if (TABS.trade.built) TABS.trade.paintSweep();
  batchRunner.start({ type: 'batch', jobs }, (k, res) => { let ev = null; try { ev = C.evaluate(res.x, jobs[k].P).A; } catch (e) { } data.pts.push({ v: ax.vals[k], res, ev }); if (S.tab === 'trade') TABS.trade.paintSweep(); }).then(() => {
    S.sweep.busy = false; if (S.tab === 'trade') TABS.trade.paintSweep();
    runSupplies();
  }).catch(e => { if (e !== 'cancelled') { S.sweep.busy = false; } });
}
function runSupplies() {
  const keys = ['wall12', 'wall24', 'bat24', 'bat48'], base = clonePSafe(S.P);
  const jobs = keys.map(k => { const P = clonePSafe(base); P.supply = Object.assign({}, C.SUPPLIES[k]); return { P, opt: { lock: lockFor(P), starts: coldStarts(2).concat([S.sol.u]), maxOuter: 8, maxInner: 60 } }; });
  S.supplyCmp.busy = true; S.supplyCmp.stale = false; S.supplyCmp.data = keys.map(k => ({ key: k, res: null }));
  batchRunner.start({ type: 'batch', jobs }, (k, res) => { S.supplyCmp.data[k].res = res; if (S.tab === 'trade') TABS.trade.paintSupplies(); }).then(() => { S.supplyCmp.busy = false; if (S.tab === 'trade') TABS.trade.paintSupplies(); }).catch(e => { if (e !== 'cancelled') S.supplyCmp.busy = false; });
}
TABS.trade = {
  build(h) {
    h.innerHTML = card('Trade-off sweep', `<div class="toolrow"><label class="sel">Vary<select id="axSel">${Object.keys(AXES).map(k => `<option value="${k}">${esc(AXES[k].label)} (${esc(AXES[k].unit)})</option>`).join('')}</select></label><span id="swState" class="chip busy" hidden></span></div>
      <div id="chSweep"></div><p class="note" id="swNote"></p>`, '', 'Each point is a full re-optimization of the whole design with one limit changed. The dashed tangent is the slope predicted by the Lagrange multiplier alone, with no re-solve.') +
      card('How the design adapts', '<div id="chAdapt"></div><div class="tablewrap" id="swTable"></div>', '', 'Every variable shown as its position within its allowed range (0 = minimum, 1 = maximum). The table lists the actual values.') +
      card('Which power source?', '<div id="supBars"></div><p class="note" id="supNote"></p>', '', 'The same problem solved from scratch for each source, with your other settings unchanged.');
    this.ch = new LineChart($('#chSweep'), { height: 220 }); this.adapt = new LineChart($('#chAdapt'), { height: 200 });
    $('#axSel').value = S.sweep.axis;
    $('#axSel').addEventListener('change', e => { S.sweep.axis = e.target.value; S.sweep.data = null; S.sweep.stale = true; this.paintSweep(); sweepSoon(); });
  },
  update() { if (this.built) { this.paintSweep(); this.paintSupplies(); } if ((S.sweep.stale || S.supplyCmp.stale) && !S.sweep.busy && !S.supplyCmp.busy) sweepSoon(); },
  paintSweep() {
    const d = S.sweep.data, key = S.sweep.axis, ax = AXES[key], [mn, mu] = metricName(); const cur = axisCurrent(key), minP = obj().min;
    const st = $('#swState'); st.hidden = !(S.sweep.busy || S.sweep.stale); st.innerHTML = S.sweep.busy ? `<i class="spin"></i>Solving ${d ? d.pts.length : 0} of ${ax.vals.length}` : '<i class="spin"></i>Queued';
    const pts = d && d.key === key ? d.pts.slice().sort((a, b) => a.v - b.v) : [];
    const ok = pts.filter(p => p.res.kkt.viol < 5e-3), series = [{ name: mn + ' (best design at each setting)', color: cssVar('--c1'), pts: ok.map(p => [p.v, metric(p.res)]), dots: true }];
    const bad = pts.filter(p => p.res.kkt.viol >= 5e-3); if (bad.length) series.push({ name: 'No feasible design', color: cssVar('--c3'), pts: bad.map(p => [p.v, metric(p.res)]), dots: true, w: 0 });
    const markers = [], y0 = S.sol ? obj().fromSol(S.sol) : 0;
    let xc = cur; if (key === 'Pcap' && !isFinite(cur)) xc = S.r.A.Pcoil;
    if (S.sol && isFinite(xc)) {
      markers.push({ x: xc, y: y0, color: cssVar('--ink'), label: 'now' });
      if (ax.cons && CI[ax.cons] != null) {
        const i = CI[ax.cons], lam = S.sol.lam[i], scl = S.r.scl[i], slope = obj().slope * lam / scl * ax.k, xs = ok.length ? ok.map(p => p.v) : [xc], span = (Math.max(...xs) - Math.min(...xs)) * 0.22 || xc * 0.2;
        series.push({ name: `Tangent from λ = ${lam.toFixed(3)}`, color: cssVar('--c2'), dash: '6 4', w: 1.8, pts: [[xc - span, y0 - slope * span], [xc + span, y0 + slope * span]] });
      }
    }
    this.ch.set({ series, markers, xLabel: `${ax.label} (${ax.unit})`, yLabel: mu, yUnit: mu, xUnit: ax.unit, yZero: false });
    const nm = ok.length > 1 ? ok.reduce((a, p) => Math.abs(p.v - xc) < Math.abs(a.v - xc) ? p : a, ok[0]) : null;
    $('#swNote').innerHTML = !pts.length ? 'Sweep starts a moment after the design settles.' : bad.length ? `${bad.length} setting${bad.length > 1 ? 's' : ''} have no feasible design: the orange points show the least-bad attempt.` : (ax.cons && S.sol && S.sol.lam[CI[ax.cons]] > 1e-3 ? `The limit is binding now, so loosening it pays off at the tangent slope; the curve bends away as other limits take over.` : ax.cons ? 'This limit is slack at the current optimum, so changing it moves nothing until it starts to bind.' : 'No single multiplier prices this variable, so only the re-solved curve is shown.');
    // adaptation chart + table
    const names = VAR.map(v => v.label), ser = VAR.map((v, i) => ({ name: v.label, color: cssVar(CAT[i % CAT.length]), pts: ok.map(p => [p.v, p.res.u[i]]), w: 1.8 }));
    this.adapt.set({ series: ser, yDom: [0, 1], xLabel: `${ax.label} (${ax.unit})`, yLabel: 'position in range', yZero: false, tipY: v => v.toFixed(2) });
    const rows = pts.map(p => { const x = p.res.x, lamI = p.res.lam.map((l, i) => ({ l, i })).sort((a, b) => b.l - a.l)[0]; const top = lamI && lamI.l > 1e-3 ? CN[lamI.i].label : 'none';
      return `<tr><td>${fx(p.v, ax.vals[0] < 2 ? 2 : 1)}</td><td>${fx(metric(p.res), 2)}</td><td>${fx(x[0] * 1e3, 0)} × ${fx(x[1] * 1e3, 0)}</td><td>${fx(x[2], 1)}</td><td>${fx(x[3], 1)}</td><td>${fx(x[4] * 180 / Math.PI, 1)}°</td><td><b>${fx(x[6], 1)}</b></td><td>${p.ev ? fx(p.ev.Vreq, 1) : ''}</td><td>${p.ev ? fx(p.ev.Pcoil, 1) : ''}</td><td class="l">${esc(top)}</td></tr>`; }).join('');
    $('#swTable').innerHTML = rows ? `<table><thead><tr><th>${esc(ax.unit)}</th><th>${esc(mu)}</th><th>Wing mm</th><th>Turns</th><th>AWG</th><th>Bend</th><th>Amps</th><th>Volts</th><th>Heat W</th><th class="l">Top limit</th></tr></thead><tbody>${rows}</tbody></table>` : '';
  },
  paintSupplies() {
    const d = S.supplyCmp.data; if (!d) { $('#supBars').innerHTML = '<p class="note">Waiting for the first sweep to finish.</p>'; return; }
    const [mn, mu] = metricName(), minP = obj().min, vals = d.filter(o => o.res).map(o => metric(o.res));
    const mx = Math.max(...vals, 1e-9), curKey = S.supplyKey;
    $('#supBars').innerHTML = d.map(o => {
      const nm = C.SUPPLIES[o.key].name; if (!o.res) return `<div class="sbar"><span class="sn">${esc(nm)}</span><div class="sbt"><i style="width:0"></i></div><span class="sv mut">solving…</span></div>`;
      const v = metric(o.res), feas = o.res.kkt.viol < 5e-3, x = o.res.x;
      return `<div class="sbar${o.key === curKey ? ' cur' : ''}"><span class="sn">${esc(nm)}${o.key === curKey ? ' <em>now</em>' : ''}</span><div class="sbt"><i style="width:${(v / mx * 100).toFixed(1)}%" class="${feas ? '' : 'bad'}"></i></div><span class="sv">${fx(v, 2)} ${mu}</span><span class="ss2">${feas ? '' : 'no feasible design · '}${fx(x[2], 1)} turns · AWG ${fx(x[3], 1)} · ${fx(x[6], 1)} A</span></div>`;
    }).join('');
    const ok = d.filter(o => o.res && o.res.kkt.viol < 5e-3);
    if (ok.length > 1 && !S.supplyCmp.busy) {
      const best = ok.reduce((a, o) => (minP ? metric(o.res) < metric(a.res) : metric(o.res) > metric(a.res)) ? o : a, ok[0]), worst = ok.reduce((a, o) => (minP ? metric(o.res) > metric(a.res) : metric(o.res) < metric(a.res)) ? o : a, ok[0]);
      const sp = Math.abs(metric(best.res) / metric(worst.res) - 1) * 100;
      $('#supNote').innerHTML = sp < 4 ? 'The source barely matters here: heat or current sets the result, not voltage. A smaller supply is enough.' : `${esc(C.SUPPLIES[best.key].name)} gives the best result, ${fx(sp, 0)}% ${minP ? 'less heat' : 'more flux'} than ${esc(C.SUPPLIES[worst.key].name)}.`;
    } else $('#supNote').innerHTML = '';
  }
};

/* ---------------- equations ---------------- */
const EQG = [['geo', 'Winding and geometry'], ['field', 'Magnetic field'], ['efield', 'Induced E-field'], ['ind', 'Inductance'], ['drive', 'Waveform and drive'], ['therm', 'Heat'], ['opt', 'Optimization']];
const CGRP = c => { const id = c.id; if (id.startsWith('E_')) return 'efield'; if (id === 'Breq') return 'field'; return ({ thermal: 'therm', drive: 'drive', size: 'geo', field: 'field' })[c.grp] || 'opt'; };
function eqList() {
  const r = S.r, P = S.P, g = r.geo, A = r.A, R = r.R, m = S.mode, res = m === 'a' ? A : R, M = m === 'a' ? P.acute : P.recov, T = res.T, W = C.WAVES[M.wave];
  const lam = S.sol ? S.sol.lam : [], top = CN.map((c, i) => ({ c, l: lam[i] || 0 })).filter(o => o.l > 1e-3).sort((a, b) => b.l - a.l).slice(0, 3);
  const th = r.geo.th * 180 / Math.PI;
  return [
    { g: 'geo', t: 'Wire diameter', e: 'd=0.127\\,\\mathrm{mm}\\cdot 92^{(36-\\mathrm{AWG})/39},\\quad d_I=d+2\\left(0.012\\,\\mathrm{mm}+0.015\\,d\\right)', v: `AWG ${fx(g.awg, 1)}: d = ${fx(g.d * 1e3, 3)} mm bare, ${fx(g.dI * 1e3, 3)} mm with enamel`, n: 'Standard AWG definition. A lower gauge number is thicker wire.' },
    { g: 'geo', t: 'Winding thickness', e: 't=\\max\\!\\left(\\frac{N\\,d_I^{2}}{\\varphi\\,b},\\,d_I\\right)', v: `${fx(g.N, 1)} × ${fx(g.dI * 1e3, 2)}² / (${fx(P.phi, 2)} × ${fx(g.b * 1e3, 0)} mm) = ${fx(g.tRaw * 1e3, 2)} mm → t = ${fx(g.t * 1e3, 2)} mm (${fx(g.layers, 1)} layers)`, n: 'Turns are packed into a band of width b. What does not fit sideways stacks into layers and thickens the coil. A smooth maximum keeps the optimizer well behaved.' },
    { g: 'geo', t: 'Turn length and wire length', e: '\\ell_t=2(w+\\ell)-4b,\\qquad \\ell_w=2N\\,\\ell_t', v: `ℓt = ${fx(g.lturn * 100, 1)} cm, total wire ${fx(g.lw, 1)} m for both wings`, n: 'Mean length of one rectangular turn at the middle of the band, times the turns of both wings.' },
    { g: 'geo', t: 'Resistance with temperature and skin effect', e: 'R(T)=\\rho_{20}\\left[1+\\alpha(T-20)\\right]\\frac{\\ell_w}{A_{Cu}}\\,F_s,\\quad F_s=1+\\frac{(d/2\\delta)^{4}}{48}', v: `R20 = ${fx(g.R20 * 1e3, 1)} mΩ → ${fx(res.Rhot * 1e3, 1)} mΩ at ${fx(T.Tend, 0)} °C, Fs = ${fx(res.Fs, 4)}`, n: 'ρ20 = 1.724e-8 Ω·m, α = 0.0039 per K. Skin effect is negligible at these frequencies for sensible wire.' },
    { g: 'geo', t: 'Copper mass and profile height', e: 'm=\\rho_{Cu}\\,\\ell_w A_{Cu},\\qquad H=t+w\\sin\\theta', v: `m = ${fx(g.mcu, 2)} kg (about $${fx(g.mcu * P.price, 0)} of wire), H = ${fx(r.prof * 1e3, 1)} mm at ${fx(th, 1)}° bend`, n: 'The raised edge of each bent wing sets the profile you lie on.' },
    { g: 'field', t: 'Field of one straight segment (Biot–Savart)', e: '\\vec B=\\frac{\\mu_0 I}{4\\pi\\,d_\\perp}\\left(\\sin\\alpha_2-\\sin\\alpha_1\\right)\\,\\hat t\\times\\hat d', v: `Summed over ${r.S ? 'all' : ''} winding filaments of both wings at the target`, n: 'Exact for a finite straight wire. The coil is thousands of such segments, so there is no far-field or loop approximation.' },
    { g: 'field', t: 'Flux at the target', e: 'B_T=k_B\\,I,\\qquad k_B=\\left|\\sum_{\\mathrm{seg}}\\vec b_{seg}(0,0,z_T)\\right|', v: `z_T = ${fx(r.zT * 100, 1)} cm, k_B = ${fx(r.kB * 1e3, 3)} mT/A, I = ${fx(res.I, 1)} A → B = ${fx(res.Bpk * 1e3, 2)} mT`, n: 'Linear in current, so the optimizer only needs k_B from geometry and I from the heat and voltage limits.' },
    { g: 'field', t: 'Amps against turns', e: 'I=\\frac{B_T}{k_B},\\quad k_B\\approx N\\,k_1,\\quad P_{coil}\\propto\\frac{(N I)^{2}}{m_{Cu}}', v: `${fx(g.N, 1)} turns × ${fx(res.I, 1)} A = ${fx(g.N * res.I, 0)} ampere-turns per ${g.nw === 1 ? 'coil' : 'wing'} for ${fx(res.Bpk * 1e3, 2)} mT; heat ${fx(res.Pcoil, 1)} W from ${fx(g.mcu, 2)} kg of copper`, n: 'Flux needs ampere-turns, and heat is set by ampere-turns and copper mass, not by amps alone. Fewer amps means more turns, which raises inductance and the voltage you need. That is the amps, volts and heat tradeoff.' },
    { g: 'field', t: 'Recovery current', e: 'I_r=\\frac{B_r}{k_B}', v: `${fx(P.recov.Bpk * 1e3, 2)} mT / ${fx(r.kB * 1e3, 3)} mT/A = ${fx(r.Ir, 2)} A`, n: 'Recovery flux is a setting, not a variable, so its current follows from the geometry.' },
    { g: 'efield', t: 'Faraday’s law', e: '\\vec E=-\\frac{\\partial \\vec A}{\\partial t}-\\nabla\\varphi\\ \\approx\\ -\\frac{\\partial \\vec A}{\\partial t}', v: 'Half-space tissue, tangential component, no charge build-up term', n: 'A conservative simplification: surface charge on real tissue boundaries redistributes the field, so verify with FEM before relying on it.' },
    { g: 'efield', t: 'Vector potential of a segment', e: '\\vec A=\\frac{\\mu_0 I}{4\\pi}\\,\\hat t\\left[\\mathrm{asinh}\\frac{s_2}{d_\\perp}-\\mathrm{asinh}\\frac{s_1}{d_\\perp}\\right]', v: `Peak over the skin surface: a_E = ${eng(r.aE, 'Wb/m/A', 3)}`, n: 'Closed form, summed over all segments. The maximum is searched on a grid across the skin under the coil.' },
    { g: 'efield', t: 'Peak induced E-field', e: 'E_{pk}=\\kappa_{slew}\\,f\\,a_E\\,I', v: `${fx(W.slew, 2)} × ${M.f} Hz × ${eng(r.aE, '', 3)} × ${fx(res.I, 1)} A = ${fx(res.Epk, 2)} V/m (reference ${fx(P.Elim, 2)})`, n: 'κ is the waveform’s peak slew: 2π for a sine, 4 for a triangle. Slower waveforms and lower frequency cut E at the same flux.' },
    { g: 'ind', t: 'Neumann mutual inductance', e: 'M_{ij}=\\frac{\\mu_0}{4\\pi}\\oint\\!\\oint\\frac{d\\vec\\ell_i\\cdot d\\vec\\ell_j}{|\\vec r_i-\\vec r_j|}', v: 'Parallel-segment pairs use the closed form Ψ(u) = u·asinh(u/d) − √(u²+d²)', n: 'Evaluated pair by pair for every segment, including the coupling between the two wings.' },
    { g: 'ind', t: 'Total inductance', e: g.nw === 1 ? 'L=L_w' : 'L=2L_w+2M_{12}', v: g.nw === 1 ? `Single coil: L = ${fx(r.ind.L * 1e6, 1)} µH` : `L_w = ${fx(r.ind.Lw * 1e6, 1)} µH, M₁₂ = ${fx(r.ind.M12 * 1e6, 1)} µH → L = ${fx(r.ind.L * 1e6, 1)} µH`, n: 'The wings are wound in opposite sense for the figure-8 field, which makes the series coupling add (M₁₂ > 0).' },
    { g: 'drive', t: 'Coil voltage', e: 'v=R\\,i+L\\frac{di}{dt},\\qquad V_{pk}=I\\sqrt{R^{2}+(2\\pi f L)^{2}}\\ (\\mathrm{sine})', v: `R = ${fx((res.Rhot + res.Rdrive) * 1e3, 0)} mΩ incl. drive, L = ${fx(r.ind.L * 1e6, 0)} µH, f = ${M.f} Hz → V = ${fx(res.Vreq, 2)} V`, n: 'At 100 Hz the inductive part is usually small for a low-turn coil, which is why heat rather than voltage limits the design.' },
    { g: 'drive', t: 'Voltage available from the source', e: 'V_{av}=D_{max}\\left(V_{oc}-R_{src}\\,I_{bus}\\right),\\quad I_{bus}\\approx I\\frac{V_{req}}{V_{oc}}', v: `0.${fx(P.drive.Dmax * 100, 0)} × (${fx(P.supply.Voc, 0)} − ${fx(P.supply.Rsrc * 1e3, 0)} mΩ × ${fx(res.Ibus, 1)} A) = ${fx(res.Vav, 1)} V`, n: 'The H-bridge cannot output the full bus voltage, and the source sags under load.' },
    { g: 'drive', t: 'Input power', e: 'P_{in}=\\delta\\,I_{rms}^{2}\\left(R_{coil}+R_{drive}\\right)+P_{sw},\\quad I_{rms}=\\kappa_{rms}I', v: `coil ${fx(res.Pcoil, 1)} W + drive ${fx(res.Pdrive, 1)} W + switching ${fx(res.Psw, 2)} W = ${fx(res.Pin, 1)} W`, n: 'Only the coil term heats the patient-side surface. Drive losses stay in the electronics.' },
    { g: 'drive', t: 'Battery energy per session', e: 'E=P_{in}\\,t_{sess}\\le 0.8\\,E_{pack}', v: `${fx(res.E_Wh, 1)} Wh of ${isFinite(P.supply.capWh) ? fx(0.8 * P.supply.capWh, 0) + ' Wh usable' : 'unlimited (wall supply)'}`, n: 'A pack is held to 80% of rated energy so it does not run flat mid-session.' },
    { g: 'therm', t: 'Lumped thermal node', e: 'C\\,\\frac{dT}{dt}=P_0\\left[1+\\alpha(T-20)\\right]-G\\,(T-T_{ref})', v: `C = ${fx(T.C, 0)} J/K, G = ${fx(T.G, 2)} W/K, T_ref = ${fx(T.Tref, 1)} °C, P0 = ${fx(T.P0, 1)} W`, n: 'Copper heats itself, loses heat to the air below and through the cover to the body above. Resistance rises with temperature, so heating feeds on itself.' },
    { g: 'therm', t: 'Closed-form temperature', e: 'T(t)=T_{ref}+f_0\\,t\\,\\frac{1-e^{-\\lambda t}}{\\lambda t},\\qquad \\lambda=\\frac{G-\\alpha P_0}{C}', v: T.runaway ? 'λ ≤ 0: thermal runaway, heat generated grows faster than it can leave' : `λ = ${sig(T.lam, 3)} /s, τ = ${fx(T.tau / 60, 1)} min, steady state ${fx(T.Tss, 1)} °C, after ${fx(M.tsess / 60, 0)} min ${fx(T.Tend, 1)} °C`, n: 'Exact solution of the linearized node, so the session limit is checked without time stepping.' },
    { g: 'therm', t: 'Conductances and skin temperature', e: 'G=A_{th}\\left(h_{dn}+U_{up}\\right),\\quad U_{up}=\\left(\\frac{h_0}{k_c}+\\frac{1}{h_t}\\right)^{-1},\\quad T_s=T_{core}+\\frac{U_{up}}{h_t}(T-T_{core})', v: `U_up = ${fx(T.Uup, 2)} W/m²K, A_th = ${fx(T.Ath * 1e4, 0)} cm², skin = ${fx(T.Ts, 1)} °C (limit ${fx(P.thermal.Tskin, 1)})`, n: 'The cover is the thermal path to the patient: thicker or more insulating cover keeps skin cooler but also traps heat in the coil.' },
    { g: 'opt', t: 'The constrained problem', e: '\\min_{x}\\ f(x)\\quad\\mathrm{s.t.}\\quad g_i(x)\\le 0,\\ \\ i=1\\ldots 22', v: `f = ${obj().f} = ${fx(r.f, 4)};  x = [w, ℓ, N, AWG, θ, b, I]`, n: 'Every limit is written as a normalized g ≤ 0 so 1 means “100% over”.' },
    { g: 'opt', t: 'Lagrangian and KKT conditions', e: '\\mathcal{L}=f+\\sum_i\\lambda_i g_i,\\quad \\nabla f+\\sum_i\\lambda_i\\nabla g_i=0,\\quad \\lambda_i\\ge 0,\\quad \\lambda_i g_i=0', v: S.sol ? `stationarity ${S.sol.kkt.stat.toExponential(1)}, violation ${S.sol.kkt.viol.toExponential(1)}, complementarity ${S.sol.kkt.comp.toExponential(1)}` : 'not solved yet', n: 'At the optimum the objective’s pull is exactly cancelled by the active limits. A multiplier of zero means the limit is slack.' },
    { g: 'opt', t: 'Augmented Lagrangian solver', e: '\\mathcal{L}_A=f+\\sum_i\\frac{1}{2\\rho}\\left[\\max(0,\\lambda_i+\\rho g_i)^{2}-\\lambda_i^{2}\\right],\\quad \\lambda_i\\leftarrow\\max(0,\\lambda_i+\\rho g_i)', v: S.sol ? `${(S.sol.trace || []).length} outer iterations, ${S.sol.evals} model evaluations` : '', n: 'Each outer step minimizes ℒ_A with projected BFGS on a normalized [0,1] box (log scale for N and I), then updates the multipliers.' },
    { g: 'opt', t: 'Shadow price of a limit', e: '\\frac{\\partial B^{*}}{\\partial\\,\\mathrm{limit}_i}=\\frac{\\lambda_i}{s_i}\\ \\mathrm{mT}', v: top.length ? top.map(o => `${CN[CI[o.c.id]].label}: λ = ${o.l.toFixed(3)}`).join(' · ') : 'No active limits', n: 'How much the best achievable flux changes if you relax that limit by one unit. This is the quantity the trade-off tab verifies by re-solving.' }
  ];
}
TABS.eq = {
  build(h) {
    h.innerHTML = `<section class="card"><p class="note">Every number on this page comes from these equations, evaluated live with your current design. Groups that contain a binding limit are marked.</p><div class="chips" id="eqChips" role="group"></div></section><div id="eqList"></div>`;
    this.f = 'all'; $('#eqChips').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { this.f = b.dataset.g; this.update(); } });
  },
  update() {
    const list = eqList(), bind = new Set();
    const lam = S.sol ? S.sol.lam : []; CN.forEach((c, i) => { if ((lam[i] || 0) > 1e-3 && !(c.id === 'Breq' && !needsB())) bind.add(CGRP(c)); });
    $('#eqChips').innerHTML = [['all', 'All']].concat(EQG).map(([k, n]) => `<button type="button" data-g="${k}" aria-pressed="${this.f === k}">${esc(n)}${bind.has(k) ? '<i class="bd" title="Contains a binding limit"></i>' : ''}</button>`).join('');
    const fl = list.filter(q => this.f === 'all' || q.g === this.f);
    $('#eqList').innerHTML = EQG.filter(([k]) => fl.some(q => q.g === k)).map(([k, n]) => `<section class="card eqg"><h3>${esc(n)}${bind.has(k) ? '<span class="tag">binding limit here</span>' : ''}</h3>${fl.filter(q => q.g === k).map(q => `<div class="eq"><div class="eqt">${esc(q.t)}</div><div class="eqf">${tex(q.e)}</div><div class="eqv"><span>Now</span> ${esc(q.v)}</div><p class="note">${esc(q.n)}</p></div>`).join('')}</section>`).join('');
  }
};

/* ---------------- build sheet ---------------- */
function discreteCheck() {
  const g0 = S.r.geo, P = S.P, N = Math.max(1, Math.round(g0.N));
  const geo = C.geometry({ wx: g0.wx, ly: g0.ly, N, awg: g0.awg, th: g0.th, b: g0.b }, P);
  const rgd = C.discreteRings(geo), rgc = C.makeRings(geo, P.nRings, P.nLay), zT = S.r.zT - g0.t / 2 + geo.t / 2;
  const one = rg => { const Sg = C.buildSegs(geo, rg, P), f = C.fieldAt(Sg, 0, 0, zT, new Float64Array(6)); return { kB: Math.hypot(f[0], f[1], f[2]), aE: C.peakA(Sg, geo, P).aE, L: C.inductance(geo, rg, P).L }; };
  return { N, d: one(rgd), c: one(rgc), rgd, geo };
}
function runSnap() {
  const x = S.x, af = [Math.floor(x[3]), Math.ceil(x[3])].filter((v, i, a) => a.indexOf(v) === i), nf = [Math.floor(x[2]), Math.ceil(x[2])].filter((v, i, a) => a.indexOf(v) === i);
  const combos = []; for (const a of af) for (const n of nf) combos.push({ awg: Math.max(8, a), N: Math.max(2, n) });
  const jobs = combos.map(c => { const lock = lockFor(S.P); lock[2] = c.N; lock[3] = c.awg; return { P: clonePSafe(S.P), opt: { lock, starts: [S.sol.u], lam0: S.sol.lam, maxOuter: 8, maxInner: 60 } }; });
  S.snap = { busy: true, rows: [], combos }; TABS.build.paintSnap();
  batchRunner.start({ type: 'batch', jobs }, (k, res) => { S.snap.rows[k] = { c: combos[k], res }; TABS.build.paintSnap(); }).then(() => { S.snap.busy = false; TABS.build.paintSnap(); }).catch(e => { if (e !== 'cancelled' && S.snap) S.snap.busy = false; });
}
function copyText(txt, btn) {
  const done = ok => { const o = btn.dataset.t || btn.textContent; btn.dataset.t = o; btn.textContent = ok ? 'Copied' : 'Select and copy'; setTimeout(() => { btn.textContent = o; }, 1600); };
  try { navigator.clipboard.writeText(txt).then(() => done(true), () => { done(false); const pre = btn.closest('.card').querySelector('pre'); if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }); } catch (e) { done(false); }
}
TABS.build = {
  build(h) {
    h.innerHTML = card('Winding sheet', '<div id="winding"></div>', '', 'The values below are the continuous optimum. Wire gauge and turns must be whole numbers to build, so use the next section to snap them.') +
      card('Snap to buildable values', '<div class="btnrow"><button type="button" class="btn" id="snapBtn">Compare whole-number options</button></div><div id="snapOut"></div>', '', 'Tries every combination of the neighbouring wire gauges and whole turn counts, and re-optimizes the bend, size, band and current around each.') +
      card('Continuum model against real turns', '<div id="discBox"></div>', '', 'The optimizer treats the winding as a smooth band of current. This compares that against the same coil with every turn placed individually.') +
      card('Drive electronics', '<div id="drvBox"></div>') +
      card('Settings for the ESP32-S3', '<pre class="code" id="espOut" tabindex="0"></pre><div class="btnrow"><button type="button" class="btn" id="cpEsp">Copy constants</button><button type="button" class="btn ghost" id="cpJson">Copy design as JSON</button></div>', '', 'Constants for your firmware.');
    $('#snapBtn').addEventListener('click', runSnap);
    $('#snapOut').addEventListener('click', e => { const b = e.target.closest('[data-adopt]'); if (!b) return; const row = S.snap.rows[+b.dataset.adopt]; S.lock[2] = row.c.N; S.lock[3] = row.c.awg; S.snap = null; solveNow(); saveSoon(); $('#tabs [data-tab=opt]').focus(); });
    $('#cpEsp').addEventListener('click', e => copyText(this.esp, e.target));
    $('#cpJson').addEventListener('click', e => copyText(this.json, e.target));
  },
  update() {
    const r = S.r, P = S.P, g = r.geo, A = r.A, R = r.R;
    const dc = discreteCheck(), rg = dc.rgd;
    const rows = [
      ['Wire', `AWG ${fx(g.awg, 1)}  (${fx(g.d * 1e3, 2)} mm bare, ${fx(g.dI * 1e3, 2)} mm with enamel)`],
      ['Turns', `${fx(g.N, 1)} per ${g.nw === 1 ? 'coil' : 'wing'}  (${dc.N} when rounded: ${rg.npl} per layer × ${rg.Ld} layer${rg.Ld > 1 ? 's' : ''})`],
      [g.nw === 1 ? 'Coil' : 'Wing', `${fx(g.wx * 1e3, 0)} mm wide × ${fx(g.ly * 1e3, 0)} mm long, winding band ${fx(g.b * 1e3, 0)} mm, thickness ${fx(g.t * 1e3, 1)} mm`],
      [g.nw === 1 ? 'Shape' : 'Bend', g.nw === 1 ? `flat single coil, profile ${fx(r.prof * 1e3, 1)} mm` : `${fx(g.th * 180 / Math.PI, 1)}° per wing, ${fx(P.gap * 1e3, 0)} mm hinge gap, profile ${fx(r.prof * 1e3, 1)} mm`],
      ['Current', `${fx(A.I, 1)} A peak acute (rms ${fx(A.Irms, 1)} A, budget ${fx(P.drive.Isw, 1)} A), ${fx(R.I, 1)} A peak recovery, ${fx(A.Ibus, 1)} A average from the source`],
      ['Copper', `${fx(g.lw, 1)} m total, ${fx(g.mcu, 2)} kg, about $${fx(g.mcu * P.price, 0)}`],
      ['Electrical', `${fx(g.R20 * 1e3, 0)} mΩ cold, ${fx(A.Rhot * 1e3, 0)} mΩ hot, ${fx(r.ind.L * 1e6, 0)} µH, current density ${fx(A.Irms / (g.Acu * 1e6), 1)} A/mm² rms`],
      ['Footprint', `${fx((g.nw === 1 ? g.wx : 2 * g.wx + P.gap) * 1e3, 0)} × ${fx(g.ly * 1e3, 0)} mm`]
    ];
    $('#winding').innerHTML = '<dl class="dl">' + rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') + '</dl>';
    this.paintSnap();
    const rel = (a, b) => (a / b - 1) * 100;
    $('#discBox').innerHTML = `<div class="tablewrap"><table><thead><tr><th class="l">At ${dc.N} turns per wing</th><th>Continuum</th><th>Each turn placed</th><th>Difference</th></tr></thead><tbody>
      <tr><td class="l">Flux per amp, mT/A</td><td>${fx(dc.c.kB * 1e3, 3)}</td><td>${fx(dc.d.kB * 1e3, 3)}</td><td>${fx(rel(dc.c.kB, dc.d.kB), 1)}%</td></tr>
      <tr><td class="l">Inductance, µH</td><td>${fx(dc.c.L * 1e6, 1)}</td><td>${fx(dc.d.L * 1e6, 1)}</td><td>${fx(rel(dc.c.L, dc.d.L), 1)}%</td></tr>
      <tr><td class="l">E-field potential, µWb/m/A</td><td>${fx(dc.c.aE * 1e6, 3)}</td><td>${fx(dc.d.aE * 1e6, 3)}</td><td>${fx(rel(dc.c.aE, dc.d.aE), 1)}%</td></tr></tbody></table></div>`;
    const Ia = A.I, Lh = r.ind.L, rip = P.supply.Voc / (4 * Lh * P.drive.fpwm), Es = 0.5 * Lh * Ia * Ia, Pfet = 2 * P.drive.Rds * A.Irms * A.Irms * P.acute.duty;
    $('#drvBox').innerHTML = `<dl class="dl">${[
      ['MOSFET rating', `Vds at least ${fx(1.5 * P.supply.Voc, 0)} V (1.5 × ${fx(P.supply.Voc, 0)} V; use 100 V parts on a 48 V pack), current at least ${fx(1.5 * Ia, 0)} A pulsed`],
      ['Gate driver', 'Half-bridge or full-bridge driver with dead time and under-voltage lockout. A bare ESP32 pin cannot switch these FETs fast enough.'],
      ['PWM ripple', `V / (4 L f) = ${fx(rip, 2)} A peak-to-peak at ${fx(P.drive.fpwm / 1e3, 0)} kHz (${fx(rip / Ia * 100, 1)}% of ${fx(Ia, 1)} A)`],
      ['Stored energy', `½ L I² = ${fx(Es * 1e3, 1)} mJ at the acute peak. Add a fast clamp or TVS across the bridge and a bulk capacitor at the bus.`],
      ['Shunt', `${fx(P.drive.Rsh * 1e3, 1)} mΩ gives ${fx(P.drive.Rsh * Ia * 1e3, 0)} mV at ${fx(Ia, 1)} A; dissipates ${fx(P.drive.Rsh * A.Irms * A.Irms, 2)} W rms. Use a current-sense amplifier.`],
      ['FET conduction loss', `${fx(Pfet, 1)} W total in the bridge at the acute setting, plus ${fx(A.Psw, 2)} W switching`],
      ['Bus current', `${fx(A.Ibus, 1)} A average from the source; fuse at ${fx(1.25 * A.Ibus + 2, 0)} A`]
    ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

    const nm = x => String(x).replace(/\./g, '_');
    this.esp = `// generated by the butterfly PEMF optimizer\nconst float V_BUS_V        = ${fx(P.supply.Voc, 1)}f;\nconst float F_ACUTE_HZ     = ${P.acute.f}.0f;\nconst float I_ACUTE_PK_A   = ${fx(A.I, 2)}f;\nconst uint32_t T_ACUTE_S   = ${Math.round(P.acute.tsess)};\nconst float DUTY_ACUTE     = ${fx(P.acute.duty, 2)}f;\nconst float F_RECOV_HZ     = ${P.recov.f}.0f;\nconst float I_RECOV_PK_A   = ${fx(R.I, 2)}f;\nconst uint32_t T_RECOV_S   = ${Math.round(P.recov.tsess)};\nconst float DUTY_RECOV     = ${fx(P.recov.duty, 2)}f;\nconst float I_HW_LIMIT_A   = ${fx(1.25 * Math.max(A.I, R.I), 1)}f;\nconst float T_COIL_CUT_C   = ${fx(P.thermal.Tmax - 5, 0)}f;\nconst float T_SKIN_CUT_C   = ${fx(P.thermal.Tskin - 0.5, 1)}f;\nconst float PWM_HZ         = ${P.drive.fpwm}.0f;\nconst float SHUNT_OHM      = ${fx(P.drive.Rsh, 4)}f;\nconst float MAX_DUTY       = ${fx(P.drive.Dmax, 2)}f;`;
    $('#espOut').textContent = this.esp;
    this.json = JSON.stringify({ design: { wing_width_mm: +fx(g.wx * 1e3, 1), wing_length_mm: +fx(g.ly * 1e3, 1), turns_per_wing: +fx(g.N, 2), awg: +fx(g.awg, 2), bend_deg: +fx(g.th * 180 / Math.PI, 2), band_mm: +fx(g.b * 1e3, 1), gap_mm: P.gap * 1e3 }, acute: { f_hz: P.acute.f, wave: P.acute.wave, i_pk_a: +fx(A.I, 3), b_target_mt: +fx(A.Bpk * 1e3, 3), e_pk_v_per_m: +fx(A.Epk, 3), coil_t_end_c: +fx(A.T.Tend, 1), skin_t_c: +fx(A.T.Ts, 1) }, recovery: { f_hz: P.recov.f, wave: P.recov.wave, i_pk_a: +fx(R.I, 3), b_target_mt: +fx(R.Bpk * 1e3, 3), e_pk_v_per_m: +fx(R.Epk, 3) }, electrical: { r20_mohm: +fx(g.R20 * 1e3, 1), l_uh: +fx(r.ind.L * 1e6, 1) }, source: { voc: P.supply.Voc, name: P.supply.name } }, null, 2);
  },
  paintSnap() {
    const el = $('#snapOut'); if (!el) return; const s = S.snap;
    if (!s) { el.innerHTML = ''; return; }
    const ok = s.rows.filter(Boolean).filter(o => o.res.kkt.viol < 5e-3), minP = obj().min;
    const best = ok.length ? ok.reduce((a, o) => (minP ? metric(o.res) < metric(a.res) : metric(o.res) > metric(a.res)) ? o : a, ok[0]) : null;
    const [mn, mu] = metricName(), cont = obj().fromSol(S.sol);
    el.innerHTML = `<div class="tablewrap"><table><thead><tr><th class="l">Option</th><th>${esc(mn)}, ${esc(mu)}</th><th>Change</th><th>Wing mm</th><th>Bend</th><th>Amps</th><th></th></tr></thead><tbody>
      <tr class="ref"><td class="l">Continuous optimum</td><td>${fx(cont, 2)}</td><td>–</td><td>${fx(S.x[0] * 1e3, 0)} × ${fx(S.x[1] * 1e3, 0)}</td><td>${fx(S.x[4] * 180 / Math.PI, 1)}°</td><td>${fx(S.x[6], 1)}</td><td></td></tr>
      ${s.combos.map((c, k) => { const o = s.rows[k]; if (!o) return `<tr><td class="l">AWG ${c.awg}, ${c.N} turns</td><td colspan="6" class="mut">solving…</td></tr>`; const x = o.res.x, v = metric(o.res), feas = o.res.kkt.viol < 5e-3;
        return `<tr${best === o ? ' class="best"' : ''}><td class="l">AWG ${c.awg}, ${c.N} turns${best === o ? ' <b class="tag">best</b>' : ''}</td><td>${fx(v, 2)}</td><td>${feas ? fx((v / cont - 1) * 100, 1) + '%' : '<span class="mut">infeasible</span>'}</td><td>${fx(x[0] * 1e3, 0)} × ${fx(x[1] * 1e3, 0)}</td><td>${fx(x[4] * 180 / Math.PI, 1)}°</td><td>${fx(x[6], 1)}</td><td>${feas ? `<button type="button" class="btn sm" data-adopt="${k}">Use</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>${s.busy ? '<p class="note"><i class="spin"></i> Solving…</p>' : ''}`;
  }
};

/* ---------------- tab registry, render, init ---------------- */
const TAB_LIST = [['field', 'Field'], ['opt', 'Optimum'], ['mine', 'My build'], ['lag', 'Lagrangian'], ['trade', 'Trade-offs'], ['eq', 'Equations'], ['build', 'Build sheet'], ['wiring', 'Wiring']];
S.sweep.axis = 'Imax';
function showTab(id) {
  S.tab = id; const t = TABS[id], host = $('#panel_' + id);
  if (!t.built) { t.build(host); t.built = true; }
  $$('#tabs button').forEach(b => { const on = b.dataset.tab === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
  $$('#panels > section').forEach(p => { p.hidden = p.id !== 'panel_' + id; });
  if (id === 'lag') S.sliceStale = true;
  t.update();
}
function renderAll(fast) {
  renderStatus(); if (!S.r) return;
  renderReadout();
  const t = TABS[S.tab]; if (!t || !t.built) return;
  if (fast && (S.tab === 'lag' || S.tab === 'trade' || S.tab === 'build')) { if (S.tab === 'lag') S.sliceStale = true; return; }
  t.update();
}
function init() {
  loadState();
  $('#tabs').innerHTML = TAB_LIST.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="false" aria-controls="panel_${k}">${esc(n)}</button>`).join('');
  $('#panels').innerHTML = TAB_LIST.map(([k]) => `<section id="panel_${k}" role="tabpanel" hidden></section>`).join('');
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
  $('#tabs').addEventListener('keydown', e => { const ks = TAB_LIST.map(t => t[0]), i = ks.indexOf(S.tab); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = ks[(i + (e.key === 'ArrowRight' ? 1 : ks.length - 1)) % ks.length]; showTab(n); $(`#tabs [data-tab=${n}]`).focus(); e.preventDefault(); } });
  $('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { S.mode = b.dataset.m; renderAll(true); if (S.tab === 'lag') TABS.lag.update(true); } });
  $('#pswitch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.panel = b.dataset.p; document.body.dataset.panel = S.panel; $$('#pswitch button').forEach(x => x.setAttribute('aria-pressed', x === b)); window.scrollTo(0, 0); });
  document.body.dataset.panel = 'views';
  renderControls(); wireControls();
  S.x = C.toX(coldStarts(1)[0]); quickEval();
  showTab('field'); renderAll();
  solveNow({ global: true });
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const t = TABS[S.tab]; if (t && t.built && (S.tab === 'field' || S.tab === 'lag')) t.update(S.tab === 'lag'); }, 150); });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { const t = TABS[S.tab]; if (t && t.built) t.update(); });
}
init();
