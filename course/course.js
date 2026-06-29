/* Course reader: loads a manifest of modules/lessons, lazy-loads each lesson's
   HTML fragment from course/lessons/<id>.html, and typesets math with MathJax.
   Navigation is hash-based (#<lesson-id>), so lesson cross-references are plain
   <a href="#<id>"> links and the browser back/forward + refresh all work. */
(function () {
  "use strict";

  var sidebar = document.getElementById("sidebar");
  var lessonEl = document.getElementById("lesson");
  var menuToggle = document.getElementById("menu-toggle");

  var FLAT = [];          // ordered [{id,title,module}]
  var BY_ID = {};         // id -> {id,title,module}
  var CACHE = {};         // id -> html string

  // MathJax loads async; the first typeset can race it. Retry until ready.
  function typeset(el) {
    if (window.MathJax && MathJax.startup && MathJax.startup.promise && MathJax.typesetPromise) {
      MathJax.startup.promise
        .then(function () { return MathJax.typesetPromise([el]); })
        .catch(function (e) { console.error("MathJax typeset failed", e); });
    } else {
      setTimeout(function () { typeset(el); }, 120);
    }
  }

  function buildSidebar(manifest) {
    var html = "";
    manifest.modules.forEach(function (mod) {
      html += '<div class="mod-title">' + esc(mod.title) + "</div>";
      mod.lessons.forEach(function (ls) {
        ls.module = mod.title;
        FLAT.push(ls);
        BY_ID[ls.id] = ls;
        html += '<a class="lesson" data-id="' + ls.id + '" href="#' + ls.id + '">' +
                esc(ls.title) + "</a>";
      });
    });
    sidebar.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function highlight(id) {
    var links = sidebar.querySelectorAll("a.lesson");
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle("current", links[i].getAttribute("data-id") === id);
    }
  }

  function navHtml(id) {
    var idx = FLAT.findIndex(function (l) { return l.id === id; });
    var prev = idx > 0 ? FLAT[idx - 1] : null;
    var next = idx >= 0 && idx < FLAT.length - 1 ? FLAT[idx + 1] : null;
    var h = '<nav class="lesson-nav">';
    h += prev
      ? '<a class="prev" href="#' + prev.id + '"><div class="dir">← Previous</div><div class="ttl">' + esc(prev.title) + "</div></a>"
      : "<span></span>";
    h += next
      ? '<a class="next" href="#' + next.id + '"><div class="dir">Next →</div><div class="ttl">' + esc(next.title) + "</div></a>"
      : "<span></span>";
    h += "</nav>";
    return h;
  }

  function render(id, body) {
    var ls = BY_ID[id];
    var crumb = ls ? '<div class="crumb">' + esc(ls.module) + "</div>" : "";
    lessonEl.innerHTML = crumb + body + navHtml(id);
    highlight(id);
    document.title = (ls ? ls.title : "Course") + " · Deligne–Illusie";
    typeset(lessonEl);
    document.getElementById("content").scrollTop = 0;
    if (window.innerWidth <= 800) sidebar.classList.remove("open");
  }

  function loadLesson(id) {
    if (!BY_ID[id]) id = FLAT[0] && FLAT[0].id;
    if (!id) return;
    if (CACHE[id]) { render(id, CACHE[id]); return; }
    lessonEl.innerHTML = '<p style="color:#6b675e">Loading…</p>';
    fetch("course/lessons/" + id + ".html")
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (txt) { CACHE[id] = txt; render(id, txt); })
      .catch(function (e) {
        lessonEl.innerHTML = '<h1>Lesson not found</h1><p style="color:#6b675e">Could not load <code>' +
          esc(id) + "</code> (" + esc(e.message) + ").</p>" + navHtml(id);
        highlight(id);
      });
  }

  function currentId() { return (location.hash || "").replace(/^#/, ""); }

  function go() { loadLesson(currentId() || (FLAT[0] && FLAT[0].id)); }

  window.addEventListener("hashchange", go);

  // keyboard: ← / → move between lessons
  document.addEventListener("keydown", function (e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var idx = FLAT.findIndex(function (l) { return l.id === currentId(); });
    if (e.key === "ArrowLeft" && idx > 0) location.hash = "#" + FLAT[idx - 1].id;
    if (e.key === "ArrowRight" && idx >= 0 && idx < FLAT.length - 1) location.hash = "#" + FLAT[idx + 1].id;
  });

  if (menuToggle) {
    menuToggle.addEventListener("click", function () {
      if (window.innerWidth <= 800) sidebar.classList.toggle("open");
      else document.body.classList.toggle("sidebar-collapsed");
    });
  }

  fetch("course/manifest.json")
    .then(function (r) { return r.json(); })
    .then(function (manifest) { buildSidebar(manifest); go(); })
    .catch(function (e) {
      lessonEl.innerHTML = "<h1>Could not load the course</h1><p>" + esc(e.message) + "</p>";
    });
})();
