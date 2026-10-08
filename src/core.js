/* PEMF butterfly-coil physics + augmented-Lagrangian optimizer.
   Pure JS, no dependencies. Works in Node (tests) and in the browser (inlined into the page).
   SI units everywhere internally (m, A, T, s, K or degC as noted). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PEMF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PI = Math.PI;
  const MU0 = 4e-7 * PI;
  const K = { rho20: 1.724e-8, alpha: 0.0039, dens: 8960, cp: 385, gmdRound: 0.7788, gmdRect: 0.2235 };

  /* ---------------------------------------------------------------- wire */
  function awgDia(awg) { return 1e-3 * 0.127 * Math.pow(92, (36 - awg) / 39); }
  function enamel(d) { return 0.012e-3 + 0.015 * d; }            // per-side enamel build
  function smax(a, b, eps) { return 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + eps * eps)); }
  function skinFactor(d, f) {                                     // R_ac/R_dc, small-argument series
    const delta = Math.sqrt(K.rho20 / (PI * Math.max(f, 1e-3) * MU0));
    const x = d / 2 / delta; return 1 + Math.pow(x, 4) / 48;
  }

  /* ---------------------------------------------------------------- defaults */
  function defaults() {
    return {
      nRings: 5, nLay: 0,
      gap: 0.008, phi: 0.85, rin: 0.012,
      depth: 0.06, standoff: 0.010,
      objective: 'maxB', BaReq: 2e-3,
      acute: { f: 100, wave: 'sine', duty: 1.0, tsess: 600 },
      recov: { f: 20, wave: 'sine', duty: 1.0, tsess: 3600, Bpk: 0.5e-3 },
      supply: { name: '24 V battery', kind: 'battery', Voc: 24, Rsrc: 0.08, Pmax: 720, capWh: 120 },
      drive: { Rds: 0.005, Rsh: 0.005, Rwire: 0.02, Dmax: 0.95, fpwm: 20000, tsw: 1.2e-7, Isw: 10 },
      thermal: { Ta: 22, Tcore: 37, hdn: 6, kc: 0.05, ht: 40, spread: 1.5, Cx: 2000, Tmax: 60, Tskin: 41 },
      Elim: 0.8,
      size: { Wmax: 0.40, Lmax: 0.30, Hmax: 0.030, mmax: 2.0, Pcap: Infinity },
      price: 13
    };
  }
  const SUPPLIES = {
    wall12: { name: '12 V wall supply', kind: 'wall', Voc: 12, Rsrc: 0.02, Pmax: 120, capWh: Infinity },
    wall24: { name: '24 V wall supply', kind: 'wall', Voc: 24, Rsrc: 0.02, Pmax: 240, capWh: Infinity },
    bat24: { name: '24 V battery', kind: 'battery', Voc: 24, Rsrc: 0.08, Pmax: 720, capWh: 120 },
    bat48: { name: '48 V battery', kind: 'battery', Voc: 48, Rsrc: 0.15, Pmax: 1440, capWh: 240 }
  };

  /* ---------------------------------------------------------------- waveforms
     i(t) = I_pk g(tau); kRms = rms(g), slew = max|dg/dtau|, kAbs = mean|g|, vpk: peak of R i + L di/dt per amp */
  const WAVES = {
    sine: { name: 'Sine (bipolar)', krms: Math.SQRT1_2, slew: 2 * PI, kabs: 2 / PI, g: t => Math.sin(2 * PI * t), vpk: (R, L, f) => Math.sqrt(R * R + Math.pow(2 * PI * f * L, 2)) },
    tri: { name: 'Triangle (bipolar)', krms: 1 / Math.sqrt(3), slew: 4, kabs: 0.5, g: t => { const u = t - Math.floor(t); return u < 0.25 ? 4 * u : u < 0.75 ? 2 - 4 * u : 4 * u - 4; }, vpk: (R, L, f) => R + 4 * f * L },
    half: { name: 'Half-sine pulse (unipolar)', krms: 0.5, slew: 2 * PI, kabs: 1 / PI, g: t => Math.max(0, Math.sin(2 * PI * t)), vpk: (R, L, f) => Math.sqrt(R * R + Math.pow(2 * PI * f * L, 2)) }
  };

  /* ---------------------------------------------------------------- geometry */
  function geometry(x, P) {
    const d = awgDia(x.awg), dI = d + 2 * enamel(d), Acu = PI * d * d / 4;
    const tRaw = x.N * dI * dI / (P.phi * x.b);
    const t = smax(tRaw, dI, 0.05 * dI);
    const lturn = 2 * (x.wx + x.ly) - 4 * x.b;
    const lw = 2 * x.N * lturn;
    const g = {
      wx: x.wx, ly: x.ly, N: x.N, awg: x.awg, th: x.th, b: x.b,
      d, dI, Acu, tRaw, t, lturn, lw,
      R20: K.rho20 * lw / Acu,
      mcu: K.dens * lw * Acu,
      Aband: 2 * (x.wx * x.ly - (x.wx - 2 * x.b) * (x.ly - 2 * x.b)),
      layers: t / dI
    };
    return g;
  }
  /* continuum winding: a Rb x Rz grid of filament rings; each carries N/(Rb*Rz) turns.
     Rb adapts to N (=> exact turn-by-turn model at integer N <= Rbmax). */
  function makeRings(geo, Rbmax, Rz) {
    Rz = Rz || Math.min(2, Math.max(1, Math.round(geo.t / geo.dI)));
    const Rb = Math.max(1, Math.min(Rbmax, Math.round(geo.N)));
    const s = [], n = [], z = [];
    for (let i = 0; i < Rb; i++) for (let j = 0; j < Rz; j++) {
      s.push((i + 0.5) * geo.b / Rb); n.push(geo.N / (Rb * Rz)); z.push(((j + 0.5) / Rz - 0.5) * geo.t);
    }
    return { s, n, z, R: s.length, Rb, Rz, cb: geo.b / Rb, cz: geo.t / Rz };
  }
  /* exact turn-by-turn winding (one filament per turn, layered) for verification and the build sheet */
  function discreteRings(geo) {
    const N = Math.max(1, Math.round(geo.N)), Ld = Math.max(1, Math.round(geo.t / geo.dI)), npl = Math.ceil(N / Ld);
    const s = [], n = [], z = [];
    for (let i = 0; i < N; i++) { const l = Math.floor(i / npl), j = i % npl; s.push((j + 0.5) * geo.b / npl); z.push((l - (Ld - 1) / 2) * geo.t / Ld); n.push(1); }
    return { s, n, z, R: N, Rb: N, Rz: 1, cb: geo.b / npl, cz: geo.t / Ld, Ld, npl };
  }
  /* one ring of one wing: 4 segments in global coords, CCW in (u,v); wing 2 is the mirror image (=> opposite sense) */
  function ringSegs(geo, sigma, s, zo, gap) {
    const ct = Math.cos(geo.th), st = Math.sin(geo.th), wx = geo.wx, ly = geo.ly;
    const loc = [[s, -ly / 2 + s], [wx - s, -ly / 2 + s], [wx - s, ly / 2 - s], [s, ly / 2 - s]];
    const nx = -sigma * st, nz = ct;
    const pts = loc.map(p => [sigma * (gap / 2 + p[0] * ct) + zo * nx, p[1], p[0] * st + zo * nz]);
    const out = [];
    for (let i = 0; i < 4; i++) { const a = pts[i], b = pts[(i + 1) % 4]; out.push([a[0], a[1], a[2], b[0], b[1], b[2]]); }
    return out;
  }
  function buildSegs(geo, rg, P) {
    const cnt = rg.R * 8;
    const S = new Float64Array(cnt * 7); let o = 0;
    for (const sigma of [1, -1]) for (let k = 0; k < rg.R; k++) {
      const sg = ringSegs(geo, sigma, rg.s[k], rg.z[k], P.gap);
      for (const q of sg) { S[o] = q[0]; S[o + 1] = q[1]; S[o + 2] = q[2]; S[o + 3] = q[3]; S[o + 4] = q[4]; S[o + 5] = q[5]; S[o + 6] = rg.n[k]; o += 7; }
    }
    return S;
  }

  /* ---------------------------------------------------------------- field: closed-form straight segments
     B = mu0/(4 pi d) (sin a2 - sin a1) (t x dhat) ;  A = mu0/(4 pi) t [asinh(s2/d) - asinh(s1/d)]   (per ampere) */
  const _o = new Float64Array(6);
  function fieldAt(S, px, py, pz, out) {
    out = out || _o;
    let Bx = 0, By = 0, Bz = 0, Ax = 0, Ay = 0, Az = 0;
    for (let i = 0; i < S.length; i += 7) {
      const x1 = S[i], y1 = S[i + 1], z1 = S[i + 2], wt = S[i + 6];
      let tx = S[i + 3] - x1, ty = S[i + 4] - y1, tz = S[i + 5] - z1;
      const len = Math.sqrt(tx * tx + ty * ty + tz * tz); tx /= len; ty /= len; tz /= len;
      const rx = px - x1, ry = py - y1, rz = pz - z1;
      const s = rx * tx + ry * ty + rz * tz;
      const qx = rx - s * tx, qy = ry - s * ty, qz = rz - s * tz;
      let d = Math.sqrt(qx * qx + qy * qy + qz * qz); if (d < 1e-9) d = 1e-9;
      const s1 = -s, s2 = len - s;
      const f = (s2 / Math.sqrt(s2 * s2 + d * d) - s1 / Math.sqrt(s1 * s1 + d * d)) / d * wt;
      const inv = 1 / d;
      Bx += f * (ty * qz - tz * qy) * inv; By += f * (tz * qx - tx * qz) * inv; Bz += f * (tx * qy - ty * qx) * inv;
      const a = (Math.asinh(s2 / d) - Math.asinh(s1 / d)) * wt;
      Ax += a * tx; Ay += a * ty; Az += a * tz;
    }
    const c = MU0 / (4 * PI);
    out[0] = Bx * c; out[1] = By * c; out[2] = Bz * c; out[3] = Ax * c; out[4] = Ay * c; out[5] = Az * c;
    return out;
  }

  /* vector potential only (cheaper): used for the induced-E survey */
  function potentialAt(S, px, py, pz, out) {
    let Ax = 0, Ay = 0, Az = 0;
    for (let i = 0; i < S.length; i += 7) {
      const x1 = S[i], y1 = S[i + 1], z1 = S[i + 2], wt = S[i + 6];
      let tx = S[i + 3] - x1, ty = S[i + 4] - y1, tz = S[i + 5] - z1;
      const len = Math.sqrt(tx * tx + ty * ty + tz * tz); tx /= len; ty /= len; tz /= len;
      const rx = px - x1, ry = py - y1, rz = pz - z1;
      const s = rx * tx + ry * ty + rz * tz;
      const qx = rx - s * tx, qy = ry - s * ty, qz = rz - s * tz;
      let d = Math.sqrt(qx * qx + qy * qy + qz * qz); if (d < 1e-9) d = 1e-9;
      const a = (Math.asinh((len - s) / d) - Math.asinh(-s / d)) * wt;
      Ax += a * tx; Ay += a * ty; Az += a * tz;
    }
    const c = MU0 / (4 * PI); out[0] = Ax * c; out[1] = Ay * c; out[2] = Az * c; return out;
  }
  /* skin surface = coil top face offset by the stand-off, along each wing normal, plus the junction line */
  function skinPoints(geo, P, nu, nv) {
    const pts = []; const ct = Math.cos(geo.th), st = Math.sin(geo.th);
    const off = geo.t / 2 + P.standoff;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = (i + 0.5) / nu * geo.wx, v = (j / (nv - 1)) * geo.ly * 0.46;
      pts.push([P.gap / 2 + u * ct - off * st, v, u * st + off * ct]);
    }
    for (let j = 0; j < nv; j++) pts.push([0, (j / (nv - 1)) * geo.ly * 0.46, off]);
    return pts;
  }
  function peakA(S, geo, P) {
    const pts = skinPoints(geo, P, 4, 2); let m = 0, at = null; const o = new Float64Array(3);
    for (const p of pts) { potentialAt(S, p[0], p[1], p[2], o); const a = Math.hypot(o[0], o[1], o[2]); if (a > m) { m = a; at = p; } }
    return { aE: m, at };
  }

  /* ---------------------------------------------------------------- inductance (Neumann, closed form for parallel segments) */
  function psi(u, d) { return u * Math.asinh(u / d) - Math.sqrt(u * u + d * d); }
  function I2(a1, a2, b1, b2, d) { return psi(a2 - b1, d) + psi(a1 - b2, d) - psi(a2 - b2, d) - psi(a1 - b1, d); }
  /* concentric rectangles (half sizes hu,hv), parallel planes dz apart. dSameU/V = distance of like sides */
  function mutRect(hu1, hv1, hu2, hv2, dz, dSameU, dSameV) {
    const dOu = Math.sqrt(Math.pow(hv1 + hv2, 2) + dz * dz), dOv = Math.sqrt(Math.pow(hu1 + hu2, 2) + dz * dz);
    const Iu = 2 * I2(-hu1, hu1, -hu2, hu2, dSameU) - 2 * I2(-hu1, hu1, -hu2, hu2, dOu);
    const Iv = 2 * I2(-hv1, hv1, -hv2, hv2, dSameV) - 2 * I2(-hv1, hv1, -hv2, hv2, dOv);
    return 1e-7 * (Iu + Iv);
  }
  const GLX = [-0.9324695142031521, -0.6612093864662645, -0.2386191860831969, 0.2386191860831969, 0.6612093864662645, 0.9324695142031521];
  const GLW = [0.1713244923791704, 0.3607615730481386, 0.4679139345726910, 0.4679139345726910, 0.3607615730481386, 0.1713244923791704];
  const GLT = []; for (let h = 0; h < 2; h++) for (let i = 0; i < 6; i++) GLT.push([h * 0.5 + 0.25 * (GLX[i] + 1), GLW[i]]);
  function segSegInt(a, b) {      // int int ds dt / |r| ; inner exact (asinh), outer 6-pt Gauss-Legendre on 2 sub-intervals
    let tx = a[3] - a[0], ty = a[4] - a[1], tz = a[5] - a[2];
    const len = Math.sqrt(tx * tx + ty * ty + tz * tz); tx /= len; ty /= len; tz /= len;
    const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2]; const lenQ = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let sum = 0;
    for (let k = 0; k < 12; k++) {
      const t = GLT[k][0];
      const rx = b[0] + dx * t - a[0], ry = b[1] + dy * t - a[1], rz = b[2] + dz * t - a[2];
      const s = rx * tx + ry * ty + rz * tz;
      const ax = rx - s * tx, ay = ry - s * ty, az = rz - s * tz;
      let d = Math.sqrt(ax * ax + ay * ay + az * az); if (d < 1e-9) d = 1e-9;
      sum += GLT[k][1] * (Math.asinh((len - s) / d) - Math.asinh(-s / d));
    }
    return sum * lenQ / 4;
  }
  function diagGMD(geo, n, rg) {
    const gw = K.gmdRound * geo.d / 2, gb = K.gmdRect * (rg.cb + rg.cz), nh = Math.max(n, 1);
    return Math.exp(Math.log(gw) / nh + (1 - 1 / nh) * Math.log(gb));
  }
  function crossMutual(sa, sb) {          // signed mutual inductance of two single-turn rings (wing1 ring, wing2 ring)
    let M = 0;
    for (const A of sa) for (const B of sb) {
      const ua = [A[3] - A[0], A[4] - A[1], A[5] - A[2]], ub = [B[3] - B[0], B[4] - B[1], B[5] - B[2]];
      const la = Math.hypot(ua[0], ua[1], ua[2]), lb = Math.hypot(ub[0], ub[1], ub[2]);
      const dot = (ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]) / (la * lb);
      if (Math.abs(dot) < 1e-9) continue;
      if (Math.abs(ua[1]) / la > 0.9999 && Math.abs(ub[1]) / lb > 0.9999) {
        const a1 = Math.min(A[1], A[4]), a2 = Math.max(A[1], A[4]), b1 = Math.min(B[1], B[4]), b2 = Math.max(B[1], B[4]);
        const d = Math.max(Math.hypot(A[0] - B[0], A[2] - B[2]), 1e-9);
        M += dot * I2(a1, a2, b1, b2, d);
      } else M += dot * segSegInt(A, B);
    }
    return 1e-7 * M;
  }
  function inductance(geo, rg, P) {
    const R = rg.R; let Lw = 0, M12 = 0;
    for (let k = 0; k < R; k++) for (let l = 0; l < R; l++) {
      const hu1 = geo.wx / 2 - rg.s[k], hv1 = geo.ly / 2 - rg.s[k], hu2 = geo.wx / 2 - rg.s[l], hv2 = geo.ly / 2 - rg.s[l];
      const dz = rg.z[k] - rg.z[l];
      let dU, dV;
      if (k === l) { dU = dV = diagGMD(geo, rg.n[k], rg); }
      else { dU = Math.hypot(hv1 - hv2, dz); dV = Math.hypot(hu1 - hu2, dz); }
      Lw += rg.n[k] * rg.n[l] * mutRect(hu1, hv1, hu2, hv2, dz, dU, dV);
    }
    /* wing-to-wing coupling is ~3% of L: a coarse 3-ring winding reproduces it to ~1% of M12 (<0.1% of L) */
    const rc = makeRings(geo, 3, 1), Rc = rc.R, W1 = [], W2 = [];
    for (let k = 0; k < Rc; k++) { W1.push(ringSegs(geo, 1, rc.s[k], rc.z[k], P.gap)); W2.push(ringSegs(geo, -1, rc.s[k], rc.z[k], P.gap)); }
    for (let k = 0; k < Rc; k++) for (let l = k; l < Rc; l++) {            // mirror symmetry: M(k,l) = M(l,k)
      const m = rc.n[k] * rc.n[l] * crossMutual(W1[k], W2[l]);
      M12 += k === l ? m : 2 * m;
    }
    return { Lw, M12, L: 2 * Lw + 2 * M12 };
  }

  /* ---------------------------------------------------------------- thermal (lumped, temperature-dependent copper) */
  function thermal(geo, P, P0, tsess) {
    const th = P.thermal;
    const Uup = 1 / (P.standoff / th.kc + 1 / th.ht);
    const Ath = geo.Aband * th.spread;
    const G = Ath * (th.hdn + Uup);
    const Tref = (th.hdn * th.Ta + Uup * th.Tcore) / (th.hdn + Uup);
    const C = geo.mcu * K.cp + th.Cx * Ath;
    const q = P0 * K.alpha;
    const lam = (G - q) / C;
    const f0 = P0 * (1 + K.alpha * (Tref - 20)) / C;
    const Tat = t => { const x = lam * t; const ph = Math.abs(x) < 1e-6 ? 1 : (1 - Math.exp(-Math.min(x, 700))) / x; return Math.min(Tref + f0 * t * ph, 1e4); };
    const Tend = Tat(tsess);
    const Tss = lam > 0 ? (P0 * (1 - 20 * K.alpha) + G * Tref) / (G - q) : Infinity;
    const skin = T => th.Tcore + (Uup / th.ht) * (T - th.Tcore);
    return { Uup, Ath, G, Tref, C, lam, tau: lam > 0 ? 1 / lam : Infinity, runaway: lam <= 0, Tend, Tss, Ts: skin(Tend), Tat, skin, P0 };
  }

  /* ---------------------------------------------------------------- one operating mode */
  function modeCalc(geo, ind, aE, kB, P, M, I) {
    const W = WAVES[M.wave], dr = P.drive, sp = P.supply;
    const Rdrive = 2 * dr.Rds + dr.Rsh + dr.Rwire;
    const Fs = skinFactor(geo.d, M.f);
    const Irms = W.krms * I;
    const P0 = M.duty * Irms * Irms * geo.R20 * Fs;
    const T = thermal(geo, P, P0, M.tsess);
    const Rhot = geo.R20 * (1 + K.alpha * (T.Tend - 20)) * Fs;
    const Pcoil = M.duty * Irms * Irms * Rhot;
    const Pdrive = M.duty * Irms * Irms * Rdrive;
    const Psw = M.duty * sp.Voc * W.kabs * I * dr.tsw * dr.fpwm;
    const Pin = Pcoil + Pdrive + Psw;
    const Vreq = I * W.vpk(Rhot + Rdrive, ind.L, M.f);
    const Ibus = I * Vreq / Math.max(sp.Voc, 1e-9);
    const Vav = dr.Dmax * (sp.Voc - sp.Rsrc * Ibus);
    return {
      I, Irms, Bpk: kB * I, Epk: W.slew * M.f * aE * I, dBdt: W.slew * M.f * kB * I,
      P0, T, Rhot, Pcoil, Pdrive, Psw, Pin, Vreq, Vav, Ibus, Rdrive, Fs,
      E_Wh: Pin * M.tsess / 3600, Ipk: I, W
    };
  }

  /* ---------------------------------------------------------------- full design evaluation */
  const VARS = [
    { k: 'wx', label: 'Wing width', unit: 'mm', sc: 1e3, lo: 0.04, hi: 0.20, log: false, dec: 0 },
    { k: 'ly', label: 'Wing length', unit: 'mm', sc: 1e3, lo: 0.08, hi: 0.32, log: false, dec: 0 },
    { k: 'N', label: 'Turns per wing', unit: '', sc: 1, lo: 2, hi: 300, log: true, dec: 1 },
    { k: 'awg', label: 'Wire gauge', unit: 'AWG', sc: 1, lo: 8, hi: 28, log: false, dec: 1 },
    { k: 'th', label: 'Bend angle', unit: '°', sc: 180 / PI, lo: -0.1745, hi: 0.6109, log: false, dec: 1 },
    { k: 'b', label: 'Winding band', unit: 'mm', sc: 1e3, lo: 0.008, hi: 0.095, log: false, dec: 0 },
    { k: 'Ia', label: 'Acute peak current', unit: 'A', sc: 1, lo: 0.5, hi: 100, log: true, dec: 1 }
  ];
  const CONS = [
    { id: 'Tc_a', label: 'Coil temp, acute session', unit: '°C', grp: 'thermal' },
    { id: 'Ts_a', label: 'Skin temp, acute session', unit: '°C', grp: 'thermal' },
    { id: 'Tc_r', label: 'Coil temp, recovery session', unit: '°C', grp: 'thermal' },
    { id: 'Ts_r', label: 'Skin temp, recovery session', unit: '°C', grp: 'thermal' },
    { id: 'E_a', label: 'Induced E-field, acute', unit: 'V/m', grp: 'field' },
    { id: 'E_r', label: 'Induced E-field, recovery', unit: 'V/m', grp: 'field' },
    { id: 'V_a', label: 'Drive voltage, acute', unit: 'V', grp: 'drive' },
    { id: 'V_r', label: 'Drive voltage, recovery', unit: 'V', grp: 'drive' },
    { id: 'P_a', label: 'Supply power, acute', unit: 'W', grp: 'drive' },
    { id: 'P_r', label: 'Supply power, recovery', unit: 'W', grp: 'drive' },
    { id: 'I_a', label: 'Peak current, acute', unit: 'A', grp: 'drive' },
    { id: 'I_r', label: 'Peak current, recovery', unit: 'A', grp: 'drive' },
    { id: 'W', label: 'Footprint width', unit: 'mm', grp: 'size' },
    { id: 'Ln', label: 'Footprint length', unit: 'mm', grp: 'size' },
    { id: 'H', label: 'Profile height', unit: 'mm', grp: 'size' },
    { id: 'mCu', label: 'Copper mass', unit: 'kg', grp: 'size' },
    { id: 'bw', label: 'Band fits wing width', unit: '', grp: 'size' },
    { id: 'bl', label: 'Band fits wing length', unit: '', grp: 'size' },
    { id: 'Pcap', label: 'Heat budget, acute', unit: 'W', grp: 'thermal' },
    { id: 'Eb_a', label: 'Battery energy, acute', unit: 'Wh', grp: 'drive' },
    { id: 'Eb_r', label: 'Battery energy, recovery', unit: 'Wh', grp: 'drive' },
    { id: 'Breq', label: 'Required acute flux', unit: 'mT', grp: 'field' }
  ];
  function evaluate(xv, P, rgOverride) {
    const x = { wx: xv[0], ly: xv[1], N: xv[2], awg: xv[3], th: xv[4], b: xv[5] };
    const Ia = xv[6];
    const geo = geometry(x, P);
    const rg = rgOverride ? rgOverride(geo) : makeRings(geo, P.nRings, P.nLay);
    const S = buildSegs(geo, rg, P);
    const zT = P.standoff + geo.t / 2 + P.depth;
    const fT = fieldAt(S, 0, 0, zT, new Float64Array(6));
    const kB = Math.hypot(fT[0], fT[1], fT[2]);
    const pa = peakA(S, geo, P);
    const ind = inductance(geo, rg, P);
    const Ir = P.recov.Bpk / kB;
    const A = modeCalc(geo, ind, pa.aE, kB, P, P.acute, Ia);
    const Rm = modeCalc(geo, ind, pa.aE, kB, P, P.recov, Ir);
    const th = P.thermal, sz = P.size, sp = P.supply, dr = P.drive;
    const prof = geo.t + geo.wx * Math.sin(Math.max(geo.th, 0));
    const g = new Array(CONS.length), val = new Array(CONS.length), lim = new Array(CONS.length), scl = new Array(CONS.length);
    const set = (i, v, l, s, mode) => { val[i] = v; lim[i] = l; scl[i] = s; g[i] = mode === 'diff' ? (v - l) / s : v / l - 1; };
    set(0, A.T.Tend, th.Tmax, 10, 'diff'); set(1, A.T.Ts, th.Tskin, 2, 'diff');
    set(2, Rm.T.Tend, th.Tmax, 10, 'diff'); set(3, Rm.T.Ts, th.Tskin, 2, 'diff');
    set(4, A.Epk, P.Elim, P.Elim, 'ratio'); set(5, Rm.Epk, P.Elim, P.Elim, 'ratio');
    set(6, A.Vreq, A.Vav, A.Vav, 'ratio'); set(7, Rm.Vreq, Rm.Vav, Rm.Vav, 'ratio');
    set(8, A.Pin, sp.Pmax, sp.Pmax, 'ratio'); set(9, Rm.Pin, sp.Pmax, sp.Pmax, 'ratio');
    set(10, Ia, dr.Isw, dr.Isw, 'ratio'); set(11, Ir, dr.Isw, dr.Isw, 'ratio');
    set(12, 2 * geo.wx + P.gap, sz.Wmax, sz.Wmax, 'ratio'); set(13, geo.ly, sz.Lmax, sz.Lmax, 'ratio');
    set(14, prof, sz.Hmax, sz.Hmax, 'ratio'); set(15, geo.mcu, sz.mmax, sz.mmax, 'ratio');
    set(16, 2 * geo.b + 2 * P.rin, geo.wx, geo.wx, 'ratio'); set(17, 2 * geo.b + 2 * P.rin, geo.ly, geo.ly, 'ratio');
    if (isFinite(sz.Pcap)) set(18, A.Pcoil, sz.Pcap, sz.Pcap, 'ratio'); else { val[18] = A.Pcoil; lim[18] = Infinity; scl[18] = 1; g[18] = -1; }
    if (isFinite(sp.capWh)) { set(19, A.E_Wh, 0.8 * sp.capWh, 0.8 * sp.capWh, 'ratio'); set(20, Rm.E_Wh, 0.8 * sp.capWh, 0.8 * sp.capWh, 'ratio'); }
    else { val[19] = A.E_Wh; lim[19] = Infinity; scl[19] = 1; g[19] = -1; val[20] = Rm.E_Wh; lim[20] = Infinity; scl[20] = 1; g[20] = -1; }
    if (P.objective !== 'maxB') { val[21] = A.Bpk; lim[21] = P.BaReq; scl[21] = P.BaReq; g[21] = 1 - A.Bpk / P.BaReq; }
    else { val[21] = A.Bpk; lim[21] = 0; scl[21] = 1; g[21] = -1; }
    const f = P.objective === 'minP' ? A.Pcoil / 10 : P.objective === 'minI' ? Ia / 5 : -A.Bpk / 1e-3;
    return { f, g, val, lim, scl, geo, rg, kB, aE: pa.aE, aEat: pa.at, ind, A, R: Rm, Ir, zT, prof, S, Bp: A.Bpk };
  }

  /* ---------------------------------------------------------------- optimizer: augmented Lagrangian + projected BFGS */
  function toX(u) { return VARS.map((v, i) => v.log ? Math.exp(Math.log(v.lo) + u[i] * (Math.log(v.hi) - Math.log(v.lo))) : v.lo + u[i] * (v.hi - v.lo)); }
  function toU(x) { return VARS.map((v, i) => v.log ? (Math.log(x[i]) - Math.log(v.lo)) / (Math.log(v.hi) - Math.log(v.lo)) : (x[i] - v.lo) / (v.hi - v.lo)); }
  const clamp01 = z => Math.min(1, Math.max(0, z));

  function solve(P, opt) {
    opt = opt || {};
    const n = VARS.length, m = CONS.length;
    const lock = opt.lock || new Array(n).fill(null);               // physical value or null
    const free = []; for (let i = 0; i < n; i++) if (lock[i] == null) free.push(i);
    const nF = free.length;
    let evals = 0;
    const ev = u => { evals++; return evaluate(toX(u), P); };
    function applyLock(u) { for (let i = 0; i < n; i++) if (lock[i] != null) u[i] = clamp01(toU(VARS.map((v, j) => j === i ? lock[i] : v.lo))[i]); return u; }
    function LA(r, lam, rho) {
      let s = r.f; for (let i = 0; i < m; i++) { const t = Math.max(0, lam[i] + rho * r.g[i]); s += (t * t - lam[i] * lam[i]) / (2 * rho); } return s;
    }
    function grad(u, lam, rho, h) {
      const gr = new Array(n).fill(0);
      for (const i of free) {
        const up = u.slice(), um = u.slice(); const hp = Math.min(h, 1 - u[i]), hm = Math.min(h, u[i]);
        up[i] = u[i] + hp; um[i] = u[i] - hm;
        gr[i] = (LA(ev(up), lam, rho) - LA(ev(um), lam, rho)) / (hp + hm);
      }
      return gr;
    }
    function inner(u0, lam, rho, maxIt) {
      let u = u0.slice(), r = ev(u), F = LA(r, lam, rho);
      let H = []; const reset = () => { H = []; for (let i = 0; i < n; i++) { H.push(new Array(n).fill(0)); H[i][i] = 1; } }; reset();
      let gr = grad(u, lam, rho, 1e-6);
      for (let it = 0; it < maxIt; it++) {
        const act = new Array(n).fill(false);
        for (const i of free) if ((u[i] <= 1e-9 && gr[i] > 0) || (u[i] >= 1 - 1e-9 && gr[i] < 0)) act[i] = true;
        const fi = free.filter(i => !act[i]);
        let gn = 0; for (const i of fi) gn += gr[i] * gr[i]; gn = Math.sqrt(gn);
        if (gn < (opt.gtol || 1e-5)) break;
        const d = new Array(n).fill(0);
        for (const i of fi) { let s = 0; for (const j of fi) s += H[i][j] * gr[j]; d[i] = -s; }
        let dd = 0; for (const i of fi) dd += d[i] * gr[i];
        if (dd >= 0) { reset(); for (const i of fi) d[i] = -gr[i]; dd = -gn * gn; }
        let a = 1, ok = false, un = null, rn = null, Fn = 0;
        for (let ls = 0; ls < 30; ls++) {
          un = u.slice(); for (const i of fi) un[i] = clamp01(u[i] + a * d[i]);
          rn = ev(un); Fn = LA(rn, lam, rho);
          let step = 0; for (const i of fi) step += (un[i] - u[i]) * gr[i];
          if (Fn <= F + 1e-4 * step) { ok = true; break; }
          a *= 0.5;
        }
        if (!ok) { if (H[0][0] !== 1) { reset(); continue; } break; }
        const gnew = grad(un, lam, rho, 1e-6);
        const s = new Array(n).fill(0), y = new Array(n).fill(0);
        for (const i of fi) { s[i] = un[i] - u[i]; y[i] = gnew[i] - gr[i]; }
        let sy = 0; for (const i of fi) sy += s[i] * y[i];
        if (sy > 1e-12) {
          const Hy = new Array(n).fill(0); for (const i of fi) { let t = 0; for (const j of fi) t += H[i][j] * y[j]; Hy[i] = t; }
          let yHy = 0; for (const i of fi) yHy += y[i] * Hy[i];
          for (const i of fi) for (const j of fi) H[i][j] += (1 + yHy / sy) * s[i] * s[j] / sy - (Hy[i] * s[j] + s[i] * Hy[j]) / sy;
        }
        const dF = F - Fn; u = un; r = rn; F = Fn; gr = gnew;
        if (dF < 1e-12 && it > 3) break;
      }
      return { u, r, F };
    }
    function runFrom(uStart, maxOuter, maxInner) {
      let u = applyLock(uStart.slice()), lam = opt.lam0 ? opt.lam0.slice() : new Array(m).fill(0), rho = opt.rho0 || 10, prevViol = Infinity, last; const trace = [];
      for (let k = 0; k < maxOuter; k++) {
        last = inner(u, lam, rho, maxInner); u = last.u;
        const r = last.r; let viol = 0;
        for (let i = 0; i < m; i++) viol = Math.max(viol, r.g[i]);
        trace.push({ u: u.slice(), f: r.f, viol: Math.max(viol, 0), rho, B: r.A.Bpk, lam: lam.slice() });
        for (let i = 0; i < m; i++) lam[i] = Math.max(0, lam[i] + rho * r.g[i]);
        if (viol < 2e-5 && (k >= 2 || (opt.lam0 && k >= 1))) break;
        if (viol > 0.25 * prevViol) rho = Math.min(rho * 4, 1e5);
        prevViol = Math.max(viol, 0);
      }
      const r = ev(u); return { u, r, lam, trace };
    }
    const starts = opt.starts || [];
    let best = null;
    const score = o => { const v = Math.max(0, ...o.r.g); return o.r.f + (v > 1e-3 ? 1e3 * v : 0); };
    for (const u0 of starts) {
      const o = runFrom(u0, opt.maxOuter || 10, opt.maxInner || 80);
      if (!best || score(o) < score(best)) best = o;
    }
    // KKT diagnostics at the solution
    const rho = 10, lam = best.lam;
    const gr = new Array(n).fill(0);
    {
      const u = best.u, h = 1e-6;
      for (const i of free) {
        const up = u.slice(), um = u.slice(); const hp = Math.min(h, 1 - u[i]), hm = Math.min(h, u[i]); up[i] += hp; um[i] -= hm;
        const rp = ev(up), rm = ev(um);
        let s = (rp.f - rm.f) / (hp + hm);
        for (let c = 0; c < m; c++) s += lam[c] * (rp.g[c] - rm.g[c]) / (hp + hm);
        gr[i] = s;
      }
    }
    let stat = 0; for (const i of free) { const u = best.u[i]; if (!((u <= 1e-6 && gr[i] > 0) || (u >= 1 - 1e-6 && gr[i] < 0))) stat += gr[i] * gr[i]; }
    const viol = Math.max(0, ...best.r.g);
    let comp = 0; for (let c = 0; c < m; c++) comp = Math.max(comp, Math.abs(lam[c] * best.r.g[c]));
    const atBound = best.u.map((v, i) => lock[i] != null ? 'locked' : v <= 1e-6 ? 'lo' : v >= 1 - 1e-6 ? 'hi' : '');
    return { u: best.u, x: toX(best.u), r: best.r, lam, kkt: { stat: Math.sqrt(stat), viol, comp }, evals, free, trace: best.trace, atBound };
  }

  return { PI, MU0, K, VARS, CONS, WAVES, SUPPLIES, defaults, awgDia, enamel, skinFactor, geometry, makeRings, discreteRings, ringSegs, buildSegs, fieldAt, potentialAt, skinPoints, peakA,
    psi, I2, mutRect, crossMutual, segSegInt, inductance, diagGMD, thermal, modeCalc, evaluate, solve, toX, toU };
});
