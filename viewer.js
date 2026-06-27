/* SGA 2 viewer: loads the JSON manifest + per-chapter content and renders it
   with client-side MathJax 3 + XyJax-v3. Resolves cross-page anchors via the
   manifest's anchor_index. */
(function () {
  'use strict';

  // The left column is always French (the reference); the right column shows a
  // second language (English or Chinese) chosen via state.rightLang. The two are
  // laid out block-by-block in shared grid rows so every theorem/proof/paragraph
  // aligns vertically (see renderAligned). Navigation, the TOC and anchorIndex are
  // driven by the French manifest only; all languages share identical
  // chapter/page/element ids.
  var state = {
    manifest: null,                            // FRENCH manifest only
    rightLang: 'en',                           // 'en' | 'cn' (persisted)
    chapterCache: { fr: {}, en: {}, cn: {} },  // lang -> chapterId -> chapter JSON
    pageToChapter: {},                         // pageId -> chapterId
    anchorIndex: {},                           // elementId -> pageId
    currentPage: null
  };

  var elPanes = document.getElementById('panes');
  var elSidebar = document.getElementById('sidebar');
  var elContent = document.getElementById('content');

  // Per-pane strings. The shell (title/header/sidebar) is French-primary; each
  // pane uses STRINGS[lang] for its own messages (empty-page notice, footnote
  // backref title, load errors). The right pane may be 'en' or 'cn'.
  var STRINGS = {
    fr: {
      pageTitle: 'Deligne–Illusie — Relèvements modulo p² et décomposition du complexe de de Rham',
      bookTitle: 'Deligne–Illusie · Relèvements mod p²',
      toc: 'Table des matières',
      notrans: '(Traduction non disponible — la version française est la référence.)',
      loadErr: 'Erreur de chargement : ',
      backref: 'retour'
    },
    en: {
      notrans: '(Translation not available — the French version is the reference.)',
      loadErr: 'Loading error: ',
      backref: 'back'
    },
    cn: {
      notrans: '（暂无中文翻译——以法语版本为准。）',
      loadErr: '加载错误：',
      backref: '返回'
    }
  };

  function applyChrome() {
    var s = STRINGS.fr;
    document.documentElement.lang = 'fr';
    document.title = s.pageTitle;
    var bt = document.getElementById('book-title');
    if (bt) bt.textContent = s.bookTitle;
    if (elSidebar) elSidebar.setAttribute('aria-label', s.toc);
  }

  // Typeset an element, chaining through MathJax's startup promise so we never
  // race the async CDN load (and so concurrent typesets serialize cleanly).
  // The MathJax library is loaded with `async`, so on the first render its
  // startup.promise may not exist yet; in that case defer and retry until it is
  // ready (otherwise the initial page would show raw \(..\) until you navigate).
  function typeset(el) {
    if (window.MathJax && MathJax.startup && MathJax.startup.promise) {
      MathJax.startup.promise = MathJax.startup.promise
        .then(function () { return MathJax.typesetPromise([el]); })
        .catch(function (e) { console.warn('MathJax typeset', e); });
    } else if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([el]).catch(function (e) { console.warn('MathJax', e); });
    } else {
      setTimeout(function () { typeset(el); }, 150);  // MathJax not loaded yet
    }
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }

  // The manifest is loaded once, in French — it drives the sidebar, navigation
  // and anchorIndex for every language (ids are shared across fr/en/cn).
  function loadManifest() {
    return fetchJSON('data/fr/manifest.json').then(function (m) {
      state.manifest = m;
      applyChrome();
      state.pageToChapter = {};
      state.anchorIndex = m.anchor_index || {};
      m.chapters.forEach(function (ch) {
        (ch.page_ids || []).forEach(function (pid) { state.pageToChapter[pid] = ch.id; });
      });
      buildSidebar();
    });
  }

  function buildSidebar() {
    var m = state.manifest;
    var tocByPage = {};
    m.toc.forEach(function (t) { tocByPage[t.page_id] = t; });
    var html = '';
    m.chapters.forEach(function (ch) {
      var pids = ch.page_ids || [];
      var landing = pids[0];
      var num = ch.number ? '<span class="cnum">' + ch.number + '</span>' : '';
      html += '<div class="chap" data-chapter="' + ch.id + '">';
      html += '<a href="#' + encodeURIComponent(landing) + '" data-page="' + landing + '">' +
              num + ch.title + '</a>';
      if (pids.length > 1) {
        html += '<div class="pages">';
        pids.slice(1).forEach(function (pid) {
          var t = tocByPage[pid] || { title: pid };
          html += '<a href="#' + encodeURIComponent(pid) + '" data-page="' + pid + '">' +
                  t.title + '</a>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    elSidebar.innerHTML = html;
    typeset(elSidebar);
  }

  function chapterFor(pageId) {
    return state.pageToChapter[pageId] ||
           (state.manifest.chapters[0] && state.manifest.chapters[0].id);
  }

  function loadChapter(lang, chapterId) {
    var cache = state.chapterCache[lang] || (state.chapterCache[lang] = {});
    if (cache[chapterId]) return Promise.resolve(cache[chapterId]);
    return fetchJSON('data/' + lang + '/chapters/' + chapterId + '.json').then(function (c) {
      cache[chapterId] = c;
      return c;
    });
  }

  function pickPage(chapter, pageId) {
    var page = (chapter.pages || []).filter(function (p) { return p.id === pageId; })[0];
    return page || chapter.pages[0];
  }

  function showPage(pageId, anchor) {
    renderPageAligned(pageId, anchor, false);
  }

  // Render French (left) and the right-language translation side by side, with
  // every top-level block (theorem / proof / paragraph / equation) paired into a
  // shared grid ROW so corresponding statements line up vertically. The two
  // chapters are loaded together because alignment needs both before laying out;
  // French stays canonical (it drives currentPage, sidebar highlight, scrolling).
  // keepScroll preserves the scroll position (used when only the right language
  // changes); otherwise we jump to the anchor or the top.
  function renderPageAligned(pageId, anchor, keepScroll) {
    var chId = chapterFor(pageId);
    if (!chId) return;
    var rlang = state.rightLang;
    var prevScroll = elContent.scrollTop;
    Promise.all([
      loadChapter('fr', chId),
      loadChapter(rlang, chId).catch(function (e) { return { __err: e }; })
    ]).then(function (res) {
      var frPage = pickPage(res[0], pageId);
      pageId = frPage.id;
      state.currentPage = pageId;
      // Expose the page/chapter ids on the panes container so comments.js can
      // record where each comment lives (data/<lang>/chapters/<chapterId>.json).
      elPanes.dataset.pageId = pageId;
      elPanes.dataset.chapterId = chId;
      var rChapter = res[1], rPage, rErr = null;
      if (rChapter && rChapter.__err) {
        rErr = (STRINGS[rlang] || STRINGS.fr).loadErr + rChapter.__err.message;
        rPage = { html: '', title: frPage.title };
      } else {
        rPage = pickPage(rChapter, pageId);
      }
      renderAligned(frPage, rPage, rlang, rErr);
      markCurrent(pageId);
      if (keepScroll) elContent.scrollTop = prevScroll;
      else if (anchor) scrollToAnchor(anchor);
      else elContent.scrollTop = 0;
    }).catch(function (e) {
      elPanes.innerHTML = '<p class="error">' + STRINGS.fr.loadErr + e.message + '</p>';
    });
  }

  // Split a page's html into its sequence of top-level block elements. The
  // translation pipeline preserves this sequence 1:1 across fr/en/cn (same count
  // and kind of blocks in the same order), so blocks pair cleanly by index.
  function parseBlocks(html) {
    var tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    var out = [];
    Array.prototype.forEach.call(tpl.content.childNodes, function (n) {
      if (n.nodeType === 1) out.push(n);  // element nodes only (drop whitespace)
    });
    return out;
  }

  // Build the footnotes <section> as a detached element so it can be paired into
  // a trailing aligned row (mirrors the old per-pane footnotes block).
  function footnotesEl(page, lang) {
    if (!page || !page.footnotes || !page.footnotes.length) return null;
    var s = STRINGS[lang] || STRINGS.fr;
    var sec = document.createElement('section');
    sec.id = 'footnotes';
    var ol = document.createElement('ol');
    page.footnotes.forEach(function (f) {
      var li = document.createElement('li');
      li.id = f.id;
      li.innerHTML = f.html +
        ' <a class="backref" href="#' + f.id + 'ref" title="' + s.backref + '">↩</a>';
      ol.appendChild(li);
    });
    sec.appendChild(ol);
    return sec;
  }

  function renderAligned(frPage, rPage, rlang, rErr) {
    var s = STRINGS[rlang] || STRINGS.fr;
    var leftBlocks = parseBlocks(frPage.html || '');
    var rightHtml = (rPage && rPage.html) ? rPage.html : '';
    var rightBlocks;
    if (rightHtml.trim()) {
      rightBlocks = parseBlocks(rightHtml);
    } else {
      // No translation (or load error): one placeholder block beside the French
      // title; the remaining rows keep the French text reading on the left.
      var ph = document.createElement('div');
      ph.innerHTML = '<h1>' + ((rPage && rPage.title) || frPage.title || '') + '</h1>' +
        (rErr ? '<p class="error">' + rErr + '</p>'
              : '<p class="muted"><em>' + s.notrans + '</em></p>');
      rightBlocks = [ph];
    }
    // Footnotes pair as a final aligned row.
    var lf = footnotesEl(frPage, 'fr');
    var rf = footnotesEl(rPage, rlang);
    if (lf) leftBlocks.push(lf);
    if (rf) rightBlocks.push(rf);

    var frag = document.createDocumentFragment();
    var n = Math.max(leftBlocks.length, rightBlocks.length);
    for (var i = 0; i < n; i++) {
      frag.appendChild(buildRow(leftBlocks[i] || null, rightBlocks[i] || null, rlang, i));
    }
    elPanes.innerHTML = '';
    elPanes.appendChild(frag);
    wireProofs(elPanes);
    typeset(elPanes);
    // Let comments.js (re-)apply its block badges for the page just rendered.
    document.dispatchEvent(new CustomEvent('panes:rendered'));
  }

  // One aligned row: French block in the left cell, its translation in the right
  // cell. align-items:start (in CSS) tops them out, so each pair lines up. The
  // block index (same on both cells, stable across fr/en/cn) lets comments.js
  // anchor a comment to a block that has no id of its own.
  function buildRow(leftNode, rightNode, rlang, idx) {
    var row = document.createElement('div');
    row.className = 'align-row';
    var lc = document.createElement('div');
    lc.className = 'cell cell-left';
    lc.lang = 'fr';
    lc.dataset.blockIndex = idx;
    if (leftNode) lc.appendChild(leftNode);
    var rc = document.createElement('div');
    rc.className = 'cell cell-right';
    rc.lang = rlang;
    rc.dataset.blockIndex = idx;
    if (rightNode) {
      rc.appendChild(rightNode);
      // The right cell reuses the same element ids as the left (ids are shared
      // across languages), so namespace them to keep the DOM valid and ensure
      // getElementById/scrollToAnchor resolve to the canonical left (French) cell.
      namespaceIds(rc);
    }
    row.appendChild(lc);
    row.appendChild(rc);
    return row;
  }

  // Prefix every id in the right cell so it never collides with the left cell.
  function namespaceIds(el) {
    el.querySelectorAll('[id]').forEach(function (n) { n.id = 'r-' + n.id; });
  }

  // Wire collapsible proofs. Proof blocks carry stable ids (proof-x <-> r-proof-x),
  // so toggling one proof toggles its paired translation, keeping the row aligned.
  function wireProofs(root) {
    root.querySelectorAll('.proof-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var proof = h.parentNode;
        var collapsed = proof.classList.toggle('collapsed');
        var id = proof.id;
        if (!id) return;
        var mateId = id.indexOf('r-') === 0 ? id.slice(2) : 'r-' + id;
        var mate = document.getElementById(mateId);
        if (mate) mate.classList.toggle('collapsed', collapsed);
      });
    });
  }

  function markCurrent(pageId) {
    elSidebar.querySelectorAll('a.current').forEach(function (a) { a.classList.remove('current'); });
    var a = elSidebar.querySelector('a[data-page="' + cssEscape(pageId) + '"]');
    if (a) {
      a.classList.add('current');
      a.scrollIntoView({ block: 'nearest' });
    }
  }

  function scrollToAnchor(id) {
    var el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.classList.add('target-flash');
      setTimeout(function () { el.classList.remove('target-flash'); }, 1300);
    }
  }

  function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

  // Resolve a hash like "#I.1.3" or "#I-1" into a {page, anchor}.
  function resolveHash(hash) {
    var raw = decodeURIComponent(hash.replace(/^#/, ''));
    if (!raw) return null;
    if (state.pageToChapter.hasOwnProperty(raw)) return { page: raw, anchor: null };
    var pid = state.anchorIndex[raw];
    if (pid) return { page: pid, anchor: raw };
    // toc-anchor-<CHAP> style fallbacks -> jump to chapter landing page
    var m = raw.match(/^toc-anchor-(.+)$/);
    if (m) {
      var key = m[1].replace(/-/g, '.');
      var pid2 = state.anchorIndex[key] || (state.pageToChapter.hasOwnProperty(key) ? key : null);
      if (pid2) return { page: pid2, anchor: key };
    }
    return null;
  }

  function navigate(hash) {
    var r = resolveHash(hash);
    if (!r) {
      var def = state.manifest.default_page_id || state.manifest.chapters[0].page_ids[0];
      showPage(def, null);
      return;
    }
    showPage(r.page, r.anchor);
  }

  // intercept internal link clicks (incl. links inside rendered content)
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    var hash = a.getAttribute('href');
    e.preventDefault();
    if (history.pushState) history.pushState(null, '', hash);
    navigate(hash);
  });

  window.addEventListener('popstate', function () { navigate(location.hash); });

  // right-pane language switch (EN / 中文): re-renders only the right pane.
  document.getElementById('lang-switch').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-rlang]');
    if (!b) return;
    var lang = b.getAttribute('data-rlang');
    if (lang === state.rightLang) return;
    state.rightLang = lang;
    try { localStorage.setItem('rightLang', lang); } catch (_) {}
    document.querySelectorAll('#lang-switch button').forEach(function (x) {
      x.classList.toggle('active', x === b);
    });
    // Re-lay-out the current page in the new language, preserving scroll (the
    // whole grid is rebuilt because the right blocks change height).
    if (state.currentPage) renderPageAligned(state.currentPage, null, true);
  });

  // menu toggle: mobile shows the sidebar as an overlay (.open); on desktop it
  // collapses the sidebar entirely (persisted).
  document.getElementById('menu-toggle').addEventListener('click', function () {
    if (window.matchMedia('(max-width: 800px)').matches) {
      elSidebar.classList.toggle('open');
    } else {
      var collapsed = document.body.classList.toggle('sidebar-collapsed');
      try { localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0'); } catch (_) {}
    }
  });

  // restore persisted prefs before the first render (avoids a layout flash)
  try {
    var rl = localStorage.getItem('rightLang');
    if (rl === 'en' || rl === 'cn') state.rightLang = rl;
    if (localStorage.getItem('sidebarCollapsed') === '1') document.body.classList.add('sidebar-collapsed');
  } catch (_) {}
  document.querySelectorAll('#lang-switch button').forEach(function (x) {
    x.classList.toggle('active', x.getAttribute('data-rlang') === state.rightLang);
  });

  // boot
  loadManifest().then(function () {
    navigate(location.hash || ('#' + (state.manifest.default_page_id || '')));
  }).catch(function (e) {
    elPanes.innerHTML = '<p class="error">Impossible de charger le manifeste / Could not load the manifest (' +
                       e.message + '). Servez ce dossier via un serveur HTTP / Serve this folder over HTTP ' +
                       '(<code>python3 -m http.server</code>).</p>';
  });
})();
