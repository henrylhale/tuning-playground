// Tests for the iOS silent-switch fix (quartet.html #region audio-session).
// Run: `npm test`  (node --test, zero dependencies).
//
// The bug: iOS gives every page an "ambient" audio session, which the ringer/silent switch
// mutes — so an iPhone with the switch flipped plays nothing from Web Audio. The fix asks for
// a "playback" session, which the switch doesn't touch.
//
// None of that behaviour is observable off an iPhone, so what these tests actually pin down is
// the part that IS testable anywhere: that we ask, that we ask correctly, that we survive
// browsers with no AudioSession API, and that all three apps ask in the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadRegion } from '../test-utils/load-region.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = f => readFileSync(join(here, '..', f), 'utf8');

const { requestPlaybackSession } = loadRegion('audio-session', ['requestPlaybackSession']);

// A stand-in for Safari's navigator.audioSession: a settable `type` that starts where iOS
// starts it. `auto` resolves to an ambient (switch-muted) session on iOS — that's the bug state.
const iosNavigator = (type = 'auto') => ({ audioSession: { type } });

test('an iOS-shaped session is moved to playback', () => {
  const nav = iosNavigator();
  assert.equal(requestPlaybackSession(nav), 'set');
  assert.equal(nav.audioSession.type, 'playback');
});

test('a session that was reset to ambient mid-session is moved back', () => {
  // What happens after a phone call or Siri: iOS hands the page an ambient session again, and
  // the next interaction has to re-assert playback or the app goes quiet with the switch on.
  const nav = iosNavigator('ambient');
  assert.equal(requestPlaybackSession(nav), 'set');
  assert.equal(nav.audioSession.type, 'playback');
});

test('an existing playback session is left alone', () => {
  // Assigning on every interaction would churn the session for no reason; the common case is a
  // no-op. Proven by a session whose setter would throw if touched.
  const audioSession = {
    get type() { return 'playback'; },
    set type(v) { throw new Error('must not reassign an already-playback session'); },
  };
  assert.equal(requestPlaybackSession({ audioSession }), 'already');
});

test('browsers without the AudioSession API are untouched, not crashed', () => {
  // Chrome, Firefox, desktop everything, and iOS < 16.4. The apps must open and sound normally.
  assert.equal(requestPlaybackSession({}), 'unsupported');
  assert.equal(requestPlaybackSession({ audioSession: undefined }), 'unsupported');
  assert.equal(requestPlaybackSession(undefined), 'unsupported');
  assert.equal(requestPlaybackSession(null), 'unsupported');
  // Present but not the shape we expect — treat as unsupported rather than poking at it.
  assert.equal(requestPlaybackSession({ audioSession: {} }), 'unsupported');
  assert.equal(requestPlaybackSession({ audioSession: { type: 42 } }), 'unsupported');
});

test('a refusing or throwing implementation degrades quietly', () => {
  // A future/partial implementation could throw on assignment, or silently ignore it. Either way
  // the app must keep working (audio just stays switch-muted) rather than take out ensureAudio().
  const throws = { audioSession: { get type() { return 'auto'; }, set type(v) { throw new TypeError('nope'); } } };
  assert.equal(requestPlaybackSession(throws), 'failed');

  const ignores = { audioSession: { get type() { return 'auto'; }, set type(v) {} } };
  assert.equal(requestPlaybackSession(ignores), 'failed');
});

test('it asks for exactly the one type that beats the silent switch', () => {
  // "playback" is the only session type iOS exempts from the ringer switch. "ambient" and the
  // "transient" types are all switch-muted, and "auto" is how we got here.
  const nav = iosNavigator();
  requestPlaybackSession(nav);
  assert.equal(nav.audioSession.type, 'playback');
});

// --- the fix has to be wired in, and wired in the same way, in all three apps ---------------

const APPS = ['quartet.html', 'voice-synth.html', 'barbershop-tuning.html'];

// Whitespace-insensitive so each file can keep its own brace/spacing style.
const fnSource = html => {
  const m = html.match(/function requestPlaybackSession\s*\(nav\)\s*\{[\s\S]*?\n\s*\}\n/);
  assert.ok(m, 'requestPlaybackSession not found');
  return m[0].replace(/\s+/g, '');
};

test('all three apps carry the same session logic', () => {
  const [canonical, ...rest] = APPS.map(f => fnSource(app(f)));
  rest.forEach((src, i) => assert.equal(src, canonical,
    `${APPS[i + 1]} has drifted from quartet.html's tested copy`));
});

test('every app requests the session before it opens an AudioContext', () => {
  // Ordering matters: the session type has to be set before the context starts producing audio,
  // and it must sit on a path a user gesture reaches (ensureAudio/ensureCtx), not on page load.
  for (const f of APPS) {
    const html = app(f);
    const call = html.indexOf('requestPlaybackSession(window.navigator)');
    const ctor = html.indexOf('new (window.AudioContext');
    assert.ok(call !== -1, `${f} never calls requestPlaybackSession`);
    assert.ok(ctor !== -1 && call < ctor, `${f} creates its AudioContext before asking for a playback session`);
  }
});
