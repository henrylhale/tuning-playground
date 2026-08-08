// Tests for snapshot normalization (quartet.html #region snapshot).
// Run: `npm test`  (node --test, zero dependencies).
//
// A snapshot is the atom of a sequence slot. normalizeSnapshot coerces any parsed object (a loaded
// JSON document, a hand-edited paste) into a clean snapshot shaped exactly like defaultSnapshot(defs),
// filling omitted fields from defaults and dropping extras — that is what keeps older/newer saved
// documents loadable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const { SCHEMA_VERSION, defaultSnapshot, normalizeSnapshot } = loadRegion('snapshot', [
  'SCHEMA_VERSION', 'VOICE_MODES', 'defaultSnapshot', 'normalizeSnapshot',
]);

// Stand-in for the app's appDefaults() — the region takes defaults as input so the app stays the
// single source of truth. Values mirror quartet.html's initial state.
const defs = {
  key: 220, root: 0, chord: 1, et: false, moveAll: true,
  vib: 3, jit: 4, shim: 0.04, vol: 0.45,
  voices: Array.from({ length: 4 }, () => ({
    f3: 2500, lvl: 1, bend: 0, mode: 'voice', mute: false, f1: 500, f2: 1500,
    bc: 0, tt: 0, lh: 0.5, vel: 0, lip: 0, tw: 0.2,
  })),
};

// A fully-populated, already-normalized snapshot with messy (chart-dragged) floats.
const full = () => normalizeSnapshot({
  key: 329.6275569128699, root: 4, chord: 2, et: true, moveAll: false,
  vib: 2.5, jit: 3.1, shim: 0.037, vol: 0.512,
  voicing: [[2, 0], [0, -1], [1, 1], [3, 0]],
  voices: [
    { bc: 0.0000000001, tt: 0.31, f3: 2503, lvl: 1.01, bend: 0.5, mode: 'voice',    mute: false, f1: 512.38, f2: 1487.99 },
    { bc: 0.34, tt: 0.71,  lh: 0.8, f3: 2310, lvl: 0.93, bend: 4.5, mode: 'sine',     mute: false, f1: 604.11, f2: 1801.77 },
    { bc: 1.00, vel: 0.55, tw: 0.9, f3: 2680, lvl: 1.12, bend: -3,  mode: 'sawtooth', mute: true,  f1: 447.90, f2: 1399.02 },
    { bc: 0.5,  lip: 0.83, tw: 0.0, f3: 2450, lvl: 0.88, bend: 2,   mode: 'triangle', mute: false, f1: 531.66, f2: 1622.50 },
  ],
}, defs);

test('a fully-specified object survives normalization intact', () => {
  const s = full();
  assert.equal(s.v, SCHEMA_VERSION);
  assert.equal(s.root, 4);
  assert.equal(s.chord, 2);
  assert.equal(s.et, true);
  assert.equal(s.key, 329.6275569128699);
  assert.deepEqual(s.voicing, [{ tone: 2, octave: 0 }, { tone: 0, octave: -1 }, { tone: 1, octave: 1 }, { tone: 3, octave: 0 }]);
  assert.equal(s.voices[2].mode, 'sawtooth');
  assert.equal(s.voices[2].mute, true);
});

test('BACKWARD compat: a document missing fields fills them from defaults', () => {
  // An older/partial save: only some globals + a couple of partial voices.
  const n = normalizeSnapshot({ key: 261.63, root: 2, voices: [{ f1: 480 }, { mode: 'sine' }] }, defs);
  assert.equal(n.key, 261.63);              // present globals survive
  assert.equal(n.root, 2);
  assert.equal(n.chord, defs.chord);        // absent global → default
  assert.equal(n.voices.length, 4);         // always four voices
  assert.equal(n.voices[0].f1, 480);        // present per-voice field survives
  assert.equal(n.voices[0].tw, defs.voices[0].tw);   // absent per-voice field → default
  assert.equal(n.voices[1].mode, 'sine');
  assert.equal(n.voices[3].f2, defs.voices[3].f2);
});

test('FORWARD compat: unknown fields are dropped', () => {
  const raw = { ...full(), mysteryFeature: 42, voices: [{ ...full().voices[0], futureKnob: 9 }] };
  const n = normalizeSnapshot(raw, defs);
  assert.ok(!('mysteryFeature' in n));
  assert.ok(!('futureKnob' in n.voices[0]));
});

test('bad types coerce to defaults', () => {
  const n = normalizeSnapshot({ key: 'abc', root: 2.7, et: 'yes', vol: NaN, voices: 'nope', voicing: 'x' }, defs);
  assert.equal(n.key, defs.key);
  assert.equal(n.root, 3);                  // 2.7 → rounded to a valid index
  assert.equal(n.et, defs.et);              // 'yes' is not a boolean → default
  assert.equal(n.vol, defs.vol);            // NaN → default
  assert.deepEqual(n.voices, defaultSnapshot(defs).voices);
  assert.deepEqual(n.voicing, []);          // non-array voicing → default (empty ⇒ app derives it)
});

test('null / garbage top-level input → full default snapshot', () => {
  assert.deepEqual(normalizeSnapshot(null, defs), defaultSnapshot(defs));
  assert.deepEqual(normalizeSnapshot(42, defs), defaultSnapshot(defs));
  assert.deepEqual(normalizeSnapshot(undefined, defs), defaultSnapshot(defs));
});

test('voicing accepts [tone,octave] pairs and {tone,octave} objects; drops invalid entries', () => {
  const n = normalizeSnapshot({ voicing: [[2, 1], { tone: 0, octave: -1 }, 'junk', { octave: 3 }, [-5, 0]] }, defs);
  assert.deepEqual(n.voicing, [
    { tone: 2, octave: 1 },
    { tone: 0, octave: -1 },
    { tone: 0, octave: 3 },   // missing tone → 0 (kept); 'junk' and [-5,0] (tone<0) dropped
  ]);
});

// The six Estill figures are the per-voice timbre state as of schema v2. They replaced {bri, nas}
// — the old source's falloff exponent and bandwidth fraction — and since a figure is a 0..1
// fraction by construction, the region clamps them rather than trusting whatever produced the file.
test('figures are clamped into 0..1', () => {
  const n = normalizeSnapshot({ voices: [{ bc: 1.4, tt: -0.2, lh: 0.5, tw: 'x' }] }, defs);
  assert.equal(n.voices[0].bc, 1);
  assert.equal(n.voices[0].tt, 0);
  assert.equal(n.voices[0].lh, 0.5);
  assert.equal(n.voices[0].tw, defs.voices[0].tw);   // non-numeric → default, then clamped
});

test('a v1 document loads with default figures rather than failing', () => {
  // v1 stored {bri, nas}; there is no brightness in the LF model to map them onto, so they are
  // dropped like any unknown field and the voice comes up on the default figure set.
  const n = normalizeSnapshot({ v: 1, key: 261.63, voices: [{ bri: 1.5, nas: 0.083, f1: 480 }] }, defs);
  assert.equal(n.v, SCHEMA_VERSION);
  assert.equal(n.voices[0].f1, 480);                 // fields v1 and v2 share still survive
  assert.ok(!('bri' in n.voices[0]));
  assert.equal(n.voices[0].bc, defs.voices[0].bc);
  assert.equal(n.voices[0].tw, defs.voices[0].tw);
});

test('invalid wave mode → default "voice"', () => {
  assert.equal(normalizeSnapshot({ voices: [{ mode: 'kazoo' }] }, defs).voices[0].mode, 'voice');
});
