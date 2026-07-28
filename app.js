'use strict';

/* ============================================================
 * 支給ルール（KESEN LARUS BASKETBALL CLUB 交通費等及び謝礼金支給規程 第5条・第6条 等）
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
    /* 気仙管外は謝礼(試合数分)＋交通費(1日1回のみ)の合計。気仙管内は交通費なし */
    location: {
      in: { honorarium: 1000, transport: 0 },
      out: { honorarium: 1000, transport: 1000 },
    },
  },
};

const ROLE_LABELS = { referee: '帯同審判', commissioner: 'コミッショナー', other: 'その他' };
const LOCATION_LABEL = { in: '気仙管内', out: '気仙管外' };
const DURATION_LABEL = { half: '半日（4h以内・1試合）', full: '1日（4h超）' };
const OTHER_VALUE = '__other__';

/* 審判の公式戦・コミッショナーは1試合あたりの金額のため、試合数(最大3)を掛ける */
function gameCountApplies(role, gametype) {
  return role === 'commissioner' || (role === 'referee' && gametype === 'official_game');
}

function calcAmount(role, { gametype, location, duration, gamecount }) {
  if (role === 'referee') {
    const gt = RULES.referee.gametype[gametype];
    if (!gt) return 0;
    if (gt.flat !== undefined) return gt.flat * (gamecount || 1);
    return gt.table[location]?.[duration] ?? 0;
  }
  if (role === 'commissioner') {
    const conf = RULES.commissioner.location[location];
    if (!conf) return 0;
    return conf.honorarium * (gamecount || 1) + conf.transport;
  }
  return 0;
}

function amountBreakdownText(role, { gametype, location, gamecount }) {
  if (role === 'referee' && gametype === 'official_game') {
    return `${yen(RULES.referee.gametype.official_game.flat)} × ${gamecount}試合`;
  }
  if (role === 'commissioner') {
    const conf = RULES.commissioner.location[location];
    if (!conf) return '';
    const parts = [`謝礼 ${yen(conf.honorarium)} × ${gamecount}試合`];
    if (conf.transport > 0) parts.push(`交通費 ${yen(conf.transport)}`);
    return parts.join(' + ');
  }
  return '';
}

function roleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

function describeEntry(r) {
  if (r.role === 'other') {
    return r.otherContent || '';
  }
  if (r.role === 'referee') {
    const gt = RULES.referee.gametype[r.gametype];
    const parts = [gt?.label];
    if (r.gametype === 'practice_game') {
      parts.push(LOCATION_LABEL[r.location], DURATION_LABEL[r.duration]);
    } else if (r.gametype === 'official_game' && r.gamecount) {
      parts.push(`${r.gamecount}試合`);
    }
    return parts.filter(Boolean).join(' / ');
  }
  if (r.role === 'commissioner') {
    const parts = [LOCATION_LABEL[r.location]];
    if (r.gamecount) parts.push(`${r.gamecount}試合`);
    return parts.filter(Boolean).join(' / ');
  }
  return '';
}

/* ============================================================
 * データストア（Firestoreに保存。window.FirebaseDataはfirebase-bundle.jsが用意する）
 * ============================================================ */
let records = [];
let rosterNames = [];
let contactsCache = { addresses: {}, phones: {} };

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
  document.getElementById('f-gamecount').addEventListener('change', updateUnitAmount);
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
    const venue = document.getElementById('f-venue').value.trim();
    let record;

    if (role === 'other') {
      const otherContent = document.getElementById('f-other-content').value.trim();
      const amount = Number(document.getElementById('f-other-amount').value);
      if (!otherContent) {
        alert('内容を入力してください');
        return;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        alert('支給額を正しく入力してください');
        return;
      }
      record = { date, role, otherContent, amount, name, note, venue };
    } else {
      const gametype = role === 'referee' ? document.getElementById('f-gametype').value : undefined;
      const showLocation = role === 'commissioner' || (role === 'referee' && gametype === 'practice_game');
      const location = showLocation ? document.getElementById('f-location').value : undefined;
      const duration = role === 'referee' && gametype === 'practice_game' ? document.getElementById('f-duration').value : undefined;
      const applyCount = gameCountApplies(role, gametype);
      const gamecount = applyCount ? Number(document.getElementById('f-gamecount').value) : undefined;
      const amount = calcAmount(role, { gametype, location, duration, gamecount });
      record = { date, role, gametype, location, duration, gamecount, amount, name, note, venue };
    }

    const submitBtn = form.querySelector('.btn-primary');
    submitBtn.disabled = true;
    window.FirebaseData.addRecord(record)
      .then(() => {
        showToast('登録しました');
        document.getElementById('f-note').value = '';
        if (role === 'other') {
          document.getElementById('f-other-content').value = '';
          document.getElementById('f-other-amount').value = '';
        }
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
  const isOther = role === 'other';
  const isPracticeGame = role === 'referee' && gametype === 'practice_game';
  const showLocation = !isOther && (role === 'commissioner' || isPracticeGame);
  const showGamecount = !isOther && gameCountApplies(role, gametype);

  document.getElementById('group-gametype').style.display = role === 'referee' ? '' : 'none';
  document.getElementById('group-location').style.display = showLocation ? '' : 'none';
  document.getElementById('group-duration').style.display = isPracticeGame ? '' : 'none';
  document.getElementById('group-gamecount').style.display = showGamecount ? '' : 'none';
  document.getElementById('group-unit-amount').style.display = isOther ? 'none' : '';
  document.getElementById('group-other-fields').style.display = isOther ? '' : 'none';
}

function updateUnitAmount() {
  const role = document.getElementById('f-role').value;
  if (role === 'other') return;
  const gametype = document.getElementById('f-gametype').value;
  const location = document.getElementById('f-location').value;
  const duration = document.getElementById('f-duration').value;
  const applyCount = gameCountApplies(role, gametype);
  const gamecount = applyCount ? Number(document.getElementById('f-gamecount').value) : 1;
  const total = calcAmount(role, { gametype, location, duration, gamecount });

  document.getElementById('f-unit-amount').textContent = yen(total);
  document.getElementById('f-unit-amount-detail').textContent = applyCount ? amountBreakdownText(role, { gametype, location, gamecount }) : '';
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
      <td><button class="btn-secondary receipt-btn" data-receipt="${r.id}">精算書</button></td>
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
  tbody.querySelectorAll('[data-receipt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const record = filtered.find((r) => r.id === btn.dataset.receipt);
      if (record) handleReceiptClick(record);
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
 * 精算書用の連絡先・住所（よく依頼する対象者ごとに設定。Firestoreで共有）
 * ============================================================ */
function saveContacts(contacts) {
  window.FirebaseData.saveContacts(contacts).catch((err) => {
    console.error('saveContacts failed', err);
    alert('連絡先の保存に失敗しました: ' + err.message);
  });
}

function renderContactSettingsBody() {
  const body = document.getElementById('contact-settings-body');
  if (rosterNames.length === 0) {
    body.innerHTML = '<p class="import-hint">「よく依頼する対象者の登録・削除」で対象者を登録すると、ここで連絡先・住所を設定できるようになります。</p>';
    return;
  }
  body.innerHTML = rosterNames
    .map(
      (name, i) => `
    <fieldset class="contact-person">
      <legend>${escapeHtml(name)}</legend>
      <label class="field-group">
        住所
        <input type="text" id="c-address-${i}" data-name="${escapeHtml(name)}" data-field="address" placeholder="例）陸前高田市高田町字中和野14-1">
      </label>
      <label class="field-group">
        電話番号
        <input type="text" id="c-phone-${i}" data-name="${escapeHtml(name)}" data-field="phone" placeholder="080-0000-0000">
      </label>
    </fieldset>`
    )
    .join('');

  body.querySelectorAll('input').forEach((input) => {
    const name = input.dataset.name;
    const field = input.dataset.field;
    input.addEventListener('input', () => {
      const target = field === 'address' ? contactsCache.addresses : contactsCache.phones;
      target[name] = input.value;
      saveContacts(contactsCache);
    });
  });

  refreshContactInputs();
}

function refreshContactInputs() {
  document.querySelectorAll('#contact-settings-body input').forEach((input) => {
    if (document.activeElement === input) return; // 入力中の欄は上書きしない
    const name = input.dataset.name;
    const field = input.dataset.field;
    const store = field === 'address' ? contactsCache.addresses : contactsCache.phones;
    input.value = store[name] || '';
  });
}

/* ============================================================
 * 精算書（謝礼金精算書）PDF出力
 * ============================================================ */
const RECEIPT_TITLES = { referee: '審判謝礼精算書', commissioner: 'コミッショナー謝礼精算書', other: '謝礼金精算書' };

function numFmt(n) {
  return Number(n || 0).toLocaleString('ja-JP');
}

function formatDateDot(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}.${m}.${d}`;
}

function eventLabel(r) {
  const d = formatDateDot(r.date);
  let typeText = '';
  if (r.role === 'referee') typeText = RULES.referee.gametype[r.gametype]?.label ?? '';
  else if (r.role === 'commissioner') typeText = 'コミッショナー';
  else if (r.role === 'other') typeText = r.otherContent || '';
  return typeText ? `${d}　${typeText}` : d;
}

function buildReceiptRows(r) {
  if (r.role === 'referee') {
    if (r.gametype === 'practice_game') {
      return [{ label: DURATION_LABEL[r.duration] || '', amount: r.amount }];
    }
    if (r.gametype === 'official_game') {
      const unit = RULES.referee.gametype.official_game.flat;
      return [{ label: `公式戦（${yen(unit)} × ${r.gamecount || 1}試合）`, amount: r.amount }];
    }
  }
  if (r.role === 'commissioner') {
    const conf = RULES.commissioner.location[r.location];
    const gamecount = r.gamecount || 1;
    const honorarium = (conf?.honorarium ?? 0) * gamecount;
    const rows = [{ label: `謝礼（${yen(conf?.honorarium ?? 0)} × ${gamecount}試合）`, amount: honorarium }];
    if (conf && conf.transport > 0) rows.push({ label: '交通費', amount: conf.transport });
    return rows;
  }
  if (r.role === 'other') {
    return [{ label: r.otherContent || '内容', amount: r.amount }];
  }
  return [{ label: '', amount: r.amount }];
}

function renderReceiptPrintArea(recordsToPrint) {
  const area = document.getElementById('receipt-print-area');
  area.innerHTML = recordsToPrint
    .map((r) => {
      const rows = buildReceiptRows(r);
      const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
      const phone = contactsCache.phones[r.name] || '';
      const address = contactsCache.addresses[r.name] || '';
      const rowsHtml = rows
        .map((row) => `<tr><td class="rc-item-label">${escapeHtml(row.label)}</td><td class="rc-num">${numFmt(row.amount)} 円</td></tr>`)
        .join('');

      return `
      <div class="receipt-page">
        <img class="receipt-logo-img" src="logo.png" alt="KESEN LARUS BASKETBALL CLUB">
        <div class="receipt-logo-divider"></div>
        <div class="receipt-title-bar"><span>${escapeHtml(RECEIPT_TITLES[r.role] ?? '謝礼金精算書')}</span></div>
        <table class="receipt-info-table">
          <tr>
            <th>大会名</th>
            <td>${escapeHtml(eventLabel(r))}</td>
            <th>大会開催地</th>
            <td>${escapeHtml(r.venue || '')}</td>
          </tr>
          <tr>
            <th>名前</th>
            <td class="receipt-name-cell">${escapeHtml(r.name)}<span class="receipt-seal">印</span></td>
            <th>連絡先</th>
            <td>${escapeHtml(phone)}</td>
          </tr>
          <tr>
            <th>住所</th>
            <td colspan="3">${escapeHtml(address)}</td>
          </tr>
        </table>
        <table class="receipt-amount-table">
          <tr><th>金額</th><td class="receipt-amount-value">${numFmt(total)}</td><td class="receipt-amount-unit">円</td></tr>
        </table>
        <table class="receipt-detail-table">
          ${rowsHtml}
          <tr class="rc-total-row"><td class="rc-total-label">合計</td><td class="rc-num">${numFmt(total)} 円</td></tr>
        </table>
        ${r.note ? `<p class="receipt-note">備考：${escapeHtml(r.note)}</p>` : ''}
      </div>`;
    })
    .join('');
}

function handleReceiptClick(record) {
  renderReceiptPrintArea([record]);
  window.print();
}

function initContactSettings() {
  renderContactSettingsBody();
}

/* ============================================================
 * 認証（共有の合言葉でFirebase Authenticationにログイン。交通費アプリと同じアカウント）
 * ============================================================ */
function initAuth() {
  const loginForm = document.getElementById('login-form');
  const loginPin = document.getElementById('login-pin');
  const loginError = document.getElementById('login-error');
  const loginStatus = document.getElementById('login-status');
  const logoutBtn = document.getElementById('btn-logout');

  let unsubscribeRecords = null;
  let unsubscribeRoster = null;
  let unsubscribeContacts = null;
  let autoLoginAttempted = false;

  const urlKey = new URLSearchParams(location.search).get('key');
  if (urlKey) {
    loginStatus.textContent = '自動ログイン中...';
  }

  function tryAutoLogin() {
    if (autoLoginAttempted || !urlKey) return;
    autoLoginAttempted = true;
    window.FirebaseData.signIn(urlKey)
      .then(() => {
        history.replaceState(null, '', location.pathname + location.hash);
      })
      .catch((err) => {
        console.error('auto signIn failed', err);
        loginError.textContent = 'URLの合言葉が正しくありません。手動で入力してください';
      });
  }

  window.FirebaseData.onAuthChange((user) => {
    loginStatus.style.display = 'none';

    if (!user) {
      // signIn()が同じonAuthChangeコールバックを同期的に再入呼び出しするため、
      // 今回のコールバック処理が完了してから実行する
      setTimeout(tryAutoLogin, 0);
    }

    if (user) {
      document.body.classList.remove('auth-locked');
      loginError.textContent = '';
      loginPin.value = '';
      if (!unsubscribeRecords) {
        unsubscribeRecords = window.FirebaseData.subscribeRecords((recs) => {
          records = recs;
          renderList();
        });
      }
      if (!unsubscribeRoster) {
        unsubscribeRoster = window.FirebaseData.subscribeRoster((names) => {
          rosterNames = names;
          renderNameSelect();
          renderRosterList();
          renderContactSettingsBody();
        });
      }
      if (!unsubscribeContacts) {
        unsubscribeContacts = window.FirebaseData.subscribeContacts((c) => {
          contactsCache = c;
          refreshContactInputs();
        });
      }
    } else {
      document.body.classList.add('auth-locked');
      if (unsubscribeRecords) {
        unsubscribeRecords();
        unsubscribeRecords = null;
      }
      if (unsubscribeRoster) {
        unsubscribeRoster();
        unsubscribeRoster = null;
      }
      if (unsubscribeContacts) {
        unsubscribeContacts();
        unsubscribeContacts = null;
      }
      records = [];
      rosterNames = [];
      contactsCache = { addresses: {}, phones: {} };
    }
  });

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = loginPin.value;
    if (!pin) return;
    loginError.textContent = '';
    window.FirebaseData.signIn(pin).catch((err) => {
      console.error('signIn failed', err);
      loginError.textContent = '合言葉が正しくありません';
    });
  });

  logoutBtn.addEventListener('click', () => {
    window.FirebaseData.signOut();
  });
}

/* ============================================================
 * 初期化
 * ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initForm();
  initRoster();
  initContactSettings();
  initList();
  initAuth();
});
