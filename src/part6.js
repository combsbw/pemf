/* ===================== part 6: My build (own numbers) and Wiring diagrams ===================== */
const clampv = (v, a, b) => Math.min(b, Math.max(a, v));
function setVar(i, v) { S.x[i] = v; S.lock[i] = v; }
function afterEdit() {
  quickEval(); if (S.manual) { applyManual(); } else { solveSoon(); }
  renderStatus(); renderReadout(); saveSoon();
}

/* ---------------- My build ---------------- */
function mbFields() {
  const r = S.r, P = S.P, g = r.geo, A = r.A, single = g.nw === 1, W = single ? 'Coil' : 'Wing', turnsLabel = single ? 'Turns' : 'Turns per wing';
  return [
    { id: 'awg', label: 'Wire gauge', unit: 'AWG', step: 1, v: S.x[3], vi: 3, set: v => setVar(3, clampv(v, 0, 40)), note: `${fx(g.d * 1e3, 2)} mm bare, ${fx(g.dI * 1e3, 2)} mm with enamel, ${fx(g.Acu * 1e6, 2)} mm² of copper` },
    { id: 'dia', label: 'Wire diameter (bare)', unit: 'mm', step: 0.01, v: g.d * 1e3, vi: 3, set: v => setVar(3, clampv(36 - 39 * Math.log(Math.max(v, 0.05) / 0.127) / Math.log(92), 0, 40)), note: 'Enter a measured diameter and the gauge follows.' },
    { id: 'N', label: turnsLabel, unit: '', step: 1, v: S.x[2], vi: 2, set: v => setVar(2, clampv(v, 0.5, 2000)), note: `${fx(g.N * g.lturn, 1)} m of wire per ${single ? 'coil' : 'wing'}` },
    { id: 'lw', label: 'Total wire length', unit: 'm', step: 0.5, v: g.lw, vi: 2, set: v => setVar(2, clampv(v / (g.nw * g.lturn), 0.5, 2000)), note: `Enter the length of wire you have and the turns follow. ${fx(g.lturn * 100, 1)} cm per turn at these dimensions.` },
    { id: 'wx', label: W + ' width', unit: 'mm', step: 1, v: g.wx * 1e3, vi: 0, set: v => setVar(0, clampv(v / 1e3, 0.01, 1)), note: '' },
    { id: 'ly', label: W + ' length', unit: 'mm', step: 1, v: g.ly * 1e3, vi: 1, set: v => setVar(1, clampv(v / 1e3, 0.01, 1)), note: '' },
    { id: 'b', label: 'Winding band width', unit: 'mm', step: 1, v: g.b * 1e3, vi: 5, set: v => setVar(5, clampv(v / 1e3, 0.002, 0.3)), note: `Inner opening ${fx((g.wx - 2 * g.b) * 1e3, 0)} × ${fx((g.ly - 2 * g.b) * 1e3, 0)} mm` },
    { id: 'th', label: 'Bend angle', unit: '°', step: 0.5, v: g.th * 180 / Math.PI, vi: 4, set: v => setVar(4, clampv(v * Math.PI / 180, -0.5, 1.2)), only: 'butterfly', note: 'Wings rise toward the patient by this angle.' },
    { id: 'gap', label: 'Hinge gap', unit: 'mm', step: 1, v: P.gap * 1e3, vi: null, set: v => { S.P.gap = clampv(v / 1e3, 0.0005, 0.1); }, only: 'butterfly', note: 'Space between the two wings at the hinge.' },
    { id: 'Ia', label: 'Peak current (acute)', unit: 'A', step: 0.1, v: S.x[6], vi: 6, set: v => setVar(6, clampv(v, 0.01, 500)), note: `Recovery mode runs ${fx(r.R.I, 2)} A for ${fx(P.recov.Bpk * 1e3, 2)} mT` },
    { id: 'Bw', label: 'Flux at target (acute)', unit: 'mT', step: 0.05, v: A.Bpk * 1e3, vi: 6, set: v => setVar(6, clampv(v * 1e-3 / r.kB, 0.01, 500)), note: `${fx(r.kB * 1e3, 3)} mT per amp at ${fx(P.depth * 100, 1)} cm. Enter the flux you want and the current follows.` }
  ].filter(f => !f.only || f.only === P.coilType || (f.only === 'butterfly' && P.coilType !== 'single'));
}
const decFor = st => st >= 1 ? 0 : st >= 0.1 ? 1 : 2;
TABS.mine = {
  build(h) {
    h.innerHTML = card('Where the numbers come from', `<div class="toolrow"><div class="seg" id="srcSeg" role="group" aria-label="Design source"><button type="button" data-src="opt">Optimizer picks</button><button type="button" data-src="man">My numbers</button></div><div class="seg" id="coilSeg" role="group" aria-label="Coil type"><button type="button" data-coil="butterfly">Butterfly</button><button type="button" data-coil="single">Single coil</button></div></div><p class="note" id="srcNote"></p><div class="btnrow" id="srcBtns"></div>`) +
      card('Your dimensions', '<div class="mbgrid" id="mbFields"></div>', '', 'Type any value. Related fields move together: gauge with diameter, turns with wire length, current with flux.') +
      card('What these numbers give you', '<div id="mbRes"></div><div id="mbOver"></div>') +
      card('Winding check', '<div id="mbWind"></div>', '', 'A practical packing count for a real winding, separate from the smooth model the optimizer uses.');
    $('#srcSeg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.src === 'man' && !S.manual) { S.lock = S.x.slice(); S.manual = true; afterEdit(); renderAll(); }
      else if (b.dataset.src === 'opt' && S.manual) { S.manual = false; S.lock.fill(null); solveNow(); saveSoon(); }
    });
    $('#coilSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (S.P.coilType !== b.dataset.coil) { applyParam('coilType', b.dataset.coil); renderControls(); } });
    $('#srcBtns').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'round') { setVar(3, Math.round(S.x[3])); setVar(2, Math.max(1, Math.round(S.x[2]))); afterEdit(); renderAll(); }
      else if (b.dataset.act === 'copy') { S.lock = S.sol && !S.manual ? S.sol.x.slice() : S.x.slice(); S.x = S.lock.slice(); S.manual = true; afterEdit(); renderAll(); }
    });
    $('#mbFields').addEventListener('input', e => {
      const t = e.target; if (!t.dataset.f) return; const f = mbFields().find(q => q.id === t.dataset.f); if (!f) return;
      const v = parseFloat(t.value); if (!isFinite(v)) return; f.set(v); this.focusId = f.id; afterEdit(); this.paint(f.id); this.paintResults();
    });
    $('#mbFields').addEventListener('click', e => { const b = e.target.closest('[data-lock]'); if (!b) return; const i = +b.dataset.lock; S.lock[i] = S.lock[i] == null ? S.x[i] : null; afterEdit(); this.paint(); });
  },
  update() { this.paint(); this.paintResults(); },
  paint(skip) {
    const fs = mbFields(), host = $('#mbFields'), single = S.P.coilType === 'single';
    $$('#srcSeg button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.src === 'man') === S.manual));
    $$('#coilSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.coil === S.P.coilType));
    $('#srcNote').innerHTML = S.manual ? 'The solver is off. Every result below is computed straight from your numbers, and the ledger shows any limit you are over.' : 'The solver chooses everything. Type a value into any field to hold it, and the solver re-optimizes the rest around it.';
    $('#srcBtns').innerHTML = S.manual ? '<button type="button" class="btn ghost" data-act="round">Round gauge and turns to whole numbers</button>' : '<button type="button" class="btn ghost" data-act="copy">Use the current design as my numbers</button>';
    const have = $$('.mbf', host).map(e => e.dataset.id).join();
    if (have !== fs.map(f => f.id).join()) {
      host.innerHTML = fs.map(f => `<div class="mbf" data-id="${f.id}"><label class="cl" for="mb_${f.id}">${esc(f.label)}<span class="u">${esc(f.unit)}</span></label><div class="mbi"><input type="number" inputmode="decimal" id="mb_${f.id}" data-f="${f.id}" step="${f.step}" value="${fx(f.v, f.id === 'N' ? 1 : decFor(f.step))}">${f.vi != null && !S.manual ? `<button type="button" class="lockb sm" data-lock="${f.vi}" aria-pressed="false" aria-label="Hold ${esc(f.label)}"></button>` : '<span></span>'}</div><p class="note" data-n="${f.id}"></p></div>`).join('');
    }
    for (const f of fs) {
      const inp = $('#mb_' + f.id); if (!inp) continue;
      if (document.activeElement !== inp && f.id !== skip) inp.value = fx(f.v, f.id === 'N' ? 1 : decFor(f.step));
      const n = $(`[data-n="${f.id}"]`); if (n) n.textContent = f.note;
      const lb = $(`[data-lock="${f.vi}"]`, host);
      if (lb && f.vi != null) { const held = S.lock[f.vi] != null; lb.setAttribute('aria-pressed', held); lb.innerHTML = held ? LOCK_SVG : UNLOCK_SVG; lb.title = held ? 'Held. Click to let the solver choose.' : 'Free. Typing a value holds it.'; }
    }
  },
  paintResults() {
    const r = S.r, P = S.P, g = r.geo, A = r.A, R = r.R, T = A.T;
    const items = [
      ['Flux at target', `${fx(A.Bpk * 1e3, 2)} mT`], ['Peak current', `${fx(A.I, 2)} A (rms ${fx(A.Irms, 2)})`], ['Voltage needed', `${fx(A.Vreq, 1)} V of ${fx(A.Vav, 1)} V`],
      ['Coil heat', `${fx(A.Pcoil, 1)} W`], ['Coil temperature', `${fx(T.Tend, 0)} °C after ${fx(P.acute.tsess / 60, 0)} min`], ['Skin temperature', `${fx(T.Ts, 1)} °C`],
      ['Induced E-field', `${fx(A.Epk, 2)} V/m`], ['Resistance', `${fx(g.R20 * 1e3, 0)} mΩ cold, ${fx(A.Rhot * 1e3, 0)} mΩ hot`], ['Inductance', `${fx(r.ind.L * 1e6, 0)} µH`],
      ['Wire', `${fx(g.lw, 1)} m, ${fx(g.mcu, 2)} kg`], ['Current density', `${fx(A.Irms / (g.Acu * 1e6), 1)} A/mm² rms`], ['Source current', `${fx(A.Ibus, 1)} A average`],
      ['Footprint', `${fx((g.nw === 1 ? g.wx : 2 * g.wx + P.gap) * 1e3, 0)} × ${fx(g.ly * 1e3, 0)} mm, ${fx(r.prof * 1e3, 0)} mm high`], ['Recovery mode', `${fx(R.I, 2)} A, ${fx(R.Bpk * 1e3, 2)} mT`]
    ];
    $('#mbRes').innerHTML = '<div class="kgrid">' + items.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('') + '</div>';
    const over = CN.map((c, i) => ({ c, i, g: r.g[i] })).filter(q => q.g > 1e-3 && isFinite(r.lim[q.i]) && !(q.c.id === 'Breq' && !needsB()));
    $('#mbOver').innerHTML = over.length ? `<p class="note"><b>Over a limit:</b></p>` + over.map(q => `<div class="lrow over"><div class="ln"><span>${esc(q.c.label)}</span><em><b class="tag">over</b></em></div><div class="lv">${esc(fmtVal(q.i))}</div></div>`).join('') : '<p class="note"><b>Inside every limit</b> you have set in the Problem panel.</p>';
    const npl = Math.max(1, Math.floor(g.b / g.dI)), layers = Math.ceil(g.N / npl), thick = layers * g.dI;
    $('#mbWind').innerHTML = `<dl class="dl">${[
      ['Turns per layer', `${npl} (band ${fx(g.b * 1e3, 0)} mm ÷ ${fx(g.dI * 1e3, 2)} mm wire)`],
      ['Layers', `${layers} for ${fx(g.N, 1)} turns, ${fx(thick * 1e3, 1)} mm thick wound neatly`],
      ['Smooth model used', `${fx(g.t * 1e3, 1)} mm at ${fx(P.phi, 2)} packing`],
      ['Wire per ' + (g.nw === 1 ? 'coil' : 'wing'), `${fx(g.N * g.lturn, 1)} m at ${fx(g.lturn * 100, 1)} cm per turn`]
    ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  }
};

/* ---------------- Wiring ---------------- */
const STD = { fuse: [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60], vds: [30, 40, 60, 80, 100, 150, 200], tvs: [12, 15, 18, 20, 22, 24, 26, 28, 30, 33, 36, 40, 43, 45, 48, 51, 54, 58, 60, 64, 70, 75, 78], cap: [470, 680, 1000, 1500, 2200, 3300, 4700, 6800], capV: [25, 35, 50, 63, 100], gain: [20, 50, 100, 200] };
const upTo = (v, a) => a.find(x => x >= v) || a[a.length - 1];
const AMPACITY = [[24, 2], [22, 3], [20, 5], [18, 7], [16, 10], [14, 15], [12, 20], [10, 30], [8, 40], [6, 55]];
const awgFor = amps => { for (const [a, c] of AMPACITY) if (c >= amps) return a; return 4; };
function wiringParts() {
  const r = S.r, P = S.P, A = r.A, R = r.R, g = r.geo, Voc = P.supply.Voc, Ipk = Math.max(A.I, R.I), Irms = Math.max(A.Irms, R.Irms);
  const ibus = Math.max(A.Ibus, R.Ibus), fuse = upTo(1.5 * ibus, STD.fuse), vds = upTo(1.5 * Voc, STD.vds), tvs = upTo(1.15 * Voc, STD.tvs);
  const cap = upTo(100 * Irms, STD.cap), capV = upTo(1.5 * Voc, STD.capV), rsh = P.drive.Rsh, vs = Ipk * rsh;
  const gainWant = 1.65 / (1.2 * Ipk * rsh), gain = [...STD.gain].reverse().find(x => x <= gainWant) || 20;
  return { A, R, g, Voc, Ipk, Irms, ibus, fuse, vds, tvs, cap, capV, rsh, vs, gain, gainWant, id: Math.ceil(2 * Irms * 1.5), harness: awgFor(1.25 * Math.max(Irms, ibus)), leads: awgFor(1.25 * Irms), pshunt: Irms * Irms * rsh, fsw: P.drive.fpwm };
}
const IND = (x0, x1, y) => { const r = (x1 - x0) / 8; let d = `M${x0} ${y}`; for (let i = 0; i < 4; i++) d += `a${r} ${r} 0 0 1 ${2 * r} 0`; return d; };
function schematicSVG() {
  const Q = wiringParts(), P = S.P, single = Q.g.nw === 1;
  const box = (x, y, w, h, t1, t2, t3) => `<rect class="box" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/><text class="lb b" x="${x + w / 2}" y="${y + (t2 ? 19 : h / 2 + 4)}" text-anchor="middle">${t1}</text>${t2 ? `<text class="sm" x="${x + w / 2}" y="${y + 34}" text-anchor="middle">${t2}</text>` : ''}${t3 ? `<text class="sm" x="${x + w / 2}" y="${y + 48}" text-anchor="middle">${t3}</text>` : ''}`;
  const fet = (cx, top, id) => `<rect class="box" x="${cx - 20}" y="${top}" width="40" height="50" rx="4"/><text class="lb b" x="${cx}" y="${top + 24}" text-anchor="middle">${id}</text><text class="sm" x="${cx}" y="${top + 39}" text-anchor="middle">N-FET</text>`;
  const gate = (x1, x2, y, name) => `<path class="wire sig" d="M${x1} ${y} H${x2}"/><text class="tg" x="${x2 + (x2 < x1 ? -4 : 4)}" y="${y + 4}" text-anchor="${x2 < x1 ? 'end' : 'start'}">${name}</text>`;
  let s = '';
  s += `<path class="wire pwr" d="M70 190 H800"/><path class="wire gnd" d="M70 440 H800"/>`;
  // source
  s += `<path class="wire pwr" d="M70 190 V272"/><path class="wire gnd" d="M70 302 V440"/><path class="wire" d="M52 272 H88 M60 282 H80 M52 292 H88 M60 302 H80"/>`;
  s += `<text class="lb b" x="100" y="340">${esc(P.supply.name)}</text><text class="sm" x="100" y="356">${fx(Q.Voc, 0)} V, ${fx(P.supply.Rsrc * 1e3, 0)} mΩ</text><text class="sm" x="96" y="184">+</text><text class="sm" x="96" y="432">−</text>`;
  s += `<path class="wire gnd" d="M70 440 V452 M58 452 H82 M63 458 H77 M67 464 H73"/>`;
  // fuse, cap, TVS
  s += box(130, 177, 66, 26, 'F1', '', '') + `<text class="sm" x="163" y="170" text-anchor="middle">${Q.fuse} A fuse</text>`;
  s += `<path class="wire" d="M222 190 V285 M207 285 H237 M207 295 H237 M222 295 V440"/><circle class="dot" cx="222" cy="190" r="3"/><circle class="dot" cx="222" cy="440" r="3"/><text class="lb b" x="198" y="278" text-anchor="end">C1</text><text class="sm" x="198" y="292" text-anchor="end">${Q.cap} µF</text><text class="sm" x="198" y="306" text-anchor="end">${Q.capV} V</text>`;
  s += `<path class="wire" d="M282 190 V275 M272 275 H292 L282 295 Z M272 295 H292 M282 295 V440"/><circle class="dot" cx="282" cy="190" r="3"/><circle class="dot" cx="282" cy="440" r="3"/><text class="lb b" x="262" y="278" text-anchor="end">D1 TVS</text><text class="sm" x="262" y="292" text-anchor="end">${Q.tvs} V</text>`;
  // bridge
  for (const [cx, ids] of [[400, ['Q1', 'Q2']], [800, ['Q3', 'Q4']]]) {
    s += `<path class="wire pwr" d="M${cx} 190 V215"/><path class="wire" d="M${cx} 265 V335"/><path class="wire gnd" d="M${cx} 385 V440"/><circle class="dot" cx="${cx}" cy="190" r="3"/><circle class="dot" cx="${cx}" cy="300" r="3"/><circle class="dot" cx="${cx}" cy="440" r="3"/>`;
    s += fet(cx, 215, ids[0]) + fet(cx, 335, ids[1]);
  }
  s += gate(380, 352, 240, 'HO_A') + gate(380, 352, 360, 'LO_A') + gate(820, 848, 240, 'HO_B') + gate(820, 848, 360, 'LO_B');
  s += `<text class="sm" x="352" y="258" text-anchor="end">via 10 Ω</text><text class="sm" x="352" y="378" text-anchor="end">via 10 Ω</text><text class="sm" x="848" y="258">via 10 Ω</text><text class="sm" x="848" y="378">via 10 Ω</text>`;
  s += `<text class="sm" x="408" y="292">OUT_A</text><text class="sm" x="808" y="292">OUT_B</text>`;
  // coil chain
  s += `<path class="wire coil" d="M400 300 H480 M540 300 H${single ? 600 : 570}"/>`;
  s += box(480, 288, 60, 24, 'Rsh', '', '') + `<text class="sm" x="510" y="326" text-anchor="middle">${fx(Q.rsh * 1e3, 0)} mΩ, ${fx(Q.pshunt, 1)} W</text>`;
  if (single) {
    s += `<path class="wire coil thick" d="${IND(600, 740, 300)}"/><path class="wire coil" d="M740 300 H800"/><text class="lb b" x="670" y="258" text-anchor="middle">COIL</text><text class="sm" x="670" y="272" text-anchor="middle">${fx(Q.g.N, 0)} turns, AWG ${fx(Q.g.awg, 0)}</text>`;
    s += `<text class="sm" x="670" y="335" text-anchor="middle">${fx(Q.g.R20 * 1e3, 0)} mΩ, ${fx(S.r.ind.L * 1e6, 0)} µH</text>`;
  } else {
    s += `<path class="wire coil thick" d="${IND(570, 670, 300)}"/><path class="wire coil" d="M670 300 H695"/><circle class="dot orange" cx="682" cy="300" r="3.5"/><path class="wire coil thick" d="${IND(695, 790, 300)}"/><path class="wire coil" d="M790 300 H800"/>`;
    s += `<text class="lb b" x="620" y="266" text-anchor="middle">WING 1</text><text class="sm" x="620" y="280" text-anchor="middle">clockwise</text><text class="lb b" x="742" y="266" text-anchor="middle">WING 2</text><text class="sm" x="742" y="280" text-anchor="middle">counter-clockwise</text>`;
    s += `<text class="sm" x="640" y="336" text-anchor="middle">${fx(Q.g.N, 0)} turns each, AWG ${fx(Q.g.awg, 0)}</text><text class="sm" x="640" y="350" text-anchor="middle">in series: ${fx(Q.g.R20 * 1e3, 0)} mΩ, ${fx(S.r.ind.L * 1e6, 0)} µH</text>`;
  }
  // sense amp
  s += `<path class="wire sig" d="M492 312 V500 M528 312 V500"/>` + box(460, 500, 100, 52, 'Sense amp', `gain ${Q.gain}`, 'ADC mid-rail') + `<path class="wire sig" d="M560 526 H590"/><text class="tg" x="594" y="530">ISENSE</text>`;
  // NTC note
  s += `<path class="wire sig dash" d="M735 390 V312"/><rect class="box" x="575" y="390" width="200" height="40" rx="5"/><text class="sm" x="675" y="406" text-anchor="middle">NTC 10 k on the coil: TCOIL</text><text class="sm" x="675" y="421" text-anchor="middle">NTC 10 k under cover: TSKIN</text>`;
  // controller
  s += `<rect class="box" x="60" y="20" width="230" height="130" rx="6"/><text class="lb b" x="75" y="42">ESP32-S3</text><text class="sm" x="75" y="58">MCPWM, 20 kHz, dead time 300 ns</text><text class="sm" x="75" y="73">ADC1 for sense inputs</text><text class="sm" x="75" y="88">3.3 V logic, USB powered</text>`;
  s += `<text class="tg" x="284" y="46" text-anchor="end">PWM_A</text><text class="tg" x="284" y="71" text-anchor="end">EN</text><text class="tg" x="284" y="96" text-anchor="end">PWM_B</text>`;
  s += `<path class="wire sig" d="M290 50 H340 M290 75 H340 M290 100 H315 V170 H790 V110"/>`;
  s += box(340, 30, 120, 80, 'Gate driver A', 'half-bridge', '12 V supply') + box(740, 30, 120, 80, 'Gate driver B', 'half-bridge', '12 V supply');
  s += `<path class="wire sig" d="M720 75 H740"/><text class="tg" x="716" y="79" text-anchor="end">EN</text>`;
  s += `<path class="wire sig" d="M365 110 V140 M435 110 V140"/><text class="tg" x="365" y="153" text-anchor="middle">HO_A</text><text class="tg" x="435" y="153" text-anchor="middle">LO_A</text>`;
  s += `<path class="wire sig" d="M765 110 V140 M835 110 V140"/><text class="tg" x="765" y="153" text-anchor="middle">HO_B</text><text class="tg" x="835" y="153" text-anchor="middle">LO_B</text>`;
  // legend
  s += `<path class="wire pwr" d="M60 586 H90"/><text class="sm" x="96" y="590">power</text><path class="wire gnd" d="M160 586 H190"/><text class="sm" x="196" y="590">ground</text><path class="wire sig" d="M270 586 H300"/><text class="sm" x="306" y="590">signal</text><path class="wire coil thick" d="M370 586 H400"/><text class="sm" x="406" y="590">coil current</text>`;
  s += `<text class="sm" x="60" y="610">Each gate also gets a 10 kΩ pull-down to its source. Bootstrap: 1 µF and a fast diode per half-bridge.</text><text class="sm" x="60" y="626">Add 100 nF at each driver and 10 µF ceramic at each half-bridge.</text>`;
  return `<svg class="wd" viewBox="0 0 900 640" role="img" aria-label="Power and drive schematic">${s}</svg>`;
}
function coilSVG() {
  const r = S.r, P = S.P, g = r.geo, single = g.nw === 1, mm = v => v * 1e3;
  const Wmm = single ? mm(g.wx) : mm(2 * g.wx + P.gap), Lmm = mm(g.ly), k = Math.min(640 / Wmm, 230 / Lmm), cx = 450, y0 = 54;
  const X = v => cx + v * k, Y = v => y0 + v * k;
  let s = '<defs><marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="ah"/></marker></defs>';
  const wings = single ? [{ x0: -mm(g.wx) / 2, x1: mm(g.wx) / 2, ccw: true }] : [{ x0: -(Wmm / 2), x1: -(Wmm / 2) + mm(g.wx), ccw: false }, { x0: Wmm / 2 - mm(g.wx), x1: Wmm / 2, ccw: true }];
  const bm = mm(g.b), nT = Math.min(10, Math.max(2, Math.round(g.N)));
  wings.forEach((w, wi) => {
    s += `<rect class="wing" x="${X(w.x0)}" y="${Y(0)}" width="${(w.x1 - w.x0) * k}" height="${Lmm * k}" rx="4"/>`;
    for (let i = 0; i < nT; i++) { const d = bm * (i + 0.5) / nT; s += `<rect class="turn" x="${X(w.x0 + d)}" y="${Y(d)}" width="${(w.x1 - w.x0 - 2 * d) * k}" height="${(Lmm - 2 * d) * k}" rx="2"/>`; }
    s += `<rect class="band" x="${X(w.x0 + bm)}" y="${Y(bm)}" width="${(w.x1 - w.x0 - 2 * bm) * k}" height="${(Lmm - 2 * bm) * k}"/>`;
    const mx = (w.x0 + w.x1) / 2, ty = Y(bm / 2);
    s += `<path class="cur" marker-end="url(#arw)" d="M${X(mx + (w.ccw ? 18 : -18))} ${ty} H${X(mx + (w.ccw ? -18 : 18))}"/>`;
    s += `<text class="lb b halo" x="${X(mx)}" y="${Y(Lmm * 0.38)}" text-anchor="middle">${single ? 'COIL' : 'WING ' + (wi + 1)}</text><text class="sm halo" x="${X(mx)}" y="${Y(Lmm * 0.38) + 14}" text-anchor="middle">${fx(g.N, 0)} turns, ${w.ccw ? 'counter-clockwise' : 'clockwise'}</text>`;
  });
  if (!single) {
    const gx = mm(P.gap) / 2; for (const sg of [-1, 1]) s += `<path class="cur red" marker-end="url(#arw)" d="M${X(sg * gx + (sg > 0 ? mm(g.b) * 0.5 : -mm(g.b) * 0.5))} ${Y(Lmm * 0.3)} V${Y(Lmm * 0.7)}"/>`;
    s += `<text class="sm" x="${X(0)}" y="${Y(Lmm) + 14}" text-anchor="middle">currents run the same way at the centre edges, so their fields add</text>`;
    const jy = Y(Lmm * 0.7); s += `<path class="wire coil dash" d="M${X(wings[0].x0 + mm(g.wx) / 2)} ${jy} H${X(wings[1].x0 + mm(g.wx) / 2)}"/><circle class="dot orange" cx="${X(wings[0].x0 + mm(g.wx) / 2)}" cy="${jy}" r="4"/><circle class="dot orange" cx="${X(wings[1].x0 + mm(g.wx) / 2)}" cy="${jy}" r="4"/><text class="sm orange" x="${X(0)}" y="${jy + 16}" text-anchor="middle">J: join the two inner ends (insulated)</text>`;
    s += `<path class="wire coil" d="M${X(wings[0].x0)} ${Y(Lmm * 0.1)} H${X(wings[0].x0) - 34}"/><text class="tg" x="${X(wings[0].x0) - 38}" y="${Y(Lmm * 0.1) + 4}" text-anchor="end">A: outer end, to OUT_A</text>`;
    s += `<path class="wire coil" d="M${X(wings[1].x1)} ${Y(Lmm * 0.1)} H${X(wings[1].x1) + 34}"/><text class="tg" x="${X(wings[1].x1) + 38}" y="${Y(Lmm * 0.1) + 4}">B: outer end, to OUT_B</text>`;
  } else {
    s += `<path class="wire coil" d="M${X(wings[0].x0)} ${Y(Lmm * 0.1)} H${X(wings[0].x0) - 34}"/><text class="tg" x="${X(wings[0].x0) - 38}" y="${Y(Lmm * 0.1) + 4}" text-anchor="end">A: outer end, to OUT_A</text>`;
    const jy = Y(Lmm * 0.7); s += `<path class="wire coil dash" d="M${X(0)} ${jy} H${X(wings[0].x1) + 34}"/><circle class="dot orange" cx="${X(0)}" cy="${jy}" r="4"/><text class="tg" x="${X(wings[0].x1) + 38}" y="${jy + 4}">B: inner end, to OUT_B</text>`;
  }
  // dimensions
  const dimY = Y(Lmm) + 34; const dim = (xa, xb, y, t) => `<path class="dim" marker-start="url(#arw)" marker-end="url(#arw)" d="M${xa} ${y} H${xb}"/><text class="sm" x="${(xa + xb) / 2}" y="${y - 5}" text-anchor="middle">${t}</text>`;
  if (single) s += dim(X(wings[0].x0), X(wings[0].x1), dimY, `${fx(mm(g.wx), 0)} mm`);
  else s += dim(X(wings[1].x0), X(wings[1].x1), dimY, `${fx(mm(g.wx), 0)} mm`) + dim(X(wings[0].x0), X(wings[0].x1), dimY, `${fx(mm(g.wx), 0)} mm`) + dim(X(-mm(P.gap) / 2), X(mm(P.gap) / 2), dimY + 22, `gap ${fx(mm(P.gap), 0)} mm`);
  const rx = X(wings[wings.length - 1].x1) + 20; s += `<path class="dim" marker-start="url(#arw)" marker-end="url(#arw)" d="M${rx} ${Y(0)} V${Y(Lmm)}"/><text class="sm" x="${rx + 6}" y="${Y(Lmm / 2)}">${fx(Lmm, 0)} mm</text>`;
  s += `<text class="sm" x="${X(wings[0].x0) + 4}" y="${Y(0) - 8}">band ${fx(bm, 0)} mm, thickness ${fx(mm(g.t), 1)} mm</text>`;
  // side view
  const base = 560, rise = mm(g.wx) * Math.sin(g.th), zT = mm(r.zT) , ks = Math.min(k, 200 / (zT + rise + 10)), sx = v => cx + v * ks, sy = z => base - z * ks;
  const off = mm(g.t) / 2 + mm(P.standoff), ct = Math.cos(g.th), tn = Math.tan(g.th), gh = single ? -mm(g.wx) : mm(P.gap);
  const skin = x => { const ax = Math.abs(x) - gh / 2; return single || ax <= 0 ? off : ax * tn + off / ct; };
  const xl = single ? -mm(g.wx) / 2 : -(mm(P.gap) / 2 + mm(g.wx) * ct), xr = -xl, pts = []; for (let i = 0; i <= 40; i++) { const x = xl + (xr - xl) * i / 40; pts.push(`${sx(x)} ${sy(skin(x))}`); }
  s += `<text class="lb b" x="60" y="${base - 214}">Side view, to scale</text>`;
  s += `<path class="tissue" d="M${sx(xl - 30)} ${sy(skin(xl))} L${pts.join(' L')} L${sx(xr + 30)} ${sy(skin(xr))} V${sy(zT + 30)} H${sx(xl - 30)} Z"/><path class="wire skin" d="M${pts.join(' L')}"/>`.replace('M' + pts[0], 'M' + pts[0]);
  const tw = Math.max(3, mm(g.t) * ks);
  if (single) s += `<path class="cu" style="stroke-width:${tw}px" d="M${sx(xl)} ${sy(0)} H${sx(xr)}"/>`;
  else for (const sg of [-1, 1]) s += `<path class="cu" style="stroke-width:${tw}px" d="M${sx(sg * gh / 2)} ${sy(0)} L${sx(sg * (gh / 2 + mm(g.wx) * ct))} ${sy(mm(g.wx) * Math.sin(g.th))}"/>`;
  s += `<circle class="tgt" cx="${sx(0)}" cy="${sy(zT)}" r="6"/><text class="sm" x="${sx(0) + 12}" y="${sy(zT) + 4}">target, ${fx(mm(P.depth), 0)} mm below skin</text>`;
  s += `<path class="dim" marker-start="url(#arw)" marker-end="url(#arw)" d="M${sx(xl) - 20} ${sy(0)} V${sy(off)}"/><text class="sm" x="${sx(xl) - 26}" y="${sy(off / 2) + 4}" text-anchor="end">cover ${fx(mm(P.standoff), 0)} mm</text>`;
  s += single ? `<text class="sm" x="${sx(xr) + 10}" y="${sy(0) + 4}">flat, ${fx(mm(g.t), 1)} mm thick</text>` : `<text class="sm" x="${sx(xr) + 10}" y="${sy(rise) + 4}">bend ${fx(g.th * 180 / Math.PI, 1)}°, wing tip ${fx(rise, 0)} mm up</text>`;
  s += `<path class="wire gnd" d="M${sx(xl - 30)} ${sy(-6)} H${sx(xr + 30)}"/><text class="sm" x="${sx(xr + 30)}" y="${sy(-6) + 14}" text-anchor="end">bed or backrest surface</text>`;
  return `<svg class="wd" viewBox="0 0 900 ${base + 30}" role="img" aria-label="Coil construction, top and side views">${s}</svg>`;
}
TABS.wiring = {
  build(h) {
    h.innerHTML = card('Power and drive schematic', '<div class="wdwrap" id="wdSch"></div>', '', 'Wired from your numbers: part values change with current, voltage and coil. An H-bridge drives sine, triangle or half-sine; the controller sets the shape.') +
      card('Coil construction and connection', '<div class="wdwrap" id="wdCoil"></div><div id="wdTest"></div>') +
      card('Parts and values', '<div class="tablewrap" id="wdParts"></div>') +
      card('Cut list', '<div id="wdCut"></div>') +
      card('Controller connections', '<div class="tablewrap" id="wdPins"></div>');
  },
  update() {
    const Q = wiringParts(), P = S.P, g = Q.g, single = g.nw === 1;
    $('#wdSch').innerHTML = schematicSVG(); $('#wdCoil').innerHTML = coilSVG();
    $('#wdTest').innerHTML = single ? '<p class="note">Wind one flat spiral, outside end to A and inside end to B. Reversing A and B only reverses the field direction.</p>' : '<p class="note"><b>Check the polarity before sealing it up.</b> With a small current (1 to 2 A), hold a compass or a small magnet at the hinge: the two centre edges should pull the same way. If the field cancels instead, swap the two leads of one wing.</p>';
    const rows = [
      ['Source', `${esc(P.supply.name)}`, `${fx(Q.Voc, 0)} V, ${fx(Q.ibus, 1)} A average at the worst mode`],
      ['F1 fuse', `${Q.fuse} A`, 'Fast-blow or automotive blade, on the positive lead at the source'],
      ['C1 bulk capacitor', `${Q.cap} µF, ${Q.capV} V or higher`, 'Low-ESR electrolytic, plus 10 µF ceramic at each half-bridge'],
      ['D1 TVS', `${Q.tvs} V standoff, 600 W or more`, 'Across the bus, catches coil and cable spikes'],
      ['Q1 to Q4', `N-channel, ${Q.vds} V or more, ${Math.max(Q.id, 10)} A continuous, ${fx(P.drive.Rds * 1e3, 0)} mΩ or less`, `Pulsed rating at least ${fx(3 * Q.Ipk, 0)} A. TO-220 or D2PAK with a small heatsink`],
      ['Gate drivers (2)', 'Half-bridge, 12 V gate supply', 'IR2104 class for these voltages; add a 12 V buck from the bus'],
      ['Gate resistors', '10 Ω each, 10 kΩ gate-source pull-down', 'Slows the edges and holds the FETs off at power-up'],
      ['Rsh shunt', `${fx(Q.rsh * 1e3, 0)} mΩ, ${Math.max(1, Math.ceil(Q.pshunt * 2))} W, 1% or better`, `${fx(Q.vs * 1e3, 0)} mV at ${fx(Q.Ipk, 1)} A. Four-terminal type if available`],
      ['Sense amp', `Bidirectional, gain about ${Q.gain}`, `Output centred at 1.65 V so ±${fx(Q.Ipk, 0)} A fits the ADC (ideal gain ${fx(Q.gainWant, 0)})`],
      ['Thermistors (2)', '10 k NTC with 10 k pull-up to 3.3 V', 'One bonded to the coil, one under the cover'],
      ['Coil wire', `AWG ${fx(g.awg, 0)} enamelled, ${fx(g.lw * 1.1, 0)} m`, `${fx(g.lw, 1)} m wound plus 10% for leads and trimming`],
      ['Harness wire', `AWG ${Q.harness} for source and bridge, AWG ${Q.leads} for coil leads`, 'Stranded silicone insulation, rated for the current with margin']
    ];
    $('#wdParts').innerHTML = `<table><thead><tr><th class="l">Part</th><th class="l">Value</th><th class="l">Notes</th></tr></thead><tbody>${rows.map(r => `<tr><td class="l"><b>${esc(r[0])}</b></td><td class="l wrap">${esc(r[1])}</td><td class="l wrap">${esc(r[2])}</td></tr>`).join('')}</tbody></table>`;
    const npl = Math.max(1, Math.floor(g.b / g.dI)), layers = Math.ceil(g.N / npl);
    $('#wdCut').innerHTML = `<dl class="dl">${[
      ['Wire to buy', `${fx(g.lw * 1.1, 0)} m of AWG ${fx(g.awg, 0)} (${fx(g.d * 1e3, 2)} mm), about ${fx(g.mcu * 1.1, 2)} kg`],
      [single ? 'Winding' : 'Each wing', `${fx(g.N, 0)} turns, ${fx(g.N * g.lturn, 1)} m, ${npl} per layer over ${layers} layer${layers > 1 ? 's' : ''}`],
      ['Former', `${fx(g.wx * 1e3, 0)} × ${fx(g.ly * 1e3, 0)} mm outside, winding band ${fx(g.b * 1e3, 0)} mm, open centre ${fx((g.wx - 2 * g.b) * 1e3, 0)} × ${fx((g.ly - 2 * g.b) * 1e3, 0)} mm`],
      ['Layout', single ? 'One flat coil, no hinge' : `Two wings ${fx(P.gap * 1e3, 0)} mm apart, each tilted ${fx(g.th * 180 / Math.PI, 1)}° toward the patient`],
      ['Resistance', `${fx(g.R20 * 1e3, 0)} mΩ cold. Measure it when done; it should match within about 5%`],
      ['Inductance', `${fx(S.r.ind.L * 1e6, 0)} µH expected`]
    ].map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    const pins = [['PWM_A', 'GPIO4', 'Gate driver A input'], ['PWM_B', 'GPIO5', 'Gate driver B input'], ['EN', 'GPIO6', 'Both driver shutdown pins (high = run)'], ['ISENSE', 'GPIO1 (ADC1)', 'Sense amp output'], ['TCOIL', 'GPIO2 (ADC1)', 'Coil thermistor divider'], ['TSKIN', 'GPIO3 (ADC1)', 'Cover thermistor divider'], ['VBUS', 'GPIO7 (ADC1)', 'Bus voltage through a 10:1 divider'], ['3V3 / GND', 'power', 'Thermistor pull-ups and sense amp supply']];
    $('#wdPins').innerHTML = `<table><thead><tr><th class="l">Signal</th><th class="l">ESP32-S3 pin</th><th class="l">Connects to</th></tr></thead><tbody>${pins.map(p => `<tr><td class="l"><b>${p[0]}</b></td><td class="l">${p[1]}</td><td class="l wrap">${p[2]}</td></tr>`).join('')}</tbody></table>`;
  }
};
