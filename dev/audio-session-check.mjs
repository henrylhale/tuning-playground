#!/usr/bin/env node
// Local-only browser check for the iOS silent-switch fix. NOT part of `npm test` (it needs
// Chrome installed) and NOT a prerequisite for opening the apps — they stay plain file:// HTML.
//
//     node dev/audio-session-check.mjs           # all three apps
//     node dev/audio-session-check.mjs quartet.html
//
// What it proves that the unit tests can't: in a real browser, loading the real app file and
// clicking the real control with a real user gesture, the app asks for a "playback" audio
// session *before* it opens its AudioContext — and the AudioContext still ends up running.
//
// What it can't prove: that iOS then ignores the ringer switch. No desktop browser implements
// the AudioSession API (it is Safari-on-iOS only), so `navigator.audioSession` here is a stub we
// install to record what the app asks for. The stub is the only fake in the loop; the page, the
// click, and the Web Audio graph are real. Confirming actual audible output with the switch
// flipped needs an iPhone.
//
// Zero dependencies: Chrome DevTools Protocol over Node's built-in WebSocket and fetch.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

// Each app: the file, and the control a user presses to start audio.
const APPS = [
  { file: 'quartet.html',           click: '#play' },
  { file: 'voice-synth.html',       click: '#play' },
  { file: 'barbershop-tuning.html', click: '.keys .pbtn' },  // a key; this app has no transport button
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- CDP plumbing ---------------------------------------------------------------------------
let nextId = 1;
function cdp(ws) {
  const pending = new Map();
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP connect failed')), { once: true });
  });
  return ws;
}

// Evaluate in the page. `userGesture` makes Chrome treat it as a real user activation, which is
// what unlocks AudioContext — the same gate iOS applies.
async function evalInPage(send, expression, userGesture = false) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

// --- the check ------------------------------------------------------------------------------
// Installed before any click. Records every write to navigator.audioSession.type in order, so we
// can tell "asked once, correctly" from "never asked" and from "churned it on every interaction".
const STUB = `(() => {
  const writes = [], errors = [];
  window.addEventListener('error', e => errors.push(String(e.message)));
  window.__pageErrors = errors;
  let type = 'auto';                       // where iOS starts every page: an ambient session
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: {
    get type() { return type; },
    set type(v) { writes.push(v); type = v; },
  }});
  window.__sessionWrites = writes;
  window.__ctxCreatedBeforeSession = false;
  const AC = window.AudioContext;
  window.__contexts = [];
  window.AudioContext = function (...a) {   // trip a flag if a context is opened while ambient
    if (navigator.audioSession.type !== 'playback') window.__ctxCreatedBeforeSession = true;
    const ctx = new AC(...a);
    window.__contexts.push(ctx);
    return ctx;
  };
  window.AudioContext.prototype = AC.prototype;
  return true;
})()`;

async function check(send, { file, click }) {
  const url = pathToFileURL(join(REPO, file)).href;
  // Installed before the page's own script, so the stub sees the whole lifetime — including any
  // audio the app might set up at load rather than on the click.
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url });
  await sleep(900);                                    // no build step, no bundle: this is plenty
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  const clicked = await evalInPage(send, `(() => {
    const el = document.querySelector(${JSON.stringify(click)});
    if (!el) return 'no element matching ${click}';
    el.click();
    return 'ok';
  })()`, true);
  if (clicked !== 'ok') throw new Error(`${file}: ${clicked}`);
  await sleep(400);

  const r = await evalInPage(send, `({
    writes: window.__sessionWrites,
    type: navigator.audioSession.type,
    ctxCreatedBeforeSession: window.__ctxCreatedBeforeSession,
    errors: window.__pageErrors || [],
    ctxStates: (window.__contexts || []).map(c => c.state),
  })`);

  const problems = [];
  if (r.writes.length === 0) problems.push('never asked for an audio session');
  if (r.type !== 'playback') problems.push(`session ended as "${r.type}", not "playback"`);
  if (r.writes.some(w => w !== 'playback')) problems.push(`asked for ${r.writes.join(', ')}`);
  if (r.ctxCreatedBeforeSession) problems.push('opened its AudioContext before asking');
  if (r.errors.length) problems.push(`page errors: ${r.errors.join('; ')}`);
  // Regression guard: asking for the session must not cost us the audio itself.
  if (!r.ctxStates.includes('running')) problems.push(`no running AudioContext after the click (states: ${r.ctxStates.join(', ') || 'none created'})`);

  return { file, writes: r.writes, problems };
}

async function main() {
  const only = process.argv[2];
  const apps = only ? APPS.filter(a => a.file === only) : APPS;
  if (!apps.length) { console.error(`unknown app: ${only}`); process.exit(2); }

  const profile = mkdtempSync(join(tmpdir(), 'audio-session-check-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
    '--mute-audio',                                  // headless has no speakers; the graph still runs
    'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    let targets;
    for (let i = 0; i < 50; i++) {                   // wait for the debugging port
      try {
        targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        if (targets.some(t => t.type === 'page')) break;
      } catch {}
      await sleep(200);
    }
    const page = targets?.find(t => t.type === 'page');
    if (!page) throw new Error('Chrome never exposed a page target');

    ws = await connect(page.webSocketDebuggerUrl);
    const send = cdp(ws);
    await send('Runtime.enable');
    await send('Page.enable');

    let failed = 0;
    for (const app of apps) {
      const r = await check(send, app);
      if (r.problems.length) {
        failed++;
        console.log(`✗ ${r.file}`);
        r.problems.forEach(p => console.log(`    ${p}`));
      } else {
        console.log(`✓ ${r.file} — asked for a playback session (${r.writes.length} write) before opening its AudioContext`);
      }
    }
    console.log(failed
      ? `\n${failed} app(s) failed. Note: an iPhone is still needed to confirm audible output with the ringer switch off.`
      : '\nAll checked. Remaining unverifiable off-device: that iOS honours the playback session with the ringer switch off.');
    process.exitCode = failed ? 1 : 0;
  } finally {
    ws?.close();
    chrome.kill();
    await sleep(300);                                // let Chrome finish writing its profile out
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
