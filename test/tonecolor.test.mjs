// Tests for the chord-tone → color mapping (quartet.html #region tonecolor).
// Run: `npm test`  (node --test, zero dependencies).
//
// toneColor(role) buckets a chord-tone role label by harmonic FUNCTION so the same function is the
// same color everywhere it shows (the sequencer chip stack and the voicing lattice). The buckets are
// root / third / fifth / sixth / seventh / ninth / eleventh, else a neutral fallback. Pure lookup, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const { toneClass, toneColor, TONE_COLORS } = loadRegion('tonecolor', ['toneClass', 'toneColor', 'TONE_COLORS']);

test('each named chord tone maps to its own function bucket', () => {
  assert.equal(toneClass('R'),  'root');
  assert.equal(toneClass('3'),  'third');
  assert.equal(toneClass('5'),  'fifth');
  assert.equal(toneClass('♭7'), 'seventh');
  assert.equal(toneClass('7'),  'seventh');
  assert.equal(toneClass('9'),  'ninth');
});

test('altered tones ride with their parent function', () => {
  assert.equal(toneClass('♭3'), 'third');    // minor third is still "the third"
  assert.equal(toneClass('♯4'), 'fifth');    // tritone read as an altered fifth
  assert.equal(toneClass('♯5'), 'fifth');
  assert.equal(toneClass('♭6'), 'sixth');
  assert.equal(toneClass('♭9'), 'ninth');
});

test('the eleventh is not mistaken for a root (its "1" would otherwise match)', () => {
  assert.equal(toneClass('11'), 'eleventh');
  assert.notEqual(toneClass('11'), 'root');
});

test('unknown labels fall back to neutral', () => {
  assert.equal(toneClass('?'),  'other');
  assert.equal(toneClass(''),   'other');
});

test('toneColor resolves a real hex for every bucket', () => {
  for (const role of ['R', '3', '♭3', '5', '♯4', '6', '♭7', '9', '11', '?']) {
    assert.match(toneColor(role), /^#[0-9a-f]{6}$/i, `role ${role}`);
  }
  // distinct functions get distinct colors (the whole point of the coding)
  assert.notEqual(toneColor('R'), toneColor('3'));
  assert.notEqual(toneColor('3'), toneColor('5'));
  assert.notEqual(toneColor('5'), toneColor('♭7'));
  assert.notEqual(toneColor('♭7'), toneColor('9'));
});
