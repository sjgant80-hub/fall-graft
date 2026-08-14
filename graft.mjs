// graft.mjs — put a block into a page without cutting the page in half.
//
// ⚑ WHY THIS EXISTS. An injector appended its block at a byte offset. On fourteen live apps that
// offset landed INSIDE the host <script>, in the middle of a statement:
//
//     var html='<!DOCTYPE html>...                        ← host script, mid string
//     <script type="module"> ...the injected block... </script>
//     </body></html>';                                   ← the host script's own next line
//
// A browser ends a <script> at the first </script> it meets — even inside a string, even inside a
// template literal. So the host script was severed there and everything after it stopped being code:
// 622 lines in fallaccount, 546 in fallinsurancepaper. Every page still DREW, because the static HTML
// around it was untouched, which is why it went unnoticed. fallaccount-trades shipped with 44
// controls, 25 click handlers and zero functions defined.
//
// Three rules, each of them a bug that actually happened:
//
//   1 · NEVER WRITE INSIDE A SCRIPT. The insertion point is chosen structurally, not by offset.
//   2 · NEVER WRITE A BLOCK TWICE. fallaccount carried two, so repairing one left it just as dead.
//   3 · NEVER WRITE A PAGE THAT DOES NOT PARSE. The result is compiled before it is returned, and a
//       graft that would break the page is refused with a reason instead of written.
//
// Pure: no filesystem, no network. The JavaScript parser is passed in — `new vm.Script` under Node,
// `new Function` in a browser — the same way the audit chain takes its hash function, so the checker
// and the writer can never drift apart.

const CLOSE = '</' + 'script>';

/** Script types a browser executes. Anything else on a <script> tag is data. */
const EXECUTED = /^(|module|text\/javascript|application\/javascript|text\/ecmascript|application\/ecmascript)$/i;

function typeOf(attrs) {
  const m = /\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || '');
  return (m ? (m[2] ?? m[3] ?? m[4]) : '').trim();
}

/**
 * Every <script> element, as a BROWSER sees it: the body ends at the first `</script>`, whatever the
 * JavaScript around it thinks. That rule is the whole reason the estate lost fourteen apps.
 */
export function scriptSpans(html) {
  const src = typeof html === 'string' ? html : '';
  const out = [];
  const re = /<script([^>]*)>/gi;
  let m;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '';
    const bodyFrom = m.index + m[0].length;
    const close = src.indexOf(CLOSE, bodyFrom);
    const external = /\bsrc\s*=/i.test(attrs);
    if (close < 0) {
      out.push({ tagFrom: m.index, bodyFrom, bodyTo: src.length, end: src.length, attrs, external, unclosed: true, type: typeOf(attrs) });
      break;
    }
    out.push({ tagFrom: m.index, bodyFrom, bodyTo: close, end: close + CLOSE.length, attrs, external, unclosed: false, type: typeOf(attrs) });
    re.lastIndex = close;
  }
  return out;
}

/**
 * Is this offset inside a script body — the one place a block must never be written?
 *
 * ⚑ Inclusive at both ends. Writing at the very first character of a script body, or at the very
 * last, is writing inside the script; an exclusive test calls those two positions safe and they are
 * the two most likely places for an appender to aim at.
 */
export function insideScript(html, offset) {
  const at = Number(offset);
  if (!Number.isFinite(at)) return null;
  for (const s of scriptSpans(html)) {
    if (at >= s.bodyFrom && at <= s.bodyTo) return s;
  }
  return null;
}

/**
 * Where a block may safely go: after every script has closed, just before </body>.
 *
 * ⚑ Chosen from the document's STRUCTURE, never from a byte count. An offset is exactly what the old
 * injector used, and an offset knows nothing about what it is landing in the middle of.
 */
export function insertionPoint(html) {
  const src = typeof html === 'string' ? html : '';
  if (!src) return 0;

  const spans = scriptSpans(src);
  const lastEnd = spans.length ? Math.max(...spans.map(s => s.end)) : 0;

  // Prefer just before </body>, but never before a script that has not closed yet.
  const body = src.toLowerCase().lastIndexOf('</body>');
  if (body >= 0 && body >= lastEnd) return body;
  if (lastEnd > 0 && lastEnd <= src.length) return lastEnd;
  return src.length;
}

/** The line ending the file actually uses. Writing the other one puts a raw newline in a string. */
export function newlineOf(html) {
  return typeof html === 'string' && html.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Every executable inline script compiles, cut the way a browser cuts it.
 *
 * `parse` is supplied by the caller — `code => new vm.Script(code)` under Node. Modules are skipped
 * unless a module parser is given, because `import` is illegal in the ordinary one and compiling a
 * healthy module that way reports a working page as broken.
 */
export function pageParses(html, parse, parseModule) {
  if (typeof parse !== 'function') throw new TypeError('graft needs a JavaScript parser passed in');
  for (const s of scriptSpans(html)) {
    if (s.unclosed) return { ok: false, reason: 'a <script> is never closed', at: s.tagFrom };
    if (s.external) continue;
    if (!EXECUTED.test(s.type)) continue;
    const code = html.slice(s.bodyFrom, s.bodyTo);
    if (!code.trim()) continue;
    const isModule = /^module$/i.test(s.type);
    if (isModule && typeof parseModule !== 'function') continue;
    try { (isModule ? parseModule : parse)(code); }
    catch (e) { return { ok: false, reason: e && e.message ? e.message : 'does not parse', at: s.bodyFrom }; }
  }
  return { ok: true, reason: 'every script parses', at: -1 };
}

/**
 * ⚑ THE ONE SAFE WAY TO ADD A BLOCK.
 *
 * Refuses rather than damages: if the page would stop parsing, nothing is written and the caller is
 * told why. `marker` makes it idempotent — a second run adds nothing.
 */
export function graft(html, block, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const src = typeof html === 'string' ? html : '';
  const text = typeof block === 'string' ? block.replace(/^[\r\n]+|[\r\n]+$/g, '') : '';

  if (!src) return { ok: false, reason: 'there is no page to graft onto', html: src, already: false };
  if (!text) return { ok: false, reason: 'there is no block to graft', html: src, already: false };

  const marker = typeof o.marker === 'string' && o.marker ? o.marker : text.split(/\r?\n/)[0];
  if (marker && src.includes(marker)) {
    return { ok: false, already: true, reason: 'this block is already on the page', html: src };
  }

  const before = pageParses(src, o.parse, o.parseModule);
  const at = insertionPoint(src);
  if (insideScript(src, at)) {
    return { ok: false, already: false, reason: 'no safe place to put it — every candidate is inside a script', html: src };
  }

  const nl = newlineOf(src);
  const out = src.slice(0, at) + nl + nl + text.replace(/\r?\n/g, nl) + nl + src.slice(at);

  // ⚑ Never hand back a page that stops parsing because of this graft. A page that was ALREADY
  // broken is not made the graft's fault — it is reported, and the graft still refuses, because
  // grafting onto a broken page hides which fault is which.
  const after = pageParses(out, o.parse, o.parseModule);
  if (!after.ok) {
    return {
      ok: false, already: false, html: src,
      reason: before.ok
        ? `grafting would stop the page parsing (${after.reason}) — nothing was written`
        : `the page was already broken before grafting (${before.reason}) — fix that first`,
    };
  }
  return { ok: true, already: false, reason: 'grafted', html: out, at };
}

/**
 * Blocks that are sitting inside a script body — pages the old injector cut.
 *
 * A block is recognised by its banner comment. More than one injector does this, so the caller passes
 * the banners it knows about rather than this file assuming there is only ever one.
 *
 * ⚑ A BANNER INSIDE A SCRIPT IS NOT ENOUGH, and this page proved it. The page you are reading holds a
 * worked example of a cut page in a JavaScript string, banner and all — and an earlier version of this
 * function reported the tool itself as damaged. A comment sitting in a string is text; it does no
 * harm. What does the harm is the injected `<script>` that follows the banner, because ITS closing tag
 * becomes the host's, and that is what ends the host early. So a block counts as severing only when a
 * script tag actually opens between the banner and the point where the host script now ends.
 */
export function severedBlocks(html, banners) {
  const src = typeof html === 'string' ? html : '';
  const names = Array.isArray(banners) && banners.length ? banners : ['AUTOPILOT'];
  const out = [];
  const re = /<!--([^]*?)-->/g;
  let m;
  while ((m = re.exec(src))) {
    const body = m[1] || '';
    if (!names.some(n => body.toUpperCase().includes(String(n).toUpperCase()))) continue;
    const host = insideScript(src, m.index);
    if (!host) continue;
    const opensAScript = /<script[\s>]/i.test(src.slice(m.index, host.bodyTo));
    if (!opensAScript) continue;
    out.push({ at: m.index, hostFrom: host.bodyFrom, hostTo: host.bodyTo });
  }
  return out;
}

/**
 * The whole injected run starting at `at` — every consecutive block, not just the first.
 *
 * ⚑ INJECTORS QUEUE UP BEHIND EACH OTHER. quine-cube-runner has three runs back to back: the
 * autopilot banner and its module, then the organs banner with an external script, then an inline
 * one. Removing only the first leaves the other two still sitting inside the host script, so the app
 * stays just as dead — and worse, it now looks repaired.
 *
 * Returns the end offset of the last consecutive injected piece. What counts as injected is
 * deliberately narrow: whitespace, a banner comment naming a known injector, and the script tags
 * belonging to it. Anything else stops the walk, because deleting a line of somebody's app because it
 * happened to sit nearby is a far worse bug than leaving one block behind.
 */
export function injectedRunAt(html, at, banners) {
  const src = typeof html === 'string' ? html : '';
  const names = Array.isArray(banners) && banners.length ? banners : ['AUTOPILOT'];
  const isBanner = (text) => names.some(n => text.toUpperCase().includes(String(n).toUpperCase()));

  let i = Number(at);
  if (!Number.isFinite(i) || i < 0 || i >= src.length) return Number(at) || 0;
  let end = i, sawSomething = false;

  for (let guard = 0; guard < 64; guard++) {
    const rest = src.slice(end);
    const ws = /^\s*/.exec(rest)[0].length;
    const after = rest.slice(ws);

    const comment = /^<!--([^]*?)-->/.exec(after);
    if (comment && isBanner(comment[1])) { end += ws + comment[0].length; sawSomething = true; continue; }

    const external = /^<script[^>]*\bsrc\s*=[^>]*>\s*<\/script>/i.exec(after);
    if (external && sawSomething) { end += ws + external[0].length; continue; }

    const inline = /^<script(?![^>]*\bsrc\s*=)[^>]*>/i.exec(after);
    if (inline && sawSomething) {
      const close = src.indexOf(CLOSE, end + ws + inline[0].length);
      if (close < 0) break;
      end = close + CLOSE.length;
      continue;
    }
    break;
  }
  return sawSomething ? end : i;
}

export default { scriptSpans, insideScript, insertionPoint, newlineOf, pageParses, graft, severedBlocks, injectedRunAt };
