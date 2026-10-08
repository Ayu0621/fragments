/* =========================
   Writing Page (Posts)
   - post-style cards
   - publication date (user-chosen)
   - MULTI tags (comma-separated)
   - tag filter + URL ?tag=xxx
   - search title/text/tag
   - timeline/list view
   - click title to expand/collapse
   - edit/delete
   ========================= */
window.WritingPage = (() => {
  const KEY = "site:writing:v2";
  const VIEW_KEY = "site:writing:view";
  const LAST_TAG_KEY = "site:writing:lastTag";

  let editingId = null;
  let activeTag = "all";
  let viewMode = "timeline"; // timeline | list
  let query = "";

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatYMD(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${y}.${m}.${d}`;
  }

  function monthKey(iso) {
    if (!iso) return "";
    const [y, m] = iso.split("-");
    return `${y}.${m}`;
  }

  function read() {
    return Store.get(KEY, []);
  }

  function write(list) {
    Store.set(KEY, list);
  }

  function clampList(list, maxItems = 12) {
    return (list || []).slice(0, maxItems);
  }

  function parseTags(raw) {
    const s = (raw || "").trim();
    if (!s) return [];
    // split by , ， ; ； / | newline
    const parts = s
      .split(/[，,;；\n\r\t\|\/]+/g)
      .map(x => x.trim())
      .filter(Boolean);

    const out = [];
    const seen = new Set();
    for (const p of parts) {
      const t = p.slice(0, 30);
      const key = t.toLowerCase();
      if (!t || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= 12) break;
    }
    return out;
  }

  function tagsToString(tags) {
    const arr = Array.isArray(tags) ? tags : [];
    return arr.join(", ");
  }

  function normalizeItem(x) {
    if (!x) return x;
    // Back-compat: old schema may have { tag: "xxx" }
    const tags = Array.isArray(x.tags)
      ? x.tags
      : ((x.tag || "").trim() ? [String(x.tag).trim()] : []);

    return {
      ...x,
      tags: clampList(tags.filter(Boolean).map(t => String(t).trim()), 12)
    };
  }

  function normalizeList(list) {
    return (list || []).map(normalizeItem);
  }

  function uniqTags(list) {
    const s = new Set();
    for (const raw of list) {
      const x = normalizeItem(raw);
      for (const t of (x.tags || [])) {
        const tt = (t || "").trim();
        if (tt) s.add(tt);
      }
    }
    return ["all", ...Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hans"))];
  }

  function refreshFilterOptions(list) {
    const sel = document.getElementById("writingTagFilter");
    if (!sel) return;

    const tags = uniqTags(list);
    // IMPORTANT: honor activeTag (URL / lastTag) first, then fallback to select
    const current = activeTag || sel.value || "all";

    sel.innerHTML = "";
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = (t === "all") ? "All Tags" : t;
      sel.appendChild(opt);
    }

    sel.value = tags.includes(current) ? current : "all";
    activeTag = sel.value;

    Store.set(LAST_TAG_KEY, activeTag);
  }

  function calcStats(text) {
    const raw = (text || "");
    const noSpace = raw.replace(/\s/g, "");
    const chars = noSpace.length;
    const words = (raw.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []).length;
    return { chars, words };
  }

  function updateStatsUI() {
    const textEl = document.getElementById("writingText");
    const statsEl = document.getElementById("writingStats");
    if (!textEl || !statsEl) return;
    const { chars, words } = calcStats(textEl.value || "");
    statsEl.textContent = `Chars: ${chars} • Words: ${words}`;
  }

  function openDialog(mode, item = null) {
    const dialog = document.getElementById("writingDialog");
    const titleEl = document.getElementById("writingTitle");
    const textEl = document.getElementById("writingText");
    const dateEl = document.getElementById("writingDate");
    const tagEl = document.getElementById("writingTag");
    const delBtn = document.getElementById("writingDeleteBtn");

    if (!dialog || !titleEl || !textEl || !dateEl || !tagEl || !delBtn) return;

    if (mode === "new") {
      editingId = null;
      titleEl.value = "";
      textEl.value = "";
      dateEl.value = todayISO();
      tagEl.value = (activeTag !== "all") ? activeTag : "";
      delBtn.classList.add("hidden");
    } else {
      const it = normalizeItem(item);
      editingId = it.id;
      titleEl.value = it.title || "";
      textEl.value = it.text || "";
      dateEl.value = it.date || todayISO();
      tagEl.value = tagsToString(it.tags || []);
      delBtn.classList.remove("hidden");
    }

    dialog.showModal();
    updateStatsUI();
    titleEl.focus();
  }

  function closeDialog() {
    document.getElementById("writingDialog")?.close();
  }

  function saveFromDialog() {
    const titleEl = document.getElementById("writingTitle");
    const textEl = document.getElementById("writingText");
    const dateEl = document.getElementById("writingDate");
    const tagEl = document.getElementById("writingTag");

    const title = (titleEl?.value || "").trim();
    const text = (textEl?.value || "").trim();
    const date = dateEl?.value || todayISO();
    const tags = parseTags(tagEl?.value || "");

    if (!title) {
      alert("Title Is Required.");
      return;
    }
    if (!text) {
      alert("Write Something First.");
      return;
    }

    const list = normalizeList(read());

    if (!editingId) {
      list.unshift({
        id: Store.uid(),
        title,
        text,
        date,
        tags,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    } else {
      const idx = list.findIndex(x => x.id === editingId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], title, text, date, tags, updatedAt: Date.now() };
      }
    }

    write(list);
    refreshFilterOptions(list);
    render();
    closeDialog();
  }

  function deleteEditing() {
    if (!editingId) return;
    const ok = confirm("Delete This Post?");
    if (!ok) return;

    const list = normalizeList(read()).filter(x => x.id !== editingId);
    write(list);
    refreshFilterOptions(list);
    render();
    closeDialog();
  }

  function initFromURL(list) {
    const params = new URLSearchParams(location.search);
    const t = (params.get("tag") || "").trim();
    if (t) {
      // ALWAYS honor ?tag=... even if there are no posts yet
      activeTag = t;
      return;
    }

    // fallback to last chosen tag
    const last = (Store.get(LAST_TAG_KEY, "all") || "all").trim();
    activeTag = last || "all";
  }

  function normalize(s) {
    return (s || "").toLowerCase().trim();
  }

  function hasTag(item, tag) {
    const it = normalizeItem(item);
    return (it.tags || []).map(x => String(x).trim()).includes(tag);
  }

  function matches(item) {
    const it = normalizeItem(item);
    if (activeTag !== "all" && !hasTag(it, activeTag)) return false;
    if (!query) return true;

    const q = normalize(query);
    const tagStr = (it.tags || []).join(" ");
    const hay = normalize([it.title, it.text, tagStr].filter(Boolean).join(" "));
    return hay.includes(q);
  }

  function sortByDateDesc(a, b) {
    const ad = a.date || "0000-01-01";
    const bd = b.date || "0000-01-01";
    if (ad > bd) return -1;
    if (ad < bd) return 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  }

  function excerptText(t, max = 260) {
    const s = (t || "").trim();
    if (s.length <= max) return s;
    return s.slice(0, max) + "…";
  }

  function makeTagChip(t) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = t;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      activeTag = t;
      const sel = document.getElementById("writingTagFilter");
      if (sel) sel.value = t;
      Store.set(LAST_TAG_KEY, activeTag);
      render();
    });
    return chip;
  }

  function buildCard(item) {
    const it = normalizeItem(item);

    const card = document.createElement("article");
    card.className = "writing-card";

    const top = document.createElement("div");
    top.className = "writing-top";

    const meta = document.createElement("div");
    meta.className = "writing-meta";

    const date = document.createElement("div");
    date.className = "post-date";
    date.textContent = formatYMD(it.date || "");

    meta.appendChild(date);

    // tags
    if ((it.tags || []).length) {
      const chips = document.createElement("div");
      chips.className = "tag-row";
      for (const t of it.tags) chips.appendChild(makeTagChip(t));
      meta.appendChild(chips);
    }

    const actions = document.createElement("div");
    actions.className = "post-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "post-action";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDialog("edit", it);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "post-action";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ok = confirm("Delete This Post?");
      if (!ok) return;
      const next = normalizeList(read()).filter(x => x.id !== it.id);
      write(next);
      refreshFilterOptions(next);
      render();
    });

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    top.appendChild(meta);
    top.appendChild(actions);

    const title = document.createElement("h3");
    title.className = "writing-title";
    title.textContent = it.title || "";

    const body = document.createElement("div");
    body.className = "writing-excerpt is-collapsed";
    body.textContent = excerptText(it.text || "", 520);

    const more = document.createElement("button");
    more.type = "button";
    more.className = "more-link";
    more.textContent = "Expand";

    function setOpen(open) {
      card.classList.toggle("is-open", open);
      body.classList.toggle("is-collapsed", !open);
      body.textContent = open ? (it.text || "") : excerptText(it.text || "", 520);
      more.textContent = open ? "Collapse" : "Expand";
    }

    // click title toggles
    title.style.cursor = "pointer";
    title.addEventListener("click", () => setOpen(!card.classList.contains("is-open")));
    more.addEventListener("click", () => setOpen(!card.classList.contains("is-open")));

    card.appendChild(top);
    card.appendChild(title);
    card.appendChild(body);

    // show expand only when long
    if (((it.text || "").trim().length) > 520) {
      card.appendChild(more);
    }

    return card;
  }

  function render() {
    const grid = document.getElementById("writingGrid");
    if (!grid) return;

    const raw = read();
    const list = normalizeList(raw);

    // keep filter options in sync with any migrated tags
    refreshFilterOptions(list);

    const filtered = list.filter(matches).sort(sortByDateDesc);

    grid.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.style.padding = "10px 2px";
      empty.textContent = query
        ? "No matching posts."
        : (activeTag === "all" ? "No Posts Yet. Click “+ Add”." : "No Posts Under This Tag Yet.");
      grid.appendChild(empty);
      return;
    }

    if (viewMode === "list") {
      for (const item of filtered) grid.appendChild(buildCard(item));
      return;
    }

    // timeline
    const groups = new Map();
    for (const item of filtered) {
      const k = monthKey(item.date || "");
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(item);
    }

    for (const [k, items] of groups) {
      const group = document.createElement("section");
      group.className = "timeline-group";

      const h = document.createElement("h4");
      h.className = "timeline-title";
      h.textContent = k;
      group.appendChild(h);

      for (const item of items) group.appendChild(buildCard(item));

      grid.appendChild(group);
    }
  }

  function setView(next) {
    viewMode = next;
    Store.set(VIEW_KEY, viewMode);
    document.querySelectorAll(".seg__btn").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.view === next);
    });
    render();
  }

  function init() {
    const addBtn = document.getElementById("writingAddBtn");
    const sel = document.getElementById("writingTagFilter");
    const searchEl = document.getElementById("writingSearch");

    const saveBtn = document.getElementById("writingSaveBtn");
    const deleteBtn = document.getElementById("writingDeleteBtn");

    const list = normalizeList(read());

    viewMode = Store.get(VIEW_KEY, "timeline") || "timeline";
    initFromURL(list);

    refreshFilterOptions(list);
    sel.value = activeTag;

    // set view buttons
    document.querySelectorAll(".seg__btn").forEach(btn => {
      btn.addEventListener("click", () => setView(btn.dataset.view));
    });
    setView(viewMode);

    sel.addEventListener("change", () => {
      activeTag = sel.value;
      Store.set(LAST_TAG_KEY, activeTag);
      render();
    });

    searchEl.addEventListener("input", () => {
      query = searchEl.value || "";
      render();
    });

    addBtn.addEventListener("click", () => openDialog("new"));
    saveBtn.addEventListener("click", saveFromDialog);
    deleteBtn.addEventListener("click", deleteEditing);

    document.getElementById("writingText")?.addEventListener("input", updateStatsUI);

    render();
  }

  return { init };
})();
