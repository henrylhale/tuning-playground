// The voice model exists twice: it is developed in voice-synth.html, where the plots that make it
// inspectable live, and copied into quartet.html so four voices can run it. A copy is a liability —
// the failure mode is silent, and it is exactly the one that matters here, a quartet quietly
// synthesizing on an older voice than the single-voice instrument it is supposed to agree with.
//
// So: assert the copies are byte-identical, and then run the same behavioural checks against
// quartet's copy that lf-source.test.mjs and estill-map.test.mjs run against voice-synth's. The
// text comparison is what catches drift; the behavioural checks are what catch a copy that was
// pasted into a file where it doesn't actually work (a missing helper, a shadowed name).
//
// Run: `npm test`  (node --test, zero dependencies).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegion } from '../test-utils/load-region.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = ['lf-source', 'estill-map'];

function regionText(file, name) {
  const html = readFileSync(join(root, file), 'utf8');
  const m = html.match(new RegExp('//#region ' + name + '[\\s\\S]*?//#endregion ' + name));
  assert.ok(m, `region "${name}" not found in ${file}`);
  return m[0];
}

for (const name of SHARED) {
  test(`#region ${name} is identical in quartet.html and voice-synth.html`, () => {
    assert.equal(
      regionText('quartet.html', name),
      regionText('voice-synth.html', name),
      `#region ${name} has drifted between the two apps. Whichever copy you changed, copy it ` +
      `across verbatim rather than editing this test — the point of the region is that there is ` +
      `one model, not two.`,
    );
  });
}

// --- quartet's copy actually runs, and agrees with voice-synth's ------------------------------
const q = loadRegion(
  ['math-utils', ...SHARED],
  ['lfShape', 'lfSample', 'lfHarmonics', 'sourceFromFigures', 'tractFromFigures', 'pull'],
  'quartet.html',
);
const vs = loadRegion(
  ['math-utils', ...SHARED],
  ['lfShape', 'lfSample', 'sourceFromFigures', 'tractFromFigures'],
  'voice-synth.html',
);

const SINGER = { F4: 3500, F5: 4500, Fcluster: 2900, B: [50, 70, 110, 170, 250] };
const SCHWA = { F1: 500, F2: 1500, F3: 2500 };
const FIGS = { body_cover: 0.4, thyroid_tilt: 0.7, larynx_height: 0.65, twang: 0.8, velum: 0.3, lip_protrusion: 0.2 };

test('both copies derive the same source parameters from the same figures', () => {
  assert.deepEqual(q.sourceFromFigures(FIGS, 220), vs.sourceFromFigures(FIGS, 220));
});

test('both copies derive the same tract from the same figures', () => {
  assert.deepEqual(q.tractFromFigures(FIGS, SCHWA, SINGER), vs.tractFromFigures(FIGS, SCHWA, SINGER));
});

test('both copies produce the same glottal waveform', () => {
  const f0 = 196, s = q.sourceFromFigures(FIGS, f0);
  const pq = q.lfShape(f0, s.OQ, s.Rk, s.Ra), pv = vs.lfShape(f0, s.OQ, s.Rk, s.Ra);
  for (let i = 0; i < 64; i++) {
    const t = i / 64 * pq.T;
    assert.equal(q.lfSample(pq, t), vs.lfSample(pv, t), `sample ${i} differs`);
  }
});

// The quartet retunes constantly — every chord change rebuilds four waves — so what would hurt
// most is the solve failing to converge at some pitch and handing NaN to createPeriodicWave,
// which silences the voice rather than throwing. Sweep the range the key dial can reach.
test('the source solves cleanly across the whole playable range', () => {
  for (const bc of [0, 0.5, 1]) {
    for (const tt of [0, 0.5, 1]) {
      const s = q.sourceFromFigures({ ...FIGS, body_cover: bc, thyroid_tilt: tt }, 220);
      for (let midi = 24; midi <= 96; midi += 3) {
        const f0 = 440 * Math.pow(2, (midi - 69) / 12);
        const h = q.lfHarmonics(q.lfShape(f0, s.OQ, s.Rk, s.Ra), 64);
        for (let k = 1; k <= h.n; k++) {
          assert.ok(Number.isFinite(h.real[k]) && Number.isFinite(h.imag[k]),
            `non-finite harmonic ${k} at f0=${f0.toFixed(1)} bc=${bc} tt=${tt}`);
        }
      }
    }
  }
});
