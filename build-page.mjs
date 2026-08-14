// build-page.mjs — put the GATED kernel inside the page, verbatim.
//
// The page is a single file, so the kernel is inlined rather than imported — and inlined exactly, or
// the code the gate ran against and the code that answers on the page would be two different
// programs. CI re-runs this and fails if the shipped page has drifted.
import { readFileSync, writeFileSync } from 'node:fs';

const OPEN = '/* __GRAFT_KERNEL__ */';
const CLOSE = '/* __END_GRAFT_KERNEL__ */';

// Only the `export` keyword goes. The \r? matters: these files are CRLF and `.` stops at \r.
//
// ⚑ AND THE KERNEL WOULD HAVE CUT ITS OWN PAGE IN HALF. graft.mjs explains the fault in prose, so its
// comments contain the literal closing tag — "a browser ends a script at the first </script> it
// meets". Inlined as-is, the browser would end the page's script at that very sentence, and the tool
// built to stop pages being cut would ship cut. Escaped to <\/script>, which no boundary scan matches
// and which reads the same. Exactly the trap this whole repo is about, met on the way out the door.
const kernel = readFileSync('graft.mjs', 'utf8')
  .replace(/^#!.*\r?\n/, '')
  .replace(/^import[^\n]*\n/gm, '')
  .replace(/^export default[\s\S]*?;\s*$/m, '')
  .replace(/^export (function|const|async function)/gm, '$1')
  .replace(/^export \{[^}]*\};?\s*$/gm, '')
  .split('</' + 'script>').join('<\\/' + 'script>');

const html = readFileSync('index.html', 'utf8');
const a = html.indexOf(OPEN), b = html.indexOf(CLOSE);
if (a < 0 || b < 0) throw new Error('the kernel markers are missing from index.html');

const out = html.slice(0, a + OPEN.length) + '\n' + kernel + '\n' + html.slice(b);
writeFileSync('index.html', out);

for (const fn of ['function scriptSpans', 'function insertionPoint', 'function severedBlocks', 'function pageParses']) {
  if (!out.includes(fn)) throw new Error(`the page does not contain ${fn} — the inline did not take`);
}
const inlined = out.slice(a, out.indexOf(CLOSE));
if (/^export /m.test(inlined)) throw new Error('module syntax survived into the page');
console.log(`index.html — kernel inlined, ${kernel.split('\n').length} lines, page ${(out.length / 1024).toFixed(0)}KB`);
