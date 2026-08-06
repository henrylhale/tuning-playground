// Tests for the Great Tags plain-text importer (quartet.html #region tagimport).
// Run: `npm test`  (node --test, zero dependencies).
//
// parseTag reads the stacked-voice text (Tenor / Lead / <lyric> / Bari / Bass per phrase, key in [..]
// on line 1). Voice tokens are major-scale degrees 1–7 with '+'/'-' = sharp/flat and '↑'/'↓' = octave
// (ignored for pitch class). detectChord picks the best (root, quality) from the app's vocabulary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const { parseTag, detectChord, tagTokenPC } = loadRegion('tagimport', ['parseTag', 'detectChord', 'tagTokenPC']);

// A faithful slice of the app's music tables for detectChord.
const rval   = s => { const [n, d] = s.split('/').map(Number); return n / d; };
const octRed = v => { while (v >= 2) v /= 2; while (v < 1) v *= 2; return v; };
const CHORDS = [
  {name:'Maj',  r:['1/1','5/4','3/2','1/1']},
  {name:'Dom7', r:['1/1','5/4','3/2','7/4']},
  {name:'Min',  r:['1/1','6/5','3/2','1/1']},
];
const music = { CHORDS, rval, octRed };

test("'+' is a sharp, '-' is a flat, arrows are octaves (ignored for pitch class)", () => {
  assert.equal(tagTokenPC('1'),   0);   // tonic
  assert.equal(tagTokenPC('3'),   4);   // major third
  assert.equal(tagTokenPC('-3'),  3);   // ♭3
  assert.equal(tagTokenPC('+4'),  6);   // ♯4
  assert.equal(tagTokenPC('-6'),  8);   // ♭6
  assert.equal(tagTokenPC('↑1'),  0);   // octave up — same pitch class
  assert.equal(tagTokenPC('↓+4'), 6);   // octave-down ♯4 — still ♯4's pitch class
});

test('parseTag pulls the key from the first line and stacks four voices per column', () => {
  const text = [
    'Little Tag [E♭] (arr. someone)',
    '',
    '  4  3',    // Tenor
    '  5  1',    // Lead
    'sing it!',  // lyrics (ignored)
    '  7  5',    // Bari
    '  2  1',    // Bass
  ].join('\n');
  const { key, chords } = parseTag(text);
  assert.equal(key, 'E♭');
  assert.equal(chords.length, 2);
  // column 0 = parts [Tenor, Lead, Bari, Bass] = degrees [4,5,7,2]
  assert.deepEqual(chords[0].parts, [5, 7, 11, 2]);   // semitones: 4→5, 5→7, 7→11, 2→2
  assert.deepEqual(chords[1].parts, [4, 0, 7, 0]);    // 3→4, 1→0, 5→7, 1→0
});

test('octave arrows are carried alongside the pitch class (net ↑ minus ↓)', () => {
  const text = ['t [C]', '', ' ↑1  1', '  1  1', 'la', ' ↓1 ↑↑1', '  1  1'].join('\n');
  const { chords } = parseTag(text);
  assert.deepEqual(chords[0].parts, [0, 0, 0, 0]);   // all tonic — arrows never change pitch class
  assert.deepEqual(chords[0].arr,   [1, 0, -1, 0]);  // tenor ↑, bari ↓; others none
  assert.deepEqual(chords[1].arr,   [0, 0, 2, 0]);   // bari ↑↑ = +2 octaves
});

test('detectChord recovers a V7 (dominant seventh) from its four scale degrees', () => {
  // degrees 4,5,7,2 over the key = A♭,B♭,D,F = a B♭ dominant 7th → root on scale-degree 5, quality Dom7
  const det = detectChord([5, 7, 11, 2], music);
  assert.equal(det.root, 7);            // scale degree "5" (7 semitones)
  assert.equal(CHORDS[det.chord].name, 'Dom7');
  assert.equal(det.exact, true);
});

test('detectChord finds a plain triad and marks it exact', () => {
  const det = detectChord([0, 4, 7], music);   // 1,3,5 = major triad on the tonic
  assert.equal(det.root, 0);
  assert.equal(CHORDS[det.chord].name, 'Maj');
  assert.equal(det.exact, true);
});

test('a block without four voice lines contributes no chords, and warns', () => {
  const text = 'x [C]\n\n 1 2\n 3 4\nlyric only\n';   // only two voice lines
  const { chords, warnings } = parseTag(text);
  assert.equal(chords.length, 0);
  assert.ok(warnings.length >= 1, 'should surface a warning');
  assert.match(warnings[0], /expected 4/);
});

test('swipe: a voice moves through notes (X ~ Y) while the others hold (------)', () => {
  // Columns must line up: the swipe run sits under the ------ holds. Tenor/Lead/Bass hold across the swipe.
  const text = [
    's [C]',
    '',
    ' 1  1 ------ 1',   // Tenor: 1, 1, [hold hold], 1
    ' 3  3 ------ 3',   // Lead
    'la la  swipe  x',  // lyric
    ' 5  5  6 ~ 7  5',  // Bari: 5, 5, then swipe 6→7, then 5
    ' 1  1 ------ 1',   // Bass
  ].join('\n');
  const { chords } = parseTag(text);
  // beats: [1,3,5,1]  [1,3,5,1]  [hold,hold,6,hold]  [hold,hold,7,hold]  [1,3,5,1]
  assert.equal(chords.length, 5);
  assert.deepEqual(chords.map(c => c.parts[2]), [7, 7, 9, 11, 7]);   // bari: 5,5,6,7,5 in semitones
  assert.deepEqual(chords[2].parts, [0, 4, 9, 0]);   // during the swipe T/L/Bs hold 1/3/1, bari on 6
  assert.deepEqual(chords[3].parts, [0, 4, 11, 0]);  // bari swipes up to 7, others still holding
});
