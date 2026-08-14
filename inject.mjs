#!/usr/bin/env node
// inject.mjs — the injector, rewritten so it cannot cut a page in half.
//
//   node inject.mjs check <page.html> [...]        does this page have a block inside a script?
//   node inject.mjs add   <block.html> <page.html> [...]   graft a block, safely, or refuse
//   node inject.mjs repair <page.html> [...]       move a block that is already inside a script
//
// Every write is verified before it happens. A page that would stop parsing is left alone and
// reported. Nothing is ever written twice.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { graft, severedBlocks, insideScript, insertionPoint, pageParses, scriptSpans, newlineOf, injectedRunAt } from './graft.mjs';

const parse = (code) => new vm.Script(code);
const parseModule = typeof vm.SourceTextModule === 'function'
  ? (code) => new vm.SourceTextModule(code, { identifier: 'x.js' })
  : undefined;

// The banners every injector the estate has used announces itself with.
const BANNERS = ['AUTOPILOT', 'niceassos-organs', 'L3 graft', 'fall-kit', 'fall-hot'];

const CLOSE = '</' + 'script>';
const [cmd, ...rest] = process.argv.slice(2);

function check(files) {
  let bad = 0;
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    const cut = severedBlocks(html, BANNERS);
    const p = pageParses(html, parse, parseModule);
    if (!cut.length && p.ok) { console.log(`  ✓ ${f} — ${scriptSpans(html).length} script(s), all parse`); continue; }
    bad++;
    if (cut.length) console.log(`  ✗ ${f} — ${cut.length} block(s) sitting INSIDE a script; the app is cut there`);
    if (!p.ok) console.log(`  ✗ ${f} — does not parse: ${p.reason}`);
  }
  return bad;
}

function add(blockFile, files) {
  const block = readFileSync(blockFile, 'utf8');
  let bad = 0;
  for (const f of files) {
    const html = readFileSync(f, 'utf8');
    const r = graft(html, block, { parse, parseModule });
    if (r.ok) { writeFileSync(f, r.html); console.log(`  ✓ ${f} — grafted after the last script`); continue; }
    if (r.already) { console.log(`  – ${f} — already has it`); continue; }
    bad++;
    console.log(`  ✗ ${f} — refused: ${r.reason}`);
  }
  return bad;
}

/** Move a block that is already inside a script out to where it belongs, and close what it split. */
function repair(files) {
  let bad = 0;
  for (const f of files) {
    let html = readFileSync(f, 'utf8');
    let moved = 0, found = 0;

    for (let round = 0; round < 8; round++) {
      const cut = severedBlocks(html, BANNERS);
      if (!cut.length) break;
      found++;
      const b = cut[0];
      // ⚑ The WHOLE run, not just the first block — injectedRunAt walks every consecutive one.
      const end = injectedRunAt(html, b.at, BANNERS);
      if (end <= b.at) break;
      const block = html.slice(b.at, end).replace(/^[\r\n]+|[\r\n]+$/g, '');
      const stripped = html.slice(0, b.at) + html.slice(end);
      const r = graft(stripped, block, { parse, parseModule, marker: block.slice(0, 40) });
      if (r.ok) { html = r.html; moved++; continue; }

      // ⚑ The injector split a LINE, not just a file. Where it landed in a plain quoted string, the
      // leftover newline is itself a syntax error, so the seam has to be closed as well.
      const sealed = stripped.slice(0, b.at).replace(/\s*$/, '') + stripped.slice(b.at).replace(/^\s*/, '');
      const r2 = graft(sealed, block, { parse, parseModule, marker: block.slice(0, 40) });
      if (r2.ok) { html = r2.html; moved++; continue; }
      break;
    }

    const p = pageParses(html, parse, parseModule);
    // ⚑ "Nothing inside a script" and "I found one and could not move it" are different sentences,
    // and an earlier version printed the first when it meant the second. A tool that reports a
    // failure as a clean bill of health is worse than one that crashes.
    if (!moved && !found) { console.log(`  – ${f} — nothing inside a script`); continue; }
    if (!moved) { bad++; console.log(`  ✗ ${f} — ${found} block(s) found inside a script but none could be moved; left untouched`); continue; }
    if (!p.ok) { bad++; console.log(`  ✗ ${f} — ${moved} run(s) moved but it still does not parse (${p.reason}); left untouched`); continue; }
    writeFileSync(f, html);
    console.log(`  ✓ ${f} — ${moved} injected run(s) moved out, page parses`);
  }
  return bad;
}

let bad = 0;
if (cmd === 'check') bad = check(rest);
else if (cmd === 'add') bad = add(rest[0], rest.slice(1));
else if (cmd === 'repair') bad = repair(rest);
else {
  console.log(`inject — graft a block into a page without cutting it in half

  node inject.mjs check  <page.html> [...]
  node inject.mjs add    <block.html> <page.html> [...]
  node inject.mjs repair <page.html> [...]

Every write is verified first. A page that would stop parsing is refused, not written.`);
  process.exit(2);
}
process.exit(bad ? 1 : 0);
