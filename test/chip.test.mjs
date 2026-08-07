// Tests for the sequencer chord-chip derivation (quartet.html #region chip).
// Run: `npm test`  (node --test, zero dependencies).
//
// chipRows(snap, music) turns a snapshot's root+chord+voicing into the four stacked rows a chip
// shows: each PART's scale degree relative to the key (snapped to the nearest chromatic degree), in
// fixed part order — Tenor / Lead / Bari / Bass, top→bottom (bass on the bottom) — NOT sorted by
// pitch, so a row always means the same voice even when voices cross. voicing[i] is what part i
// sings (0=bass … 3=tenor), so rows are the voicing reversed. Tables are injected → testable, no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const { chipRows } = loadRegion('chip', ['chipRows']);

// A faithful slice of the app's real music tables (see quartet.html).
const rval   = s => { const [n, d] = s.split('/').map(Number); return n / d; };
const octRed = v => { while (v >= 2) v /= 2; while (v < 1) v *= 2; return v; };
const DEGREES = [
  {lab:'1',r:'1/1'},{lab:'♭2',r:'16/15'},{lab:'2',r:'9/8'},{lab:'♭3',r:'6/5'},
  {lab:'3',r:'5/4'},{lab:'4',r:'4/3'},{lab:'♯4',r:'7/5'},{lab:'5',r:'3/2'},
  {lab:'♭6',r:'8/5'},{lab:'6',r:'5/3'},{lab:'♭7',r:'9/5'},{lab:'7',r:'15/8'},
];
const CHORDS = [
  {name:'Maj',  r:['1/1','5/4','3/2','1/1']},
  {name:'Dom7', r:['1/1','5/4','3/2','7/4']},
];
const ITV = {'1/1':'R','9/8':'9','6/5':'♭3','5/4':'3','4/3':'11','7/5':'♯4','3/2':'5',
             '8/5':'♭6','5/3':'6','7/4':'♭7','9/5':'♭7','15/8':'7','16/15':'♭9','25/16':'♯5'};
const music = { DEGREES, CHORDS, ITV, rval, octRed };

const degs  = rows => rows.map(r => r.deg);
const roles = rows => rows.map(r => r.role);

test('root-position dom7 stacks in part order: tenor→bass = ♭7 5 3 1', () => {
  // voicing is bass→tenor [R, 3, 5, ♭7]; the chip is that reversed (tenor on top, bass on bottom).
  const snap = { root: 0, chord: 1, voicing: [[0,0],[1,0],[2,0],[3,0]] };
  const rows = chipRows(snap, music);
  assert.deepEqual(degs(rows),  ['♭7','5','3','1']);
  assert.deepEqual(roles(rows), ['♭7','5','3','R']);   // bottom row (bass) is the root
});

test('order is by PART, not pitch — bass stays on the bottom even when it is the highest voice', () => {
  // Push the bass (part 0) up two octaves so it sounds above everyone; it must still be the bottom row.
  const snap = { root: 0, chord: 1, voicing: [[0,2],[1,0],[2,0],[3,0]] };
  const rows = chipRows(snap, music);
  assert.equal(rows[3].role, 'R');         // bottom row is still the bass part (the root)
  assert.equal(rows[0].role, '♭7');        // top row is still the tenor part
});

test('scale degree is named in the key, but role is the chord-tone function', () => {
  // V (root on scale degree 5) major triad: its 3rd is scale-degree 7 (the leading tone).
  const snap = { root: 7, chord: 0, voicing: [[0,0],[1,0],[2,0]] };
  const rows = chipRows(snap, music);
  const third = rows.find(r => r.role === '3');
  assert.equal(third.deg, '7');            // named "7" in the key…
  assert.equal(third.role, '3');           // …but its role is the chord's 3rd
});

test('missing voicing falls back to root position (part i sings tone i)', () => {
  const rows = chipRows({ root: 0, chord: 1 }, music);
  assert.equal(rows.length, 4);
  assert.deepEqual(roles(rows), ['♭7','5','3','R']);   // tenor→bass, bass on the root
});

test('degree snapping is robust to JI detuning (never renames a note)', () => {
  // Major third of the ♭3 chord root: 6/5 · 5/4 = 3/2 → clean "5". A JI-detuned product must
  // still round to the nearest chromatic degree rather than falling off the table.
  const snap = { root: 3, chord: 0, voicing: [[1,0]] };   // the 3rd of a chord rooted on ♭3
  const rows = chipRows(snap, music);
  assert.equal(rows[0].deg, '5');
});
