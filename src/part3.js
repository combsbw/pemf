/* ===================== part 3: state, solver manager, controls, read-out ===================== */
const VAR = C.VARS, CN = C.CONS, NV = VAR.length;
const CI = {}; CN.forEach((c, i) => CI[c.id] = i);
C.SUPPLIES.bat24.Imax = 30; C.SUPPLIES.bat48.Imax = 30;

const S = {
  P: C.defaults(), lock: new Array(NV).fill(null), sol: null, x: null, r: null,
  mode: 'a', tab: 'field', solving: false, solveMs: 0, panel: 'views',
  plane: 'xz', q: 'B', slice: { i: 5, j: 0 }, sweep: { axis: 'Pcap', data: null, busy: false, stale: true }, supplyCmp: { data: null, busy: false, stale: true },
  snap: null, supplyKey: 'bat24', showAll: false, manual: false
};
S.P.supply = Object.assign({}, C.SUPPLIES.bat24);
/* objective descriptors: every place that depends on what is being optimized reads from here */
const OBJ = {
  maxB: { min: false, name: 'Flux at target', unit: 'mT', fromSol: s => s.Bpk * 1e3, fromR: r => r.A.Bpk * 1e3, f: '−B / 1 mT', fTex: 'f=-B_T/1\\,\\mathrm{mT}', pull: '∇B', slope: 1, dec: 2 },
  minP: { min: true, name: 'Coil heat', unit: 'W', fromSol: s => s.Pcoil, fromR: r => r.A.Pcoil, f: 'P_coil / 10 W', pull: '−∇P', slope: -10, dec: 1 },
  minI: { min: true, name: 'Peak current', unit: 'A', fromSol: s => s.x[6], fromR: r => r.A.I, f: 'I / 5 A', pull: '−∇I', slope: -5, dec: 2 }
};
const obj = () => OBJ[S.P.objective] || OBJ.maxB;
const needsB = () => S.P.objective !== 'maxB';

/* ---------- persistence (per-viewer convenience only) ---------- */
const KEY = 'pemf-butterfly-v2';
function saveState() { try { localStorage.setItem(KEY, JSON.stringify({ P: S.P, lock: S.lock, supplyKey: S.supplyKey, manual: S.manual, x: S.x }, (k, v) => v === Infinity ? '∞' : v)); } catch (e) { } }
function loadState() {
  try {
    const t = localStorage.getItem(KEY); if (!t) return;
    const o = JSON.parse(t, (k, v) => v === '∞' ? Infinity : v); if (!o || !o.P) return;
    const def = C.defaults();
    const merge = (a, b) => { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k]) merge(a[k], b[k]); else if (k in a || k === 'Imax') a[k] = b[k]; } return a; };
    S.P = merge(def, o.P); S.lock = Array.isArray(o.lock) && o.lock.length === NV ? o.lock : S.lock; S.supplyKey = o.supplyKey || S.supplyKey; S.manual = !!o.manual && S.lock.every(v => v != null); if (S.manual && Array.isArray(o.x) && o.x.length === NV) S.x = o.x;
  } catch (e) { }
}
const saveSoon = debounce(saveState, 400);

/* ---------- solver manager (Web Worker with synchronous fallback) ---------- */
const WORKER_GLUE = `
function pack(r){return {u:r.u,x:r.x,lam:r.lam,kkt:r.kkt,evals:r.evals,trace:r.trace,atBound:r.atBound,g:r.r.g,Bpk:r.r.A.Bpk,Pcoil:r.r.A.Pcoil};}
self.onmessage=function(e){var m=e.data;try{
 if(m.type==='solve'){var res=PEMF.solve(m.P,m.opt);self.postMessage({id:m.id,type:'done',res:pack(res)});}
 else if(m.type==='batch'){var prev=null;for(var k=0;k<m.jobs.length;k++){var j=m.jobs[k];var o=j.opt||{};if(j.warm&&prev){o.starts=[prev.u];o.lam0=prev.lam;}var res=PEMF.solve(j.P,o);prev=res;self.postMessage({id:m.id,type:'job',k:k,res:pack(res)});}self.postMessage({id:m.id,type:'done'});}
}catch(err){self.postMessage({id:m.id,type:'error',msg:String(err)});}};`;
class Runner {
  constructor() { this.w = null; this.failed = false; this.seq = 0; this.cur = null; }
  ensure() {
    if (this.w || this.failed) return;
    try {
      const src = document.getElementById('core').textContent + '\n' + WORKER_GLUE;
      this.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.w = new Worker(this.url);
      this.w.onmessage = e => this.onMsg(e.data);
      this.w.onerror = () => { this.failed = true; this.w = null; if (this.cur) { const c = this.cur; this.cur = null; this.fallback(c); } };
    } catch (e) { this.failed = true; this.w = null; }
  }
  onMsg(m) {
    const c = this.cur; if (!c || m.id !== c.id) return;
    if (m.type === 'job') c.onJob && c.onJob(m.k, m.res);
    else if (m.type === 'done') { this.cur = null; c.resolve(m.res); }
    else if (m.type === 'error') { this.cur = null; c.reject(new Error(m.msg)); }
  }
  cancel() { if (this.cur) { const c = this.cur; this.cur = null; c.reject('cancelled'); if (this.w) { this.w.terminate(); this.w = null; } } }
  start(msg, onJob) {
    this.cancel(); this.ensure();
    return new Promise((resolve, reject) => {
      const id = ++this.seq; const c = { id, resolve, reject, onJob, msg }; this.cur = c; msg.id = id;
      if (this.w) this.w.postMessage(msg); else this.fallback(c);
    });
  }
  fallback(c) {                      // run on the main thread in small steps so the page stays alive
    const msg = c.msg; this.cur = c;
    setTimeout(() => {
      try {
        const pack = r => ({ u: r.u, x: r.x, lam: r.lam, kkt: r.kkt, evals: r.evals, trace: r.trace, atBound: r.atBound, g: r.r.g, Bpk: r.r.A.Bpk, Pcoil: r.r.A.Pcoil });
        if (msg.type === 'solve') { const r = pack(C.solve(msg.P, msg.opt)); if (this.cur === c) { this.cur = null; c.resolve(r); } }
        else { let prev = null; const jobs = msg.jobs; let k = 0;
          const step = () => { if (this.cur !== c) return; if (k >= jobs.length) { this.cur = null; c.resolve(); return; }
            const j = jobs[k], o = j.opt || {}; if (j.warm && prev) { o.starts = [prev.u]; o.lam0 = prev.lam; } const res = C.solve(j.P, o); prev = res; c.onJob && c.onJob(k, pack(res)); k++; setTimeout(step, 0); };
          step(); }
      } catch (e) { if (this.cur === c) { this.cur = null; c.reject(e); } }
    }, 5);
  }
}
const mainRunner = new Runner(), batchRunner = new Runner();
function clonePSafe(P) { return JSON.parse(JSON.stringify(P, (k, v) => v === Infinity ? '∞' : v), (k, v) => v === '∞' ? Infinity : v); }
function coldStarts(n) {
  const base = [[0.55, 0.55, 0.45, 0.2, 0.4, 0.55, 0.5], [0.35, 0.35, 0.35, 0.5, 0.25, 0.4, 0.6], [0.8, 0.8, 0.5, 0.15, 0.45, 0.7, 0.4], [0.6, 0.6, 0.7, 0.5, 0.4, 0.5, 0.35]];
  return base.slice(0, n || 2);
}
let solveToken = 0;
const lockFor = P => { const l = S.manual ? new Array(NV).fill(null) : S.lock.slice(); if (P.coilType === 'single') l[4] = 0; return l; };
function applyManual() {
  const x = S.x.slice(); for (let i = 0; i < NV; i++) if (S.lock[i] != null) x[i] = S.lock[i];
  S.x = x; S.r = C.evaluate(S.x, S.P); let viol = 0; S.r.g.forEach((g, i) => { if (!(CN[i].id === 'Breq' && !needsB())) viol = Math.max(viol, g); });
  S.sol = { u: C.toU(x), x: x.slice(), lam: new Array(CN.length).fill(0), kkt: { stat: 0, viol: Math.max(0, viol), comp: 0 }, evals: 1, trace: [], atBound: VAR.map(() => 'locked'), g: S.r.g, Bpk: S.r.A.Bpk, Pcoil: S.r.A.Pcoil };
  S.solving = false; S.error = null; S.sweep.stale = true; S.supplyCmp.stale = true; S.snap = null; S.sliceStale = true;
}
function solveNow(opts) {
  opts = opts || {};
  if (S.manual) { solveToken++; mainRunner.cancel(); applyManual(); renderAll(); return; } const token = ++solveToken; S.solving = true; renderStatus();
  const t0 = performance.now();
  const P = clonePSafe(S.P);
  const starts = opts.global ? coldStarts(3).concat(S.sol ? [S.sol.u] : []) : (S.sol ? [S.sol.u] : coldStarts(2));
  const opt = { lock: lockFor(S.P), starts, maxOuter: 10, maxInner: 80 };
  if (S.sol && !opts.global) opt.lam0 = S.sol.lam;
  mainRunner.start({ type: 'solve', P, opt }).then(sol => {
    if (token !== solveToken) return;
    S.solveMs = performance.now() - t0; S.sol = sol; S.x = sol.x.slice(); S.solving = false;
    S.r = C.evaluate(S.x, S.P);
    S.sweep.stale = true; S.supplyCmp.stale = true; S.snap = null; S.sliceStale = true;
    renderAll();
  }).catch(err => { if (err === 'cancelled') return; S.solving = false; S.error = String(err && err.message || err); renderStatus(); });
}
const solveSoon = debounce(solveNow, 150);
function quickEval() { if (S.x) S.r = C.evaluate(S.x, S.P); }

/* ---------- control schema ---------- */
const WAVE_OPTS = Object.keys(C.WAVES).map(k => [k, C.WAVES[k].name]);
const P_ = (path, scale) => ({
  get: P => { const v = path.split('.').reduce((o, k) => o[k], P); return typeof v === 'number' ? v * scale : v; },
  set: (P, v) => { const ks = path.split('.'); let o = P; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = scale === 1 ? v : v / scale; }
});
const SCHEMA = [
  { sec: 'Target and objective', open: true, items: [
    { id: 'coilType', type: 'seg', label: 'Coil', opts: [['butterfly', 'Butterfly'], ['single', 'Single coil']], ...P_('coilType', 1), reflow: true, hint: 'Butterfly is two wings wound in opposite sense (a figure-8) with an optional bend. Single coil is one flat rectangular spiral.' },
    { id: 'objective', type: 'seg', label: 'Objective', opts: [['maxB', 'Max flux'], ['minI', 'Min amps'], ['minP', 'Min heat']], ...P_('objective', 1), reflow: true, hint: 'Max flux pushes B at the target as high as your limits allow. Min amps and Min heat fix the flux you need and then minimize current or coil dissipation.' },
    { id: 'Isw', label: 'Peak current budget (acute)', unit: 'A', min: 1, max: 60, step: 0.5, ...P_('drive.Isw', 1), hint: 'The most amps your build can handle. The solver trades turns, wire gauge and voltage to stay under it. Recovery current is set by its flux and the same limit applies.' },
    { id: 'BaReq', label: 'Required acute flux', unit: 'mT', min: 0.5, max: 20, step: 0.1, ...P_('BaReq', 1e3), show: P => P.objective !== 'maxB' },
    { id: 'depth', label: 'Target depth below skin', unit: 'cm', min: 2, max: 12, step: 0.5, ...P_('depth', 100), hint: 'Skin to the disc and nerve root. Lumbar discs are commonly 5 to 8 cm deep.' },
    { id: 'standoff', label: 'Cover and cushion thickness', unit: 'mm', min: 3, max: 30, step: 1, ...P_('standoff', 1e3) },
    { id: 'Brec', label: 'Recovery-mode flux', unit: 'mT', min: 0.05, max: 5, step: 0.05, ...P_('recov.Bpk', 1e3), hint: 'Set directly. Recovery current follows from I = B / k_B.' }
  ] },
  { sec: 'Acute mode', open: true, items: [
    { id: 'fa', label: 'Frequency', unit: 'Hz', min: 40, max: 200, step: 5, ...P_('acute.f', 1) },
    { id: 'wa', type: 'select', label: 'Waveform', opts: WAVE_OPTS, ...P_('acute.wave', 1) },
    { id: 'da', label: 'Burst duty', unit: '%', min: 10, max: 100, step: 5, ...P_('acute.duty', 100), hint: 'Fraction of time the coil is energized. Heat scales with duty, flux per pulse does not.' },
    { id: 'ta', label: 'Session length', unit: 'min', min: 1, max: 60, step: 1, ...P_('acute.tsess', 1 / 60) }
  ] },
  { sec: 'Recovery mode', items: [
    { id: 'fr', label: 'Frequency', unit: 'Hz', min: 5, max: 40, step: 1, ...P_('recov.f', 1) },
    { id: 'wr', type: 'select', label: 'Waveform', opts: WAVE_OPTS, ...P_('recov.wave', 1) },
    { id: 'dr', label: 'Burst duty', unit: '%', min: 10, max: 100, step: 5, ...P_('recov.duty', 100) },
    { id: 'tr', label: 'Session length', unit: 'min', min: 5, max: 480, step: 5, ...P_('recov.tsess', 1 / 60) }
  ] },
  { sec: 'Power source', open: true, items: [
    { id: 'supply', type: 'chips', label: 'Source', opts: [['wall12', '12 V wall'], ['wall24', '24 V wall'], ['bat24', '24 V pack'], ['bat48', '48 V pack'], ['custom', 'Custom']] },
    { id: 'Voc', label: 'Open-circuit voltage', unit: 'V', min: 6, max: 60, step: 0.5, ...P_('supply.Voc', 1), after: 'pmax' },
    { id: 'Rsrc', label: 'Source resistance', unit: 'mΩ', min: 5, max: 400, step: 5, ...P_('supply.Rsrc', 1e3), hint: 'Pack internal resistance plus cable and connector.' },
    { id: 'Pmax', label: 'Supply rating', unit: 'W', min: 20, max: 800, step: 10, ...P_('supply.Pmax', 1), show: P => P.supply.kind === 'wall' },
    { id: 'Imax', label: 'Pack continuous current', unit: 'A', min: 5, max: 80, step: 1, ...P_('supply.Imax', 1), show: P => P.supply.kind === 'battery', after: 'pmax' },
    { id: 'capWh', label: 'Pack energy', unit: 'Wh', min: 20, max: 600, step: 10, ...P_('supply.capWh', 1), show: P => P.supply.kind === 'battery' },
    { id: 'Rds', label: 'MOSFET on-resistance', unit: 'mΩ', min: 1, max: 60, step: 0.5, ...P_('drive.Rds', 1e3), hint: 'Per device. An H-bridge puts two in the current path.' }
  ] },
  { sec: 'Heat and comfort', items: [
    { id: 'Tmax', label: 'Coil temperature limit', unit: '°C', min: 35, max: 90, step: 1, ...P_('thermal.Tmax', 1) },
    { id: 'Tskin', label: 'Skin temperature limit', unit: '°C', min: 36, max: 45, step: 0.5, ...P_('thermal.Tskin', 1), hint: 'Comfort margin. Medical-device practice allows about 43 °C for prolonged skin contact.' },
    { id: 'Ta', label: 'Ambient', unit: '°C', min: 10, max: 35, step: 1, ...P_('thermal.Ta', 1) },
    { id: 'hdn', label: 'Underside cooling', unit: 'W/m²K', min: 2, max: 15, step: 0.5, ...P_('thermal.hdn', 1), hint: 'About 6 in open air, 2 to 3 on a mattress.' },
    { id: 'kc', label: 'Cover conductivity', unit: 'W/mK', min: 0.02, max: 0.5, step: 0.01, ...P_('thermal.kc', 1), hint: 'Foam 0.04, fabric 0.06, silicone 0.2.' },
    { id: 'spread', label: 'Heat spreading', unit: '×', min: 1, max: 3, step: 0.1, ...P_('thermal.spread', 1), hint: 'Effective cooling area as a multiple of the winding band area.' },
    { id: 'Cx', label: 'Former thermal mass', unit: 'J/m²K', min: 0, max: 10000, step: 250, ...P_('thermal.Cx', 1) },
    { id: 'ht', label: 'Skin to core conductance', unit: 'W/m²K', min: 20, max: 100, step: 5, ...P_('thermal.ht', 1) }
  ] },
  { sec: 'Limits and budget', items: [
    { id: 'Elim', label: 'Induced E-field limit', unit: 'V/m', min: 0.1, max: 5, step: 0.05, ...P_('Elim', 1), hint: 'ICNIRP 2010 reference for general public, all tissues, 1 Hz to 3 kHz: 0.4 V/m; occupational 0.8. Treatment devices can exceed it under clinical control.' },
    { id: 'Pcap', type: 'togglenum', label: 'Heat budget (acute)', unit: 'W', min: 2, max: 150, step: 1, get: P => P.size.Pcap, set: (P, v) => P.size.Pcap = v },
    { id: 'Wmax', label: 'Max width', unit: 'mm', min: 100, max: 600, step: 10, ...P_('size.Wmax', 1e3) },
    { id: 'Lmax', label: 'Max length', unit: 'mm', min: 100, max: 500, step: 10, ...P_('size.Lmax', 1e3) },
    { id: 'Hmax', label: 'Max profile height', unit: 'mm', min: 8, max: 80, step: 1, ...P_('size.Hmax', 1e3) },
    { id: 'mmax', label: 'Max copper mass', unit: 'kg', min: 0.2, max: 6, step: 0.1, ...P_('size.mmax', 1) },
    { id: 'price', label: 'Wire price', unit: '$/kg', min: 5, max: 40, step: 1, ...P_('price', 1) }
  ] },
  { sec: 'Winding assumptions', items: [
    { id: 'gap', label: 'Gap between wings', unit: 'mm', min: 2, max: 30, step: 1, ...P_('gap', 1e3), show: P => P.coilType !== 'single' },
    { id: 'phi', label: 'Winding packing', unit: '', min: 0.6, max: 0.95, step: 0.01, ...P_('phi', 1), hint: 'Share of the winding window the insulated wire fills.' },
    { id: 'rin', label: 'Inner clearance', unit: 'mm', min: 5, max: 40, step: 1, ...P_('rin', 1e3) }
  ] }
];
const ITEM = {}; SCHEMA.forEach(s => s.items.forEach(it => ITEM[it.id] = it));
const decOf = st => st >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(st) - 1e-9));
const openSec = {}; SCHEMA.forEach(s => openSec[s.sec] = !!s.open);

function controlHTML(it) {
  const P = S.P;
  if (it.show && !it.show(P)) return '';
  const v = it.get ? it.get(P) : null;
  const hint = it.hint ? `<span class="hint" tabindex="0" aria-label="${esc(it.hint)}" data-tip="${esc(it.hint)}">i</span>` : '';
  if (it.type === 'seg') return `<div class="ctl"><div class="cl">${esc(it.label)}${hint}</div><div class="seg" role="group">${it.opts.map(o => `<button type="button" data-seg="${it.id}" data-val="${o[0]}" aria-pressed="${v === o[0]}">${esc(o[1])}</button>`).join('')}</div></div>`;
  if (it.type === 'chips') return `<div class="ctl"><div class="cl">${esc(it.label)}</div><div class="chips" role="group">${it.opts.map(o => `<button type="button" data-chip="${o[0]}" aria-pressed="${S.supplyKey === o[0]}">${esc(o[1])}</button>`).join('')}</div></div>`;
  if (it.type === 'select') return `<div class="ctl"><label class="cl" for="in_${it.id}">${esc(it.label)}</label><select id="in_${it.id}" data-sel="${it.id}">${it.opts.map(o => `<option value="${o[0]}"${o[0] === v ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
  if (it.type === 'togglenum') {
    const on = isFinite(v), val = on ? v : 40;
    return `<div class="ctl"><div class="cl"><label class="chk"><input type="checkbox" id="tg_${it.id}" data-tog="${it.id}"${on ? ' checked' : ''}> ${esc(it.label)}</label><span class="u">${esc(it.unit)}</span></div><div class="ci"><input type="range" id="rg_${it.id}" data-rg="${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${val}"${on ? '' : ' disabled'}><input type="number" id="in_${it.id}" data-num="${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${val}"${on ? '' : ' disabled'}></div></div>`;
  }
  const d = decOf(it.step), shown = Number(v).toFixed(d);
  return `<div class="ctl"><label class="cl" for="in_${it.id}">${esc(it.label)}${hint}<span class="u">${esc(it.unit)}</span></label><div class="ci"><input type="range" id="rg_${it.id}" data-rg="${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${clamp(v, it.min, it.max)}"><input type="number" id="in_${it.id}" data-num="${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${shown}"></div></div>`;
}
function renderControls() {
  const host = $('#problem'); const scroll = host.scrollTop;
  host.innerHTML = '<h2 class="ph">Problem</h2>' + SCHEMA.map(s => `<details class="sec" data-sec="${esc(s.sec)}"${openSec[s.sec] ? ' open' : ''}><summary>${esc(s.sec)}</summary><div class="secbody">${s.items.map(controlHTML).join('')}</div></details>`).join('') +
    '<div class="ph-foot"><button type="button" id="resetBtn" class="btn ghost">Reset all to defaults</button></div>';
  host.scrollTop = scroll;
}
function syncSupplyKey() {
  const s = S.P.supply; let key = 'custom';
  for (const k in C.SUPPLIES) { const c = C.SUPPLIES[k]; if (c.kind === s.kind && c.Voc === s.Voc && c.Rsrc === s.Rsrc && c.Pmax === s.Pmax && c.capWh === s.capWh) key = k; }
  S.supplyKey = key;
}
function applyParam(id, disp) {
  const it = ITEM[id]; it.set(S.P, disp);
  if (id === 'Imax') S.P.supply.Pmax = S.P.supply.Voc * S.P.supply.Imax;
  if (id === 'Voc' && S.P.supply.kind === 'battery') S.P.supply.Pmax = S.P.supply.Voc * (S.P.supply.Imax || 30);
  if (['Voc', 'Rsrc', 'Pmax', 'capWh', 'Imax'].includes(id)) { S.supplyKey = 'custom'; $$('#problem [data-chip]').forEach(b => b.setAttribute('aria-pressed', b.dataset.chip === 'custom')); }
  if (id === 'Voc' || id === 'Imax') { const pm = $('#in_Pmax'); if (pm) pm.value = S.P.supply.Pmax; }
  quickEval(); renderAll(true); solveSoon(); saveSoon();
}
function wireControls() {
  const host = $('#problem');
  host.addEventListener('input', e => {
    const t = e.target, id = t.dataset.rg || t.dataset.num; if (!id) return;
    const it = ITEM[id]; let v = parseFloat(t.value); if (!isFinite(v)) return;
    const other = t.dataset.rg ? $('#in_' + id) : $('#rg_' + id);
    if (t.dataset.rg) { if (other) other.value = Number(v).toFixed(decOf(it.step)); }
    else if (other) other.value = clamp(v, it.min, it.max);
    applyParam(id, clamp(v, it.min * 0.2, it.max * 5));
  });
  host.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.sel) { applyParam(t.dataset.sel, t.value); renderControls(); }
    else if (t.dataset.tog) { const id = t.dataset.tog, it = ITEM[id]; if (t.checked) applyParam(id, parseFloat($('#in_' + id).value) || 40); else applyParam(id, Infinity); renderControls(); }
  });
  host.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.seg) { applyParam(b.dataset.seg, b.dataset.val); renderControls(); }
    else if (b.dataset.chip) {
      const k = b.dataset.chip; if (k !== 'custom') { const keep = S.P.supply; S.P.supply = Object.assign({}, C.SUPPLIES[k]); S.supplyKey = k; quickEval(); renderControls(); renderAll(true); solveSoon(); saveSoon(); }
      else { S.supplyKey = 'custom'; renderControls(); }
    } else if (b.id === 'resetBtn') { S.P = C.defaults(); S.P.supply = Object.assign({}, C.SUPPLIES.bat24); S.supplyKey = 'bat24'; S.lock.fill(null); renderControls(); solveNow({ global: true }); saveSoon(); }
  });
  host.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.sec) openSec[d.dataset.sec] = d.open; }, true);
}

/* ---------- read-out strip, status ---------- */
function stClass(g) { return g > 1e-3 ? 'over' : g > -0.03 ? 'bind' : ''; }
function renderStatus() {
  const el = $('#status'); if (!el) return;
  const s = S.sol; let html;
  if (S.error) html = `<span class="chip bad">Solver error</span>`;
  else if (S.manual && s) { const o = CN.map((c, i) => ({ c, g: S.r.g[i] })).filter(q => q.g > 1e-3 && !(q.c.id === 'Breq' && !needsB())); html = o.length ? `<span class="chip bad" title="${esc(o.map(q => q.c.label).join(', '))}">Your numbers · ${o.length} limit${o.length > 1 ? 's' : ''} over</span>` : '<span class="chip ok">Your numbers · within every limit</span>'; }
  else if (S.solving) html = `<span class="chip busy"><i class="spin"></i>Solving</span>`;
  else if (s && s.kkt.viol > 5e-3) html = `<span class="chip bad" title="Largest constraint violation at the best point found">No feasible design · worst limit over by ${fx(s.kkt.viol * 100, 0)}%</span>`;
  else if (s) html = `<span class="chip ok" title="Stationarity residual ${s.kkt.stat.toExponential(1)}, worst violation ${s.kkt.viol.toExponential(1)}, complementarity ${s.kkt.comp.toExponential(1)}">KKT satisfied · ${fx(S.solveMs / 1000, 1)} s</span>`;
  else html = '<span class="chip busy"><i class="spin"></i>Starting</span>';
  el.innerHTML = html;
}
function limitedBy() {
  if (!S.sol) return '';
  if (S.manual) { const o = CN.map((c, i) => ({ c, g: S.r.g[i] })).filter(q => q.g > -0.03 && isFinite(S.r.lim[CI[q.c.id]]) && !(q.c.id === 'Breq' && !needsB())).sort((a, b) => b.g - a.g).slice(0, 3); return o.length ? 'Your numbers are at or over: ' + o.map(q => `<b>${esc(q.c.label.toLowerCase())}</b>`).join(', ') : 'Your numbers are inside every limit.'; }
  const lam = S.sol.lam, act = CN.map((c, i) => ({ c, i, l: lam[i] })).filter(o => o.l > 1e-3 && !(!needsB() && o.c.id === 'Breq')).sort((a, b) => b.l - a.l).slice(0, 3);
  const bounds = S.sol.atBound.map((b, i) => (b === 'lo' || b === 'hi') ? VAR[i].label.toLowerCase() + (b === 'lo' ? ' at minimum' : ' at maximum') : null).filter(Boolean);
  if (!act.length && !bounds.length) return 'No limit is binding: the design is set by the variable ranges.';
  return 'Held back by ' + act.map(o => `<b>${esc(o.c.label.toLowerCase())}</b>`).join(', ') + (bounds.length ? '; ' + bounds.slice(0, 2).join(', ') : '');
}
function renderReadout() {
  const r = S.r, P = S.P, m = S.mode, res = m === 'a' ? r.A : r.R, M = m === 'a' ? P.acute : P.recov;
  const gi = (a, b) => r.g[m === 'a' ? CI[a] : CI[b]];
  const wname = C.WAVES[M.wave].name.split(' (')[0].toLowerCase();
  const cells = [
    { k: 'Flux at target', v: fx(res.Bpk * 1e3, 2), u: 'mT', sub: `peak, ${fx(P.depth * 100, 1)} cm deep`, big: 1 },
    { k: 'Peak current', v: fx(res.I, 1), u: 'A', sub: `of ${fx(P.drive.Isw, 1)} A budget · ${wname} rms ${fx(res.Irms, 1)} A · source ${fx(res.Ibus, 1)} A`, big: 1, amps: 1, meter: res.I / P.drive.Isw, cls: stClass(r.g[m === 'a' ? CI.I_a : CI.I_r]) },
    { k: 'Induced E at skin', v: fx(res.Epk, 2), u: 'V/m', sub: `reference ${fx(P.Elim, 2)}`, cls: stClass(gi('E_a', 'E_r')) },
    { k: 'Coil temperature', v: fx(res.T.Tend, 0), u: '°C', sub: `after ${fx(M.tsess / 60, 0)} min, limit ${fx(P.thermal.Tmax, 0)}`, cls: stClass(gi('Tc_a', 'Tc_r')) },
    { k: 'Skin temperature', v: fx(res.T.Ts, 1), u: '°C', sub: `limit ${fx(P.thermal.Tskin, 1)}`, cls: stClass(gi('Ts_a', 'Ts_r')) },
    { k: 'Drive voltage', v: fx(res.Vreq, 1), u: 'V', sub: `of ${fx(res.Vav, 1)} V available`, cls: stClass(gi('V_a', 'V_r')) },
    { k: 'Coil heat', v: fx(res.Pcoil, 1), u: 'W', sub: `${fx(res.Pin, 0)} W from source`, cls: stClass(gi('P_a', 'P_r')) }
  ];
  const html = cells.map(c => `<div class="kpi ${c.big ? 'big' : ''} ${c.amps ? 'amps' : ''} ${c.cls || ''}"><div class="kk">${esc(c.k)}</div><div class="kv">${c.v}<span>${esc(c.u)}</span></div><div class="ks">${c.cls === 'over' ? '<b class="tag">over limit</b> ' : c.cls === 'bind' ? '<b class="tag">at limit</b> ' : ''}${esc(c.sub)}</div>${c.meter != null ? `<div class="meter"><i style="width:${clamp(c.meter * 100, 0, 100).toFixed(0)}%"></i></div>` : ''}</div>`).join('');
  $('#kpis').innerHTML = html; $('#limitedby').innerHTML = limitedBy();
  $$('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.m === m));
  $('#modeSeg [data-m=a]').textContent = `Acute ${P.acute.f} Hz`; $('#modeSeg [data-m=r]').textContent = `Recovery ${P.recov.f} Hz`;
}
