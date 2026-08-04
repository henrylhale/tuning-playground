// Tests for the save-state codec (quartet.html #region state-codec).
// Run: `npm test`  (node --test, zero dependencies).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const {
  SCHEMA_VERSION, HEADER_LEN, defaultSnapshot, normalizeSnapshot,
  packSnapshot, unpackSnapshot, encodeSnapshot, decodeSnapshot,
} = loadRegion('state-codec', [
  'SCHEMA_VERSION', 'HEADER_LEN', 'VOICE_MODES',
  'defaultSnapshot', 'normalizeSnapshot', 'packSnapshot', 'unpackSnapshot', 'encodeSnapshot', 'decodeSnapshot',
]);

const f32 = Math.fround;   // the exact Float32 value a double packs to

// Stand-in for the app's appDefaults() — the codec takes defaults as input so the app stays
// the single source of truth. Values mirror quartet.html's initial state.
const defs = {
  key: 220, root: 0, chord: 1, et: false, moveAll: true,
  vib: 3, jit: 4, shim: 0.04, vol: 0.45,
  voices: Array.from({ length: 4 }, () => ({
    bri: 1.2, nas: 0.06, f3: 2500, lvl: 1, bend: 0, mode: 'voice', mute: false, f1: 500, f2: 1500,
  })),
};

// A fully-populated, already-normalized snapshot with messy (chart-dragged) floats.
const full = () => normalizeSnapshot({
  key: 329.6275569128699, root: 4, chord: 2, et: true, moveAll: false,
  vib: 2.5, jit: 3.1, shim: 0.037, vol: 0.512,
  voicing: [[2, 0], [0, -1], [1, 1], [3, 0]],
  voices: [
    { bri: 1.2000000000001, nas: 0.061, f3: 2503, lvl: 1.01, bend: 0.5, mode: 'voice',    mute: false, f1: 512.3847726, f2: 1487.99201 },
    { bri: 1.34, nas: 0.071, f3: 2310, lvl: 0.93, bend: 4.5, mode: 'sine',     mute: false, f1: 604.11,  f2: 1801.7733 },
    { bri: 1.05, nas: 0.055, f3: 2680, lvl: 1.12, bend: -3,  mode: 'sawtooth', mute: true,  f1: 447.9,   f2: 1399.02 },
    { bri: 1.5,  nas: 0.083, f3: 2450, lvl: 0.88, bend: 2,   mode: 'triangle', mute: false, f1: 531.66,  f2: 1622.5 },
  ],
}, defs);

test('pack → unpack round-trips: discrete exact, floats to Float32', () => {
  const s = full();
  const out = unpackSnapshot(packSnapshot(s));
  // discrete fields: exact
  assert.equal(out.v, SCHEMA_VERSION);
  assert.equal(out.root, s.root);
  assert.equal(out.chord, s.chord);
  assert.equal(out.et, s.et);
  assert.equal(out.moveAll, s.moveAll);
  s.voicing.forEach((slot, i) => assert.deepEqual(out.voicing[i], [slot.tone, slot.octave]));
  // continuous fields: exactly the Float32 image of the input
  assert.equal(out.key, f32(s.key));
  assert.equal(out.vib, f32(s.vib));
  assert.equal(out.shim, f32(s.shim));
  assert.equal(out.vol, f32(s.vol));
  s.voices.forEach((v, i) => {
    assert.equal(out.voices[i].mode, v.mode);
    assert.equal(out.voices[i].mute, v.mute);
    for (const k of ['bri', 'nas', 'f3', 'lvl', 'bend', 'f1', 'f2']) {
      assert.equal(out.voices[i][k], f32(v[k]), `voice ${i} ${k}`);
    }
  });
});

test('Float32 precision is far finer than any control needs', () => {
  // representative audio values keep ~7 significant figures through the round trip
  for (const x of [329.6275569128699, 1487.99201, 0.0612345, 1.2000001, 2503.7]) {
    const rel = Math.abs(f32(x) - x) / Math.abs(x);
    assert.ok(rel < 1e-6, `${x} lost too much: rel=${rel}`);
  }
});

test('encode → decode round-trips through deflate (Float32 precision)', async () => {
  const s = full();
  const out = await decodeSnapshot(await encodeSnapshot(s));
  assert.equal(out.chord, s.chord);
  assert.equal(out.voices[0].mode, s.voices[0].mode);
  assert.equal(out.voices[2].mute, s.voices[2].mute);
  assert.equal(out.voices[1].f2, f32(s.voices[1].f2));
  assert.equal(out.key, f32(s.key));
});

test('encoding is deterministic and URL-safe', async () => {
  const s = full();
  assert.equal(await encodeSnapshot(s), await encodeSnapshot(s));   // same state ⇒ same link
  assert.match(await encodeSnapshot(s), /^[A-Za-z0-9_-]+$/);        // base64url: no + / =
});

test('even a fully-custom state stays a short link', async () => {
  const hash = await encodeSnapshot(full());
  assert.ok(hash.length < 210, `hash was ${hash.length} chars`);   // packed f32 caps ~192
});

test('BACKWARD compat: a truncated/older buffer still loads (missing floats → defaults)', () => {
  // Simulate an older/shorter build: header + only the 5 global floats, per-voice floats absent.
  const short = packSnapshot(full()).slice(0, HEADER_LEN + 5 * 4);
  const n = normalizeSnapshot(unpackSnapshot(short), defs);
  assert.equal(n.key, f32(full().key));         // globals that were present survive
  assert.equal(n.voices.length, 4);
  assert.equal(n.voices[0].bri, defs.voices[0].bri);  // absent per-voice floats → defaults
  assert.equal(n.voices[3].f2, defs.voices[3].f2);
  assert.equal(n.voices[0].mode, full().voices[0].mode); // modes/mutes live in the header, so preserved
});

test('decodeSnapshot rejects corrupt input (the app then keeps the default state)', async () => {
  await assert.rejects(() => decodeSnapshot('!!!not-base64-or-deflate!!!'));
});

// ---- normalizeSnapshot (pure, DOM-free) compat + coercion ----

test('FORWARD compat: unknown fields in a decoded object are dropped', () => {
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

test('invalid wave mode → default "voice"', () => {
  assert.equal(normalizeSnapshot({ voices: [{ mode: 'kazoo' }] }, defs).voices[0].mode, 'voice');
});
