# Deligne–Illusie — web edition

HTML/JSON edition of P. Deligne & L. Illusie, *« Relèvements modulo p² et décomposition
du complexe de de Rham »* (Inventiones math. **89**, 247–270, 1987), rendered with MathJax 3
+ XyJax‑v3. Same viewer format as the SGA 2 viewer.

## View it

Live: **https://rosie-0525.github.io/Deligne-Illusie/**

To run locally — must be served over HTTP (the viewer uses `fetch`), from the repo root:

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Layout

```
index.html        viewer shell (MathJax + XyJax config, top bar, sidebar)
viewer.js         loads the manifest once, lazy-loads + caches chapters, resolves #anchors
viewer.css        styling
data/<lang>/manifest.json   per-language manifest: { toc, chapters, anchor_index, default_page_id }
data/fr/chapters/*.json     French content       (the reference text)
data/en/chapters/*.json     English translation  (full; bibliography entries kept verbatim)
data/cn/chapters/*.json     Chinese translation  (full; bibliography entries kept verbatim)
source/Deligne-Illusie.pdf  original paper (source material; not referenced by the viewer)
```

## Reading layout (bilingual, block-aligned)

The viewer is a **side-by-side reader**: French is fixed in the left column (the reference) and a
second language fills the right column, chosen with the `EN / 中文` switch in the top bar (the
`FR |` label marks the fixed left). Both English and Chinese are full translations.

The two columns are **aligned block by block**: every top-level block — each theorem, proof,
proposition, numbered paragraph, displayed equation — is paired with its translation in a shared
grid row (`.align-row`), with the cells topped out (`align-items: start`), so corresponding
statements always begin at the same vertical position. The pairing is by position: the
translation pipeline keeps the block sequence identical across `fr`/`en`/`cn` (same count and kind
of blocks, same order), so block *N* on the left is the translation of block *N* on the right.
When one side's block is taller, its partner simply has trailing whitespace and the **next** row
re-aligns. Collapsible proofs are toggled in sync across both columns (they share ids
`proof-x` ⇄ `r-proof-x`) so a collapse on one side keeps the rows lined up.

The two columns share one vertical scrollbar. The right-column choice and the sidebar collapse
state are remembered in `localStorage`. The **table-of-contents sidebar is collapsible** on
desktop (the ☰ button); below 800 px each block stacks over its translation (French block, then
its rendering) and ☰ opens the sidebar as an overlay.

Navigation, the TOC and `anchor_index` are driven by the **French manifest only** — all three
languages share identical chapter/page/element ids, so `data/en/manifest.json` and
`data/cn/manifest.json` (copies of `data/fr/manifest.json`) are kept for parallelism but are not
loaded by the viewer.

`data/fr/manifest.json` is small (~6 KB) and loaded first; each section JSON (~total 110 KB) is fetched only
when visited, so navigation is fast. Cross-references resolve in O(1) through `anchor_index`
(`anchorId → pageId`).

## Content model (per page, lean schema)

```jsonc
{ "id": "2", "title": "...", "html": "<...>", "footnotes": [{ "id", "number", "html" }] }
```

`html` is the rendered page. Conventions: statements `div.thm.thm-plain.<kind> id="2.1"`;
collapsible proofs `div.proof`; numbered equations `div.equation id="eq:0.2"` with `\tag{0.2}`;
unnumbered displays `div.displaymath`; cross-refs `a.ref href="#2.1"` / `a.eqref href="#eq:0.2"`;
citations `a.ref href="#bib-14"`; bibliography `dl.bibliography > dt id="bib-1"`.
Inside math, `<`/`>` are written as `&lt;`/`&gt;` so the browser doesn’t mistake `\(i<p\)` for a tag.

## Chapters / anchors

`front` (title + Sommaire) · `intro` · `1`–`4` (4 has sub-pages `4-1`, `4-2`) · `bibliographie`.
Statement anchors are the paper’s native numbers (`2.1`, `4.1.2`, …); equations `eq:<n>`;
bibliography `bib-1…bib-28`, `bib-EGA`, `bib-SGA1`, `bib-SGA6`. All 133 internal links resolve.

## Note on `viewer.js`

Changes vs. the sample. (1) `typeset()` now defers until MathJax has finished loading (the
library is loaded `async`, so the original raced it and left the first page un-typeset until you
navigated). (2) `renderPageAligned()` loads the French chapter **and** the right-language chapter
together (alignment needs both before layout), then `renderAligned()` splits each page into its
top-level blocks (`parseBlocks()`), pairs them by index, and emits one `.align-row` per pair
(French in `.cell-left`, translation in `.cell-right`). Because all languages reuse the same
element ids, each right cell is passed through `namespaceIds()` (prefixing every `id` with `r-`)
so the DOM stays valid and `getElementById`/cross-reference scrolling resolve to the canonical
left (French) cell. French stays canonical for navigation, the sidebar highlight and scrolling;
the shell chrome stays French-primary; per-column messages come from a `STRINGS` table keyed by
language. Each translation was produced by protecting every math span behind a placeholder,
translating only the prose, then restoring the math verbatim — so all `\(..\)`/`\[..\]`, equation
tags, `\xymatrix` diagrams, ids, and cross-reference anchors are byte-identical to the French
source (which is also what guarantees the block-by-block pairing lines up).

**Known caveat:** right-column internal links (footnote `↩` backrefs, citation/`eqref` links)
scroll to the **left** column, because only the right cells' `id`s are prefixed — their
`href="#…"` targets are left untouched and resolve to the canonical left-cell anchor. Acceptable
since both columns are the same content (and, being aligned, the target sits at the same height);
full right-column self-navigation is out of scope.
