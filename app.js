(function () {
  'use strict';

  var STORAGE_KEY = 'todo-app:v1';
  var CORRUPT_KEY = 'todo-app:v1:corrupt';
  var MAX_LEN = 100;
  var CATEGORIES = { work: '업무', personal: '개인', study: '공부' };
  var FILTERS = ['all', 'work', 'personal', 'study'];

  var storageOk = true;
  var editingId = null;

  // ---------- Storage ----------

  function defaultState() {
    return { version: 1, todos: [], ui: { filter: 'all', lastCategory: 'work' } };
  }

  // localStorage에서 상태를 읽고, 손상되었거나 접근 불가면 빈 상태로 시작
  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageOk = false;
      return defaultState();
    }
    if (raw === null) return defaultState();
    try {
      return normalize(JSON.parse(raw));
    } catch (e) {
      try { localStorage.setItem(CORRUPT_KEY, raw); } catch (e2) { /* 백업 실패는 무시 */ }
      return defaultState();
    }
  }

  // 외부 데이터를 신뢰하지 않고 허용된 값으로 보정
  function normalize(data) {
    var state = defaultState();
    if (!data || typeof data !== 'object') return state;
    if (Array.isArray(data.todos)) {
      data.todos.forEach(function (t) {
        if (!t || typeof t.text !== 'string' || !t.text.trim()) return;
        state.todos.push({
          id: typeof t.id === 'string' ? t.id : makeId(),
          text: t.text.slice(0, MAX_LEN),
          category: CATEGORIES[t.category] ? t.category : 'work',
          done: t.done === true,
          createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
          completedAt: typeof t.completedAt === 'number' ? t.completedAt : null
        });
      });
    }
    if (data.ui) {
      if (FILTERS.indexOf(data.ui.filter) !== -1) state.ui.filter = data.ui.filter;
      if (CATEGORIES[data.ui.lastCategory]) state.ui.lastCategory = data.ui.lastCategory;
    }
    return state;
  }

  function save() {
    if (!storageOk) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      storageOk = false;
      renderWarning();
    }
  }

  // ---------- State ----------

  var state = load();

  function makeId() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function commit() {
    save();
    render();
  }

  function addTodo(text, category) {
    text = String(text).trim().slice(0, MAX_LEN);
    if (!text || !CATEGORIES[category]) return false;
    state.todos.push({
      id: makeId(),
      text: text,
      category: category,
      done: false,
      createdAt: Date.now(),
      completedAt: null
    });
    state.ui.lastCategory = category;
    commit();
    return true;
  }

  function findTodo(id) {
    for (var i = 0; i < state.todos.length; i++) {
      if (state.todos[i].id === id) return state.todos[i];
    }
    return null;
  }

  function updateTodo(id, changes) {
    var todo = findTodo(id);
    if (!todo) return false;
    if (typeof changes.text === 'string') {
      var text = changes.text.trim().slice(0, MAX_LEN);
      if (!text) return false;
      todo.text = text;
    }
    if (changes.category && CATEGORIES[changes.category]) todo.category = changes.category;
    commit();
    return true;
  }

  function deleteTodo(id) {
    state.todos = state.todos.filter(function (t) { return t.id !== id; });
    if (editingId === id) editingId = null;
    commit();
  }

  function toggleTodo(id) {
    var todo = findTodo(id);
    if (!todo) return;
    todo.done = !todo.done;
    todo.completedAt = todo.done ? Date.now() : null;
    commit();
  }

  function clearDone() {
    state.todos = state.todos.filter(function (t) { return !t.done; });
    editingId = null;
    commit();
  }

  function setFilter(filter) {
    if (FILTERS.indexOf(filter) === -1) return;
    state.ui.filter = filter;
    commit();
  }

  // ---------- Selectors ----------

  // 필터 적용 + 정렬: 미완료가 위, 같은 그룹에서는 최신 항목이 위
  function getVisibleTodos() {
    var filter = state.ui.filter;
    return state.todos
      .map(function (t, i) { return { t: t, i: i }; })
      .filter(function (x) { return filter === 'all' || x.t.category === filter; })
      .sort(function (a, b) {
        if (a.t.done !== b.t.done) return a.t.done ? 1 : -1;
        if (a.t.createdAt !== b.t.createdAt) return b.t.createdAt - a.t.createdAt;
        return b.i - a.i;
      })
      .map(function (x) { return x.t; });
  }

  // 현재 필터와 무관하게 전체 기준 진행률 계산 (total 0이면 percent 0)
  function getProgress() {
    var result = {
      total: 0, done: 0, percent: 0,
      byCategory: { work: { total: 0, done: 0 }, personal: { total: 0, done: 0 }, study: { total: 0, done: 0 } }
    };
    state.todos.forEach(function (t) {
      result.total++;
      result.byCategory[t.category].total++;
      if (t.done) {
        result.done++;
        result.byCategory[t.category].done++;
      }
    });
    result.percent = result.total === 0 ? 0 : Math.round((result.done / result.total) * 100);
    return result;
  }

  // ---------- Render ----------

  var els = {
    warning: document.getElementById('storage-warning'),
    today: document.getElementById('today'),
    progressEmpty: document.getElementById('progress-empty'),
    progressBody: document.getElementById('progress-body'),
    progressText: document.getElementById('progress-text'),
    progressBar: document.getElementById('progress-bar'),
    progressFill: document.getElementById('progress-fill'),
    progressCategories: document.getElementById('progress-categories'),
    form: document.getElementById('add-form'),
    addText: document.getElementById('add-text'),
    addCategory: document.getElementById('add-category'),
    filters: document.getElementById('filters'),
    list: document.getElementById('todo-list'),
    listEmpty: document.getElementById('list-empty'),
    clearDone: document.getElementById('clear-done')
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderWarning() {
    els.warning.hidden = storageOk;
  }

  function renderProgress() {
    var p = getProgress();
    var empty = p.total === 0;
    els.progressEmpty.hidden = !empty;
    els.progressBody.hidden = empty;
    if (empty) return;

    els.progressText.textContent = p.done + '/' + p.total + ' (' + p.percent + '%)';
    els.progressFill.style.width = p.percent + '%';
    els.progressBar.setAttribute('aria-valuenow', String(p.percent));

    els.progressCategories.textContent = '';
    Object.keys(CATEGORIES).forEach(function (key) {
      var c = p.byCategory[key];
      var li = el('li', 'cat-' + key, CATEGORIES[key] + ' ' + c.done + '/' + c.total);
      if (state.ui.filter === key) li.classList.add('active');
      els.progressCategories.appendChild(li);
    });
  }

  function renderFilters() {
    Array.prototype.forEach.call(els.filters.querySelectorAll('button'), function (btn) {
      var active = btn.getAttribute('data-filter') === state.ui.filter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  function buildCategorySelect(selected, label) {
    var select = el('select', 'edit-category');
    select.setAttribute('aria-label', label);
    Object.keys(CATEGORIES).forEach(function (key) {
      var opt = el('option', '', CATEGORIES[key]);
      opt.value = key;
      if (key === selected) opt.selected = true;
      select.appendChild(opt);
    });
    return select;
  }

  function buildItem(todo) {
    var li = el('li', 'todo' + (todo.done ? ' done' : ''));
    li.setAttribute('data-id', todo.id);

    if (editingId === todo.id) {
      li.classList.add('editing');
      var input = el('input', 'edit-text');
      input.type = 'text';
      input.maxLength = MAX_LEN;
      input.value = todo.text;
      input.setAttribute('aria-label', '할 일 수정');
      li.appendChild(input);
      li.appendChild(buildCategorySelect(todo.category, '카테고리 수정'));
      var save = el('button', 'btn primary small', '저장');
      save.type = 'button';
      save.setAttribute('data-action', 'save');
      var cancel = el('button', 'btn small', '취소');
      cancel.type = 'button';
      cancel.setAttribute('data-action', 'cancel');
      li.appendChild(save);
      li.appendChild(cancel);
      return li;
    }

    var check = el('input', 'check');
    check.type = 'checkbox';
    check.checked = todo.done;
    check.setAttribute('data-action', 'toggle');
    check.setAttribute('aria-label', todo.text + ' 완료 표시');
    li.appendChild(check);

    li.appendChild(el('span', 'text', todo.text));
    li.appendChild(el('span', 'badge cat-' + todo.category, CATEGORIES[todo.category]));

    var edit = el('button', 'icon-btn', '✎');
    edit.type = 'button';
    edit.setAttribute('data-action', 'edit');
    edit.setAttribute('aria-label', todo.text + ' 수정');
    var del = el('button', 'icon-btn', '🗑');
    del.type = 'button';
    del.setAttribute('data-action', 'delete');
    del.setAttribute('aria-label', todo.text + ' 삭제');
    li.appendChild(edit);
    li.appendChild(del);
    return li;
  }

  function renderList() {
    var todos = getVisibleTodos();
    els.list.textContent = '';
    todos.forEach(function (t) { els.list.appendChild(buildItem(t)); });

    if (todos.length === 0) {
      els.listEmpty.hidden = false;
      els.listEmpty.textContent = state.todos.length === 0
        ? '아직 할 일이 없습니다.'
        : '이 카테고리에는 할 일이 없습니다';
    } else {
      els.listEmpty.hidden = true;
    }

    var doneCount = state.todos.filter(function (t) { return t.done; }).length;
    els.clearDone.disabled = doneCount === 0;
  }

  function render() {
    renderWarning();
    renderProgress();
    renderFilters();
    renderList();
    els.addCategory.value = state.ui.lastCategory;
  }

  function focusEditor() {
    var input = els.list.querySelector('.edit-text');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  // ---------- Events ----------

  function startEdit(id) {
    editingId = id;
    render();
    focusEditor();
  }

  function cancelEdit() {
    editingId = null;
    render();
  }

  function commitEdit(li) {
    var id = li.getAttribute('data-id');
    var text = li.querySelector('.edit-text').value;
    var category = li.querySelector('.edit-category').value;
    editingId = null;
    // 빈 값이면 수정하지 않고 취소 처리
    if (!updateTodo(id, { text: text, category: category })) render();
  }

  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (addTodo(els.addText.value, els.addCategory.value)) {
      els.addText.value = '';
    }
    els.addText.focus();
  });

  els.filters.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-filter]');
    if (btn) setFilter(btn.getAttribute('data-filter'));
  });

  els.list.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var li = target.closest('li[data-id]');
    if (!li) return;
    var id = li.getAttribute('data-id');
    var action = target.getAttribute('data-action');

    if (action === 'toggle') {
      toggleTodo(id);
    } else if (action === 'edit') {
      startEdit(id);
    } else if (action === 'delete') {
      if (window.confirm('이 할 일을 삭제할까요?')) deleteTodo(id);
    } else if (action === 'save') {
      commitEdit(li);
    } else if (action === 'cancel') {
      cancelEdit();
    }
  });

  els.list.addEventListener('dblclick', function (e) {
    var text = e.target.closest('.text');
    if (!text) return;
    startEdit(text.closest('li[data-id]').getAttribute('data-id'));
  });

  els.list.addEventListener('keydown', function (e) {
    var li = e.target.closest('li.editing');
    if (!li) return;
    if (e.key === 'Enter' && e.target.classList.contains('edit-text')) {
      e.preventDefault();
      commitEdit(li);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });

  els.clearDone.addEventListener('click', function () {
    var n = state.todos.filter(function (t) { return t.done; }).length;
    if (n > 0 && window.confirm('완료된 ' + n + '개 항목을 삭제할까요?')) clearDone();
  });

  // ---------- Init ----------

  els.today.textContent = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });
  render();
})();
