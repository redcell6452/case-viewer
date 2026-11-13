#!/usr/bin/env node
/* Builds a fully synthetic .zol case for testing Case Viewer.

   Nothing here comes from a real patient or device: names, identifiers, times and
   every sample are invented. The record layout follows the export format described
   in FORMAT.md so the viewer reads it the way it reads a real file, and the
   physiology is modelled so the viewer's algorithms have known answers to find.

     node tools/make-test-case.cjs                 -> test-cases/synthetic-cardiac.zol
     node tools/make-test-case.cjs --neuro         -> test-cases/synthetic-neuro.zol
     node tools/make-test-case.cjs --out file.zol

   Each run also writes <name>.expected.md: the timeline and the values the viewer
   should find. The output is deterministic (seeded), so results can be compared
   between versions of the viewer. */
'use strict';
const fs = require('fs'), path = require('path');

const args = process.argv.slice(2);
const NEURO = args.includes('--neuro');
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? args[outArg+1]
  : path.join(__dirname, '..', 'test-cases', NEURO ? 'synthetic-neuro.zol' : 'synthetic-cardiac.zol');

/* ---------------- deterministic randomness ---------------- */
let seed = NEURO ? 77031 : 20260314;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };
const hex = n => Array.from({length:n}, () => '0123456789abcdef'[Math.floor(rnd()*16)]).join('');
const G = (x, mu, sd) => Math.exp(-0.5*((x-mu)/sd)**2);

/* ---------------- case clock ---------------- */
const DUR = 1800;                                   /* seconds */
const START = Date.UTC(2026, 2, 14, 9, 0, 0);       /* 14 Mar 2026 09:00:00, device local */
const iso = s => new Date(START + Math.floor(s)*1000).toISOString().slice(0, 19);
const MSEC0 = 4_200_000;
let recSeq = 0;
const hdr = (recId, s) => ({ElapsedTime: Math.floor(s), MsecTime: Math.round(MSEC0 + s*1000),
  RecId: recId, DevDateTime: iso(s), GUID: hex(32)});

/* ---------------- the story, in seconds ---------------- */
const T = {
  zeroStart: 300, zeroEnd: 308, flush: 330,
  afStart: 420, afEnd: 600,
  leadGapEnd: 603,                 /* lead switch: no ECG recorded 600-603 */
  pause: 700,                      /* 3.2 s sinus pause */
  paceStart: 900, paceEnd: 1080,
  vfStart: 1080, shock: 1150, rosc: 1245,
  cprStart: 1085, cprPause0: 1146, cprPause1: 1156, cprEnd: 1240,
  desat0: 1300, desat1: 1400,
  obstr0: 1400, obstr1: 1600,
  probeOff: 1500, probeOn: 1530,
  apnea0: 1650, apnea1: 1675,
  tempOff: 1560, tempOn: 1620,
  pvc0: 1540, pvc1: 1640,         /* after the PPV stretch, which needs a regular rhythm */
  high0: 1700, high1: 1745,        /* arterial systolic above its high limit */
  twelve: [200, 1480],
  snaps: [470, 705, 950, 1100]
};
const phase = t =>
  t < T.afStart ? 'sinus' : t < T.afEnd ? 'af' : t < T.paceStart ? 'brady' :
  t < T.paceEnd ? 'paced' : t < T.shock ? 'vf' : t < T.rosc ? 'pea' : 'rosc';

/* ---------------- breaths ---------------- */
const breaths = [];   /* inspiration onsets */
{
  let t = 1.3;
  while (t < DUR) {
    const ph = phase(t);
    if (t >= T.apnea0 && t < T.apnea1) { t = T.apnea1; continue; }
    breaths.push(t);
    const rr = ph === 'vf' || ph === 'pea' ? 6.0               /* 10/min during CPR */
      : t >= T.rosc ? 5.0                                       /* ventilated 12/min */
      : 60/14 * (1 + 0.06*gauss());                             /* spontaneous ~14/min */
    t += rr;
  }
}
const breathPhase = t => {               /* 0..1 through the current breath */
  let lo = 0, hi = breaths.length - 1, k = -1;
  while (lo <= hi) { const m = (lo+hi) >> 1; if (breaths[m] <= t) { k = m; lo = m+1; } else hi = m-1; }
  if (k < 0) return {p: 0, len: 4, since: t, k};
  const len = (breaths[k+1] || breaths[k] + 4.3) - breaths[k];
  return {p: (t - breaths[k]) / len, len, since: t - breaths[k], k};
};
const ventilated = t => t >= T.rosc || (t >= T.vfStart && t < T.rosc);
/* intrathoracic pressure swing: negative with spontaneous inspiration, positive with
   positive-pressure ventilation; 0..1 shape over the inspiration */
const thorax = t => {
  const b = breathPhase(t); if (t >= T.apnea0 && t < T.apnea1 + 0.5) return 0;
  const insp = b.since < 1.4 ? Math.sin(Math.PI * b.since / 1.4) : 0;
  return ventilated(t) ? insp : -insp;
};

/* ---------------- CPR compressions ---------------- */
const comps = [];
{
  let t = T.cprStart;
  while (t < T.cprEnd) {
    if (t >= T.cprPause0 && t < T.cprPause1) { t = T.cprPause1; continue; }
    const late = (t - T.cprStart) / (T.cprEnd - T.cprStart);
    const rate = 112 + 8*gauss() + (t > 1200 ? 14 : 0);       /* drifts fast late on */
    const depth = 2.2 - 0.45*Math.max(0, late - 0.6) + 0.08*gauss(); /* inches; fatigue */
    comps.push({t, depth: +depth.toFixed(2), relVel: Math.round(410 - 90*Math.max(0, late-0.5) + 25*gauss())});
    t += 60/rate;
  }
}

/* ---------------- heart beats ---------------- */
const beats = [];
{
  let t = 0.6, n = 0;
  while (t < DUR) {
    const ph = phase(t);
    if (ph === 'vf') { t = T.shock + 0.8; continue; }
    if (t >= T.afEnd && t < T.leadGapEnd) { /* rhythm continues; only recording stops */ }
    let rr, type = 'sinus', pr = 0.16, qrs = 0.09, qt = 0.38, weak = false;
    const resp = Math.sin(2*Math.PI*breathPhase(t).p);
    if (ph === 'sinus') { rr = 60/78 * (1 - 0.045*resp) * (1 + 0.012*gauss()); }
    else if (ph === 'af') {
      type = 'af'; rr = 0.33 + 0.42*rnd(); qt = 0.33;
      if (t > 455 && t < 490) rr *= 0.82;                     /* fast run: high-rate alarm */
      weak = rr < 0.42;                                       /* short cycles barely eject */
    }
    else if (ph === 'brady') { rr = 60/48 * (1 + 0.02*gauss()); qt = 0.44;
      if (Math.abs(t - T.pause) < 0.7) rr = 3.2; }
    else if (ph === 'paced') { type = 'paced'; rr = 60/70; qt = 0.42; }
    else if (ph === 'pea') { rr = 60/100 * (1 + 0.01*gauss()); qt = 0.34; }
    else {                                                    /* after ROSC */
      const hr = 108 - 16*(t - T.rosc)/(DUR - T.rosc);
      rr = 60/hr * (1 - 0.02*resp) * (1 + 0.01*gauss()); qt = 0.36;
      if (t > T.pvc0 && t < T.pvc1 && n % 14 === 13) { type = 'pvc'; rr *= 0.7; }
    }
    beats.push({t, type, pr, qrs, qt, weak, rr, ph});
    if (type === 'pvc') { t += rr; t += 60/100*1.3; n++; continue; } /* compensatory pause */
    t += rr; n++;
  }
}

/* ---------------- ECG ---------------- */
const LEADW = {   /* P, Q, R, S, T amplitudes in mV per lead (axis about 50 degrees) */
  I:  [0.08, -0.03, 0.55, -0.08, 0.18],
  II: [0.15, -0.08, 1.10, -0.25, 0.32],
  V1: [0.05,  0.00, 0.25, -1.00, -0.05],
  V2: [0.08,  0.00, 0.50, -1.30, 0.35],
  V3: [0.08, -0.02, 0.90, -0.80, 0.45],
  V4: [0.09, -0.05, 1.40, -0.45, 0.42],
  V5: [0.09, -0.06, 1.30, -0.25, 0.35],
  V6: [0.08, -0.06, 1.00, -0.12, 0.28]
};
function beatMv(b, dt, lead, stElev) {
  const w = LEADW[lead] || LEADW.II;
  const sgn = lead === 'I' ? 0.45 : lead === 'II' ? 1 : (lead === 'V1' || lead === 'V2') ? -0.6 : 0.9;
  if (b.type === 'pvc') return sgn*(1.5*G(dt, 0.04, 0.035) - 0.45*G(dt, 0.12, 0.03) - 0.55*G(dt, 0.34, 0.06));
  if (b.type === 'paced') return sgn*(0.9*G(dt, 0.07, 0.03) - 0.6*G(dt, 0.15, 0.03) - 0.4*G(dt, 0.36, 0.06));
  const tc = -0.045 + b.qt - 0.088;
  /* Q, R and S spread so the complex is about 90 ms from onset to offset */
  let v = w[1]*G(dt, -0.036, 0.009) + w[2]*G(dt, 0, 0.0135) + w[3]*G(dt, 0.036, 0.011) + w[4]*G(dt, tc, 0.040);
  if (b.type !== 'af') v += w[0]*G(dt, -b.pr + 0.005, 0.022);
  if (stElev) v += stElev*(dt > 0.05 && dt < tc ? 1 : 0)*Math.min(1, (dt-0.05)/0.03);
  return v;
}
const ECG_HZ = 250;
const N_ECG = DUR*ECG_HZ;
const ecg = {I: new Float32Array(N_ECG), II: new Float32Array(N_ECG)};
const paceFlag = new Uint8Array(N_ECG);   /* bit 2 pulse, bit 8 blanking */
for (const b of beats) {
  const i0 = Math.max(0, Math.floor((b.t - 0.35)*ECG_HZ)), i1 = Math.min(N_ECG, Math.ceil((b.t + 0.7)*ECG_HZ));
  for (let i = i0; i < i1; i++) { const dt = i/ECG_HZ - b.t;
    ecg.II[i] += beatMv(b, dt, 'II'); ecg.I[i] += beatMv(b, dt, 'I'); }
  if (b.type === 'paced') { const k = Math.round((b.t - 0.002)*ECG_HZ);
    if (k >= 0 && k < N_ECG) { paceFlag[k] |= 2; for (let j = 1; j <= 6 && k+j < N_ECG; j++) paceFlag[k+j] |= 8; } }
}
for (let i = 0; i < N_ECG; i++) {
  const t = i/ECG_HZ, ph = phase(t);
  let add = 0.04*thorax(t) + 0.012*gauss();
  if (ph === 'af') add += 0.05*Math.sin(2*Math.PI*6.3*t) + 0.025*Math.sin(2*Math.PI*8.9*t + 1);
  if (ph === 'vf') { const env = 0.75 + 0.25*Math.sin(2*Math.PI*0.21*t);
    ecg.II[i] = env*(0.38*Math.sin(2*Math.PI*5.1*t + 0.8*Math.sin(2*Math.PI*0.4*t)) + 0.16*Math.sin(2*Math.PI*3.6*t + 1.3));
    ecg.I[i] = ecg.II[i]*0.6; }
  ecg.II[i] += add; ecg.I[i] += add*0.6;
  if (paceFlag[i] & 8) { ecg.II[i] = ecg.II[i-1] || 0; ecg.I[i] = ecg.I[i-1] || 0; }
}
for (const c of comps) {                     /* compression artefact on the ECG */
  const i0 = Math.floor(c.t*ECG_HZ), n = Math.round(0.25*ECG_HZ);
  for (let j = 0; j < n && i0+j < N_ECG; j++) { const s = 0.35*Math.sin(Math.PI*j/n); ecg.II[i0+j] += s; ecg.I[i0+j] += s*0.7; }
}
const ecgIII = i => ecg.II[i] - ecg.I[i];

/* ---------------- pressures, pleth, CO2, impedance ---------------- */
const HZ = 125;
const N = DUR*HZ;
const art = new Float32Array(N), pa = new Float32Array(N), cvp = new Float32Array(N),
  icp = new Float32Array(N), pleth = new Float32Array(N), co2 = new Float32Array(N), imp = new Float32Array(N);
/* slow vasomotor waves (~1/min). Before the arrest ICP moves against them (intact
   autoregulation, PRx negative); after ROSC it follows them (impaired, PRx positive) */
const slowWave = t => 6*Math.sin(2*Math.PI*t/55);
const pressureTarget = (t, b) => {      /* systolic, diastolic for a beat at time t */
  const ph = phase(t), sw = slowWave(t);
  if (ph === 'sinus') return [128 + sw, 74 + sw*0.6];
  if (ph === 'af') return b && b.weak ? [92, 70] : [118, 72];
  if (ph === 'brady') return [112 + sw, 62 + sw*0.6];
  if (ph === 'paced') return [104, 60];
  if (ph === 'pea') return [28, 18];
  /* after ROSC: low, then recovering; a pressor overshoot 1700-1745 */
  const k = Math.min(1, (t - T.rosc)/300);
  let s = 84 + 34*k, d = 50 + 18*k;
  if (t >= T.high0 && t < T.high1) { s = 186; d = 88; }
  return [s + sw, d + sw*0.6];
};
const ppvAmp = t => t >= T.rosc && t < 1500 ? 0.085 : t >= T.rosc ? 0.04 : ventilated(t) ? 0.05 : 0.02;
/* arterial beat shape, tau = time since the pulse foot */
function artShape(tau, sys, dia, rr) {
  const pp = sys - dia, up = 0.11, notch = 0.31;
  if (tau < 0) return dia;
  if (tau < up) return dia + pp*Math.sin(Math.PI/2*tau/up)**2;
  if (tau < notch) return sys - 0.42*pp*((tau-up)/(notch-up))**1.3;
  const pn = sys - 0.42*pp, dip = -0.06*pp*G(tau, notch + 0.015, 0.012) + 0.05*pp*G(tau, notch + 0.06, 0.025);
  const k = Math.min(1, (tau - notch)/Math.max(0.15, rr - notch));
  return dia + (pn - dia)*Math.exp(-2.6*k) - (pn - dia)*Math.exp(-2.6)*k + dip;
}
let bi = 0;
for (let i = 0; i < N; i++) {
  const t = i/HZ, ph = phase(t), th = thorax(t);
  while (bi + 1 < beats.length && beats[bi+1].t + 0.18 <= t) bi++;
  const b = beats[bi], foot = b ? b.t + 0.18 : -1, tau = t - foot;
  const rr = b ? b.rr : 1;
  let [s, d] = b ? pressureTarget(b.t, b) : [120, 70];
  const mod = 1 + ppvAmp(t)*Math.sin(2*Math.PI*breathPhase(b ? b.t : t).p - (ventilated(t) ? 0.6 : 2.5));
  const mean0 = (s + 2*d)/3; s = mean0 + (s - mean0)*mod; d = mean0 + (d - mean0)*mod;
  let p;
  if (ph === 'vf' || (ph === 'pea' && t < T.cprEnd)) {
    p = 14 + 2*gauss()*0.3;
    if (ph === 'pea') p = artShape(tau, s, d, rr);
  } else p = b && tau >= 0 ? artShape(tau, s, d, rr) : d;
  for (const c of comps) { const dc = t - c.t; if (dc >= 0 && dc < 0.32) p += 62*(c.depth/2.2)*Math.sin(Math.PI*dc/0.32)**1.4; else if (dc < 0) break; }
  p += 4*th*(ventilated(t) ? 1 : 0.6);
  /* zeroing: transducer open to air, then a fast-flush square wave and ringing */
  if (t >= T.zeroStart && t < T.zeroEnd) p = 0.4*gauss();
  if (t >= T.flush && t < T.flush + 1.2) p = 300;
  if (t >= T.flush + 1.2 && t < T.flush + 1.8) { const x = t - T.flush - 1.2; p += 45*Math.exp(-x/0.07)*Math.cos(2*Math.PI*11*x); }
  art[i] = p + 0.5*gauss();

  /* pulmonary artery (or, neuro case, a CVP-like second line) */
  const paS = ph === 'rosc' ? 34 : 28, paD = ph === 'rosc' ? 15 : 12;
  let ppa = b && tau >= -0.12 ? artShape(tau + 0.12, paS, paD, rr) : paD;
  if (ph === 'vf' || (ph === 'pea' && t < T.cprEnd)) ppa = 16 + 6*gauss()*0.2;
  pa[i] = ppa + 5*th + 0.4*gauss();

  /* CVP: a, c and v waves on a mean of 8 */
  const ta = b ? t - b.t : 1;
  let pc = 8 + 1.6*G(ta, -0.08, 0.05) + 0.8*G(ta, 0.06, 0.03) + 1.4*G(ta, 0.42, 0.07) + 3*th;
  if (ph === 'vf') pc = 12 + 0.5*gauss();
  cvp[i] = pc + 0.3*gauss();

  /* ICP (neuro case): raised, pulsatile, following the slow arterial waves */
  icp[i] = 26 + 2.8*(b && tau >= 0 ? G(tau, 0.12, 0.05) + 0.7*G(tau, 0.3, 0.06) : 0) + 0.4*th
    + (t >= T.rosc ? 0.75 : t < T.vfStart ? -0.5 : 0)*slowWave(t - 3) + 0.3*gauss();

  /* pleth: later than the arterial pulse, smoother; resp variation of amplitude */
  const fp = b ? t - (b.t + 0.25) : -1;
  const amp = 60*(b && b.weak ? 0.25 : 1)*(1 + 1.7*ppvAmp(t)*Math.sin(2*Math.PI*breathPhase(t).p));
  let q = fp >= 0 ? amp*((fp < 0.16 ? Math.sin(Math.PI/2*fp/0.16)**2 : Math.exp(-(fp - 0.16)/0.32)) + 0.08*G(fp, 0.38, 0.04)) - 25 : -25;
  if (ph === 'vf' || ph === 'pea') q = 8*gauss();
  pleth[i] = q;

  /* capnogram: inspiration ~1.1 s at zero, then expiration; shark fin when obstructed */
  const bp = breathPhase(t);
  let et = ph === 'vf' ? 14 : ph === 'pea' ? (t < T.cprEnd ? 19 : 24) : t < T.rosc + 20 && t >= T.rosc ? 48 : 38;
  if (t >= T.desat0 && t < T.desat1) et = 44;
  let c = 0;
  if (t >= T.apnea0 && t < T.apnea1) c = Math.max(0, et*Math.exp(-(t - T.apnea0)/1.5));
  else if (bp.since >= 1.1) {
    const x = bp.since - 1.1, obst = t >= T.obstr0 && t < T.obstr1;
    const rise = obst ? 0.9 : 0.22, slope = obst ? 5.5 : 1.2;
    c = (et - slope)*(1 - Math.exp(-x/rise)) + slope*Math.min(1, x/(bp.len - 1.1));
  } else c = bp.since < 0.25 && bp.k > 0 ? et*(1 - bp.since/0.25)**2 : 0;
  if (ph === 'vf' || (ph === 'pea' && t < T.cprEnd)) c += 1.5*Math.sin(2*Math.PI*1.9*t);
  co2[i] = Math.max(0, c + 0.25*gauss());

  /* impedance respiration, ohms around a baseline */
  imp[i] = 0.9*(t >= T.apnea0 && t < T.apnea1 ? 0 : Math.max(0, Math.sin(Math.PI*Math.min(1, bp.since/1.9)))) + 0.04*gauss()
    + (ph === 'vf' || (ph === 'pea' && t < T.cprEnd) ? 0.6*Math.sin(2*Math.PI*1.9*t) : 0);
}
/* the monitor stores invasive pressures as identical pairs of samples */
for (const a of [art, pa, cvp, icp]) for (let i = 1; i < N; i += 2) a[i] = a[i-1];

/* ---------------- what the monitor measured, second by second ---------------- */
const hrAt = t => {         /* device HR: mean of the last 6 s of beats */
  const bs = beats.filter(b => b.t <= t && b.t > t - 6);
  if (phase(t) === 'vf' || bs.length < 2) return null;
  return Math.round(60*(bs.length - 1)/(bs[bs.length-1].t - bs[0].t));
};
const spo2At = t => {
  if (t >= T.probeOff && t < T.probeOn) return null;
  if (phase(t) === 'vf' || (phase(t) === 'pea' && t < T.rosc + 30)) return null;
  if (t >= T.desat0 && t < T.desat1) { const x = (t - T.desat0)/(T.desat1 - T.desat0); return Math.round(96 - 13*Math.sin(Math.PI*x)); }
  return t > T.rosc ? 95 : 97;
};
const stats = (arr, t, win) => {     /* sys/dia/map over the last win seconds */
  const i1 = Math.min(N, Math.floor(t*HZ)), i0 = Math.max(0, i1 - win*HZ);
  let mx = -1e9, mn = 1e9, sm = 0, n = 0;
  for (let i = i0; i < i1; i++) { const v = arr[i]; if (v > mx) mx = v; if (v < mn) mn = v; sm += v; n++; }
  return n ? {sys: Math.round(mx), dia: Math.round(mn), map: Math.round(sm/n)} : null;
};
const etco2At = t => {
  if (t >= T.apnea0 + 8 && t < T.apnea1) return 0;
  const i1 = Math.floor(t*HZ), i0 = Math.max(0, i1 - 12*HZ); let mx = 0;
  for (let i = i0; i < i1; i++) if (co2[i] > mx) mx = co2[i];
  return Math.round(mx);
};
const rrAt = t => { const n = breaths.filter(b => b <= t && b > t - 60).length; return n; };
const tempAt = (k, t) => {
  if (k === 1 && t >= T.tempOff && t < T.tempOn) return null;
  return k === 1 ? 98.6 - 1.5*(t/DUR) : 96.4 - 0.8*(t/DUR);   /* core cools, skin cooler */
};

/* NIBP readings: auto every 5 min, then 10 min after ROSC; one fails during CPR */
const nibp = [];
{
  const read = (t, s, d, manual) => nibp.push({t, s, d, m: Math.round((s + 2*d)/3), manual});
  read(30, 134, 78); read(300, 131, 76); read(600, 116, 71); read(900, 108, 64);
  read(1270, 86, 52, true);   /* manual after ROSC: low */
  read(1500, 102, 61); read(1800 - 2, 128, 74);
}
const nibpFail = 1200;

/* ---------------- records ---------------- */
const recs = [];
const push = (key, rec) => recs.push({[key]: rec});
const val = (v, units, unitsVal, extra) => v == null
  ? {TrendData: {Alarm: 0, DataStatus: 1, Val: {'#text': -21846, '@Units': units, '@UnitsVal': unitsVal}, DataState: 'invalid'}, ...extra}
  : {TrendData: {Alarm: 0, DataStatus: 0, Val: {'#text': Math.round(v), '@Units': units, '@UnitsVal': unitsVal}, DataState: 'valid'}, ...extra};

const caseId = NEURO ? 'SIM-NEURO-0001' : 'SIM-CARDIAC-0001';
const uniq = hex(32);
const SERIAL = 'SIM00000001';
const patient = {Weight: {'#text': 180, '@Units': 'lb'}, FirstName: 'Synthetic', MiddleName: '', LastName: 'Testcase',
  Age: 58, PatientId: 'SIM-000001', RoomNo: '', Height: {'#text': 70, '@Units': 'in'}, PatMode: 0, Gender: 1,
  PatientMode: 'Adult', Sex: 'Male'};

push('NewCase', {StdHdr: hdr(4, 0), CaseLabel: caseId, '@TdrRecVer': 5, UniqueCaseId: uniq});
push('DeviceConfiguration', {StdHdr: hdr(1, 0), DeviceSerialNumber: SERIAL, ProductType: 9, TimeZone: -300,
  ContactPhone: '', DateFormat: 6, ContactName: '', SoftwareVersions: {MpSwVer: '09.99.00.00', CpSwVer: '9.99.0.0', PpSwVer: '09.99.00.00'},
  DecimalFormat: 1, OptionConfig: {Co2: 1, Ibp3: 1, Temp: 1, ImpResp: 1, Ecg12Lead: 1, Nibp: 1}, Language: 0,
  Dept: 'Example EMS (synthetic)', UnitId: 'Sim Unit 1', Facility: 'Synthetic Facility', DaylightSaving: 60, '@TdrRecVer': 4});
const CH = [   /* ChanType, scalar, scalar type (1 = ECG nanovolts per count) */
  ...[1,2,3,4,5,6,7,8,9,10,11,12,13,14,22].map(c => ({ChanType: c, Scalar: 2500, ValueDataType: 3, ScalarType: 1})),
  {ChanType: 15, Scalar: 10, ValueDataType: 3, ScalarType: 2}, {ChanType: 16, Scalar: 1, ValueDataType: 3, ScalarType: 2},
  {ChanType: 18, Scalar: 1, ValueDataType: 3, ScalarType: 2}, {ChanType: 19, Scalar: 1, ValueDataType: 3, ScalarType: 2},
  {ChanType: 20, Scalar: 1, ValueDataType: 3, ScalarType: 2}, {ChanType: 23, Scalar: 1000, ValueDataType: 3, ScalarType: 2}];
push('DataChannels', {StdHdr: hdr(2, 0), DataChannel: CH, '@TdrRecVer': 1});
push('PatientInfo', {PatientData: patient, StdHdr: hdr(5, 0), '@TdrRecVer': 3});
const lim = (lo, hi) => ({HighLimOn: {'#text': hi ? 1 : 0, '@Changed': 0}, LowLimOn: {'#text': lo ? 1 : 0, '@Changed': 0}});
push('AlarmLimits', {StdHdr: hdr(20, 0), Hr: lim(1, 1), Spo2: lim(1, 0), Resp: lim(1, 1), Etco2: lim(1, 1),
  Nibp: {Sys: lim(1, 1), Dia: lim(1, 1), Map: lim(1, 0)},
  Ibp: [0, 1, 2].map(k => ({Sys: lim(1, 1), Dia: lim(1, 1), Map: lim(1, 1), '@Seq': k+1, IbpDataSrc: 0})),
  PI: lim(0, 0), Temp: [1, 2, 3].map(k => ({...lim(1, 1), TempDataSrc: 0, '@Type': String(k)})), '@TdrRecVer': 4});
const display = (s, nibpMin) => push('DisplayInfo', {StdHdr: hdr(35, s), ParmEcgColor: '#00ff00', ParmSpo2Color: '#00ffff',
  ParmPiColor: '#00ffff', ParmCo2Color: '#ff00ff', ParmRespColor: '#ff00ff', ParmNibpColor: '#ffff00', ParmTempColor: '#ffffff',
  ParmIbpSourceP1Color: '#ff0000', ParmIbpSourceP2Color: '#ffff00', ParmIbpSourceP3Color: '#00ffff',
  ParmIbp1SourceLabel: 'P1', ParmIbp2SourceLabel: NEURO ? 'P2' : 'PA', ParmIbp3SourceLabel: NEURO ? 'ICP' : 'P3',
  ParmNibpAutoModeInterval: nibpMin, parmNibpMode: 1, ParmTempUnitsLabel: '°F', ParmPatientPaceMarkerOn: 1, '@TdrRecVer': 4});
display(0, 5); display(T.rosc + 20, 10);
const traces = (s, chans) => push('TraceConfigs', {StdHdr: hdr(3, s),
  TraceConfig: chans.map(c => ({AssignedChan: c, Multiplier: {'@Value': c <= 14 ? 1000 : 1}})), '@TdrRecVer': 1});
traces(0, [3, 4, 16, 18, 19, 20, 15]);
traces(T.afEnd, [2, 3, 16, 18, 19, 20, 15]);   /* lead III swapped for lead I */

/* --- continuous waveforms, one record per second --- */
const W = {   /* name, wave type, rate, units, data source */
  I:   {name: '12-Lead I', wt: 2, hz: 250}, II: {name: '12-Lead II', wt: 3, hz: 250}, III: {name: '12-Lead III', wt: 4, hz: 250},
  co2: {name: 'CO2 mmHg, Waveform', wt: 15, hz: 125, units: 'mmHg', u: 2, range: [0, 60], scale: 10},
  pleth: {name: 'SpO2 %, Waveform', wt: 16, hz: 125, units: 'Percent (%)', u: 5, scale: 1},
  ibp1: {name: 'IBP 1 mmHg, Waveform', wt: 18, hz: 125, units: 'mmHg', u: 2, range: [0, 180], scale: 1},
  ibp2: {name: 'IBP 2 mmHg, Waveform', wt: 19, hz: 125, units: 'mmHg', u: 2, range: NEURO ? [0, 40] : [0, 60], scale: 1},
  ibp3: {name: 'IBP 3 mmHg, Waveform', wt: 20, hz: 125, units: 'mmHg', u: 2, range: NEURO ? [0, 60] : [0, 40], scale: 1},
  imp: {name: 'Impedance Respiration, Waveform', wt: 23, hz: 125, units: 'Ohms', u: 0, scale: 1000}
};
const SRC = NEURO ? {ibp2: cvp, ibp3: icp} : {ibp2: pa, ibp3: cvp};
const wave = (k, num, samples, status) => {
  const w = W[k], ecgW = w.hz === 250;
  return {Status: 0, StatusVal: 'Valid', '@WaveNum': num,
    WaveRec: {UnpackedSamples: samples, WaveType: w.wt, FrameSize: samples.length, '@DataType': 2,
      SampleTime: 1e6/w.hz, WaveTypeVar: w.name, SampleStatus: status || samples.map(() => 0)},
    WaveSetting: {UnitsVal: w.units || 'None or unspecified', WaveType: w.wt,
      TraceScale: w.range ? {Range: {'@High': w.range[1], '@Low': w.range[0]}, AutoScale: 0} : {AutoScale: 0, Multiplier: {'@Value': ecgW ? 1000 : 1}},
      /* the neuro case records ECG in diagnostic mode so PR and QT get measured */
      ResponseFilt: ecgW ? (NEURO ? {'@High': 150, '@Low': '0.05'} : {'@High': 40, '@Low': '0.67'}) : {'@High': 0, '@Low': '0.00'}, Units: w.u || 0, GeneralData: 0,
      DataSrc: {RawDataSrc: ecgW ? 1 : 0}, WaveTypeVar: w.name}, Offset: 0};
};
for (let s = 0; s < DUR; s++) {
  const ws = [];
  const e0 = s*ECG_HZ, e1 = e0 + ECG_HZ, p0 = s*HZ, p1 = p0 + HZ;
  if (!(s >= T.afEnd && s < T.leadGapEnd)) {
    const leads = s < T.afEnd ? ['II', 'III'] : ['I', 'II'];
    leads.forEach((L, j) => {
      const smp = [], st = [];
      for (let i = e0; i < e1; i++) { const mv = L === 'III' ? ecgIII(i) : ecg[L][i]; smp.push(Math.round(mv*400)); st.push(paceFlag[i]); }
      ws.push(wave(L, j + 1, smp, st));
    });
  }
  const seg = (arr, sc) => { const o = []; for (let i = p0; i < p1; i++) o.push(Math.round(arr[i]*sc)); return o; };
  if (!(s >= T.probeOff && s < T.probeOn)) ws.push(wave('pleth', 3, seg(pleth, 1)));
  ws.push(wave('ibp1', 4, seg(art, 1)));
  ws.push(wave('ibp2', 5, seg(SRC.ibp2, 1)));
  ws.push(wave('ibp3', 6, seg(SRC.ibp3, 1)));
  ws.push(wave('co2', 7, seg(co2, 10)));
  ws.push(wave('imp', 8, seg(imp, 1000)));
  push('ContinWaveRec', {StdHdr: hdr(26, s), Waveform: ws, HeaderData: '0 0 0', NotchSetting: 60, PatMode: 0, EcgLeadLabels: 1, '@TdrRecVer': 1});
}

/* --- trends every 30 s, plus rows forced by NIBP results and alarms --- */
const alarmRows = new Set();
const flags = {hr: t => { const h = hrAt(t); return h != null && (h < 50 || h > 140); },
  spo2: t => { const v = spo2At(t); return v != null && v < 90; }};
let lastNibp = null;
const trendRow = (s, evt) => {
  const hr = hrAt(s), sp = spo2At(s), et = etco2At(s), rr = rrAt(s);
  const ibp = [stats(art, s, 6), stats(SRC.ibp2, s, 6), stats(SRC.ibp3, s, 6)];
  const nb = nibp.filter(x => x.t <= s).pop();
  const isNew = nb && nb !== lastNibp; if (nb) lastNibp = nb;
  const hrV = val(hr, 10, 'Beats per minute', {SrcLabelVal: 'ECG', SrcLabel: 1, ChanState: 0});
  if (flags.hr(s)) hrV.TrendData.Alarm = 1;
  const spV = val(sp, 5, 'Percent (%)', {ChanState: 0,
    PI: {Monitoring: 1, ...val(sp == null ? null : (s > T.rosc ? 14 : 28), 5, 'Percent (%)')},
    PVI: {Monitoring: 1, ...val(sp == null ? null : (s > T.rosc && s < 1500 ? 19 : 11), 5, 'Percent (%)')},
    SpCo: {Monitoring: 0, ...val(null, 5, 'Percent (%)')}, SpMet: {Monitoring: 0, ...val(null, 5, 'Percent (%)')}});
  if (flags.spo2(s)) spV.TrendData.Alarm = 1;
  const ibpRec = ibp.map((x, k) => {
    const label = k === 0 ? 'P1' : k === 1 ? (NEURO ? 'P2' : 'PA') : (NEURO ? 'ICP' : 'P3');
    const r = {'@ChanNum': k + 1, SrcLabelVal: label, SrcLabel: 7, DispForm: 1, ChanState: 0,
      Sys: val(x && x.sys, 2, 'mmHg'), Dia: val(x && x.dia, 2, 'mmHg'), Map: val(x && x.map, 2, 'mmHg')};
    if (k === 0 && s >= T.flush && s < T.flush + 6) r.Sys.TrendData.DataState = '+++';  /* above measurable */
    if (k === 0 && x && (x.sys > 180 || (x.sys < 90 && s > T.rosc))) r.Sys.TrendData.Alarm = 1;
    return r;
  });
  const nibpRec = {ChanState: 0, DispForm: 1, IsNew: isNew ? 'true' : 'false', Time: nb ? iso(nb.t) : '',
    Sys: val(nb && nb.s, 2, 'mmHg'), Dia: val(nb && nb.d, 2, 'mmHg'), Map: val(nb && nb.m, 2, 'mmHg')};
  if (nb && nb.s < 90) nibpRec.Sys.TrendData.Alarm = 1;
  const temp = [1, 2, 3].map(k => {
    const v = k === 3 ? (tempAt(1, s) != null ? tempAt(1, s) - tempAt(2, s) : null) : tempAt(k, s);
    return {...val(v == null ? null : v*10, 4, 'Degrees F'), SrcLabelVal: k === 3 ? 'ΔTemp' : 'Temp ' + k, SrcLabel: 1, '@Type': k, ChanState: 0};
  });
  push('TrendRpt', {StdHdr: hdr(12, s), CntId: 1, TrendStatus: {}, '@TdrRecVer': 9, DevEvtCode: evt || 30, XidCode: '00000000',
    Trend: {LtaStateVal: 'None', LtaState: 0, PatMode: 0, Hr: hrV, Spo2: spV, Nibp: nibpRec, Ibp: ibpRec, Temp: temp,
      Etco2: val(et, 2, 'mmHg', {ChanState: 0}), Fico2: {DispFlag: 0, ...val(et == null ? null : 0, 2, 'mmHg'), ChanState: 0},
      Resp: val(rr, 11, 'Breaths per minute', {SrcLabelVal: 'CO2', NoBreathAlarmActive: s >= T.apnea0 + 20 && s < T.apnea1 ? 1 : 0, SrcLabel: 2, ChanState: 0})}});
};

/* --- events --- */
const ev = (s, name, code, xid, treat, extra) => push('AnnotationEvt', {StdHdr: hdr(8, s), '@EvtName': name,
  TreatmentSummary: treat ? 1 : 0, DevEvtCode: code, XidCode: xid, Payload: '0 0 0 0', '@TdrRecVer': 1, ...extra});
/* the rolling device log: yesterday (pruned) and this morning's self-test (kept) */
const yday = s => ({...hdr(8, s), DevDateTime: new Date(START - 86400000 + s*1000).toISOString().slice(0, 19)});
push('AnnotationEvt', {StdHdr: yday(3600), '@EvtName': 'Battery Connected', TreatmentSummary: 0, DevEvtCode: 5, XidCode: '00000006', Payload: '0 0 0 0', '@TdrRecVer': 1});
push('AnnotationEvt', {StdHdr: {...hdr(8, 0), DevDateTime: new Date(START - 2*3600000).toISOString().slice(0, 19)}, '@EvtName': 'Self Test Passed', TreatmentSummary: 1, DevEvtCode: 78, XidCode: '00000142', Payload: '0 0 0 0', '@TdrRecVer': 1});
ev(0, 'System On', 0, '00000001', 1);
ev(0, 'New Patient', 13, '0000000B', 1);
ev(0, 'Patient Mode Adult', 14, '0000016C', 1);
ev(1, 'SPO2 Probe Connected', 223, '0000008B', 0);
ev(2, 'IBP Probe1 Connected', 171, '0000005D', 0);
ev(2, 'IBP Probe2 Connected', 174, '00000060', 0);
ev(2, 'IBP Probe3 Connected', 177, '00000063', 0);
ev(T.zeroEnd, 'IBP Probe1 Zeroed', 164, '00000059', 0);
ev(T.afEnd, 'Ecg Lead Fault', 102, '00000021', 0);
ev(T.paceStart, 'Pacer Mode On', 302, '000000B0', 1);
ev(T.paceEnd, 'Pacer Mode Off', 303, '000000B1', 1);
ev(T.shock - 12, 'Analyze', 310, '000000C0', 1);
ev(T.shock, 'Shock Delivered', 312, '000000C2', 1);
ev(T.cprStart + 90, 'Epinephrine', 501, '000001F5', 1);
ev(T.rosc + 5, 'ROSC', 520, '00000208', 1);
ev(T.cprStart + 5, 'SPO2 Check Probe', 221, '00000089', 0);
ev(T.rosc + 30, 'SPO2 Probe Connected', 223, '0000008B', 0);
ev(T.probeOff, 'SPO2 Probe Disconnect', 222, '0000008A', 0);
ev(T.probeOn, 'SPO2 Probe Connected', 223, '0000008B', 0);
ev(T.tempOff, 'Temp Probe1 Disconnected', 133, '0000003B', 0);
ev(T.tempOn, 'Temp Probe1 Connected', 132, '0000003A', 0);
ev(nibpFail - 25, 'NIBP Reading Started', 193, '0000006E', 0);
ev(nibpFail, 'NIBP Air Leak', 207, '00000070', 0);
for (const r of nibp) { ev(r.t - 28, 'NIBP Reading Started', 193, '0000006E', 0); ev(r.t, 'NIBP Reading', 191, '0000006C', 0); }

/* alarms: crossings worked out from the model, re-armed after 60 s back in range */
const ALARM = (s, code, xid, src, value, lo, hi, units, unitsVal) => {
  push('AlarmEvt', {TreatmentSummary: 1, StdHdr: hdr(16, s), DevEvtCode: code, XidCode: xid, DataSrc: {RawDataSrc: src},
    Value: Math.round(value), AlarmLimits: {Units: units, HighLimVal: hi, UnitsVal: unitsVal, ScaleFactor: 0, LowLimVal: lo}, '@TdrRecVer': 2});
  ev(s + 6, 'Alarms Silenced', 400, '0000013D', 0);
  alarmRows.add(s + 1);
};
{
  const armed = {}; const okSince = {};
  const check = (key, s, bad, fire) => {
    if (bad) { if (armed[key] !== false) { fire(); armed[key] = false; } okSince[key] = null; }
    else { okSince[key] = okSince[key] == null ? s : okSince[key]; if (s - okSince[key] > 60) armed[key] = true; }
  };
  for (let s = 5; s < DUR; s++) {
    const h = hrAt(s);
    check('hrlo', s, h != null && h < 50, () => ALARM(s, 319, '0000010E', 0, h, 50, 140, 10, 'Beats per minute'));
    check('hrhi', s, h != null && h > 140, () => ALARM(s, 320, '0000010F', 0, h, 50, 140, 10, 'Beats per minute'));
    const sp = spo2At(s);
    check('splo', s, sp != null && sp < 90, () => ALARM(s, 227, '0000008F', 0, sp, 90, 100, 5, 'Percent (%)'));
    const a = stats(art, s, 3);
    if (a && !(s >= T.zeroStart && s < T.flush + 3)) {
      check('artlo', s, a.sys < 90 && s > T.vfStart, () => ALARM(s, 142, '00000043', 7, a.sys, 90, 180, 2, 'mmHg'));
      check('arthi', s, a.sys > 180, () => ALARM(s, 141, '00000042', 7, a.sys, 90, 180, 2, 'mmHg'));
    }
  }
  const low = nibp.find(x => x.s < 90);
  if (low) push('AlarmEvt', {TreatmentSummary: 1, StdHdr: hdr(16, low.t + 1), DevEvtCode: 197, XidCode: '00000061', DataSrc: {RawDataSrc: 5},
    Value: low.s, AlarmLimits: {Units: 2, HighLimVal: 160, UnitsVal: 'mmHg', ScaleFactor: 0, LowLimVal: 90}, '@TdrRecVer': 2});
}
for (let s = 30; s < DUR; s += 30) trendRow(s);
for (const r of nibp) trendRow(r.t + 1, 191);
for (const s of alarmRows) trendRow(s, 142);

/* defibrillator subsystem: pads applied before the arrest, pacing, one shock */
for (let s = 0; s < DUR; s += 2) {
  const pads = s >= T.paceStart - 20, pacing = s >= T.paceStart && s < T.paceEnd;
  push('DefibTrace', {StdHdr: hdr(10, s), PacerRate: pacing ? 70 : 0, CurrEnergy: s === T.shock ? 200 : 0, SelEnergy: 200,
    PaddleType: 18, '@TdrRecVer': 1, State: 505, PacerCurrent: pacing ? 85 : 0, ModeFlags: '0A25',
    Impedance: pads ? 92 + Math.round(4*gauss()) : 9999, NotificationCode: 0, StatCode: 0});
}
/* AED: the analysis before the shock, and the background analysis every 30 s */
push('Aed', {StdHdr: hdr(27, T.shock - 8), ModeEvts: {UsePads: 0, CableFault: 0, CheckPads: 0}, Protocol: 0, DefibEnergy: 200,
  State: 2, Mode: '0003', AnalysisResult: {ShockResult: 1, SegNum: 1, NoisyEcgCnt: 0}, AnalysisEvts: {}, CprEvts: {}, DefibEvts: {}, '@TdrRecVer': 1});
for (let s = 15, k = 1; s < DUR; s += 30, k++)
  push('AedContinAnalysis', {StdHdr: hdr(30, s), '@TdrRecVer': 3, Analysis: {Timestamp: s*1000, SchemaId: 1, Segment: []},
    AnalysisResult: {SceThreshold: 4500, EndTime: s*1000, SceDecisionFlag: 0, EcgPegCnt: 0, SamCnt: 0, IntervalCode: 0,
      SceDecisionFlagVal: 'Disabled', ReportId: k, StartTime: s*1000 - 3000, SpiVal: 0, SceShockAnalysis: 0, ShockResult: 5,
      SegNum: k, ReadyFlag: 1, NoisyEcgCnt: phase(s) === 'vf' ? 1 : 0}});
/* per-compression records, one per second of CPR */
for (let s = T.cprStart; s < T.cprEnd; s++) {
  const list = comps.filter(c => c.t >= s && c.t < s + 1);
  if (list.length) push('CprCompressionRpt', {StdHdr: hdr(41, s), '@TdrRecVer': 1,
    Compressions: list.map(c => ({Depth: c.depth, ReleaseVelocity: c.relVel, Offset: Math.round((c.t - s)*1000)}))});
}
/* snapshots: 15 s of lead II and the arterial line, 6 s before the trigger */
for (const s of T.snaps) {
  const e0 = Math.max(0, (s - 6)*ECG_HZ), p0 = Math.max(0, (s - 6)*HZ);
  const leadName = s < T.afEnd ? 'II' : 'II';
  const smp = [], st = [], ap = [];
  for (let i = e0; i < e0 + 15*ECG_HZ && i < N_ECG; i++) { smp.push(Math.round(ecg[leadName][i]*400)); st.push(paceFlag[i]); }
  for (let i = p0; i < p0 + 15*HZ && i < N; i++) ap.push(Math.round(art[i]));
  push('SnapshotRpt', {StdHdr: hdr(13, s), EcgLeadLbl: 1, DevEvtCode: 66, PreEventSampleTime: 6000, HdrData: '0 0 0',
    SnapshotId: hex(32), UniqueCaseId: uniq, NotchSetting: 60, PacerState: phase(s) === 'paced' ? 1 : 0, SyncState: 0, PatMode: 0,
    SnapshotType: 4, ChartSpeed: 25, '@TdrRecVer': 13, Waveform: [wave('II', 1, smp, st), wave('ibp1', 2, ap)]});
}
/* 12-lead ECGs: 10 s at 500 Hz, starting about 1 s before the record's timestamp,
   built from the same beats as the continuous leads so the viewer can place them */
for (const s of T.twelve) {
  const L = {}; const t0 = s - 1.06;
  for (const lead of ['I', 'II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6']) {
    const a = [];
    const st = s > T.rosc && /^V[234]$/.test(lead) ? 0.18 : 0;   /* ST elevation after ROSC */
    for (let i = 0; i < 5000; i++) {
      const t = t0 + i/500; let v = 0;
      for (const b of beats) { if (b.t < t - 0.75) continue; if (b.t > t + 0.4) break; v += beatMv(b, t - b.t, lead, st); }
      v += 0.01*gauss();
      a.push(Math.round(v*400));
    }
    L['Lead' + lead] = a;
  }
  push('Ecg12LeadRec', {StdHdr: hdr(18, s), '@TdrRecVer': 2, SampleRate: 500, Amplitude: {'#text': 2500, '@UnitsVal': 'nanovolts'},
    LeadData: L, AnalysisResult: {HeartRate: hrAt(s), PrInterval: 160, QrsDuration: 90, QtInterval: s > T.rosc ? 360 : 380, QrsAxis: 50,
      Statements: s > T.rosc ? ['Sinus tachycardia', 'ST elevation, anterior leads (synthetic)'] : ['Normal sinus rhythm']}});
}
const treat = recs.filter(r => (r.AnnotationEvt || r.AlarmEvt || {}).TreatmentSummary === 1).length;
push('CaseSummary', {DeptId: 'Example EMS (synthetic)', StdHdr: hdr(17, DUR), ShockCnt: 1, SwVer: '09.99.00.00',
  TwelveLeadCnt: T.twelve.length, TotalPacerTime: T.paceEnd - T.paceStart, SerialNumber: SERIAL, TreatmentSummEvtCnt: treat,
  '@TdrRecVer': 4, ElapsedTime: DUR, StartTime: iso(0), UnitId: 'Sim Unit 1', PatientData: patient,
  LastTreatmentTimeStamp: iso(T.rosc + 5), TrendCnt: recs.filter(r => r.TrendRpt).length});

/* records are not in time order in a real export either */
for (let i = recs.length - 1; i > 0; i--) { if (rnd() < 0.02) { const j = Math.floor(rnd()*i); [recs[i], recs[j]] = [recs[j], recs[i]]; } }

/* ---------------- CaseReview XML ---------------- */
const vm = list => list.map(t => `<Ventilation second="${Math.floor(t)}" ms="${Math.round((t % 1)*1000)}" />`).join('');
const xml = `<?xml version="1.0" encoding="utf-16"?>
<ZOLLData><CaseReview version="5.3.0.0"><Case id="${caseId}"><Date>${iso(0).slice(0, 10)}</Date><Time>${iso(0).slice(11)}</Time>
<Length>${DUR}</Length><CaseType>Synthetic test case</CaseType>
<Patient><FirstName>Synthetic</FirstName><LastName>Testcase</LastName><ID>SIM-000001</ID><Gender>Male</Gender></Patient>
<Defibrillator><Model type="7" /><Serial>${SERIAL}</Serial><Software>09.99.00.00</Software>
<EtCO2Ventilations Parsed="1">${vm(breaths.filter(b => b < DUR - 2))}</EtCO2Ventilations>
<ImpedanceRespirationVentilations Parsed="1">${vm(breaths.filter(b => b < T.vfStart))}</ImpedanceRespirationVentilations></Defibrillator>
<CprPeriodsMode>Auto</CprPeriodsMode>
<CprPeriods><CprPeriod Start="${T.cprStart}" End="${T.cprPause0}" /><CprPeriod Start="${T.cprPause1}" End="${T.cprEnd}" /></CprPeriods>
<UserCprPeriods />
<CprPausePeriods><CprPausePeriod Start="${T.cprPause0}" End="${T.cprPause1}" /></CprPausePeriods>
<RoscPeriods><RoscPeriod Start="${T.rosc}" End="${DUR}" /></RoscPeriods>
<AutoPulsePeriods /><ResQPumpPeriods />
</Case></CaseReview></ZOLLData>`;

/* ---------------- write the .zol: [len][JSON][len][UTF-16LE XML with BOM] ---------------- */
const json = Buffer.from(JSON.stringify({ZOLL: {'@SchemaVersion': 9, FullDisclosure: [{FullDisclosureRecord: recs}]}}), 'utf8');
const xmlBuf = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(xml, 'utf16le')]);
const len = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
fs.mkdirSync(path.dirname(OUT), {recursive: true});
fs.writeFileSync(OUT, Buffer.concat([len(json.length), json, len(xmlBuf.length), xmlBuf]));

/* ---------------- the answer sheet ---------------- */
const clock = s => iso(s).slice(11);
const sheet = `# ${path.basename(OUT)} — what the viewer should find

Synthetic, generated by \`tools/make-test-case.cjs${NEURO ? ' --neuro' : ''}\`. No real patient or device.
Case start ${iso(0).replace('T', ' ')} (device local), 30 minutes. Times below are case clock.

| Case time | What happens | What to check |
|---|---|---|
| ${clock(0)}–${clock(T.afStart)} | Sinus 78/min with respiratory sinus arrhythmia (rate swings with each breath) | HR ~78; QRS ~90 ms; QRS axis ~50°; RR CV low, AF score 0; RSA and HRV present. ${NEURO ? 'ECG recorded at diagnostic bandwidth (0.05–150 Hz), so Physiology measures PR ~160 ms, QT ~380 ms (QTcB ~433, QTcF ~412)' : 'ECG at monitoring bandwidth (0.67–40 Hz): PR and QT are withheld by design; the neuro case records diagnostic bandwidth to test them'} |
| ${clock(30)} | First NIBP 134/78 (96) | Vitals NIBP column; auto cycle 5 min |
| ${clock(200)} | 12-lead ECG (sinus) | 12-Lead tab; placed by matching lead II; interpretation axis 50 |
| ${clock(T.zeroStart)}–${clock(T.zeroEnd)} | P1 open to air at 0 mmHg, then **IBP Probe1 Zeroed** | ZERO flag on the P1 row; Vitals zero row |
| ${clock(T.flush)} | Fast flush: 300 mmHg square, then ringing at ~11 Hz | Trend P1 systolic **+++**; damping / flush test reading; the flush also trips the arterial high alarm, as it would on a monitor |
| ${clock(T.afStart)}–${clock(T.afEnd)} | Atrial fibrillation ~115/min, faster run ${clock(455)}–${clock(490)}; short cycles produce weak pulses | AF pattern score high, RR CV high; pulse deficit (pleth/arterial rate below ECG rate); **HR high alarm** (red box) |
| ${clock(470)} | Snapshot | Snapshots list |
| ${clock(T.afEnd)}–${clock(T.leadGapEnd)} | **Ecg Lead Fault**, display switches lead III → lead I, 3 s with no ECG recorded | "Monitor display changed" event; hatched "not recorded" stretch |
| ${clock(T.leadGapEnd)}–${clock(T.paceStart)} | Sinus bradycardia 48/min; **3.2 s pause** at ${clock(T.pause)} | HR low alarm; pause found; QT 440 |
| ${clock(T.paceStart)}–${clock(T.paceEnd)} | External pacing 70/min, wide paced complexes | Pacer marks on Monitor, snapshot ${clock(950)} and strips; pacing time 180 s |
| ${clock(T.paceStart - 20)} | Pads impedance falls from open circuit to ~92 Ω | "Possible patient pad contact" |
| ${clock(T.vfStart)}–${clock(T.shock)} | **VF**; arterial pressure collapses; CPR from ${clock(T.cprStart)} | Arterial low alarm; CPR tab populated |
| ${clock(T.cprStart)}–${clock(T.cprEnd)} | Compressions ~112/min (faster after ${clock(1200)}), depth ~2.2 in falling late, release ~410 mm/s; pause ${clock(T.cprPause0)}–${clock(T.cprPause1)}; ventilations 10/min | CPR rate, depth, release velocity, compression fraction ~94%; EtCO2 14–19 during CPR; coronary perfusion pressure from P1 diastolic (and P${NEURO ? '2' : '3'} CVP) |
| ${clock(T.shock - 8)} / ${clock(T.shock)} | AED **SHOCK ADVISED**, **Shock Delivered** 200 J | Device rhythm analysis; shock on CPR timeline |
| ${clock(T.shock)}–${clock(T.rosc)} | Organised rhythm 100/min with low pressure (PEA-like) while CPR continues | |
| ${clock(T.rosc)} | **ROSC**: EtCO2 jumps to 48 then settles to 38 | ROSC period; EtCO2 rise |
| ${clock(T.rosc)}–${clock(1500)} | Ventilated 12/min; **PPV ~17%**, SPV, pleth variation; pressure 84/50 rising | PPV ~17%, SPV, DPV (regular rhythm, ventilated 12/min), PVI 19; shock index; low NIBP 86/52 at ${clock(1270)} (alarm, red) |
| ${clock(T.desat0)}–${clock(T.desat1)} | SpO2 dips to 83% | SpO2 low alarm (red); hypoxic burden, T90, SpO2/FiO2 with a FiO2 entered |
| ${clock(T.pvc0)}–${clock(T.pvc1)} | A PVC every 14 beats with compensatory pause | Ectopy on the ECG; PPV and SPV withheld here (irregular rhythm) |
| ${clock(T.obstr0)}–${clock(T.obstr1)} | Bronchospasm-shaped capnogram (slow phase II, steep phase III) | Capnogram shape: phase III slope up, alpha angle wider |
| ${clock(1480)} | 12-lead ECG with ST elevation V2–V4 | 12-Lead tab |
| ${clock(T.probeOff)}–${clock(T.probeOn)} | **SpO2 probe disconnected**, no pleth recorded | Yellow box on SpO2/PI; hatched pleth |
| ${clock(T.tempOff)}–${clock(T.tempOn)} | **T1 probe disconnected** | Yellow box on T1; T1 gap in Trends |
| ${clock(T.apnea0)}–${clock(T.apnea1)} | **Apnoea 25 s**, no breaths, CO2 falls to 0 | Apnoea detected; no-breath flag |
| ${clock(T.high0)}–${clock(T.high1)} | Arterial systolic ~186 | Arterial high alarm (red) |
| whole case | P1 arterial (auto-detected), ${NEURO ? 'P2 CVP (auto-detected), P3 labelled ICP: raised ICP ~26; slow pressure waves throughout, with ICP moving against them before the arrest (intact autoregulation, PRx negative) and with them after ROSC (impaired, PRx positive)' : 'P2 labelled **PA** ~28/12, 34/15 after ROSC, P3 CVP ~8 (auto-detected)'} | ${NEURO ? 'CPP = MAP − ICP ~65; PRx negative before the arrest, positive after ROSC' : 'mPAP; CVP; site picker in Physiology'} |
| whole case | T1 core 98.6 → 97.1 °F, T2 skin 96.4 → 95.6 °F, ΔT | Temperatures in Monitor, Trends, Vitals |
| whole case | Patient 58 y male, 70 in, 180 lb | BSA (DuBois ~1.96 m²) |

Rolling device log: a "Battery Connected" from the previous day (should be dropped) and a
"Self Test Passed" from earlier the same morning (kept).
`;
fs.writeFileSync(OUT.replace(/\.zol$/i, '') + '.expected.md', sheet);
console.log('wrote', OUT, (fs.statSync(OUT).size/1048576).toFixed(1) + ' MB,', recs.length, 'records,', beats.length, 'beats,', breaths.length, 'breaths,', comps.length, 'compressions');
