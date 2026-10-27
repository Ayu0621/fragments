/* ========== tiny storage helpers ========== */
const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  uid() {
    return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  }
};

function clampText(s, max = 1200) {
  const t = (s || "").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}

/* =========================
   To-do Page V3 — Two-week planning workspace
   - shared ToDo data for Calendar + List
   - Maybe / Wish retain independent lists
   - DDL remains optional; calendar-created tasks inherit the clicked date
   ========================= */
const TodoPageV2 = (() => {
  const KEY = "site:todos:v2"; // Keep the existing task storage key.
  const HIDE_DONE_KEY = "site:todoHideDone:v2";
  const MOBILE_VIEW_KEY = "site:todo:mobileView:v1";
  const WEEK_KEY = "site:todo:calendarWeekStart:v1";

  let hideDone = true;
  let activeList = "main"; // main | maybe | wish; used by the + ADD composer
  let activeView = "calendar"; // mobile preference only; desktop shows both panes
  let calendarCursor = null; // Monday of the visible first week
  let selectedDate = "";
  let mobileShowTwoWeeks = false;
  let editingListId = null;
  let editingId = null;
  let dayDialogDate = "";

  function read() {
    const stored = Store.get(KEY, { main: [], maybe: [], wish: [] });
    const value = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    return {
      ...value,
      main: Array.isArray(value.main) ? value.main : [],
      maybe: Array.isArray(value.maybe) ? value.maybe : [],
      wish: Array.isArray(value.wish) ? value.wish : []
    };
  }

  function write(data) {
    Store.set(KEY, data);
  }

  function todayISO() {
    return isoFromDate(new Date());
  }

  function isoFromDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseISOToLocal(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return null;
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(date, amount) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + amount);
    return next;
  }

  function mondayOf(date) {
    const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const daysSinceMonday = (base.getDay() + 6) % 7;
    base.setDate(base.getDate() - daysSinceMonday);
    return base;
  }

  function isMobileLayout() {
    return window.matchMedia ? window.matchMedia("(max-width: 760px)").matches : window.innerWidth <= 760;
  }

  function formatDueLabel(iso) {
    if (!iso) return "No DDL";
    const [y, m, d] = iso.split("-");
    return `${y}.${m}.${d}`;
  }

  function formatDayLabel(iso, includeWeekday = true) {
    const date = parseISOToLocal(iso);
    if (!date) return iso || "";
    return new Intl.DateTimeFormat("en-GB", includeWeekday
      ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
      : { day: "numeric", month: "short", year: "numeric" }
    ).format(date);
  }

  function formatRangeLabel(start, end) {
    const sameYear = start.getFullYear() === end.getFullYear();
    const startText = new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" })
    }).format(start);
    const endText = new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", year: "numeric"
    }).format(end);
    return `${startText} – ${endText}`;
  }

  function ensureCalendarCursor() {
    if (calendarCursor instanceof Date && !Number.isNaN(calendarCursor.getTime())) return;
    const saved = Store.get(WEEK_KEY, "");
    const savedDate = parseISOToLocal(saved);
    calendarCursor = mondayOf(savedDate || new Date());
    Store.set(WEEK_KEY, isoFromDate(calendarCursor));
  }

  function persistCalendarCursor() {
    ensureCalendarCursor();
    Store.set(WEEK_KEY, isoFromDate(calendarCursor));
  }

  function sortMain(list) {
    return [...list].sort((a, b) => {
      const ad = a.due || "9999-12-31";
      const bd = b.due || "9999-12-31";
      if (ad < bd) return -1;
      if (ad > bd) return 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function sortSimple(list) {
    return [...list].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function getDayState(item) {
    const today = todayISO();
    return {
      isDone: !!item.done,
      isOverdue: !!(item.due && !item.done && item.due < today),
      isTodayDue: !!(item.due && !item.done && item.due === today)
    };
  }

  function getVisibleDates() {
    ensureCalendarCursor();
    const mobileOneWeek = isMobileLayout() && !mobileShowTwoWeeks;
    const length = mobileOneWeek ? 7 : 14;
    return Array.from({ length }, (_, i) => addDays(calendarCursor, i));
  }

  function dateIsInVisibleRange(iso) {
    return getVisibleDates().some(date => isoFromDate(date) === iso);
  }

  function moveCalendarToDate(iso) {
    const date = parseISOToLocal(iso);
    if (!date) return;
    if (!dateIsInVisibleRange(iso)) {
      calendarCursor = mondayOf(date);
      persistCalendarCursor();
    }
  }

  function getTasksForDate(iso) {
    let tasks = sortMain(read().main).filter(item => item.due === iso);
    if (hideDone) tasks = tasks.filter(item => !item.done);
    return tasks;
  }

  function setActiveList(next) {
    activeList = ["main", "maybe", "wish"].includes(next) ? next : "main";
    document.querySelectorAll(".seg__btn[data-list]").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.list === activeList);
      btn.setAttribute("aria-pressed", btn.dataset.list === activeList ? "true" : "false");
    });

    const dueField = document.getElementById("todoDueField");
    const dueEl = document.getElementById("todoDue");
    const hint = document.getElementById("composerHint");
    if (dueField) dueField.classList.toggle("hidden", activeList !== "main");
    if (dueEl && activeList !== "main") dueEl.value = "";
    if (hint) {
      hint.textContent = activeList === "main"
        ? "ToDo · DDL is optional"
        : activeList === "maybe" ? "Maybe · No date required" : "Wish · No date required";
    }
  }

  function openEditDialog(listId, item) {
    const dialog = document.getElementById("todoEditDialog");
    const textEl = document.getElementById("todoEditText");
    const dueEl = document.getElementById("todoEditDue");
    const dueField = document.getElementById("todoEditDueField");
    const doneEl = document.getElementById("todoEditDone");
    if (!dialog || !textEl || !dueEl || !doneEl) return;

    editingListId = listId;
    editingId = item.id;
    textEl.value = item.text || "";
    doneEl.checked = !!item.done;
    if (dueField) dueField.classList.toggle("hidden", listId !== "main");
    dueEl.value = listId === "main" ? (item.due || "") : "";

    dialog.showModal();
    textEl.focus();
  }

  function closeEditDialog() {
    const dialog = document.getElementById("todoEditDialog");
    if (dialog?.open) dialog.close();
    editingListId = null;
    editingId = null;
  }

  function saveEdit() {
    const textEl = document.getElementById("todoEditText");
    const dueEl = document.getElementById("todoEditDue");
    const doneEl = document.getElementById("todoEditDone");
    const text = (textEl?.value || "").trim();
    const due = dueEl?.value || "";
    const done = !!doneEl?.checked;
    if (!editingListId || !editingId || !text) {
      if (!text) textEl?.focus();
      return;
    }

    const data = read();
    const idx = (data[editingListId] || []).findIndex(item => item.id === editingId);
    if (idx < 0) return;
    data[editingListId][idx] = {
      ...data[editingListId][idx],
      text,
      due: editingListId === "main" ? due : "",
      done,
      updatedAt: Date.now()
    };
    write(data);

    if (editingListId === "main" && due) {
      moveCalendarToDate(due);
      selectedDate = due;
    }
    closeEditDialog();
    renderAll();
  }

  function deleteTask(listId, id) {
    const ok = confirm("Delete This Task?");
    if (!ok) return;
    const data = read();
    data[listId] = (data[listId] || []).filter(item => item.id !== id);
    write(data);
    closeDayDialog();
    renderAll();
  }

  function deleteEdit() {
    if (!editingListId || !editingId) return;
    const listId = editingListId;
    const id = editingId;
    const ok = confirm("Delete This Task?");
    if (!ok) return;
    const data = read();
    data[listId] = (data[listId] || []).filter(item => item.id !== id);
    write(data);
    closeEditDialog();
    closeDayDialog();
    renderAll();
  }

  function toggleTaskDone(listId, id, isDone) {
    const data = read();
    const item = (data[listId] || []).find(entry => entry.id === id);
    if (!item) return;
    item.done = !!isDone;
    item.updatedAt = Date.now();
    write(data);
    renderAll();
  }

  function renderList(listId, containerId, withDue) {
    const container = document.getElementById(containerId);
    if (!container) return;
    let list = listId === "main" ? sortMain(read().main) : sortSimple(read()[listId]);
    if (hideDone) list = list.filter(item => !item.done);
    container.innerHTML = "";

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "hint todo-empty-state";
      empty.textContent = hideDone ? "No open tasks. (Done items are hidden)" : "No tasks yet.";
      container.appendChild(empty);
      return;
    }

    for (const task of list) {
      const row = document.createElement("div");
      row.className = withDue ? "todo-row todo-row--actions" : "todo-row todo-row--nodue todo-row--actions";
      if (task.done) row.classList.add("is-done");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "todo-check";
      checkbox.checked = !!task.done;
      checkbox.setAttribute("aria-label", `Mark ${task.text} as ${task.done ? "not done" : "done"}`);
      checkbox.addEventListener("change", () => toggleTaskDone(listId, task.id, checkbox.checked));

      const text = document.createElement("button");
      text.type = "button";
      text.className = "todo-text todo-text-button";
      text.textContent = task.text;
      text.title = "Click to edit";
      if (task.done) text.classList.add("is-done");
      if (withDue && task.due) {
        const state = getDayState(task);
        if (state.isOverdue) text.classList.add("todo-text--overdue");
        else if (state.isTodayDue) text.classList.add("todo-text--today");
      }
      text.addEventListener("click", () => openEditDialog(listId, task));
      row.append(checkbox, text);

      if (withDue) {
        const due = document.createElement("div");
        due.className = "todo-due";
        due.textContent = formatDueLabel(task.due || "");
        if (task.due) {
          const state = getDayState(task);
          if (state.isOverdue) due.classList.add("todo-due--overdue");
          else if (state.isTodayDue) due.classList.add("todo-due--today");
        }
        row.appendChild(due);
      }

      const actions = document.createElement("div");
      actions.className = "todo-row__actions";
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "mini-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openEditDialog(listId, task));
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "mini-btn mini-btn--danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => deleteTask(listId, task.id));
      actions.append(editBtn, delBtn);
      row.appendChild(actions);
      container.appendChild(row);
    }
  }

  function handleCalendarDateClick(iso) {
    if (isMobileLayout()) {
      selectedDate = iso;
      renderCalendar();
      renderSelectedDay();
    } else {
      openComposer(iso, "main");
    }
  }

  function createCalendarTaskButton(task, iso) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "todo-calendar-item";
    const state = getDayState(task);
    if (state.isOverdue) button.classList.add("is-overdue");
    else if (state.isTodayDue) button.classList.add("is-today-due");
    if (task.done) button.classList.add("is-done");
    button.textContent = task.text;
    button.title = `${task.text} · ${formatDueLabel(iso)}`;
    button.addEventListener("click", event => {
      event.stopPropagation();
      openEditDialog("main", task);
    });
    return button;
  }

  function renderCalendar() {
    // Mobile layout always uses one week; desktop may still use the two-week range.
    if (isMobileLayout()) mobileShowTwoWeeks = false;
    ensureCalendarCursor();
    const grid = document.getElementById("todoCalendarGrid");
    const label = document.getElementById("todoCalendarMonthLabel");
    const spanButton = document.getElementById("todoToggleCalendarSpan");
    if (!grid || !label) return;

    const dates = getVisibleDates();
    if (!dates.some(date => isoFromDate(date) === selectedDate)) selectedDate = isoFromDate(dates[0]);
    label.textContent = formatRangeLabel(dates[0], dates[dates.length - 1]);
    grid.classList.toggle("is-two-weeks", dates.length === 14);
    grid.setAttribute("aria-label", `Calendar from ${isoFromDate(dates[0])} to ${isoFromDate(dates[dates.length - 1])}`);
    if (spanButton) spanButton.textContent = mobileShowTwoWeeks ? "Show 1 Week" : "Show 2 Weeks";
    grid.innerHTML = "";

    const allTasks = sortMain(read().main || []);
    for (const date of dates) {
      const iso = isoFromDate(date);
      const cell = document.createElement("div");
      cell.className = "todo-calendar-day";
      cell.dataset.date = iso;
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `${formatDayLabel(iso)}. Click to ${isMobileLayout() ? "select the day" : "add a task"}.`);
      if (iso === todayISO()) cell.classList.add("is-today");
      if (iso === selectedDate) cell.classList.add("is-selected");

      const head = document.createElement("div");
      head.className = "todo-calendar-day__head";
      const weekday = document.createElement("span");
      weekday.className = "todo-calendar-day__weekday";
      weekday.textContent = new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(date);
      const number = document.createElement("span");
      number.className = "todo-calendar-day__number";
      number.textContent = String(date.getDate());
      if (iso === todayISO()) number.classList.add("is-today-number");
      head.append(weekday, number);

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "todo-day-add";
      addBtn.textContent = "+";
      addBtn.setAttribute("aria-label", `Add ToDo for ${formatDayLabel(iso)}`);
      addBtn.title = "Add a ToDo on this date";
      addBtn.addEventListener("click", event => {
        event.stopPropagation();
        openComposer(iso, "main");
      });
      head.appendChild(addBtn);
      cell.appendChild(head);

      let dayTasks = allTasks.filter(task => task.due === iso);
      if (hideDone) dayTasks = dayTasks.filter(task => !task.done);
      const count = document.createElement("div");
      count.className = "todo-calendar-day__count";
      count.textContent = dayTasks.length ? `${dayTasks.length} ${dayTasks.length === 1 ? "task" : "tasks"}` : "";
      count.setAttribute("aria-hidden", "true");
      cell.appendChild(count);

      const list = document.createElement("div");
      list.className = "todo-calendar-items";
      dayTasks.slice(0, 2).forEach(task => list.appendChild(createCalendarTaskButton(task, iso)));
      cell.appendChild(list);

      if (dayTasks.length > 2) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "todo-calendar-more";
        more.textContent = `+${dayTasks.length - 2} more`;
        more.addEventListener("click", event => {
          event.stopPropagation();
          if (isMobileLayout()) {
            selectedDate = iso;
            renderCalendar();
            renderSelectedDay();
          } else {
            openDayDialog(iso);
          }
        });
        cell.appendChild(more);
      }

      cell.addEventListener("click", () => handleCalendarDateClick(iso));
      cell.addEventListener("keydown", event => {
        if (event.target !== cell) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCalendarDateClick(iso);
        }
      });
      grid.appendChild(cell);
    }
  }

  function renderSelectedDay() {
    const panel = document.getElementById("todoSelectedDayPanel");
    const title = document.getElementById("todoSelectedDayTitle");
    const tasksEl = document.getElementById("todoSelectedDayTasks");
    const addBtn = document.getElementById("todoSelectedDayAdd");
    if (!panel || !title || !tasksEl) return;
    title.textContent = formatDayLabel(selectedDate);
    if (addBtn) addBtn.onclick = () => openComposer(selectedDate, "main");
    tasksEl.innerHTML = "";
    const tasks = getTasksForDate(selectedDate);
    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "todo-selected-day-empty";
      empty.textContent = hideDone ? "No open ToDos on this day." : "No ToDos on this day.";
      tasksEl.appendChild(empty);
      return;
    }
    for (const task of tasks) {
      const row = document.createElement("div");
      row.className = "todo-selected-task";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !!task.done;
      check.className = "todo-check";
      check.setAttribute("aria-label", `Mark ${task.text} as done`);
      check.addEventListener("change", () => toggleTaskDone("main", task.id, check.checked));
      const open = document.createElement("button");
      open.type = "button";
      open.className = "todo-selected-task__text";
      open.textContent = task.text;
      if (task.done) open.classList.add("is-done");
      open.addEventListener("click", () => openEditDialog("main", task));
      row.append(check, open);
      tasksEl.appendChild(row);
    }
  }

  function renderAll() {
    renderList("main", "todoListMain", true);
    renderList("maybe", "todoListMaybe", false);
    renderList("wish", "todoListWish", false);
    renderCalendar();
    renderSelectedDay();
  }

  function setView(next) {
    activeView = next === "list" ? "list" : "calendar";
    Store.set(MOBILE_VIEW_KEY, activeView);
    const workspace = document.getElementById("todoWorkspace");
    if (workspace) workspace.dataset.mobileView = activeView;
    document.querySelectorAll(".seg__btn[data-todo-view]").forEach(btn => {
      const isActive = btn.dataset.todoView === activeView;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function shiftWeeks(delta) {
    ensureCalendarCursor();
    const days = isMobileLayout() && !mobileShowTwoWeeks ? 7 : 14;
    calendarCursor = addDays(calendarCursor, delta * days);
    selectedDate = isoFromDate(calendarCursor);
    persistCalendarCursor();
    renderAll();
  }

  function goToCurrentWeek() {
    calendarCursor = mondayOf(new Date());
    selectedDate = todayISO();
    persistCalendarCursor();
    renderAll();
  }

  function openComposer(dueOverride = "", category = null) {
    if (category) setActiveList(category);
    const dialog = document.getElementById("todoCreateDialog");
    const textEl = document.getElementById("todoText");
    const dueEl = document.getElementById("todoDue");
    const titleEl = document.getElementById("todoCreateTitle");
    if (!dialog || !textEl || !dueEl) return;
    if (titleEl) titleEl.textContent = activeList === "main" ? "Add ToDo" : activeList === "maybe" ? "Add Maybe" : "Add Wish";
    textEl.value = "";
    dueEl.value = activeList === "main" ? (dueOverride || "") : "";
    setActiveList(activeList);
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => textEl.focus());
  }

  function closeComposer() {
    const dialog = document.getElementById("todoCreateDialog");
    if (dialog?.open) dialog.close();
    const text = document.getElementById("todoText");
    const due = document.getElementById("todoDue");
    if (text) text.value = "";
    if (due) due.value = "";
  }

  function addTask() {
    const textEl = document.getElementById("todoText");
    const dueEl = document.getElementById("todoDue");
    const text = (textEl?.value || "").trim();
    const due = activeList === "main" ? (dueEl?.value || "") : "";
    if (!text) {
      textEl?.focus();
      return;
    }

    const data = read();
    data[activeList] = data[activeList] || [];
    data[activeList].push({
      id: Store.uid(),
      text,
      due,
      done: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    write(data);

    if (activeList === "main" && due) {
      moveCalendarToDate(due);
      selectedDate = due;
    }
    closeComposer();
    renderAll();
  }

  function openDayDialog(iso) {
    const dialog = document.getElementById("todoDayDialog");
    const title = document.getElementById("todoDayDialogTitle");
    const list = document.getElementById("todoDayDialogTasks");
    if (!dialog || !title || !list) return;
    dayDialogDate = iso;
    title.textContent = formatDayLabel(iso);
    list.innerHTML = "";
    const tasks = getTasksForDate(iso);
    if (!tasks.length) {
      const empty = document.createElement("div");
      empty.className = "todo-selected-day-empty";
      empty.textContent = hideDone ? "No open ToDos on this day." : "No ToDos on this day.";
      list.appendChild(empty);
    } else {
      tasks.forEach(task => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "todo-day-dialog-item";
        button.textContent = `${task.done ? "✓  " : ""}${task.text}`;
        if (task.done) button.classList.add("is-done");
        button.addEventListener("click", () => {
          closeDayDialog();
          openEditDialog("main", task);
        });
        list.appendChild(button);
      });
    }
    dialog.showModal();
  }

  function closeDayDialog() {
    const dialog = document.getElementById("todoDayDialog");
    if (dialog?.open) dialog.close();
  }

  function init() {
    hideDone = Store.get(HIDE_DONE_KEY, true);
    activeView = Store.get(MOBILE_VIEW_KEY, "calendar");
    selectedDate = todayISO();
    ensureCalendarCursor();
    if (!dateIsInVisibleRange(selectedDate)) selectedDate = isoFromDate(calendarCursor);

    const toggle = document.getElementById("toggleHideDone");
    const syncToggleText = () => {
      if (!toggle) return;
      toggle.textContent = `Hide Done: ${hideDone ? "On" : "Off"}`;
      toggle.setAttribute("aria-pressed", hideDone ? "true" : "false");
    };
    syncToggleText();
    toggle?.addEventListener("click", () => {
      hideDone = !hideDone;
      Store.set(HIDE_DONE_KEY, hideDone);
      syncToggleText();
      renderAll();
    });

    document.querySelectorAll(".seg__btn[data-list]").forEach(btn => {
      btn.addEventListener("click", () => setActiveList(btn.dataset.list));
    });
    document.querySelectorAll(".seg__btn[data-todo-view]").forEach(btn => {
      btn.addEventListener("click", () => setView(btn.dataset.todoView));
    });

    document.getElementById("todoPrevWeek")?.addEventListener("click", () => shiftWeeks(-1));
    document.getElementById("todoNextWeek")?.addEventListener("click", () => shiftWeeks(1));
    document.getElementById("todoGoToday")?.addEventListener("click", goToCurrentWeek);
    document.getElementById("todoToggleCalendarSpan")?.addEventListener("click", () => {
      mobileShowTwoWeeks = !mobileShowTwoWeeks;
      renderAll();
    });

    document.getElementById("addTodoBtn")?.addEventListener("click", () => openComposer("", activeList));
    document.getElementById("todoSave")?.addEventListener("click", addTask);
    document.getElementById("todoCancel")?.addEventListener("click", closeComposer);
    document.getElementById("todoText")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTask();
      } else if (event.key === "Escape") {
        closeComposer();
      }
    });

    document.getElementById("todoEditSaveBtn")?.addEventListener("click", saveEdit);
    document.getElementById("todoEditDeleteBtn")?.addEventListener("click", deleteEdit);
    document.getElementById("todoEditText")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveEdit();
      }
    });
    document.getElementById("todoEditDue")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveEdit();
      }
    });

    document.getElementById("todoDayAddBtn")?.addEventListener("click", () => {
      const date = dayDialogDate;
      closeDayDialog();
      openComposer(date, "main");
    });
    setActiveList("main");
    setView(activeView);
    renderAll();

    // Keep the date range and selected-day panel correct if the viewport crosses
    // the desktop/mobile breakpoint while the page remains open.
    let lastMobile = isMobileLayout();
    window.addEventListener("resize", () => {
      const nowMobile = isMobileLayout();
      if (nowMobile !== lastMobile) {
        lastMobile = nowMobile;
        renderAll();
      }
    }, { passive: true });
  }

  return { init };
})();


/* =========================
   Fragments Page (IG Cards)
   - text required
   - date default today (editable)
   - tag optional
   - edit/delete
   - filter by tag + URL ?tag=xxx
   ========================= */
window.FragmentsPage = (() => {
  const KEY = "site:fragments:v1";

  let editingId = null;
  let activeTag = "all";

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

  function read() {
    return Store.get(KEY, []);
  }

  function write(list) {
    Store.set(KEY, list);
  }

  function uniqTags(list) {
    const s = new Set();
    for (const x of list) {
      const t = (x.tag || "").trim();
      if (t) s.add(t);
    }
    return ["all", ...Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hans"))];
  }

  function refreshFilterOptions(list) {
    const sel = document.getElementById("fragTagFilter");
    if (!sel) return;

    let tags = uniqTags(list);
    const current = (activeTag || sel.value || "all").trim() || "all";

    // If we're deep-linked to a tag that doesn't exist yet, still show it in the dropdown.
    if (current !== "all" && !tags.includes(current)) {
      tags = ["all", current, ...tags.filter(x => x !== "all")];
    }

    sel.innerHTML = "";
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = (t === "all") ? "All Tags" : t;
      sel.appendChild(opt);
    }

    sel.value = tags.includes(current) ? current : "all";
    activeTag = sel.value;
  }


function openDialog(mode, item = null) {
    const dialog = document.getElementById("fragDialog");
    const textEl = document.getElementById("fragText");
    const dateEl = document.getElementById("fragDate");
    const tagEl = document.getElementById("fragTag");
    const delBtn = document.getElementById("fragDeleteBtn");

    if (!dialog || !textEl || !dateEl || !tagEl || !delBtn) return;

    if (mode === "new") {
      editingId = null;
      textEl.value = "";
      dateEl.value = todayISO();
      tagEl.value = (activeTag !== "all") ? activeTag : "";
      delBtn.classList.add("hidden");
    } else {
      editingId = item.id;
      textEl.value = item.text || "";
      dateEl.value = item.date || todayISO();
      tagEl.value = item.tag || "";
      delBtn.classList.remove("hidden");
    }

    dialog.showModal();
    textEl.focus();
  }

  function closeDialog() {
    const dialog = document.getElementById("fragDialog");
    dialog?.close();
  }

  function saveFromDialog() {
    const textEl = document.getElementById("fragText");
    const dateEl = document.getElementById("fragDate");
    const tagEl = document.getElementById("fragTag");

    const text = (textEl?.value || "").trim();
    const date = dateEl?.value || todayISO();
    const tag = (tagEl?.value || "").trim();

    if (!text) {
      alert("Write Something First.");
      return;
    }

    const list = read();

    if (!editingId) {
      list.unshift({
        id: Store.uid(),
        text,
        date,
        tag,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    } else {
      const idx = list.findIndex(x => x.id === editingId);
      if (idx >= 0) {
        list[idx] = {
          ...list[idx],
          text,
          date,
          tag,
          updatedAt: Date.now()
        };
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

    const list = read().filter(x => x.id !== editingId);
    write(list);
    refreshFilterOptions(list);
    render();
    closeDialog();
  }

  function render() {
    const grid = document.getElementById("fragGrid");
    if (!grid) return;

    const list = read();
    const filtered = list.filter(x => activeTag === "all" || (x.tag || "").trim() === activeTag);

    grid.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.style.padding = "8px 2px";
      empty.textContent = "No Posts Yet. Click “+ Add”.";
      grid.appendChild(empty);
      return;
    }

    for (const item of filtered) {
      const card = document.createElement("article");
      card.className = "post-card";

      const top = document.createElement("div");
      top.className = "post-top";

      const date = document.createElement("div");
      date.className = "post-date";
      date.textContent = formatYMD(item.date || "");

      const actions = document.createElement("div");
      actions.className = "post-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "post-action";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openDialog("edit", item));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "post-action";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => {
        const ok = confirm("Delete This Post?");
        if (!ok) return;
        const next = read().filter(x => x.id !== item.id);
        write(next);
        refreshFilterOptions(next);
        render();
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      top.appendChild(date);
      top.appendChild(actions);

      const body = document.createElement("div");
      body.className = "post-body";
      body.textContent = item.text;

      card.appendChild(top);

      if ((item.tag || "").trim()) {
        const tagWrap = document.createElement("div");
        tagWrap.style.marginTop = "10px";

        const tag = document.createElement("span");
        tag.className = "post-tag";
        tag.textContent = item.tag.trim();

        tag.addEventListener("click", () => {
          activeTag = item.tag.trim();
          document.getElementById("fragTagFilter").value = activeTag;
          render();
        });

        tagWrap.appendChild(tag);
        card.appendChild(tagWrap);
      }

      card.appendChild(body);

      grid.appendChild(card);
    }
  }

  function initFromURL(list) {
    const params = new URLSearchParams(location.search);
    const t = params.get("tag");
    if (!t) return;
    // Always honor ?tag=... even if there are no posts under that tag yet.
    // This lets Hub deep-links open a "blank filtered view" that you can start adding into.
    activeTag = t.trim() || "all";
  }

  function init() {
    const addBtn = document.getElementById("fragAddBtn");
    const sel = document.getElementById("fragTagFilter");

    const saveBtn = document.getElementById("fragSaveBtn");
    const deleteBtn = document.getElementById("fragDeleteBtn");

    const list = read();
    initFromURL(list);

    refreshFilterOptions(list);
    sel.value = activeTag;

    sel.addEventListener("change", () => {
      activeTag = sel.value;
      render();
    });

    addBtn.addEventListener("click", () => openDialog("new"));

    saveBtn.addEventListener("click", saveFromDialog);
    deleteBtn.addEventListener("click", deleteEditing);

    render();
  }

  return { init };
})();

/* =========================
   INSPO Page (Sticky Notes)
   - text required
   - tag optional
   - mood optional
   - filter by tag
   - edit/delete (click note)
   ========================= */
window.InspoPage = (() => {
  const KEY = "site:inspo:v1";

  let activeTag = "all";
  let editingId = null;

  function read() {
    return Store.get(KEY, []);
  }

  function write(list) {
    Store.set(KEY, list);
  }

  function uniqTags(list) {
    const s = new Set();
    for (const x of list) {
      const t = (x.tag || "").trim();
      if (t) s.add(t);
    }
    return ["all", ...Array.from(s).sort((a, b) => a.localeCompare(b, "zh-Hans"))];
  }

  function moodClass(mood) {
    const m = (mood || "").trim();
    if (!m) return "";
    return `note--${m}`;
  }

  function refreshFilter(list) {
    const sel = document.getElementById("tagFilter");
    if (!sel) return;

    const tags = uniqTags(list);
    const current = sel.value || activeTag || "all";

    sel.innerHTML = "";
    for (const t of tags) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = (t === "all") ? "all tags" : t;
      sel.appendChild(opt);
    }
    sel.value = tags.includes(current) ? current : "all";
    activeTag = sel.value;
  }

  function openDialog(mode, item = null) {
    const dialog = document.getElementById("inspoDialog");
    const textEl = document.getElementById("inspoText");
    const tagEl = document.getElementById("inspoTag");
    const moodEl = document.getElementById("inspoMood");

    if (!dialog || !textEl || !tagEl || !moodEl) return;

    if (mode === "new") {
      editingId = null;
      textEl.value = "";
      tagEl.value = (activeTag !== "all") ? activeTag : "";
      moodEl.value = "";
    } else {
      editingId = item.id;
      textEl.value = item.text || "";
      tagEl.value = item.tag || "";
      moodEl.value = item.mood || "";
    }

    dialog.showModal();
    textEl.focus();
  }

  function closeDialog() {
    document.getElementById("inspoDialog")?.close();
  }

  function saveFromDialog() {
    const textEl = document.getElementById("inspoText");
    const tagEl = document.getElementById("inspoTag");
    const moodEl = document.getElementById("inspoMood");

    const text = clampText(textEl?.value || "", 1200);
    const tag = (tagEl?.value || "").trim();
    const mood = (moodEl?.value || "").trim();

    if (!text) return;

    const list = read();

    if (!editingId) {
      list.unshift({
        id: Store.uid(),
        text,
        tag,
        mood,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    } else {
      const idx = list.findIndex(x => x.id === editingId);
      if (idx >= 0) {
        list[idx] = { ...list[idx], text, tag, mood, updatedAt: Date.now() };
      }
    }

    write(list);
    refreshFilter(list);
    render();
    closeDialog();
  }

  function deleteEditing() {
    if (!editingId) return;
    const ok = confirm("Delete This Note?");
    if (!ok) return;
    const list = read().filter(x => x.id !== editingId);
    write(list);
    refreshFilter(list);
    render();
    closeDialog();
  }

  function render() {
    const grid = document.getElementById("inspoGrid");
    if (!grid) return;

    const list = read();
    const filtered = list.filter(x => activeTag === "all" || (x.tag || "").trim() === activeTag);

    grid.innerHTML = "";

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.style.padding = "12px 2px";
      empty.textContent = "No Notes Yet. Click “＋ add”.";
      grid.appendChild(empty);
      return;
    }

    for (const item of filtered) {
      const note = document.createElement("article");
      note.className = `note ${moodClass(item.mood)}`;

      const head = document.createElement("div");
      head.className = "note__head";

      const tag = document.createElement("div");
      tag.className = "note__tag";
      tag.textContent = (item.tag || "").trim() ? `#${item.tag.trim()}` : "—";

      const actions = document.createElement("div");
      actions.className = "note__actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "mini-btn";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openDialog("edit", item));

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "mini-btn mini-btn--danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => {
        const ok = confirm("Delete This Note?");
        if (!ok) return;
        const next = read().filter(x => x.id !== item.id);
        write(next);
        refreshFilter(next);
        render();
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      head.appendChild(tag);
      head.appendChild(actions);

      const body = document.createElement("div");
      body.className = "note__body";
      body.textContent = item.text;

      note.appendChild(head);
      note.appendChild(body);

      // click note to edit (but keep buttons too)
      note.addEventListener("dblclick", () => openDialog("edit", item));

      grid.appendChild(note);
    }
  }

  function init() {
    const addBtn = document.getElementById("addInspoBtn");
    const sel = document.getElementById("tagFilter");
    const saveBtn = document.getElementById("inspoSave");

    const list = read();
    refreshFilter(list);

    sel?.addEventListener("change", () => {
      activeTag = sel.value;
      render();
    });

    addBtn?.addEventListener("click", () => openDialog("new"));
    saveBtn?.addEventListener("click", (e) => {
      // allow <form method="dialog"> default close; we manage save then close
      e.preventDefault();
      saveFromDialog();
    });

    // optional: add delete button if exists
    const delBtn = document.getElementById("inspoDeleteBtn");
    delBtn?.addEventListener("click", deleteEditing);

    render();
  }

  return { init };
})();



/* =========================
   Writing Page (Posts)
   - post-style cards
   - publication date (user-chosen)
   - tag filter + URL ?tag=xxx
   - edit/delete
   ========================= */
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
      titleEl.value = (it.title || "").trim() || deriveTitleFromText(it.text || "");
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

    let title = (titleEl?.value || "").trim();
    const text = (textEl?.value || "").trim();
    const date = dateEl?.value || todayISO();
    const tags = parseTags(tagEl?.value || "");

    if (!title) {
      // convenience: auto-title from first line of text
      title = deriveTitleFromText(text);
      if (!title || title === "Untitled") {
        alert("Title Is Required.");
        return;
      }
      if (titleEl) titleEl.value = title;
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

  function deriveTitleFromText(text) {
    const raw = (text || "").trim();
    if (!raw) return "Untitled";
    // first non-empty line as title
    const line = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || raw;
    return line.length > 60 ? (line.slice(0, 60) + "…") : line;
  }

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
    title.textContent = (it.title || "").trim() || deriveTitleFromText(it.text || "");

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

/* =========================
   Visual Memory Page (Photo Wall)
   - grid
   - show photo + date (album kept for filtering only)
   - caption stored (optional, not shown on grid)
   - 2 albums: 我的碎片 / 生活碎片
   - add/edit/delete
   ========================= */
window.VisualPage = (() => {
  /*
   * Visual Memory / Personal Posts
   * - 1 post = 1 record containing 1–9 images + caption + date + music.
   * - Feed uses a WeChat-Moments-style thumbnail grid.
   * - Clicking a post opens one photo at a time with previous/next navigation.
   * - Music starts when the post opens and is stopped when the post closes.
   * - Legacy single-photo data is migrated into visualPosts.
   */
  const DB_NAME = "scrapbook-db";
  const DB_VER = 2;
  const LEGACY_STORE = "visualPhotos";
  const POST_STORE = "visualPosts";
  const MAX_IMAGES = 9;

  let activeAlbum = "all";
  let editingId = null;
  let openItem = null;
  let openIndex = 0;
  let objectURLs = [];
  let editorImages = [];

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

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEGACY_STORE)) {
          db.createObjectStore(LEGACY_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(POST_STORE)) {
          db.createObjectStore(POST_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  async function dbGetAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("IndexedDB getAll failed"));
      tx.oncomplete = () => db.close();
    });
  }

  async function dbPut(storeName, item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(item);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB put failed"));
      };
    });
  }

  async function dbDelete(storeName, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("IndexedDB delete failed"));
      };
    });
  }

  async function migrateLegacyPhotos() {
    const posts = await dbGetAll(POST_STORE);
    if (posts.length) return;

    const legacy = await dbGetAll(LEGACY_STORE);
    if (!legacy.length) return;

    for (const photo of legacy) {
      await dbPut(POST_STORE, {
        id: `post-${photo.id}`,
        album: photo.album || "me",
        date: photo.date || todayISO(),
        caption: photo.caption || "",
        musicUrl: photo.musicUrl || "",
        images: [{
          id: photo.id,
          blob: photo.blob,
          name: "photo"
        }],
        createdAt: photo.createdAt || Date.now(),
        updatedAt: photo.updatedAt || Date.now(),
        migratedFromLegacy: true
      });
    }
  }

  function albumLabel(a) {
    return a === "me" ? "我的碎片" : "生活碎片";
  }

  function getImages(post) {
    return Array.isArray(post?.images) ? post.images.slice(0, MAX_IMAGES) : [];
  }

  function countClass(count) {
    return `visual-post__media--${Math.max(1, Math.min(MAX_IMAGES, count))}`;
  }

  function cleanupObjectURLs() {
    for (const u of objectURLs) {
      try { URL.revokeObjectURL(u); } catch {}
    }
    objectURLs = [];
  }

  function imageURL(blob) {
    const url = URL.createObjectURL(blob);
    objectURLs.push(url);
    return url;
  }

  function stopLightboxAudio() {
    const audio = document.getElementById("lbAudio");
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute("src");
      audio.load();
    } catch {}
  }

  function closeLightbox() {
    stopLightboxAudio();
    document.getElementById("visLightbox")?.close();
    openItem = null;
    openIndex = 0;
  }

  function renderEditorOrder() {
    const wrap = document.getElementById("visPhotoOrder");
    if (!wrap) return;

    wrap.innerHTML = "";

    if (!editorImages.length) {
      const empty = document.createElement("div");
      empty.className = "visual-photo-order__empty";
      empty.textContent = "还没有照片。选择照片后，可以在这里调整顺序。";
      wrap.appendChild(empty);
      return;
    }

    editorImages.forEach((img, index) => {
      const row = document.createElement("div");
      row.className = "visual-photo-order__item";
      row.draggable = true;
      row.dataset.index = String(index);

      const thumb = document.createElement("img");
      thumb.className = "visual-photo-order__thumb";
      thumb.src = imageURL(img.blob);
      thumb.alt = `照片 ${index + 1}`;

      const meta = document.createElement("div");
      meta.className = "visual-photo-order__meta";
      const number = document.createElement("div");
      number.className = "visual-photo-order__number";
      number.textContent = `${index + 1}`;
      const name = document.createElement("div");
      name.className = "visual-photo-order__name";
      name.textContent = img.name || `照片 ${index + 1}`;
      meta.append(number, name);

      const actions = document.createElement("div");
      actions.className = "visual-photo-order__actions";

      const up = document.createElement("button");
      up.type = "button";
      up.className = "mini-btn";
      up.textContent = "↑";
      up.title = "向上移动";
      up.disabled = index === 0;
      up.addEventListener("click", e => {
        e.stopPropagation();
        if (index <= 0) return;
        [editorImages[index - 1], editorImages[index]] = [editorImages[index], editorImages[index - 1]];
        renderEditorOrder();
      });

      const down = document.createElement("button");
      down.type = "button";
      down.className = "mini-btn";
      down.textContent = "↓";
      down.title = "向下移动";
      down.disabled = index === editorImages.length - 1;
      down.addEventListener("click", e => {
        e.stopPropagation();
        if (index >= editorImages.length - 1) return;
        [editorImages[index + 1], editorImages[index]] = [editorImages[index], editorImages[index + 1]];
        renderEditorOrder();
      });

      actions.append(up, down);
      row.append(thumb, meta, actions);

      row.addEventListener("dragstart", () => row.classList.add("is-dragging"));
      row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
      row.addEventListener("dragover", e => e.preventDefault());
      row.addEventListener("drop", e => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("text/plain"));
        const to = index;
        if (!Number.isInteger(from) || from === to) return;
        const [moved] = editorImages.splice(from, 1);
        editorImages.splice(to, 0, moved);
        renderEditorOrder();
      });
      row.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/plain", String(index));
        e.dataTransfer.effectAllowed = "move";
      });

      wrap.appendChild(row);
    });
  }

  function openEditor(mode, item = null) {
    const dialog = document.getElementById("visDialog");
    const fileEl = document.getElementById("visFile");
    const dateEl = document.getElementById("visDate");
    const capEl = document.getElementById("visCaption");
    const musicEl = document.getElementById("visMusic");
    const albEl = document.getElementById("visAlbum");
    const delBtn = document.getElementById("visDeleteBtn");
    const title = document.getElementById("visDialogTitle");

    if (!dialog || !fileEl || !dateEl || !capEl || !musicEl || !albEl || !delBtn) return;

    if (mode === "new") {
      editingId = null;
      editorImages = [];
      fileEl.value = "";
      dateEl.value = todayISO();
      capEl.value = "";
      musicEl.value = "";
      albEl.value = (activeAlbum === "me" || activeAlbum === "life") ? activeAlbum : "me";
      delBtn.classList.add("hidden");
      if (title) title.textContent = "新增貼文";
      const count = document.getElementById("visFileCount");
      if (count) count.textContent = "选择 1–9 张照片";
    } else {
      editingId = item.id;
      editorImages = getImages(item).map(img => ({ ...img }));
      fileEl.value = "";
      dateEl.value = item.date || todayISO();
      capEl.value = item.caption || "";
      musicEl.value = item.musicUrl || "";
      albEl.value = item.album || "me";
      delBtn.classList.remove("hidden");
      if (title) title.textContent = "编辑贴文";
      const count = document.getElementById("visFileCount");
      if (count) count.textContent = `${getImages(item).length} 张当前照片 · 如需替换请重新选择`;
    }

    dialog.showModal();
    renderEditorOrder();
    capEl.focus();
  }

  function closeEditor() {
    document.getElementById("visDialog")?.close();
    editingId = null;
    editorImages = [];
  }

  async function saveFromEditor() {
    const fileEl = document.getElementById("visFile");
    const dateEl = document.getElementById("visDate");
    const capEl = document.getElementById("visCaption");
    const musicEl = document.getElementById("visMusic");
    const albEl = document.getElementById("visAlbum");

    const chosen = Array.from(fileEl?.files || []).filter(f => f.type.startsWith("image/"));

    if (chosen.length) {
      editorImages = chosen.map(file => ({ id: Store.uid(), blob: file, name: file.name }));
      renderEditorOrder();
    }

    if (!editingId && !editorImages.length) {
      alert("请至少选择 1 张照片。");
      return;
    }

    if (editorImages.length > MAX_IMAGES) {
      alert("一条贴文最多 9 张照片。");
      return;
    }

    const date = dateEl?.value || todayISO();
    const caption = clampText(capEl?.value || "", 1200);
    const musicUrl = clampText((musicEl?.value || "").trim(), 600);
    const album = (albEl?.value || "me").trim();

    try {
      if (!editingId) {
        await dbPut(POST_STORE, {
          id: Store.uid(),
          album,
          date,
          caption,
          musicUrl,
          images: editorImages.map(img => ({
            id: img.id || Store.uid(),
            blob: img.blob,
            name: img.name || "photo"
          })),
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      } else {
        const posts = await dbGetAll(POST_STORE);
        const current = posts.find(x => x.id === editingId);
        if (!current) return;

        await dbPut(POST_STORE, {
          ...current,
          album,
          date,
          caption,
          musicUrl,
          images: editorImages.map(img => ({
            id: img.id || Store.uid(),
            blob: img.blob,
            name: img.name || "photo"
          })),
          updatedAt: Date.now()
        });
      }

      await render();
      closeEditor();
    } catch (e) {
      console.error(e);
      alert("照片导入失败，请换较小的 JPG / PNG 文件再试。");
    }
  }

  function renderThumbs(post) {
    const media = document.createElement("div");
    const images = getImages(post);
    media.className = `visual-post__media ${countClass(images.length)}`;

    images.forEach((img, index) => {
      const cell = document.createElement("div");
      cell.className = "visual-post__cell";

      const el = document.createElement("img");
      el.className = "visual-post__img";
      el.loading = "lazy";
      el.src = imageURL(img.blob);
      el.alt = `照片 ${index + 1}`;

      cell.appendChild(el);
      media.appendChild(cell);
    });

    return media;
  }

  function renderLightboxSlide() {
    const media = document.getElementById("lbMedia");
    const count = document.getElementById("lbCount");
    const prev = document.getElementById("lbPrevBtn");
    const next = document.getElementById("lbNextBtn");

    if (!media || !count || !openItem) return;

    const images = getImages(openItem);
    if (!images.length) return;

    openIndex = Math.max(0, Math.min(openIndex, images.length - 1));

    media.innerHTML = "";

    const img = document.createElement("img");
    img.className = "lb__single-image";
    img.src = imageURL(images[openIndex].blob);
    img.alt = `照片 ${openIndex + 1}`;
    media.appendChild(img);

    count.textContent = `${openIndex + 1} / ${images.length}`;

    const single = images.length <= 1;
    prev?.classList.toggle("hidden", single);
    next?.classList.toggle("hidden", single);

    if (prev) prev.disabled = openIndex === 0;
    if (next) next.disabled = openIndex === images.length - 1;
  }

  function openLightbox(post) {
    const dialog = document.getElementById("visLightbox");
    const dateEl = document.getElementById("lbDate");
    const capEl = document.getElementById("lbCaption");
    const musicBox = document.getElementById("lbMusicBox");
    const audio = document.getElementById("lbAudio");
    const albumEl = document.getElementById("lbAlbum");

    if (!dialog || !dateEl || !capEl || !musicBox || !audio) return;

    openItem = post;
    openIndex = 0;

    dateEl.textContent = formatYMD(post.date || "");
    capEl.textContent = (post.caption || "").trim();
    if (albumEl) albumEl.textContent = albumLabel(post.album || "me");

    renderLightboxSlide();

    stopLightboxAudio();
    const mu = (post.musicUrl || "").trim();

    if (mu) {
      musicBox.classList.remove("hidden");
      audio.src = mu;
    } else {
      musicBox.classList.add("hidden");
    }

    dialog.showModal();

    // The dialog is opened by a user click, so try to start immediately.
    if (mu) {
      audio.play().catch(() => {
        // Browser may block autoplay for some external URLs.
        // The audio controls remain available in that case.
      });
    }
  }

  async function deletePost(id) {
    const ok = confirm("删除这条贴文？");
    if (!ok) return;

    try {
      await dbDelete(POST_STORE, id);
      if (openItem?.id === id) closeLightbox();
      await render();
    } catch {
      alert("删除失败。");
    }
  }

  async function render() {
    const grid = document.getElementById("visGrid");
    if (!grid) return;

    cleanupObjectURLs();

    try {
      await migrateLegacyPhotos();

      const list = (await dbGetAll(POST_STORE))
        .slice()
        .sort((a, b) => {
          const ad = a.date || "0000-00-00";
          const bd = b.date || "0000-00-00";
          if (ad > bd) return -1;
          if (ad < bd) return 1;
          return (b.createdAt || 0) - (a.createdAt || 0);
        });

      const filtered = list.filter(x => activeAlbum === "all" || (x.album || "me") === activeAlbum);
      grid.innerHTML = "";

      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "visual-empty";
        empty.innerHTML = "<strong>还没有贴文。</strong><span>点击「＋ 新增贴文」，留下一点今天的东西。</span>";
        grid.appendChild(empty);
        return;
      }

      for (const item of filtered) {
        const card = document.createElement("article");
        card.className = "visual-post";

        const head = document.createElement("div");
        head.className = "visual-post__head";

        const date = document.createElement("div");
        date.className = "visual-post__date";
        date.textContent = formatYMD(item.date || "");

        const actions = document.createElement("div");
        actions.className = "visual-post__actions";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "post-action";
        edit.textContent = "编辑";
        edit.addEventListener("click", e => {
          e.stopPropagation();
          openEditor("edit", item);
        });

        const del = document.createElement("button");
        del.type = "button";
        del.className = "post-action";
        del.textContent = "删除";
        del.addEventListener("click", e => {
          e.stopPropagation();
          deletePost(item.id);
        });

        actions.append(edit, del);
        head.append(date, actions);
        card.appendChild(head);

        card.appendChild(renderThumbs(item));

        if ((item.caption || "").trim()) {
          const cap = document.createElement("div");
          cap.className = "visual-post__caption";
          cap.textContent = item.caption.trim();
          card.appendChild(cap);
        }

        const footer = document.createElement("div");
        footer.className = "visual-post__footer";

        const album = document.createElement("span");
        album.className = "visual-post__album";
        album.textContent = albumLabel(item.album || "me");
        footer.appendChild(album);

        if ((item.musicUrl || "").trim()) {
          const music = document.createElement("span");
          music.className = "visual-post__music";
          music.textContent = "♪ 音乐";
          footer.appendChild(music);
        }

        card.appendChild(footer);
        card.addEventListener("click", () => openLightbox(item));
        grid.appendChild(card);
      }
    } catch (e) {
      console.error(e);
      grid.innerHTML = '<div class="visual-empty"><strong>无法加载贴文。</strong><span>请刷新页面再试。</span></div>';
    }
  }

  function init() {
    const addBtn = document.getElementById("visAddBtn");
    const sel = document.getElementById("visAlbumFilter");
    const fileEl = document.getElementById("visFile");
    const saveBtn = document.getElementById("visSaveBtn");
    const delBtn = document.getElementById("visDeleteBtn");

    const lbDialog = document.getElementById("visLightbox");
    const lbPrev = document.getElementById("lbPrevBtn");
    const lbNext = document.getElementById("lbNextBtn");
    const lbEdit = document.getElementById("lbEditBtn");
    const lbDel = document.getElementById("lbDeleteBtn");

    sel?.addEventListener("change", () => {
      activeAlbum = sel.value;
      render();
    });

    addBtn?.addEventListener("click", () => openEditor("new"));

    fileEl?.addEventListener("change", () => {
      const chosen = Array.from(fileEl.files || []).filter(f => f.type.startsWith("image/"));
      editorImages = chosen.map(file => ({ id: Store.uid(), blob: file, name: file.name }));
      const count = document.getElementById("visFileCount");
      if (count) {
        count.textContent = chosen.length
          ? `${chosen.length} 张照片已选择${chosen.length > MAX_IMAGES ? "（最多 9 张）" : ""}`
          : "选择 1–9 张照片";
      }
      renderEditorOrder();
    });

    saveBtn?.addEventListener("click", saveFromEditor);

    delBtn?.addEventListener("click", async () => {
      if (!editingId) return;
      const id = editingId;
      await deletePost(id);
      closeEditor();
    });

    lbPrev?.addEventListener("click", () => {
      if (!openItem) return;
      openIndex -= 1;
      renderLightboxSlide();
    });

    lbNext?.addEventListener("click", () => {
      if (!openItem) return;
      openIndex += 1;
      renderLightboxSlide();
    });

    lbEdit?.addEventListener("click", () => {
      if (!openItem) return;
      const item = openItem;
      closeLightbox();
      openEditor("edit", item);
    });

    lbDel?.addEventListener("click", () => {
      if (!openItem) return;
      deletePost(openItem.id);
    });

    lbDialog?.addEventListener("close", () => {
      stopLightboxAudio();
      openItem = null;
      openIndex = 0;
    });

    render();
  }

  return { init };
})();


// Expose TodoPageV2 for inline init scripts
try { window.TodoPageV2 = TodoPageV2; } catch (e) { /* ignore */ }

/* =========================
   Inbox / 臨時碎片
   - quick capture from Home
   - organize later into To Do / Fragments / Inspo
   ========================= */
window.InboxPage = (() => {
  const KEY = "site:inbox:v1";
  let editingId = null;

  function read() {
    return Store.get(KEY, []);
  }

  function write(list) {
    Store.set(KEY, list);
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatDateTime(ts) {
    const d = new Date(ts || Date.now());
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}.${m}.${day} ${hh}:${mm}`;
  }

  function closeDialog() {
    document.getElementById("inboxOrganizeDialog")?.close();
    editingId = null;
  }

  function openDialog(item) {
    const dialog = document.getElementById("inboxOrganizeDialog");
    if (!dialog) return;

    editingId = item.id;

    const type = document.getElementById("inboxTargetType");
    const due = document.getElementById("inboxDue");
    const date = document.getElementById("inboxDate");
    const fragTag = document.getElementById("inboxFragmentTag");
    const inspoTag = document.getElementById("inboxInspoTag");
    const mood = document.getElementById("inboxMood");

    type.value = "todo";
    due.value = "";
    date.value = todayISO();
    if (fragTag) fragTag.value = "";
    if (inspoTag) inspoTag.value = "";
    mood.value = "";

    updateFields();
    dialog.showModal();
  }

  function updateFields() {
    const type = document.getElementById("inboxTargetType")?.value;
    document.getElementById("inboxTodoFields")?.classList.toggle("hidden", type !== "todo");
    document.getElementById("inboxFragmentFields")?.classList.toggle("hidden", type !== "fragment");
    document.getElementById("inboxInspoFields")?.classList.toggle("hidden", type !== "inspo");
  }

  function removeItem(id) {
    write(read().filter(x => x.id !== id));
  }

  function saveQuick(text) {
    const value = (text || "").trim();
    if (!value) return false;

    const list = read();
    list.unshift({
      id: Store.uid(),
      text: value,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    write(list);
    return true;
  }

  function saveOrganization() {
    if (!editingId) return;

    const type = document.getElementById("inboxTargetType")?.value || "todo";
    const item = read().find(x => x.id === editingId);
    if (!item) return;

    const now = Date.now();

    if (type === "todo") {
      const due = document.getElementById("inboxDue")?.value || "";
      if (!due) {
        alert("DDL Is Required For To Do.");
        return;
      }

      const data = Store.get("site:todos:v2", { main: [], maybe: [], wish: [] });
      if (!Array.isArray(data.main)) data.main = [];
      data.main.unshift({
        id: Store.uid(),
        text: item.text,
        due,
        done: false,
        createdAt: now,
        updatedAt: now
      });
      Store.set("site:todos:v2", data);

    } else if (type === "fragment") {
      const date = document.getElementById("inboxDate")?.value || todayISO();
      const tag = (document.getElementById("inboxFragmentTag")?.value || "").trim();
      const list = Store.get("site:fragments:v1", []);
      list.unshift({
        id: Store.uid(),
        text: item.text,
        date,
        tag,
        createdAt: now,
        updatedAt: now
      });
      Store.set("site:fragments:v1", list);

    } else if (type === "inspo") {
      const tag = (document.getElementById("inboxInspoTag")?.value || "").trim();
      const mood = (document.getElementById("inboxMood")?.value || "").trim();
      const list = Store.get("site:inspo:v1", []);
      list.unshift({
        id: Store.uid(),
        text: item.text,
        tag,
        mood,
        createdAt: now,
        updatedAt: now
      });
      Store.set("site:inspo:v1", list);
    }

    removeItem(editingId);
    render();
    closeDialog();
  }

  function render() {
    const grid = document.getElementById("inboxGrid");
    const count = document.getElementById("inboxCount");
    if (!grid) return;

    const list = read().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (count) count.textContent = `${list.length} item${list.length === 1 ? "" : "s"}`;

    grid.innerHTML = "";

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "inbox-empty";
      empty.textContent = "No temporary fragments. Drop something here first.";
      grid.appendChild(empty);
      return;
    }

    for (const item of list) {
      const card = document.createElement("article");
      card.className = "inbox-card";

      const body = document.createElement("div");
      body.className = "inbox-card__body";
      body.textContent = item.text;

      const meta = document.createElement("div");
      meta.className = "inbox-card__meta";
      meta.textContent = formatDateTime(item.createdAt);

      const actions = document.createElement("div");
      actions.className = "inbox-card__actions";

      const organize = document.createElement("button");
      organize.type = "button";
      organize.className = "btn btn--small";
      organize.textContent = "整理";
      organize.addEventListener("click", () => openDialog(item));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--ghost btn--small";
      del.textContent = "Delete";
      del.addEventListener("click", () => {
        if (!confirm("Delete This Temporary Fragment?")) return;
        removeItem(item.id);
        render();
      });

      actions.append(organize, del);
      card.append(body, meta, actions);
      grid.appendChild(card);
    }
  }

  function initHome() {
    const dialog = document.getElementById("homeInboxDialog");
    const text = document.getElementById("homeInboxText");
    const save = document.getElementById("homeInboxSave");

    if (!dialog || !text || !save) return;

    save.addEventListener("click", () => {
      if (!saveQuick(text.value)) return;
      text.value = "";
      dialog.close();
    });

    text.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        save.click();
      }
    });
  }

  function init() {
    const add = document.getElementById("inboxAddBtn");
    const type = document.getElementById("inboxTargetType");
    const save = document.getElementById("inboxOrganizeSave");
    const dialog = document.getElementById("inboxOrganizeDialog");

    add?.addEventListener("click", () => {
      const text = prompt("写下临时碎片：");
      if (text && saveQuick(text)) render();
    });

    type?.addEventListener("change", updateFields);
    save?.addEventListener("click", saveOrganization);

    dialog?.addEventListener("close", () => {
      editingId = null;
    });

    render();
  }

  return { init, initHome, saveQuick, render };
})();


/* =========================================================
   MOBILE TOUCH — Visual Post viewer
   Swipe left/right to move between photos.
   ========================================================= */
(() => {
  const bindVisualSwipe = () => {
    const dialog = document.getElementById("visLightbox");
    const stage = document.getElementById("lbMedia");
    if (!dialog || !stage || dialog.dataset.swipeBound === "1") return;

    dialog.dataset.swipeBound = "1";
    let startX = 0;
    let startY = 0;
    let tracking = false;

    stage.addEventListener("touchstart", (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      const t = event.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }, { passive: true });

    stage.addEventListener("touchend", (event) => {
      if (!tracking || !event.changedTouches || event.changedTouches.length !== 1) return;
      tracking = false;

      const t = event.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.2) return;

      if (dx < 0) {
        document.getElementById("lbNextBtn")?.click();
      } else {
        document.getElementById("lbPrevBtn")?.click();
      }
    }, { passive: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindVisualSwipe, { once: true });
  } else {
    bindVisualSwipe();
  }
})();
