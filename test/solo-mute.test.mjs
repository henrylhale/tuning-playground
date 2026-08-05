// Tests for the mute/solo state machine (quartet.html #region solo-mute).
// Run: `npm test`  (node --test, zero dependencies).
//
// The rule being pinned down: the only legal states are "0–4 mutes and no solo" or
// "one solo and exactly three mutes". Every click from every reachable state must land
// on one of those — that is what `exhaustive` below actually proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRegion } from '../test-utils/load-region.mjs';

const { soloIndex, applySolo, applyMute, isLegalState } = loadRegion('solo-mute', [
  'soloIndex', 'soloedStates', 'applySolo', 'applyMute', 'isLegalState',
]);

const N = 4;
// Build a state from mute flags, optionally soloing voice `solo`.
const S = (mutes, solo = -1) => mutes.map((m, k) => ({ muted: m, soloed: k === solo }));
const mutesOf = st => st.map(s => s.muted);
const nMuted  = st => st.filter(s => s.muted).length;
const nSoloed = st => st.filter(s => s.soloed).length;
const allOff  = () => S([false, false, false, false]);

test('the legality guard matches the spec', () => {
  assert.ok(isLegalState(allOff()));                          // 0 mutes, no solo
  assert.ok(isLegalState(S([true, true, true, true])));       // 4 mutes, no solo
  assert.ok(isLegalState(S([true, false, true, false])));     // some mutes, no solo
  assert.ok(isLegalState(S([true, false, true, true], 1)));   // 1 solo + its 3 mutes
  // ...and rejects the states the old code could reach
  assert.ok(!isLegalState(S([false, false, false, false], 1)), 'solo with nothing muted');
  assert.ok(!isLegalState(S([true, true, true, true], 1)), 'solo on a muted voice');
  const twoSolos = S([true, false, false, true]); twoSolos[1].soloed = twoSolos[2].soloed = true;
  assert.ok(!isLegalState(twoSolos), 'two solos at once');
});

test('solo lights one solo and exactly three mutes', () => {
  const { states } = applySolo(allOff(), 2, null);
  assert.equal(nSoloed(states), 1);
  assert.equal(soloIndex(states), 2);
  assert.equal(nMuted(states), 3);
  assert.equal(states[2].muted, false, 'the soloed voice is the audible one');
  assert.ok(isLegalState(states));
});

test('switching solo off restores the mutes from before it', () => {
  const before = S([true, false, false, true]);            // user had 1 and 4 muted
  const on = applySolo(before, 1, null);
  assert.deepEqual(on.saved, [true, false, false, true], 'mutes are snapshotted on the way in');
  const off = applySolo(on.states, 1, on.saved);
  assert.deepEqual(mutesOf(off.states), [true, false, false, true]);
  assert.equal(nSoloed(off.states), 0);
  assert.equal(off.saved, null);
});

test('moving solo to another voice keeps the original snapshot', () => {
  const before = S([false, true, false, false]);
  const a = applySolo(before, 0, null);
  const b = applySolo(a.states, 3, a.saved);               // move solo 0 → 3, no un-solo in between
  assert.equal(soloIndex(b.states), 3);
  assert.deepEqual(b.saved, [false, true, false, false], "still the pre-solo mutes, not solo 0's");
  const off = applySolo(b.states, 3, b.saved);
  assert.deepEqual(mutesOf(off.states), [false, true, false, false]);
});

test('un-soloing with no snapshot unmutes everything', () => {
  const st = S([true, true, false, true], 2);              // e.g. solo survived a reload
  const { states } = applySolo(st, 2, null);
  assert.deepEqual(mutesOf(states), [false, false, false, false]);
});

test('muting the soloed voice clears the solo and leaves four mutes', () => {
  const soloed = applySolo(allOff(), 0, null).states;
  const { states } = applyMute(soloed, 0, false);
  assert.equal(nSoloed(states), 0);
  assert.equal(nMuted(states), 4);
  assert.ok(isLegalState(states));
});

test('unmuting another voice while soloed clears the solo', () => {
  const soloed = applySolo(allOff(), 0, null).states;      // 0 audible, 1–3 muted
  const { states } = applyMute(soloed, 2, false);          // let voice 2 back in
  assert.equal(nSoloed(states), 0);
  assert.deepEqual(mutesOf(states), [false, true, false, true]);
  assert.ok(isLegalState(states));
});

test('mute toggles just that voice, and ganged mute drives all four', () => {
  const one = applyMute(allOff(), 1, false).states;
  assert.deepEqual(mutesOf(one), [false, true, false, false]);
  const ganged = applyMute(one, 0, true).states;           // voice 0 was unmuted → all mute
  assert.deepEqual(mutesOf(ganged), [true, true, true, true]);
  assert.deepEqual(mutesOf(applyMute(ganged, 0, true).states), [false, false, false, false]);
});

test('ganged mute out of a solo is still legal', () => {
  const soloed = applySolo(allOff(), 3, null).states;      // 3 unmuted, rest muted
  const { states } = applyMute(soloed, 3, true);           // clicking its mute, ganged → all mute
  assert.deepEqual(mutesOf(states), [true, true, true, true]);
  assert.equal(nSoloed(states), 0);
  assert.ok(isLegalState(states));
});

test('exhaustive: no sequence of clicks can reach an illegal state', () => {
  const key = (st, saved) => JSON.stringify([st, saved]);
  const start = { st: allOff(), saved: null };
  const seen = new Map([[key(start.st, start.saved), start]]);
  const queue = [start];

  while (queue.length) {
    const { st, saved } = queue.shift();
    for (let i = 0; i < N; i++) {
      for (const next of [
        applySolo(st, i, saved),
        applyMute(st, i, false),
        applyMute(st, i, true),
      ]) {
        assert.ok(isLegalState(next.states),
          `illegal state ${JSON.stringify(next.states)} reached from ${JSON.stringify(st)}`);
        const k = key(next.states, next.saved);
        if (!seen.has(k)) { seen.set(k, next); queue.push({ st: next.states, saved: next.saved }); }
      }
    }
  }
  // sanity: the walk really did explore, rather than passing by visiting nothing
  assert.ok(seen.size > 20, `expected a real state space, explored ${seen.size}`);
});
