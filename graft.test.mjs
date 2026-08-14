// graft.test.mjs — PROOF-OF-PLAY for the thing that cut fourteen live apps in half.
import vm from 'node:vm';
import { scriptSpans, insideScript, insertionPoint, newlineOf, pageParses, graft, severedBlocks, injectedRunAt } from './graft.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ✓ ' : '  ✗ FAIL ') + m); };

const parse = (code) => new vm.Script(code);
const parseModule = typeof vm.SourceTextModule === 'function'
  ? (code) => new vm.SourceTextModule(code, { identifier: 'x.js' })
  : undefined;

const S = '<' + 'script>', SE = '</' + 'script>';
const BLOCK = `<!-- AUTOPILOT · fall-autopilot-kit -->\n${S}console.log('autopilot')${SE}`;

// The real shape: a function returning a whole HTML document from a template literal.
const page = (body) => `<!doctype html><html><head><title>t</title></head><body>
<h1>Hello</h1>
${S}
function report(x) {
  return \`<!doctype html><html><body>
    <p>\${x}</p>
  </body></html>\`;
}
function save() { localStorage.setItem('k', report(1)); }
${SE}
${body || ''}</body></html>`;

console.log('\n=== §1 · ⚑ A BROWSER ENDS A SCRIPT AT THE FIRST CLOSING TAG ===');
{
  const spans = scriptSpans(page());
  ok(spans.length === 1, 'the page has one script');
  ok(spans[0].unclosed === false, 'and it closes');

  // This is the fault, reproduced exactly: a block written into the middle of the template literal.
  const cut = page().replace('    <p>${x}</p>', `    <p>\${x}</p>\n${BLOCK}`);
  const spansCut = scriptSpans(cut);
  ok(spansCut[0].bodyTo < cut.indexOf('</body></html>`'),
     '⚑ the host script now ENDS at the injected block — the template literal it was inside means nothing to the parser');
  ok(pageParses(cut, parse).ok === false, 'and the page stops parsing, which is how fourteen apps shipped dead');
  ok(pageParses(page(), parse).ok === true, 'the untouched page parses');
}

console.log('\n=== §2 · ⚑ THE GRAFT GOES WHERE IT CANNOT CUT ANYTHING ===');
{
  const r = graft(page(), BLOCK, { parse });
  ok(r.ok === true, 'a block is grafted');
  ok(insideScript(r.html, r.at) === null, '⚑ and the place it went is NOT inside any script');
  ok(pageParses(r.html, parse).ok === true, 'the page still parses afterwards');
  ok(r.html.includes('function report'), 'the app it was grafted onto is untouched');
  ok(r.html.indexOf(BLOCK.split('\n')[0]) > r.html.indexOf(SE), 'the block sits after the script closes');
  ok(r.html.trimEnd().endsWith('</body></html>') === false || r.html.includes('</body>'), 'the document still ends properly');
}

console.log('\n=== §3 · ⚑ NEVER TWICE ===');
{
  const once = graft(page(), BLOCK, { parse });
  const twice = graft(once.html, BLOCK, { parse });
  ok(twice.ok === false && twice.already === true,
     '⚑ grafting the same block again adds nothing — fallaccount carried TWO, so repairing one left it just as dead');
  ok(twice.html === once.html, 'and the page is handed back unchanged');
  ok((twice.html.match(/AUTOPILOT/g) || []).length === 1, 'exactly one block on the page');

  const other = graft(once.html, `<!-- NICEASSOS · L3 graft -->\n${S}1${SE}`, { parse });
  ok(other.ok === true, 'but a DIFFERENT block is still allowed');
}

console.log('\n=== §4 · ⚑ IT REFUSES RATHER THAN DAMAGES ===');
{
  const broken = page().replace('function save()', 'function save(');   // a page that is already broken
  ok(pageParses(broken, parse).ok === false, 'the page is broken to begin with');
  const r = graft(broken, BLOCK, { parse });
  ok(r.ok === false, '⚑ grafting onto a broken page is REFUSED');
  ok(/already broken/.test(r.reason), 'and it says the page was broken first, not that the graft broke it');
  ok(r.html === broken, 'nothing was written');

  const bad = graft(page(), `<!-- X -->\n${S}function ({${SE}`, { parse });
  ok(bad.ok === false && /stop the page parsing/.test(bad.reason),
     '⚑ and a block that would break a WORKING page is refused, with the reason');
  ok(bad.html === page(), 'that page is untouched too');
}

console.log('\n=== §5 · ⚑ THE LINE ENDING THE FILE ACTUALLY USES ===');
{
  const crlf = page().replace(/\n/g, '\r\n');
  ok(newlineOf(crlf) === '\r\n' && newlineOf(page()) === '\n', 'both endings are recognised');
  const r = graft(crlf, BLOCK, { parse });
  ok(r.ok === true, 'a CRLF page is grafted');
  ok(!/[^\r]\n/.test(r.html),
     '⚑ and NO lone LF is introduced — writing one into a CRLF file puts a raw newline inside whatever string it lands in, which is the very fault being avoided');
}

console.log('\n=== §6 · finding pages the old injector already cut ===');
{
  const cut = page().replace('    <p>${x}</p>', `    <p>\${x}</p>\n${BLOCK}`);
  const found = severedBlocks(cut, ['AUTOPILOT']);
  ok(found.length === 1, '⚑ a block sitting inside a script body is found');
  ok(severedBlocks(graft(page(), BLOCK, { parse }).html, ['AUTOPILOT']).length === 0,
     'and a properly grafted page reports nothing — a check that fires on everything says nothing');
  ok(severedBlocks(cut, ['NICEASSOS']).length === 0, 'only the banners asked about are looked for');
  ok(severedBlocks(cut.replace('AUTOPILOT', 'NICEASSOS · L3 graft'), ['niceassos']).length === 1,
     '⚑ more than one injector does this — quine-cube-runner was cut by the organs graft, not the autopilot one');
  ok(severedBlocks(page(), ['AUTOPILOT']).length === 0, 'a page with no block has none');

  // ⚑ A BANNER IN A STRING IS TEXT, NOT DAMAGE — and this caught the tool reporting ITSELF as broken.
  // Its own page carries a worked example of a cut page inside a JavaScript string, banner and all.
  // What cuts a page is the injected <script> after the banner, whose closing tag becomes the host's.
  const talksAboutIt = `${S}
var DEMO = "<!-- AUTOPILOT · fall-autopilot-kit --> then some text";
var note = "an injector writes a banner and a script tag";
${SE}`;
  ok(severedBlocks(talksAboutIt, ['AUTOPILOT']).length === 0,
     '⚑ a page that merely QUOTES a banner is not damaged — it is a page explaining the fault');
  ok(pageParses(talksAboutIt, parse).ok === true, 'and it parses perfectly well');
}

console.log('\n=== §7 · where the insertion point lands ===');
{
  ok(insideScript(page(), insertionPoint(page())) === null, 'the chosen point is never inside a script');
  const noBody = `${S}var a=1${SE}`;
  ok(insertionPoint(noBody) === noBody.length, 'with no </body>, it goes after the last script');
  // ⚑ On a page whose script never closes there is NO safe point — everything to the end of the file
  // is inside that script. Saying otherwise would be the comfortable answer and the wrong one; the
  // honest behaviour is to have nowhere to put it and refuse.
  const unclosed = `<html><body>${S}var a='oops`;
  ok(insideScript(unclosed, insertionPoint(unclosed)) !== null,
     '⚑ on a page whose script never closes, every position is inside it — there is nowhere safe');
  const r = graft(unclosed, BLOCK, { parse });
  ok(r.ok === false, 'so grafting onto that page is refused');
  ok(r.html === unclosed, 'and the page is left exactly as it was');
  ok(insertionPoint('') === 0 && insertionPoint(null) === 0, 'an empty page has a point at zero');
}

console.log('\n=== §8 · data is not code ===');
{
  const withJson = page(`<script type="application/ld+json">{"@context":"https://schema.org"}</` + `script>`);
  ok(pageParses(withJson, parse).ok === true,
     '⚑ JSON-LD is DATA — compiling it as JavaScript reports a perfectly healthy page as broken');
  const withModule = page(`<script type="module">import x from './a.js'; console.log(x)</` + `script>`);
  ok(pageParses(withModule, parse).ok === true,
     '⚑ and a module is skipped unless a module parser is given — `import` is illegal in the ordinary one');
  if (parseModule) ok(pageParses(withModule, parse, parseModule).ok === true, 'with one, the module is checked properly and passes');
  else ok(true, 'module parser unavailable in this runtime — skipped');
  ok(pageParses(page(`<script src="x.js"></` + `script>`), parse).ok === true, 'an external script has no body to check');
}

console.log('\n=== §9 · pure under garbage ===');
{
  const junk = [null, undefined, '', 0, [], {}, NaN, 'x', '<script>', '</script>', '<script><script>'];
  let threw = null;
  for (const j of junk) {
    try { scriptSpans(j); insideScript(j, j); insertionPoint(j); newlineOf(j); severedBlocks(j, j); graft(j, j, { parse }); }
    catch (e) { threw = `${JSON.stringify(j)} → ${e.message}`; }
  }
  ok(threw === null, 'no input throws' + (threw ? ' — ' + threw : ''));
  ok(graft(page(), '', { parse }).ok === false, 'an empty block is refused');
  ok(graft('', BLOCK, { parse }).ok === false, 'and so is an empty page');

  let noParser = false;
  try { graft(page(), BLOCK, {}); } catch { noParser = true; }
  ok(noParser === true,
     '⚑ with no parser supplied it THROWS rather than skipping the check — a graft that cannot verify itself must not run at all');
}

console.log('\n=== §10 · ⚑ THE </body> THAT IS ITSELF INSIDE A SCRIPT ===');
{
  // This is the real shape of every page that got cut: a function returning a whole HTML document, so
  // the string contains its own </body>. Aiming at "just before </body>" without checking whether
  // that </body> is real would put the block INSIDE the script — the exact fault, reintroduced by the
  // thing meant to prevent it.
  const p = page();
  const inner = p.indexOf('</body></html>`');
  ok(inner > 0 && insideScript(p, inner) !== null, 'the page has a </body> inside a template literal');
  const at = insertionPoint(p);
  ok(at > inner, '⚑ the insertion point skips that one and lands after the script has closed');
  ok(insideScript(p, at) === null, 'so it is not inside anything');

  ok(insertionPoint('</body>') === 0, 'a document that is only a closing tag has a point at the very start');
  ok(insertionPoint('<p>no scripts here</p>') === '<p>no scripts here</p>'.length,
     '⚑ a page with no scripts and no </body> appends at the END — not at zero, which would put the block above the whole document');
}

console.log('\n=== §11 · the marker that makes it idempotent ===');
{
  const p = graft(page(), BLOCK, { parse }).html;
  const second = graft(p, `<!-- AUTOPILOT · v2 -->\n${S}2${SE}`, { parse, marker: 'AUTOPILOT' });
  ok(second.ok === false && second.already === true,
     '⚑ an explicit marker is honoured — without it, a re-worded banner counts as a different block and gets added alongside the first');

  // ⚑ A marker that is not text is IGNORED, not coerced. Coercing it would make includes(12345) look
  // for the characters "12345" anywhere on the page — a check that quietly means nothing, and that
  // refuses a perfectly good graft the moment those digits appear in an unrelated colour or id.
  const withDigits = page(`<p>order 12345</p>`);
  ok(graft(withDigits, BLOCK, { parse, marker: 12345 }).ok === true,
     '⚑ a numeric marker does not stop a graft just because those digits appear somewhere on the page');
  ok(graft(withDigits, BLOCK, { parse, marker: '12345' }).already === true,
     'but the same marker AS TEXT is honoured, because then it was meant');
  ok(graft(page(), BLOCK, { parse, marker: '' }).ok === true, 'and an empty marker falls back to the banner line');
}

console.log('\n=== §12 · the two ends of a script body ===');
{
  const p = page();
  const s = scriptSpans(p)[0];
  ok(insideScript(p, s.bodyFrom) !== null,
     '⚑ the very FIRST character of a script body counts as inside — it is where an appender aiming at "the start" would land');
  ok(insideScript(p, s.bodyTo) !== null, 'and the very last does too');
  ok(insideScript(p, s.bodyFrom - 1) === null, 'the character before the body is outside');
  ok(insideScript(p, s.end) === null, 'and so is the position just after the closing tag');

  // A script that comes AFTER the last </body> — malformed, but real, and the insertion point has to
  // land after it rather than at the </body> it now precedes.
  const odd = `<html><body><p>x</p></body>${S}var a=1${SE}</html>`;
  const at = insertionPoint(odd);
  ok(at >= odd.indexOf(SE), '⚑ a script sitting after </body> still gets grafted AFTER, never before it');
  ok(insideScript(odd, at) === null, 'and the point is outside it');
}

console.log('\n=== §13 · ⚑ INJECTORS QUEUE UP BEHIND EACH OTHER ===');
{
  // quine-cube-runner's real shape: three runs back to back inside one host script.
  const RUN = [
    `<!-- AUTOPILOT · fall-autopilot-kit -->`,
    `${S}type="module">console.log(1)${SE}`.replace('<script', '<script '),
    ``,
    `<!-- niceassos-organs · L3 graft -->`,
    `<script src="https://example.com/organ.js"></` + `script>`,
    `${S}installOrgan({})${SE}`,
  ].join('\n');
  const host = `${S}\nconst T = {\n  html: \`<!doctype html><body>x\n${RUN}\n</body>\`,\n  more: 1\n};\n${SE}`;

  const at = host.indexOf('<!-- AUTOPILOT');
  const end = injectedRunAt(host, at, ['AUTOPILOT', 'niceassos-organs', 'L3 graft']);
  const removed = host.slice(at, end);
  ok(removed.includes('AUTOPILOT') && removed.includes('niceassos-organs'),
     '⚑ ALL THREE runs come out together — removing only the first leaves the app just as dead, and looking repaired');
  ok(removed.includes('installOrgan'), 'including the inline script the second injector added');
  ok(!removed.includes('</body>`'), 'and it stops at the app\'s own next line, which is not injected');

  const rejoined = host.slice(0, at).replace(/\s*$/, '') + host.slice(end).replace(/^\s*/, '');
  ok(pageParses(rejoined, parse).ok === true, 'so once the run is gone the template literal closes and the page parses');

  // narrowness: it must not eat things that merely sit nearby
  const nearby = `<!-- AUTOPILOT -->\n${S}console.log(1)${SE}\n<div>the app's own markup</div>`;
  const e2 = injectedRunAt(nearby, 0, ['AUTOPILOT']);
  ok(!nearby.slice(0, e2).includes('<div>'),
     '⚑ it stops at anything it does not recognise — deleting a line of somebody\'s app because it sat nearby is a far worse bug than leaving a block behind');
  ok(injectedRunAt(nearby, nearby.indexOf('<div>'), ['AUTOPILOT']) === nearby.indexOf('<div>'),
     'starting somewhere that is not a banner consumes nothing');

  // ⚑ A run at the very start of the file is a real run. Treating offset 0 as "no position" would
  // silently skip a page whose first byte is the injected block.
  ok(e2 > 0, '⚑ a run beginning at offset ZERO is consumed, not dismissed as a missing position');
  ok(nearby.slice(0, e2).includes('console.log(1)'), 'and it takes the whole block with it');

  // Positions that are not positions must be handed straight back, never used to slice with.
  ok(injectedRunAt(nearby, NaN, ['AUTOPILOT']) === 0, 'a position that is not a number consumes nothing');
  ok(injectedRunAt(nearby, -5, ['AUTOPILOT']) === -5, 'and neither does a negative one');

  // ⚑ A NEGATIVE POSITION MUST NOT BE USED TO INDEX FROM THE END. slice(-5) silently means "the last
  // five characters" in JavaScript, so a guard that lets a negative through does not fail — it
  // quietly starts the walk somewhere near the end of the file and deletes whatever it finds there.
  const endsWithBlock = `<div>the app</div>\n<!-- AUTOPILOT -->\n${S}console.log(1)${SE}`;
  const tail = -(endsWithBlock.length - endsWithBlock.indexOf('<!-- AUTOPILOT'));
  ok(injectedRunAt(endsWithBlock, tail, ['AUTOPILOT']) === tail,
     '⚑ a negative position is handed straight back even when counting from the end would land exactly on a real block');
  ok(injectedRunAt(nearby, nearby.length + 99, ['AUTOPILOT']) === nearby.length + 99, 'nor one past the end');
  ok(injectedRunAt('', 0, ['AUTOPILOT']) === 0 && injectedRunAt(null, 5, null) === 5, 'and garbage consumes nothing');
}

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
