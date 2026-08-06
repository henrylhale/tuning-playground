// Tests for voice-synth.html's LF glottal source (#region lf-source).
// Run: `npm test`  (node --test, zero dependencies).
//
// The LF model is defined by constraints, not by a formula you can eyeball: α is whatever makes
// net flow over the cycle zero, ε is whatever satisfies the return-phase area. Both come out of a
// numerical solve, so what's worth pinning is that the solve actually lands on those constraints,
// that the timing landmarks are where the parameterization says they are, and that the harmonic
// table handed to the PeriodicWave really is the spectrum of the waveform.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const { lfShape, lfSample, lfHarmonics, lfTiming, rdDiagnostic } = loadRegion(
  ['math-utils', 'lf-source'],
  ['lfShape', 'lfSample', 'lfHarmonics', 'lfTiming', 'rdDiagnostic'],
  'voice-synth.html',
);

// Corners of the exposed {OQ, Rk, Ra} space plus a middle-of-the-road setting.
const CASES = [
  { OQ: 0.45, Rk: 0.25, Ra: 0.004 },   // thick folds, no thyroid tilt
  { OQ: 0.68, Rk: 0.45, Ra: 0.075 },   // thin folds, full tilt
  { OQ: 0.60, Rk: 0.30, Ra: 0.010 },
  { OQ: 0.35, Rk: 0.15, Ra: 0.001 },   // extreme pressed
  { OQ: 0.95, Rk: 0.60, Ra: 0.030 },   // extreme open — Ra has to be clamped here
];
const F0S = [65.4, 220, 880];

const integrate = (p, n = 40000) => {
  let s = 0;
  for (let i = 0; i < n; i++) s += lfSample(p, (i + 0.5) / n * p.T);
  return s / n * p.T;
};

test('net flow over the cycle is zero', () => {
  // This is what α is solved for. Nonzero net flow means a DC offset in the glottal flow, i.e.
  // a glottis that never actually closes.
  for (const f0 of F0S) for (const c of CASES) {
    const p = lfShape(f0, c.OQ, c.Rk, c.Ra);
    const scale = 1 / f0;                       // area of a unit-depth pulse over one period
    assert.ok(Math.abs(integrate(p)) < 1e-6 * scale,
      `net flow ${integrate(p)} at f0=${f0} ${JSON.stringify(c)}`);
  }
});

test('the excitation instant is at te, with depth exactly Ee', () => {
  // te is *the* landmark: maximum negative derivative, and the moment the tract is struck.
  for (const c of CASES) {
    const p = lfShape(220, c.OQ, c.Rk, c.Ra);
    assert.ok(Math.abs(lfSample(p, p.te) + 1) < 1e-9, `E(te) = ${lfSample(p, p.te)}, want -1`);

    let min = 0, argmin = 0;
    for (let i = 0; i <= 20000; i++) {
      const t = i / 20000 * p.T, v = lfSample(p, t);
      if (v < min) { min = v; argmin = t; }
    }
    // Ee normalizes the waveform, so nothing may dip meaningfully below it…
    assert.ok(min > -1.05, `dipped to ${min}`);
    // …and the dip is at te (within a bin), except at the extreme open quotient where the
    // open-phase sinusoid overshoots slightly before closure.
    if (c.OQ < 0.9) assert.ok(Math.abs(argmin - p.te) < 2 * p.T / 20000, `min at t/te=${argmin / p.te}`);
  }
});

test('the waveform is continuous across te and closes at the period end', () => {
  for (const c of CASES) {
    const p = lfShape(220, c.OQ, c.Rk, c.Ra);
    // The step has to be scaled to ta: at Ra = 0.001 the return phase falls at ~2·10^5 per
    // second, so a fixed absolute step would read a legitimate slope as a discontinuity.
    const d = p.ta * 1e-6;
    assert.ok(Math.abs(lfSample(p, p.te - d) - lfSample(p, p.te + d)) < 1e-5, 'discontinuity at te');
    assert.ok(Math.abs(lfSample(p, p.T)) < 1e-9, `E(tc) = ${lfSample(p, p.T)}, want 0`);
    assert.ok(Math.abs(lfSample(p, 0)) < 1e-12, 'open phase must start from zero');
  }
});

test('te lands at exactly OQ·T, independent of Rk', () => {
  // Falls out of te = tp(1+Rk) with tp = 1/(2·Rg·f0) and Rg = (1+Rk)/(2·OQ). Worth pinning because
  // it is what makes OQ mean "fraction of the period the glottis is open" rather than something
  // that only approximately tracks it.
  for (const OQ of [0.35, 0.5, 0.68, 0.95]) for (const Rk of [0.15, 0.3, 0.6]) {
    const t = lfTiming(440, OQ, Rk, 0.004);
    assert.ok(Math.abs(t.te / t.T - OQ) < 1e-12, `te/T = ${t.te / t.T}, want ${OQ}`);
  }
});

test('ta is clamped, and flagged, when the return phase cannot fit', () => {
  // ε only has a root while ta < (1−OQ)·T. A wide-open glottis therefore caps how much spectral
  // tilt is reachable; the alternative to clamping is a NaN waveform.
  const loose = lfTiming(220, 0.5, 0.3, 0.02);
  assert.equal(loose.taClamped, false);
  assert.ok(Math.abs(loose.ta - 0.02 / 220) < 1e-15);

  const tight = lfTiming(220, 0.95, 0.3, 0.075);     // wants ta = 0.075T, has 0.05T of room
  assert.equal(tight.taClamped, true);
  assert.ok(tight.ta < tight.Ta, 'clamped ta must still fit inside the return window');
  const p = lfShape(220, 0.95, 0.3, 0.075);
  assert.ok(Number.isFinite(p.alpha) && Number.isFinite(p.eps), 'solve must stay finite');
});

test('the return-phase area constraint is satisfied', () => {
  // ε·ta = 1 − e^(−ε·Ta) is what makes ta the effective time constant of the return phase, which
  // is in turn what puts the spectral tilt knee at 1/(2π·ta).
  for (const c of CASES) {
    const p = lfShape(220, c.OQ, c.Rk, c.Ra);
    assert.ok(Math.abs(p.eps * p.ta - (1 - Math.exp(-p.eps * p.Ta))) < 1e-9);
  }
});

test('the harmonic table reproduces the waveform', () => {
  // lfHarmonics is what actually reaches the ear (via PeriodicWave), so it has to be the same
  // signal as lfSample — not merely a similar-looking spectrum. Checked by resynthesis, which
  // also fixes the cos/sin sign convention the coefficients are handed over in.
  const p = lfShape(220, 0.6, 0.3, 0.01);
  const h = lfHarmonics(p, 400);
  const at = t => {
    let v = 0;
    for (let k = 1; k <= h.n; k++) {
      v += h.real[k] * Math.cos(2 * Math.PI * k * t / p.T) + h.imag[k] * Math.sin(2 * Math.PI * k * t / p.T);
    }
    return v;
  };
  // Away from the corner at te the band-limited sum tracks the waveform closely.
  for (const frac of [0.1, 0.2, 0.3, 0.7, 0.85, 0.95]) {
    const t = frac * p.T;
    assert.ok(Math.abs(at(t) - lfSample(p, t)) < 0.02, `mismatch at t/T=${frac}: ${at(t)} vs ${lfSample(p, t)}`);
  }
  // …and it still resolves the excitation dip, just softened by band-limiting (Gibbs).
  assert.ok(at(p.te) < -0.85 && at(p.te) > -1.15, `excitation dip resynthesized as ${at(p.te)}`);
  // No DC: the LF period integrates to zero by construction, so H0 must not sneak back in.
  assert.equal(h.real[0], 0);
  assert.equal(h.imag[0], 0);
});

test('the harmonic table is band-limited to the requested count', () => {
  const p = lfShape(880, 0.5, 0.3, 0.01);
  const h = lfHarmonics(p, 22);
  assert.equal(h.n, 22);
  assert.equal(h.real.length, 23);
});

test('body-cover moves H1−H2 without touching spectral tilt', () => {
  // The point of exposing {OQ, Rk, Ra} rather than Fant's single Rd: thinning the folds must not
  // drag the spectral tilt along with it. This direction is clean, because body_cover is defined
  // to leave Ra alone — that axis is reserved for thyroid tilt.
  const db = v => 20 * Math.log10(Math.max(1e-12, v));
  const spectrum = (OQ, Rk, Ra) => {
    const p = lfShape(220, OQ, Rk, Ra);
    const h = lfHarmonics(p, 120);
    const mag = k => Math.hypot(h.real[k], h.imag[k]);
    return {
      h1h2: db(mag(1)) - db(mag(2)),
      slope: (db(mag(80)) - db(mag(20))) / Math.log2(80 / 20),
    };
  };
  // body_cover 0 → 1 (thick → thin) at fixed Ra
  const thick = spectrum(0.45, 0.25, 0.004), thin = spectrum(0.68, 0.45, 0.004);
  assert.ok(thin.h1h2 - thick.h1h2 > 4, `H1−H2 moved only ${thin.h1h2 - thick.h1h2} dB`);
  assert.ok(Math.abs(thin.slope - thick.slope) < 0.5, `tilt leaked: ${thick.slope} → ${thin.slope}`);
  // Thick folds sit near 0 dB; thin folds reach the pedagogy's ≈ +8 dB once tilt is added too.
  assert.ok(Math.abs(thick.h1h2) < 4, `thick folds should be near 0 dB, got ${thick.h1h2}`);
  assert.ok(spectrum(0.68, 0.45, 0.075).h1h2 > 7, 'thin + tilted should reach ≈ +8 dB');
});

test('thyroid tilt is the spectral-tilt axis, and its H1−H2 side effect is bounded', () => {
  // Ra 0.004 → 0.075 at fixed OQ/Rk: the slope steepens to the −12 dB/oct the model predicts
  // above the knee. It also shifts H1−H2 by a few dB, and that is *not* a leak to be fixed:
  // ta = Ra/f0, so at full tilt the knee lands at ≈2.1·f0 whatever the pitch — right on H2. The
  // orthogonality claim is about the parameters (Ra alone), not about spectral measures that
  // necessarily overlap once the knee descends into the first few harmonics.
  const db = v => 20 * Math.log10(Math.max(1e-12, v));
  const spectrum = (Ra) => {
    const p = lfShape(220, 0.45, 0.25, Ra);
    const h = lfHarmonics(p, 120);
    const mag = k => Math.hypot(h.real[k], h.imag[k]);
    return {
      h1h2: db(mag(1)) - db(mag(2)),
      slope: (db(mag(80)) - db(mag(20))) / Math.log2(80 / 20),
      knee: 1 / (2 * Math.PI * p.ta),
    };
  };
  const bright = spectrum(0.004), dark = spectrum(0.075);
  assert.ok(dark.slope < bright.slope - 2, `slope barely moved: ${bright.slope} → ${dark.slope}`);
  assert.ok(dark.slope > -13 && dark.slope < -11, `above the knee expect ≈ −12 dB/oct, got ${dark.slope}`);
  assert.ok(bright.knee > 5000 && dark.knee < 600, `knee ${bright.knee} → ${dark.knee} Hz`);
  assert.ok(dark.h1h2 - bright.h1h2 > 2 && dark.h1h2 - bright.h1h2 < 5,
    `H1−H2 side effect ${dark.h1h2 - bright.h1h2} dB is outside the known band`);
});

test('the tilt knee sits at 1/(2π·ta) and scales with pitch', () => {
  // ta = Ra/f0, so a fixed Ra is a fixed *fraction of the period* and the knee tracks f0.
  for (const f0 of [110, 220, 440]) {
    const p = lfShape(f0, 0.5, 0.3, 0.02);
    assert.ok(Math.abs(1 / (2 * Math.PI * p.ta) - f0 / (2 * Math.PI * 0.02)) < 1e-6);
  }
});

test('Rd is a readout only, and flags implausible corners', () => {
  // Natural speech runs roughly 0.3 (pressed) to 2.7 (breathy). It is deliberately not an input.
  assert.ok(Math.abs(rdDiagnostic(0.004) - (0.4 + 1) / 4.8) < 1e-12);
  assert.ok(rdDiagnostic(0.004) < 0.3, 'a very abrupt closure should read as outside speech stats');
  assert.ok(rdDiagnostic(0.075) > 1.5 && rdDiagnostic(0.075) < 2.7);
});
