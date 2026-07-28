'use strict';

/* ============================================================
 * 支給ルール（KESEN LARUS BASKETBALL CLUB 交通費等及び謝礼金支給規程 第5条・第6条）
 * ============================================================ */
const RULES = {
  referee: {
    label: '帯同審判',
    gametype: {
      practice_game: {
        label: '練習試合',
        table: {
          in: { half: 2000, full: 4000 },
          out: { half: 3000, full: 5000 },
        },
      },
      official_game: { label: '公式戦', flat: 2500 },
    },
  },
  commissioner: {
    label: 'コミッショナー',
    table: { in: 1000, out: 2000 },
  },
};

const LOCATION_LABEL = { in: '気仙管内', out: '気仙管外' };
const DURATION_LABEL = { half: '半日（4h以内・1試合）', full: '1日（4h超）' };
const OTHER_VALUE = '__other__';

function calcUnitAmount(role, { gametype, location, duration }) {
  if (role === 'referee') {
    const gt = RULES.referee.gametype[gametype];
    if (!gt) return 0;
    if (gt.flat !== undefined) return gt.flat;
    return gt.table[location]?.[duration] ?? 0;
  }
  if (role === 'commissioner') {
    return RULES.commissioner.table[location] ?? 0;
  }
  return 0;
}

function roleLabel(role) {
  return RULES[role]?.label ?? role;
}

function describeEntry(r) {
  if (r.role === 'referee') {
    const gt = RULES.referee.gametype[r.gametype];
    const parts = [gt?.label];
    if (r.gametype === 'practice_game') {
      parts.push(LOCATION_LABEL[r.location], DURATION_LABEL[r.duration]);
    }
    return parts.filter(Boolean).join(' / ');
  }
  if (r.role === 'commissioner') {
    return LOCATION_LABEL[r.location];
  }
  return '';
}

/* ============================================================
 * データストア（Firestoreに保存。window.FirebaseDataはfirebase-bundle.jsが用意する）
 * ============================================================ */
let records = [];
let rosterNames = [];

function yen(n) {
  return '¥' + Number(n || 0).toLocaleString('ja-JP');
}

function monthKey(dateStr) {
  return (dateStr || '').slice(0, 7); // YYYY-MM
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ============================================================
 * タブ切り替え
 * ============================================================ */
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'list') renderList();
    });
  });
}

/* ============================================================
 * 入力フォーム
 * ============================================================ */
function initForm() {
  const form = document.getElementById('entry-form');

  document.getElementById('f-date').valueAsDate = new Date();

  document.getElementById('f-role').addEventListener('change', () => {
    updateConditionalFields();
    updateUnitAmount();
  });
  document.getElementById('f-gametype').addEventListener('change', () => {
    updateConditionalFields();
    updateUnitAmount();
  });
  document.getElementById('f-location').addEventListener('change', updateUnitAmount);
  document.getElementById('f-duration').addEventListener('change', updateUnitAmount);
  document.getElementById('f-name-select').addEventListener('change', updateNameFieldVisibility);

  updateConditionalFields();
  updateUnitAmount();
  updateNameFieldVisibility();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = document.getElementById('f-date').value;
    if (!date) {
      alert('日付を入力してください');
      return;
    }

    const role = document.getElementById('f-role').value;
    const gametype = role === 'referee' ? document.getElementById('f-gametype').value : undefined;
    const showLocDur = role === 'commissioner' || (role === 'referee' && gametype === 'practice_game');
    const location = showLocDur ? document.getElementById('f-location').value : undefined;
    const duration = role === 'referee' && gametype === 'practice_game' ? document.getElementById('f-duration').value : undefined;
    const amount = calcUnitAmount(role, { gametype, location, duration });

    const nameSelectValue = document.getElementById('f-name-select').value;
    let name;
    if (nameSelectValue === OTHER_VALUE) {
      name = document.getElementById('f-name-other').value.trim();
      if (!name) {
        alert('お名前を入力してください');
        return;
      }
    } else {
      name = nameSelectValue;
      if (!name) {
        alert('対象者を選択してください');
        return;
      }
    }

    const note = document.getElementById('f-note').value;
    const record = { date, role, gametype, location, duration, amount, name, note };

    const submitBtn = form.querySelector('.btn-primary');
    submitBtn.disabled = true;
    window.FirebaseData.addRecord(record)
      .then(() => {
        showToast('登録しました');
        document.getElementById('f-note').value = '';
        if (nameSelectValue === OTHER_VALUE) document.getElementById('f-name-other').value = '';
      })
      .catch((err) => {
        console.error('addRecord failed', err);
        alert('登録に失敗しました: ' + err.message);
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });
}

function updateConditionalFields() {
  const role = document.getElementById('f-role').value;
  const gametype = document.getElementById('f-gametype').value;
  const isPracticeGame = role === 'referee' && gametype === 'practice_game';
  const showLocation = role === 'commissioner' || isPracticeGame;

  document.getElementById('group-gametype').style.display = role === 'referee' ? '' : 'none';
  document.getElementById('group-location').style.display = showLocation ? '' : 'none';
  document.getElementById('group-duration').style.display = isPracticeGame ? '' : 'none';
}

function updateUnitAmount() {
  const role = document.getElementById('f-role').value;
  const gametype = document.getElementById('f-gametype').value;
  const location = document.getElementById('f-location').value;
  const duration = document.getElementById('f-duration').value;
  const amount = calcUnitAmount(role, { gametype, location, duration });
  document.getElementById('f-unit-amount').textContent = yen(amount);
}

function updateNameFieldVisibility() {
  const isOther = document.getElementById('f-name-select').value === OTHER_VALUE;
  document.getElementById('group-name-other').style.display = isOther ? '' : 'none';
}

/* ============================================================
 * 対象者ロースター（よく依頼する人を登録・削除。たまにの人はその他で自由入力）
 * ============================================================ */
function renderNameSelect() {
  const sel = document.getElementById('f-name-select');
  const current = sel.value;
  const options = rosterNames.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  sel.innerHTML = options + `<option value="${OTHER_VALUE}">その他（自由入力）</option>`;
  sel.value = rosterNames.includes(current) || current === OTHER_VALUE ? current : rosterNames[0] || OTHER_VALUE;
  updateNameFieldVisibility();
}

function renderRosterList() {
  const ul = document.getElementById('roster-list');
  if (rosterNames.length === 0) {
    ul.innerHTML = '<li class="roster-empty-hint">まだ登録がありません</li>';
    return;
  }
  ul.innerHTML = rosterNames
    .map((n) => `<li>${escapeHtml(n)}<button type="button" data-remove="${escapeHtml(n)}" aria-label="削除">×</button></li>`)
    .join('');
  ul.querySelectorAll('[data-remove]').forEach((btn) => {
    btn.addEventListener('click', () => removeRosterName(btn.dataset.remove));
  });
}

function saveRoster(names) {
  window.FirebaseData.saveRoster(names).catch((err) => {
    console.error('saveRoster failed', err);
    alert('対象者リストの保存に失敗しました: ' + err.message);
  });
}

function addRosterName(name) {
  if (!name || rosterNames.includes(name)) return;
  rosterNames = [...rosterNames, name];
  saveRoster(rosterNames);
}

function removeRosterName(name) {
  if (!confirm(`「${name}」を対象者リストから削除しますか？（過去の登録記録は残ります）`)) return;
  rosterNames = rosterNames.filter((n) => n !== name);
  saveRoster(rosterNames);
}

function initRoster() {
  document.getElementById('roster-add-btn').addEventListener('click', () => {
    const input = document.getElementById('roster-new-name');
    const name = input.value.trim();
    if (!name) return;
    if (rosterNames.includes(name)) {
      showToast('すでに登録されています');
      return;
    }
    addRosterName(name);
    input.value = '';
  });
  document.getElementById('roster-new-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('roster-add-btn').click();
    }
  });
}

/* ============================================================
 * 一覧（スプレッドシート風）
 * ============================================================ */
let listMonthFilterTouched = false;

function renderList() {
  let monthFilter = document.getElementById('list-month-filter').value;
  if (!listMonthFilterTouched) {
    const months = [...new Set(records.map((r) => monthKey(r.date)))].sort().reverse();
    monthFilter = months[0] || monthKey(new Date().toISOString());
  }
  const nameFilter = document.getElementById('list-name-filter').value.trim();

  const filtered = records
    .filter((r) => !monthFilter || monthKey(r.date) === monthFilter)
    .filter((r) => !nameFilter || r.name.includes(nameFilter))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const tbody = document.getElementById('list-tbody');
  tbody.innerHTML = '';

  let total = 0;
  filtered.forEach((r) => {
    total += Number(r.amount) || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(roleLabel(r.role))}</td>
      <td>${escapeHtml(describeEntry(r))}</td>
      <td class="num"><input type="number" class="amount-edit" value="${r.amount}" data-id="${r.id}" step="1"></td>
      <td>${escapeHtml(r.note || '')}</td>
      <td><button class="btn-danger" data-del="${r.id}">削除</button></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('list-total').textContent = yen(total);
  document.getElementById('list-count').textContent = filtered.length + ' 件';

  tbody.querySelectorAll('.amount-edit').forEach((input) => {
    input.addEventListener('change', () => {
      window.FirebaseData.updateRecord(input.dataset.id, { amount: Number(input.value) || 0 }).catch((err) => {
        console.error('updateRecord failed', err);
        alert('更新に失敗しました: ' + err.message);
      });
    });
  });
  tbody.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (confirm('この記録を削除しますか？')) {
        window.FirebaseData.deleteRecord(btn.dataset.del).catch((err) => {
          console.error('deleteRecord failed', err);
          alert('削除に失敗しました: ' + err.message);
        });
      }
    });
  });

  populateMonthOptions(monthFilter);
}

function populateMonthOptions(current) {
  const thisMonth = monthKey(new Date().toISOString());
  const months = [...new Set([...records.map((r) => monthKey(r.date)), thisMonth].filter(Boolean))].sort().reverse();
  const sel = document.getElementById('list-month-filter');
  const keep = current || sel.value;
  sel.innerHTML = '<option value="">すべての月</option>' + months.map((m) => `<option value="${m}">${m}</option>`).join('');
  sel.value = keep || '';
}

function initList() {
  document.getElementById('list-month-filter').addEventListener('change', () => {
    listMonthFilterTouched = true;
    renderList();
  });
  document.getElementById('list-name-filter').addEventListener('input', renderList);
}

/* ============================================================
 * 初期化（ログイン不要。Firestoreの専用データ領域に直接同期）
 * ============================================================ */
function initSync() {
  window.FirebaseData.subscribeRecords((recs) => {
    records = recs;
    renderList();
  });
  window.FirebaseData.subscribeRoster((names) => {
    rosterNames = names;
    renderNameSelect();
    renderRosterList();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initForm();
  initRoster();
  initList();
  initSync();
});
