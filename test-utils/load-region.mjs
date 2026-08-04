// Test helper: pull a DOM-free `//#region <name> … //#endregion <name>` block out of quartet.html
// and eval it in isolation, returning the requested exports. This lets Node unit-test the app's
// pure logic without a DOM, while the app stays a single self-contained HTML file.
// (Lives outside test/ so `node --test` doesn't run it as a test file.) See MEMORY: testing-convention.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function loadRegion(name, exports) {
  const html = readFileSync(join(here, '..', 'quartet.html'), 'utf8');
  const m = html.match(new RegExp('//#region ' + name + '[\\s\\S]*?//#endregion ' + name));
  if (!m) throw new Error(`region "${name}" not found in quartet.html — did the markers change?`);
  // The block is const/function declarations; the appended return exposes the named bindings.
  // (CompressionStream/DecompressionStream/TextEncoder/btoa/atob are Node globals, 18+.)
  return new Function(m[0] + `\nreturn { ${exports.join(', ')} };`)();
}
