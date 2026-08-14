# fall-graft

**Live: https://sjgant80-hub.github.io/fall-graft/**

Put a block into a page without cutting the page in half.

## What happened

Fourteen live apps drew their whole interface and ran no JavaScript at all. An injector appended its
block at a byte offset, and on those fourteen the offset landed **inside** the host `<script>`, in the
middle of a statement:

```
var html='<!DOCTYPE html>...                        <- host script, mid string
<script type="module"> ...the injected block... </script>
</body></html>';                                    <- the host script's own next line
```

**A browser ends a `<script>` at the first `</script>` it meets** — inside a string, inside a template
literal, it makes no difference. So the host script ended there and everything after it stopped being
code: 622 lines in one app. Every page still *drew*, because the static HTML around it was untouched.
That is why nobody noticed. `fallaccount-trades` shipped with 44 controls, 25 click handlers and zero
functions defined.

## The rules

1. **Never write inside a script.** The insertion point comes from the document's structure, never
   from a byte count. An offset knows nothing about what it is landing in the middle of.
2. **Never write a block twice.** One app carried two, so repairing one left it just as dead.
3. **Never write a page that does not parse.** The result is compiled before it is returned. A graft
   that would break the page is refused, with a reason, instead of written.

## Use

```
node inject.mjs check  page.html               # is a block sitting inside a script?
node inject.mjs add    block.html page.html    # graft it safely, or refuse
node inject.mjs repair page.html               # move a block already inside one
```

The kernel is pure — no filesystem, no network. The JavaScript parser is passed in (`new vm.Script`
under Node, `new Function` in a browser), so the checker and the writer cannot drift apart.

## Proof

73 tests, mutation gate **35/42 killed, 7 reviewed-equivalent**, CI pinned `witness@v0.2`. The page
inlines the gated kernel verbatim and CI fails if it has drifted.

Checked against the estate: of 222 real pages, it finds the **14** that were cut and reports the other
208 clean — the same answer arrived at independently by hand.

MIT · AI-Native Solutions
