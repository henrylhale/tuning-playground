// Tests for voice-synth.html's Estill figure → signal-parameter mapping (#region estill-map).
// Run: `npm test`  (node --test, zero dependencies).
//
// The model's organizing claim is that the figures are separately controllable and that the six
// voice qualities *emerge* from figure settings rather than being presets with their own code
// path. Those are testable claims, and they are what this file is for: cross-axis independence,
// and the quality fixtures landing where the pedagogy says they should.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const { sourceFromFigures, tractFromFigures, pull, QUALITIES } = loadRegion(
  ['math-utils', 'estill-map'],
  ['sourceFromFigures', 'tractFromFigures', 'pull', 'QUALITIES'],
  'voice-synth.html',
);

const SINGER = { F4: 3500, F5: 4500, Fcluster: 2900, B: [50, 70, 110, 170, 250] };
const NEUTRAL = { body_cover: 0, thyroid_tilt: 0, larynx_height: 0.5, twang: 0, velum: 0, lip_protrusion: 0 };
const SCHWA = { F1: 500, F2: 1500, F3: 2500 };
const RHOTIC = { F1: 474, F2: 1379, F3: 1571 };          // /ɝ/, "heard"
const figs = over => Object.assign({}, NEUTRAL, over);
const tract = (over, vowel = SCHWA) => tractFromFigures(figs(over), vowel, SINGER);

// --- source figures ------------------------------------------------------------------------

test('body-cover drives OQ and Rk, and leaves Ra alone', () => {
  const thick = sourceFromFigures(figs({ body_cover: 0 }), 220);
  const thin = sourceFromFigures(figs({ body_cover: 1 }), 220);
  assert.ok(Math.abs(thick.OQ - 0.45) < 1e-12 && Math.abs(thin.OQ - 0.68) < 1e-12);
  assert.ok(Math.abs(thick.Rk - 0.25) < 1e-12 && Math.abs(thin.Rk - 0.45) < 1e-12);
  assert.equal(thick.Ra, thin.Ra, 'body-cover must not touch Ra — that axis belongs to thyroid tilt');
});

test('thyroid tilt drives Ra alone', () => {
  const vertical = sourceFromFigures(figs({ thyroid_tilt: 0 }), 220);
  const tilted = sourceFromFigures(figs({ thyroid_tilt: 1 }), 220);
  assert.ok(Math.abs(vertical.Ra - 0.004) < 1e-12 && Math.abs(tilted.Ra - 0.075) < 1e-12);
  // In a real larynx thyroid tilt also raises OQ. That coupling is deliberately suppressed here,
  // and this assertion is what stops it being quietly "fixed" back in.
  assert.equal(vertical.OQ, tilted.OQ, 'thyroid tilt must not move OQ');
  assert.equal(vertical.Rk, tilted.Rk, 'thyroid tilt must not move Rk');
});

test('OQ is pitch-invariant while cricoid tilt is set aside', () => {
  // Cricoid tilt was the only thing that made the source depend on f0, so with it gone OQ is
  // whatever body-cover said, at every pitch. This test exists to pin that it is genuinely gone
  // rather than silently half-working — the previous version asserted a 0.15-per-octave drift
  // above a global 220 Hz reference, which is exactly the behaviour that was withdrawn.
  //
  // To restore: put F0_REF in the singer config (per part, not global — with max(0, …) a bass
  // never drifted at all), reinstate
  //     drift = max(0, K_DRIFT · log2(f0/F0_REF) · (1 − cricoid_tilt))
  // and bring back the Belt-emergence test below.
  const at = f0 => sourceFromFigures(figs({}), f0);
  const ref = at(220);
  for (const f0 of [55, 110, 220, 440, 880, 1046.5]) {
    assert.equal(at(f0).drift, 0, `drift reappeared at ${f0} Hz`);
    assert.equal(at(f0).OQ, ref.OQ, `OQ moved with pitch at ${f0} Hz`);
    assert.equal(at(f0).Rk, ref.Rk);
    assert.equal(at(f0).Ra, ref.Ra);
  }
  // A stray cricoid_tilt key left in an old preset must not quietly do anything either.
  assert.equal(sourceFromFigures(figs({ cricoid_tilt: 1 }), 880).OQ, ref.OQ);
});

test('Belt is still reachable, but no longer has to emerge', () => {
  // The spec calls Belt-at-440 the model's main correctness test: OQ must stay near 0.45 instead
  // of drifting up. Nothing makes OQ depend on f0 now, so that claim is vacuous rather than
  // proven — this test says only that the recipe still lands where the pedagogy wants it, and
  // records that the real assertion is on hold with the figure.
  const belt = sourceFromFigures(figs(QUALITIES["Belt"]), 440);
  assert.ok(Math.abs(belt.OQ - 0.45) < 1e-9, `Belt at 440 Hz has OQ ${belt.OQ}, want 0.45`);
  assert.ok(Math.abs(sourceFromFigures(figs(QUALITIES["Belt"]), 880).OQ - 0.45) < 1e-9);
  const t = tract(QUALITIES["Belt"]);
  assert.ok(t.eeBonus > 1.6, 'near-full twang');
  assert.ok(t.F[0] > tract(QUALITIES["Speech"]).F[0], 'a high larynx raises F1');
});

test('OQ stays inside the range the LF solve can handle', () => {
  for (const bc of [0, 0.5, 1]) for (const f0 of [65.4, 220, 1046.5]) {
    const s = sourceFromFigures(figs({ body_cover: bc }), f0);
    assert.ok(s.OQ >= 0.35 && s.OQ <= 0.95, `OQ ${s.OQ} out of range`);
  }
});

test('the onset/offset figure is gone, both halves', () => {
  // Notes fade in and out over a fixed 60 ms now. That fade is not an attack shape, and the
  // point of this test is that no onset table survives for something to start reading again:
  // asking the region for one has to fail outright.
  assert.throws(
    () => loadRegion(['math-utils', 'estill-map'], ['ONSETS'], 'voice-synth.html'),
    /ONSETS is not defined/,
    'an ONSETS table came back — the figure is being modeled again',
  );
});

// --- filter figures ------------------------------------------------------------------------

test('twang collapses F3/F4/F5 onto the cluster and leaves F1/F2 alone', () => {
  const wide = tract({ twang: 0 }), narrow = tract({ twang: 1 });
  assert.ok(Math.abs(wide.F[0] - narrow.F[0]) < 1e-9, 'twang must not move F1');
  assert.ok(Math.abs(wide.F[1] - narrow.F[1]) < 1e-9, 'twang must not move F2');
  // Three resonances inside one ~600 Hz band is what sums into a singer's formant.
  const spread = Math.max(...narrow.F.slice(2, 5)) - Math.min(...narrow.F.slice(2, 5));
  assert.ok(spread < 600, `cluster spread ${spread} Hz is too wide to sum`);
  assert.ok(spread < (Math.max(...wide.F.slice(2, 5)) - Math.min(...wide.F.slice(2, 5))) / 2);
  for (const F of narrow.F.slice(2, 5)) assert.ok(Math.abs(F - SINGER.Fcluster) < 400);
  // And the cluster narrows as it forms.
  for (const i of [2, 3, 4]) assert.ok(narrow.B[i] < wide.B[i], `B${i + 1} should narrow with twang`);
});

test('an articulatorily-held F3 is exempt from the cluster', () => {
  // A rhotic /ɝ/ holds F3 near 1570 Hz from a front-cavity resonance, which has nothing to do
  // with the epilarynx. It must stay put, leaving a two-member cluster — which is exactly why
  // rhotic vowels ring poorly and why choral practice defers the /r/ to the release.
  const r = tract({ twang: 1 }, RHOTIC);
  assert.equal(pull(RHOTIC.F3), 0, '/ɝ/ should be fully exempt');
  assert.ok(Math.abs(r.F[2] - RHOTIC.F3) < 1e-9, 'a rhotic F3 must not be pulled');
  assert.ok(r.F[2] < 1800, `F3 drifted to ${r.F[2]}`);
  assert.equal(r.B[2], SINGER.B[2], 'an exempt F3 should not narrow either');
  // Its F4/F5 still cluster; that is the two-member version.
  assert.ok(Math.abs(r.F[3] - SINGER.Fcluster) < 300 && Math.abs(r.F[4] - SINGER.Fcluster) < 500);
});

test('the pull weight ramps rather than switching', () => {
  assert.equal(pull(2500), 1);
  assert.equal(pull(2200), 1);
  assert.ok(Math.abs(pull(1950) - 0.5) < 1e-9);
  assert.equal(pull(1700), 0);
  assert.equal(pull(1200), 0);
});

test('twang pays the Ee bonus that makes it worth doing', () => {
  // Loud output for cheap glottal effort — the behavior, not just the spectrum. A one-way
  // source→filter chain cannot derive it, so it is hardcoded; omitting it would leave twang
  // sounding like an EQ curve.
  assert.equal(tract({ twang: 0 }).eeBonus, 1);
  assert.ok(Math.abs(20 * Math.log10(tract({ twang: 1 }).eeBonus) - 4.6) < 0.2, '≈ +4.6 dB at full twang');
});

test('larynx height scales the tract, harder on F1/F2 than on the epilarynx cluster', () => {
  const low = tract({ larynx_height: 0 }), mid = tract({ larynx_height: 0.5 }), high = tract({ larynx_height: 1 });
  assert.ok(Math.abs(mid.F[0] - SCHWA.F1) < 1e-9, 'mid larynx is the unscaled reference');
  assert.ok(high.F[0] > mid.F[0] && mid.F[0] > low.F[0]);
  assert.ok(Math.abs(high.F[0] / SCHWA.F1 - 1.12) < 1e-9);
  assert.ok(Math.abs(low.F[0] / SCHWA.F1 - 0.88) < 1e-9);
  // Half weight above F2: the epilarynx tube's length changes less than the whole tract's.
  // (Read off F, not Ftarget — Ftarget is the raw request the rails' drag handles set.)
  const relF1 = high.F[0] / low.F[0], relF4 = high.F[3] / low.F[3];
  assert.ok(relF4 < relF1 && relF4 > 1, `F4 scaling ${relF4} should be positive but weaker than F1's ${relF1}`);
});

test('lip protrusion lowers everything, least of all F1', () => {
  const spread = tract({ lip_protrusion: 0 }), round = tract({ lip_protrusion: 1 });
  for (let i = 0; i < 5; i++) assert.ok(round.F[i] < spread.F[i], `F${i + 1} should fall with protrusion`);
  const dropF1 = 1 - round.F[0] / spread.F[0], dropF2 = 1 - round.F[1] / spread.F[1];
  assert.ok(dropF1 < dropF2, 'F1 is back-cavity dominated and should move least');
  assert.ok(Math.abs(dropF2 - 0.05) < 1e-9);
});

test('velum separates a pole/zero pair that is otherwise an exact bypass', () => {
  const raised = tract({ velum: 0 });
  assert.equal(raised.nasal.FNP, raised.nasal.FNZ,
    'with the velum raised the pair must be coincident, i.e. cancel to unity');
  assert.equal(raised.gainCorrection, 1);
  assert.equal(raised.B[0], SINGER.B[0]);

  // Mid is a real trained option, so the separation has to be continuous, not a switch.
  const mid = tract({ velum: 0.5 }), low = tract({ velum: 1 });
  assert.ok(mid.nasal.FNZ > raised.nasal.FNZ && low.nasal.FNZ > mid.nasal.FNZ);
  assert.equal(low.nasal.FNZ, 450);
  assert.equal(low.nasal.FNP, 270, 'the nasal pole is fixed; only the zero moves');
  // Bandwidth widening is kept, but demoted: real damping, not the perceptual cue.
  assert.ok(Math.abs(low.B[0] / SINGER.B[0] - 2.4) < 1e-9);
  assert.ok(low.gainCorrection < raised.gainCorrection);
  // Nothing else about the tract may move with the velum.
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(low.F[i] - raised.F[i]) < 1e-9, `velum moved F${i + 1}`);
});

test('Ftarget stays the raw request, whatever the figures do to it', () => {
  // The resonance rails draw each drag handle at Ftarget and set the raw value from where it is
  // dropped. If Ftarget were the post-scaling frequency, a handle would snap away from the
  // pointer by the tract-length scale on the very next redraw.
  const t = tract({ larynx_height: 1, lip_protrusion: 1, twang: 1 });
  assert.deepEqual([...t.Ftarget], [SCHWA.F1, SCHWA.F2, SCHWA.F3, SINGER.F4, SINGER.F5]);
  for (let i = 0; i < 5; i++) assert.notEqual(t.F[i], t.Ftarget[i], `F${i + 1} should have moved`);
});

test('bandwidths are singer constants, moved only by nasality and twang', () => {
  // With every figure neutral the bandwidths must be exactly the voice-type table. Only two
  // things are allowed to modulate them anywhere: the velum widens B1, and twang narrows the
  // cluster members. B2 in particular has no modulator at all and must never move.
  assert.deepEqual([...tract({}).B], SINGER.B);
  for (const over of [{ velum: 1 }, { twang: 1 }, { larynx_height: 1 }, { lip_protrusion: 1 },
                      { body_cover: 1 }, { thyroid_tilt: 1 }]) {
    assert.equal(tract(over).B[1], SINGER.B[1], `B2 moved under ${JSON.stringify(over)}`);
  }
  // Larynx height and lip protrusion move centres, so they must leave every bandwidth alone.
  for (const over of [{ larynx_height: 0 }, { larynx_height: 1 }, { lip_protrusion: 1 }]) {
    assert.deepEqual([...tract(over).B], SINGER.B, `bandwidths moved under ${JSON.stringify(over)}`);
  }
});

// --- the qualities are recipes, not implementations ------------------------------------------

test('every quality fixture is a complete, in-range figure recipe', () => {
  const required = ['body_cover', 'thyroid_tilt', 'larynx_height', 'twang', 'velum'];
  for (const [name, q] of Object.entries(QUALITIES)) {
    for (const k of required) {
      assert.ok(k in q, `${name} is missing ${k}`);
      assert.ok(q[k] >= 0 && q[k] <= 1, `${name}.${k} = ${q[k]} out of range`);
    }
    // lip_protrusion is not part of the fixture table and must be left wherever the user put it.
    assert.ok(!('lip_protrusion' in q), `${name} should not dictate lip protrusion`);
    // Set aside with the figure — putting it back has to be a deliberate edit here too.
    assert.ok(!('cricoid_tilt' in q), `${name} still carries a cricoid_tilt setting`);
  }
  assert.ok(!('Falsetto' in QUALITIES), 'falsetto needs aspiration and must not be faked');
});

test('the qualities land where the pedagogy says they should', () => {
  const q = name => ({ src: sourceFromFigures(figs(QUALITIES[name]), 220), tr: tract(QUALITIES[name]) });
  const speech = q('Speech'), sob = q('Sob / Cry'), twang = q('Twang'), opera = q('Opera'), belt = q('Belt');

  // Sob/cry is thin folds plus full thyroid tilt: the darkest, most open source in the set.
  assert.ok(sob.src.Ra > 0.07 && sob.src.OQ > 0.6);
  assert.ok(sob.src.Ra > speech.src.Ra && sob.src.OQ > speech.src.OQ);
  // …on a low larynx, which lengthens the tract.
  assert.ok(sob.tr.F[0] < speech.tr.F[0]);

  // Twang is the AES figure taken to its limit: maximum ring for minimum effort.
  assert.ok(twang.tr.eeBonus > opera.tr.eeBonus && opera.tr.eeBonus > speech.tr.eeBonus);
  const spread = t => Math.max(...t.F.slice(2, 5)) - Math.min(...t.F.slice(2, 5));
  assert.ok(spread(twang.tr) < spread(speech.tr) / 2);

  // Opera is a low larynx *plus* strong twang — a long tract that still rings.
  assert.ok(opera.tr.F[0] < speech.tr.F[0] && opera.tr.eeBonus > 1.5);

  // Belt is the loud end: thick folds, high larynx, near-full twang.
  assert.ok(belt.src.OQ < sob.src.OQ, 'belt is pressed where sob is open');
});
