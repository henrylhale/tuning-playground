// Test helper: pull `//#region <name> … //#endregion <name>` blocks out of an app's HTML and eval
// them in isolation, returning the requested exports. This lets Node unit-test the app's pure
// logic without a DOM, while the app stays a single self-contained HTML file.
// (Lives outside test/ so `node --test` doesn't run it as a test file.) See MEMORY: testing-convention.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// `names` may be a single region or several, which are concatenated in the order given — regions
// that build on each other (a shared `clamp`, say) can then be loaded together without either one
// having to redeclare what the other already has.
export function loadRegion(names, exports, file = 'quartet.html') {
  const html = readFileSync(join(here, '..', file), 'utf8');
  const blocks = [].concat(names).map(name => {
    const m = html.match(new RegExp('//#region ' + name + '[\\s\\S]*?//#endregion ' + name));
    if (!m) throw new Error(`region "${name}" not found in ${file} — did the markers change?`);
    return m[0];
  });
  // The blocks are const/function declarations; the appended return exposes the named bindings.
  // (CompressionStream/DecompressionStream/TextEncoder/btoa/atob are Node globals, 18+.)
  return new Function(blocks.join('\n') + `\nreturn { ${exports.join(', ')} };`)();
}
