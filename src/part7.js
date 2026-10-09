/* ===================== part 7: duty cycle (strip above the tabs, and the Duty cycle tab) =====================
   Drive duty m   PWM modulation depth. The H-bridge applies m x supply voltage, so m sets current and flux. The flux dial.
   Burst duty D   Fraction of time energized. Heat, supply power and pack energy scale with D; flux per burst does not. The heat dial. */
const CAUSE = { coil: 'coil temperature', skin: 'skin temperature', supply: 'supply power', pcap: 'heat budget', energy: 'pack energy' };
const CAUSE_COLOR = { coil: '--c8', skin: '--c4', supply: '--c7', pcap: '--c3', energy: '--c5' };
let dutyBuilt = false;

function dutyCtl(it) {
  const v = it.get(S.P), hint = `<span class="hint" tabindex="0" aria-label="${esc(it.hint)}" data-tip="${esc(it.hint)}">i</span>`;
  return `<div class="dsc" data-k="${it.kind}"><div class="cl"><label for="in_${it.id}">${esc(it.label)}</label><em class="dtag">${esc(it.tag)}</em>${hint}<span class="u">%</span></div>` +
    `<div class="ci"><input type="range" id="rg_${it.id}" data-rg="${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${v}"><input type="number" id="in_${it.id}" data-num="${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${v.toFixed(0)}"></div>` +
    `<div class="dsr" id="dsr_${it.id}" aria-live="polite"></div></div>`;
}
function buildDutyStrip() {
  if (dutyBuilt) return;
  $('#dutystrip').innerHTML = `<div class="dsh"><h2>Duty cycle</h2><span>Drive duty sets the flux. Burst duty sets the heat. Neither touches the supply voltage.</span></div>` +
    ['a', 'r'].map(md => `<div class="dsm" data-mode="${md}">${DUTY_ITEMS.filter(i => i.mode === md).map(dutyCtl).join('')}</div>`).join('') + '<p class="dsfoot" id="dsfoot"></p>';
  dutyBuilt = true;
}
function dutyInfo(md) {
  const r = S.r, P = S.P, a = md === 'a', M = a ? P.acute : P.recov, res = a ? r.A : r.R;
  const lim = C.dutyLimits(r.geo, r.ind, r.aE, r.kB, P, M, res.I, a);
  const N = Math.max(1, Math.round(M.f * P.burstT)), on = Math.min(N, Math.max(1, Math.round(N * M.duty))), off = N - on;
  return { M, res, a, lim, N, on, off, Bavg: res.Bpk * M.duty };
}
function renderDuty() {
  if (!S.r) return; buildDutyStrip();
  const P = S.P, md = S.mode, d = dutyInfo(md), res = d.res, M = d.M;
  $$('#dutystrip .dsm').forEach(e => { e.hidden = e.dataset.mode !== md; });
  for (const it of DUTY_ITEMS) {
    if (it.mode !== md) continue; const v = it.get(P), n = $('#in_' + it.id), g = $('#rg_' + it.id);
    if (document.activeElement !== n) n.value = v.toFixed(0); if (document.activeElement !== g) g.value = v;
  }
  const mid = md === 'a' ? 'ma' : 'mr', did = md === 'a' ? 'da' : 'dr';
  const atCap = res.mReq > res.Dm - 0.01, over = res.mReq > res.Dm + 1e-3;
  $('#dsr_' + mid).innerHTML = `${over ? '<b class="tag over">over</b> ' : atCap ? '<b class="tag">at ceiling</b> ' : ''}This design needs <b>${fx(res.mReq * 100, 0)}%</b>: ${fx(res.Vreq, 1)} V peak from a ${fx(P.supply.Voc, 0)} V source, giving <b>${fx(res.Bpk * 1e3, 2)} mT</b>.`;
  const L = d.lim, mem = M.duty > L.D + 0.004;
  $('#dsr_' + did).innerHTML = L.D >= 0.999 ? `Heat allows <b>continuous</b> running here. ${M.duty < 0.995 ? 'Burst duty is a free choice, not a need.' : ''}` : `${mem ? '<b class="tag over">over</b> ' : ''}Heat allows up to <b>${fx(L.D * 100, 0)}%</b>, held back by ${CAUSE[L.by]}.`;
  $('#dsfoot').innerHTML = `On the ESP32: <b>${esc(C.WAVES[M.wave].name.split(' (')[0].toLowerCase())}</b> at <b>${fx(res.mReq * 100, 0)}%</b> modulation, <b>${d.on}</b> cycles on and <b>${d.off}</b> off every ${fx(P.burstT, 1)} s. Mean flux <b>${fx(d.Bavg * 1e3, 2)} mT</b>, average coil heat <b>${fx(res.Pcoil, 1)} W</b>.`;
}

/* envelope theorem: how the optimum moves with a duty setting, from the multipliers alone (no re-solve) */
function dutyShadow(set, d, dir) {
  if (S.manual || !S.sol || S.solving) return null;
  const P1 = clonePSafe(S.P), P0 = clonePSafe(S.P); set(P1, dir > 0 ? d / 2 : 0); set(P0, dir > 0 ? -d / 2 : -d);   // central step up, one-sided step down
  const g1 = C.evaluate(S.x, P1).g, g0 = C.evaluate(S.x, P0).g; let dF = 0;
  for (let i = 0; i < g1.length; i++) if (S.sol.lam[i] > 1e-6 && !(CN[i].id === 'Breq' && !needsB())) dF += S.sol.lam[i] * (g1[i] - g0[i]);
  return -obj().slope * dF * dir;                    // change of the objective, in its own units, for a move of dir x d
}

TABS.duty = {
  hold: false,
  build(h) {
    h.innerHTML =
      card('Flux dial for this coil', '<div class="grid2"><div><div class="ct">Flux at the target</div><div id="chdF"></div></div><div><div class="ct">Amps</div><div id="chdI"></div></div><div class="gfull"><div class="ct">Temperature at the end of the session</div><div id="chdT"></div></div></div><p class="note" id="dialNote"></p>', '', 'This coil as built, driven at every drive duty from 5 to 95%. Flux rises almost in proportion; heat rises with the square. Curves stop where the copper would pass 150 °C.') +
      card('Heat-limited burst duty', '<div class="toolrow"><div class="seg" id="holdSeg" role="group" aria-label="Session length used"><button type="button" data-h="0">Session as set</button><button type="button" data-h="1">Run until temperature settles</button></div></div><div id="chdM"></div><p class="note" id="mapNote"></p>', '', 'For each drive duty, the longest share of time the coil may be energized before a limit trips. Anything under the line is safe. Dashed lines show which limit sets it.') +
      card('Burst pattern and ESP32 settings', '<div class="toolrow"><label class="sel">Burst period (s)<input type="number" id="burstT" min="0.1" max="30" step="0.1"></label></div><div class="wdwrap"><svg class="wd" id="burstSvg" viewBox="0 0 760 300" style="min-width:600px" role="img" aria-label="Burst pattern and waveform amplitude"></svg></div><div id="fwList"></div>', '', 'The same two duties as the firmware sees them.') +
      card('What each dial buys', '<div id="buys"></div>');
    this.ch = { F: new LineChart($('#chdF'), { height: 190 }), I: new LineChart($('#chdI'), { height: 190 }), T: new LineChart($('#chdT'), { height: 200 }), M: new LineChart($('#chdM'), { height: 250 }) };
    $('#holdSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { this.hold = b.dataset.h === '1'; this.paintMap(); } });
    $('#burstT').addEventListener('input', e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0.1) { S.P.burstT = Math.min(30, v); saveSoon(); renderDuty(); this.paintBurst(); } });
  },
  ms() { return Array.from({ length: 37 }, (_, i) => 0.05 + i * 0.025); },
  update() {
    const r = S.r, P = S.P, md = S.mode, a = md === 'a', M = a ? P.acute : P.recov, res = a ? r.A : r.R, c = modeColor(), ms = this.ms();
    this.cvA = C.dutyCurve(r, P, P.acute, true, ms); this.cvR = C.dutyCurve(r, P, P.recov, false, ms); this.cv = a ? this.cvA : this.cvR;
    const ok = p => p.Tend < 150, cv = this.cv.filter(ok), now = res.mReq * 100, cvA = this.cvA.filter(ok), cvR = this.cvR.filter(ok);
    const Bat = m => { const i = clamp(Math.round((m - 0.05) / 0.025), 0, ms.length - 1); return cv[i].B; };
    this.Bat = Bat;
    const xo = { xDom: [5, 95], xLabel: 'drive duty, %', xUnit: '%', fmtX: v => v.toFixed(0) };
    this.ch.F.set(Object.assign({ series: [{ name: `Acute ${P.acute.f} Hz`, color: cssVar('--c1'), pts: cvA.map(p => [p.m * 100, p.B * 1e3]) }, { name: `Recovery ${P.recov.f} Hz`, color: cssVar('--c2'), pts: cvR.map(p => [p.m * 100, p.B * 1e3]) }], markers: [{ x: clamp(now, 5, 95), y: res.Bpk * 1e3, color: cssVar('--ink'), label: 'now' }], yLabel: 'mT', yUnit: 'mT', fmtY: v => v.toFixed(v < 10 ? 1 : 0) }, xo));
    this.ch.I.set(Object.assign({ series: [{ name: 'Peak current', color: c, pts: cv.map(p => [p.m * 100, p.I]) }, { name: 'Average from source', color: c, dash: '5 4', pts: cv.map(p => [p.m * 100, p.Ibus]) }], hlines: [{ y: P.drive.Isw, label: 'current budget' }], markers: [{ x: clamp(now, 5, 95), y: res.I, color: cssVar('--ink') }], yLabel: 'A', yUnit: 'A', fmtY: v => v.toFixed(v < 10 ? 1 : 0) }, xo));
    const Mf = Object.assign({}, M, { duty: 1 });
    const full = M.duty < 0.995 ? ms.map(m => [m * 100, C.modeCalc(r.geo, r.ind, r.aE, r.kB, P, Mf, C.driveCurrent(r.geo, r.ind, r.aE, r.kB, P, Mf, m)).T.Tend]).filter(p => p[1] < 150) : null;
    const ser = [{ name: `Coil, burst ${fx(M.duty * 100, 0)}%`, color: c, pts: cv.map(p => [p.m * 100, p.Tend]) }, { name: 'Skin', color: c, dash: '5 4', pts: cv.map(p => [p.m * 100, p.Ts]) }];
    if (full) ser.push({ name: 'Coil, continuous', color: cssVar('--muted'), dash: '2 3', w: 1.6, pts: full });
    this.ch.T.set(Object.assign({ series: ser, hlines: [{ y: P.thermal.Tmax, label: 'coil limit' }, { y: P.thermal.Tskin, label: 'skin limit' }], yZero: false, yLabel: '°C', yUnit: '°C', fmtY: v => v.toFixed(0) }, xo));
    const half = driveHalf(r, P, M, res);
    $('#dialNote').innerHTML = `Right now: <b>${fx(now, 0)}%</b> drive gives <b>${fx(res.Bpk * 1e3, 2)} mT</b> at ${fx(res.I, 1)} A. At <b>${fx(now / 2, 0)}%</b> you get <b>${fx(half.B * 1e3, 2)} mT</b> (${fx(half.B / res.Bpk * 100, 0)}% of the flux) for <b>${fx(half.P, 1)} W</b> of coil heat (${fx(half.P / res.Pcoil * 100, 0)}% of the heat).`;
    this.paintMap(); this.paintBurst(); this.paintBuys();
  },
  paintMap() {
    const r = S.r, P = S.P, md = S.mode, a = md === 'a', M = a ? P.acute : P.recov, res = a ? r.A : r.R, c = modeColor(), ms = this.ms();
    $$('#holdSeg button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.h === '1') === this.hold));
    const cv = this.hold ? C.dutyCurve(r, P, Object.assign({}, M, { tsess: 1e5 }), a, ms) : this.cv;
    const ser = [{ name: 'Allowed burst duty', color: c, w: 2.8, area: true, pts: cv.map(p => [p.m * 100, p.lim.D * 100]) }];
    for (const k of ['coil', 'skin', 'supply', 'pcap', 'energy']) if (cv.some(p => p.lim[k] < 0.995)) ser.push({ name: CAUSE[k][0].toUpperCase() + CAUSE[k].slice(1), color: cssVar(CAUSE_COLOR[k]), w: 1.6, dash: '5 4', pts: cv.map(p => [p.m * 100, p.lim[k] * 100]) });
    const now = clamp(res.mReq * 100, 5, 95), Bat = this.Bat;
    this.ch.M.set({ series: ser, hlines: [{ y: 100, label: 'continuous' }], markers: [{ x: now, y: M.duty * 100, color: cssVar('--ink'), label: 'now' }], xDom: [5, 95], yDom: [0, 105], xLabel: 'drive duty, %', yLabel: 'burst duty, %', xUnit: '%', yUnit: '%', fmtX: v => v.toFixed(0), fmtY: v => v.toFixed(0), tipX: v => `${v.toFixed(0)}% drive · ${fx(Bat(v / 100) * 1e3, 2)} mT` });
    const i = clamp(Math.round((res.mReq - 0.05) / 0.025), 0, ms.length - 1), here = cv[i].lim;
    let cont = null; for (let k = cv.length - 1; k >= 0; k--) if (cv[k].lim.D >= 0.999) { cont = cv[k]; break; }
    const sess = this.hold ? 'until the temperature settles' : `for ${fx(M.tsess / 60, 0)} minutes`;
    let t = `At <b>${fx(res.mReq * 100, 0)}%</b> drive (${fx(res.Bpk * 1e3, 2)} mT), running ${sess}, this coil may be energized up to <b>${fx(here.D * 100, 0)}%</b> of the time${here.D < 0.999 ? `, held back by ${CAUSE[here.by]}` : ''}. You have it set to <b>${fx(M.duty * 100, 0)}%</b>.`;
    if (cont && cont.m < ms[ms.length - 1] - 1e-6) t += ` To run continuously, hold drive duty at or below <b>${fx(cont.m * 100, 0)}%</b> (${fx(cont.B * 1e3, 2)} mT).`;
    else if (!cont) t += ' No drive duty in this range can run continuously in this session. Shorten the session or lower the flux.';
    else t += ' Heat does not stop continuous running at any drive duty in this range.';
    $('#mapNote').innerHTML = t;
  },
  paintBurst() {
    const r = S.r, P = S.P, md = S.mode, d = dutyInfo(md), M = d.M, res = d.res, W = C.WAVES[M.wave], inp = $('#burstT');
    if (document.activeElement !== inp) inp.value = P.burstT;
    const x0 = 40, x1 = 720, w = x1 - x0, T = P.burstT, onW = w * M.duty, mm = clamp(res.mReq, 0, 1);
    const yc = 78, amp = 34, c = modeColor(), mc = 'var(--accent)';
    let g = `<text class="sm" x="${x0}" y="16">One burst period, ${fx(T, 1)} s</text>`;
    g += `<line class="dim" x1="${x0}" x2="${x1}" y1="${yc}" y2="${yc}"/>`;
    g += `<rect x="${x0}" y="${yc - amp * mm}" width="${Math.max(onW, 1)}" height="${2 * amp * mm}" fill="var(--accent-soft)" stroke="${c}" stroke-width="1.4"/>`;
    if (d.on <= 150) { let p = ''; const n = d.on * 14; for (let k = 0; k <= n; k++) { const t = k / n * d.on, ph = (t % 1); p += (k ? 'L' : 'M') + (x0 + onW * k / n).toFixed(1) + ' ' + (yc - amp * mm * W.g(ph)).toFixed(1); } g += `<path d="${p}" fill="none" stroke="${c}" stroke-width="1.2"/>`; }
    g += `<text class="lb b" x="${x0 + onW / 2}" y="${yc - amp * mm - 8}" text-anchor="middle">on: ${d.on} cycles, ${fx(d.on / M.f * 1e3, 0)} ms</text>`;
    if (M.duty < 0.995) g += `<text class="lb" x="${x0 + onW + (w - onW) / 2}" y="${yc - 8}" text-anchor="middle">off: ${d.off} cycles, ${fx(d.off / M.f * 1e3, 0)} ms</text>`;
    g += `<line class="dim" x1="${x0}" x2="${x0 + onW}" y1="${yc + amp + 12}" y2="${yc + amp + 12}"/><text class="sm" x="${x0 + onW / 2}" y="${yc + amp + 26}" text-anchor="middle">burst duty ${fx(M.duty * 100, 0)}%: sets heat</text>`;
    // zoom: two cycles at the drive duty
    const y2 = 222, a2 = 40, nCyc = 2;
    g += `<text class="sm" x="${x0}" y="${y2 - a2 - 14}">Zoom: ${nCyc} cycles at ${M.f} Hz, drive duty ${fx(res.mReq * 100, 0)}% of the supply</text>`;
    g += `<line class="dim dash" x1="${x0}" x2="${x1}" y1="${y2 - a2}" y2="${y2 - a2}"/><line class="dim dash" x1="${x0}" x2="${x1}" y1="${y2 + a2}" y2="${y2 + a2}"/><line class="dim" x1="${x0}" x2="${x1}" y1="${y2}" y2="${y2}"/>`;
    g += `<text class="sm" x="${x1}" y="${y2 - a2 - 3}" text-anchor="end">+${fx(P.supply.Voc, 0)} V (100% drive)</text><text class="sm" x="${x1}" y="${y2 + a2 + 13}" text-anchor="end">−${fx(P.supply.Voc, 0)} V</text>`;
    let p = ''; const n = 240; for (let k = 0; k <= n; k++) { const t = k / n * nCyc; p += (k ? 'L' : 'M') + (x0 + w * k / n).toFixed(1) + ' ' + (y2 - a2 * mm * W.g(t % 1)).toFixed(1); }
    g += `<path d="${p}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`;
    g += `<line x1="${x0 + 6}" x2="${x0 + 6}" y1="${y2}" y2="${y2 - a2 * mm}" stroke="var(--ink)" stroke-width="1.4"/><text class="lb b halo" x="${x0 + 12}" y="${y2 - a2 * mm / 2 + 4}">${fx(res.mReq * 100, 0)}% sets flux</text>`;
    g += `<text class="sm" x="${x0}" y="${y2 + a2 + 28}">PWM carrier ${fx(P.drive.fpwm / 1000, 0)} kHz, ${fx(P.drive.fpwm / M.f, 0)} pulses per cycle, pulse width following this shape.</text>`;
    $('#burstSvg').innerHTML = g;
    const tau = res.T.tau, rip = isFinite(tau) && T > tau / 20;
    const rows = [
      ['Waveform', `${W.name} at ${M.f} Hz, ${fx(res.I, 2)} A peak`],
      ['Drive duty', `${fx(res.mReq * 100, 1)}%: scale the waveform table by ${fx(res.mReq, 3)}; the peak PWM compare value is ${fx(res.mReq, 3)} × the timer period`],
      ['Burst', `${d.on} cycles on, ${d.off} off, repeating every ${fx(T, 1)} s (${fx(M.duty * 100, 0)}% duty). Begin each burst with the voltage at its peak so the first cycle carries no DC offset.`],
      ['Mean flux', `${fx(d.Bavg * 1e3, 2)} mT averaged over time (${fx(res.Bpk * 1e3, 2)} mT peak × ${fx(M.duty * 100, 0)}%)`],
      ['Average power', `coil ${fx(res.Pcoil, 1)} W, ${fx(res.Pin, 0)} W from the source`],
      ['Thermal check', isFinite(tau) ? `Time constant ${fx(tau / 60, 0)} min against a ${fx(T, 1)} s burst period. ${rip ? 'The period is long enough for the temperature to ripple: shorten it.' : 'Short enough that the average power sets the temperature.'}` : 'Thermal runaway: the burst period does not matter.']
    ];
    $('#fwList').innerHTML = '<dl class="dl">' + rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') + '</dl>';
  },
  paintBuys() {
    const r = S.r, P = S.P, md = S.mode, a = md === 'a', d = dutyInfo(md), M = d.M, res = d.res, ob = obj();
    const half = driveHalf(r, P, M, res), rows = [];
    rows.push(['Halve the drive duty', `Flux falls to ${fx(half.B / res.Bpk * 100, 0)}% (${fx(half.B * 1e3, 2)} mT), amps to ${fx(half.I, 1)} A, coil heat to ${fx(half.P / res.Pcoil * 100, 0)}% (${fx(half.P, 1)} W). Heat follows current squared, so this is the strong heat lever, paid for in flux.`]);
    rows.push(['Halve the burst duty', `Coil heat falls to ${fx(res.Pcoil / 2, 1)} W. Flux in each burst stays ${fx(res.Bpk * 1e3, 2)} mT, and the mean flux drops to ${fx(d.Bavg * 1e3 / 2, 2)} mT. This is the cheap heat lever if bursts are acceptable.`]);
    if (a && !S.manual && S.sol && !S.solving) {
      const mTop = P.acute.m > 0.94, dTop = P.acute.duty > 0.94;
      const dm = dutyShadow((Q, v) => { Q.acute.m += v / 100; }, 10, mTop ? -1 : 1), dd = dutyShadow((Q, v) => { Q.acute.duty += v / 100; }, 10, dTop ? -1 : 1);
      const fmt = v => `${v >= 0 ? '+' : '−'}${fx(Math.abs(v), ob.dec + 1)} ${ob.unit}`;
      if (dm != null) rows.push(['Optimizer: drive duty ceiling', Math.abs(dm) < 1e-3 ? 'Moving it changes nothing: another limit binds first.' : `${mTop ? 'Cutting' : 'Raising'} it 10 points moves ${ob.name.toLowerCase()} by about ${fmt(dm)}, with the whole design re-tuned around it (from the Lagrange multipliers).`]);
      if (dd != null) rows.push(['Optimizer: burst duty', Math.abs(dd) < 1e-3 ? 'Moving it changes nothing: heat is not binding.' : `${dTop ? 'Cutting' : 'Raising'} it 10 points moves ${ob.name.toLowerCase()} by about ${fmt(dd)}.`]);
    }
    $('#buys').innerHTML = '<dl class="dl">' + rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('') + '</dl>';
  }
};
function driveHalf(r, P, M, res) {
  const I = C.driveCurrent(r.geo, r.ind, r.aE, r.kB, P, M, res.mReq / 2), c = C.modeCalc(r.geo, r.ind, r.aE, r.kB, P, M, I);
  return { I, B: r.kB * I, P: c.Pcoil };
}
