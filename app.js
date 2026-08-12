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
        /* 気仙管内・気仙管外とも基本額は同じ。気仙管外はさらに交通費(定額)または弁当支給が加わる */
        base: { half: 2000, full: 4000 },
      },
      official_game: { label: '公式戦', flat: 2500 },
    },
  },
  commissioner: {
    label: 'コミッショナー',
    /* 謝礼は試合数分。気仙管外はさらに交通費(定額・1日1回のみ)または弁当支給が加わる */
    honorarium: 1000,
  },
};

/* 気仙管外の場合に加算される交通費の定額（弁当支給を選んだ場合は加算しない） */
const OUT_SUPPLEMENT = 1000;
const OUT_SUPPLY_LABEL = { transport: '交通費', bento: '弁当' };

const ROLE_LABELS = { referee: '帯同審判', commissioner: 'コミッショナー', other: 'その他' };
const LOCATION_LABEL = { in: '気仙管内', out: '気仙管外' };
const DURATION_LABEL = { half: '半日（4h以内・1試合）', full: '1日（4h超）' };
const OTHER_VALUE = '__other__';

/* 審判の公式戦・コミッショナーは1試合あたりの金額のため、試合数(最大3)を掛ける */
function gameCountApplies(role, gametype) {
  return role === 'commissioner' || (role === 'referee' && gametype === 'official_game');
}

function outSupplement(location, outSupply) {
  return location === 'out' && outSupply !== 'bento' ? OUT_SUPPLEMENT : 0;
}

function calcAmount(role, { gametype, location, duration, gamecount, outSupply }) {
  if (role === 'referee') {
    const gt = RULES.referee.gametype[gametype];
    if (!gt) return 0;
    if (gt.flat !== undefined) return gt.flat * (gamecount || 1);
    return (gt.base[duration] ?? 0) + outSupplement(location, outSupply);
  }
  if (role === 'commissioner') {
    return RULES.commissioner.honorarium * (gamecount || 1) + outSupplement(location, outSupply);
  }
  return 0;
}

function amountBreakdownText(role, { gametype, location, gamecount, outSupply }) {
  const parts = [];
  if (role === 'referee' && gametype === 'official_game') {
    parts.push(`${yen(RULES.referee.gametype.official_game.flat)} × ${gamecount}試合`);
  } else if (role === 'commissioner') {
    parts.push(`謝礼 ${yen(RULES.commissioner.honorarium)} × ${gamecount}試合`);
  }
  if (location === 'out') {
    parts.push(outSupply === 'bento' ? '弁当支給（気仙管外）' : `交通費 ${yen(OUT_SUPPLEMENT)}（気仙管外）`);
  }
  return parts.join(' + ');
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
      if (r.location === 'out') parts.push(OUT_SUPPLY_LABEL[r.outSupply] ?? OUT_SUPPLY_LABEL.transport);
    } else if (r.gametype === 'official_game' && r.gamecount) {
      parts.push(`${r.gamecount}試合`);
    }
    return parts.filter(Boolean).join(' / ');
  }
  if (r.role === 'commissioner') {
    const parts = [LOCATION_LABEL[r.location]];
    if (r.gamecount) parts.push(`${r.gamecount}試合`);
    if (r.location === 'out') parts.push(OUT_SUPPLY_LABEL[r.outSupply] ?? OUT_SUPPLY_LABEL.transport);
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
      if (btn.dataset.tab === 'dashboard') renderDashboard();
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
  document.getElementById('f-location').addEventListener('change', () => {
    updateConditionalFields();
    updateUnitAmount();
  });
  document.getElementById('f-duration').addEventListener('change', updateUnitAmount);
  document.getElementById('f-gamecount').addEventListener('change', updateUnitAmount);
  document.getElementById('f-out-supply').addEventListener('change', updateUnitAmount);
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
      const outSupply = showLocation && location === 'out' ? document.getElementById('f-out-supply').value : undefined;
      const amount = calcAmount(role, { gametype, location, duration, gamecount, outSupply });
      record = { date, role, gametype, location, duration, gamecount, outSupply, amount, name, note, venue };
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
  const location = document.getElementById('f-location').value;
  const isOther = role === 'other';
  const isPracticeGame = role === 'referee' && gametype === 'practice_game';
  const showLocation = !isOther && (role === 'commissioner' || isPracticeGame);
  const showGamecount = !isOther && gameCountApplies(role, gametype);
  const showOutSupply = showLocation && location === 'out';

  document.getElementById('group-gametype').style.display = role === 'referee' ? '' : 'none';
  document.getElementById('group-location').style.display = showLocation ? '' : 'none';
  document.getElementById('group-duration').style.display = isPracticeGame ? '' : 'none';
  document.getElementById('group-out-supply').style.display = showOutSupply ? '' : 'none';
  document.getElementById('group-gamecount').style.display = showGamecount ? '' : 'none';
  document.getElementById('group-unit-amount').style.display = isOther ? 'none' : '';
  document.getElementById('group-other-fields').style.display = isOther ? '' : 'none';
}

function updateUnitAmount() {
  const role = document.getElementById('f-role').value;
  if (role === 'other') return;
  const gametype = document.getElementById('f-gametype').value;
  const isPracticeGame = role === 'referee' && gametype === 'practice_game';
  const showLocation = role === 'commissioner' || isPracticeGame;
  const location = showLocation ? document.getElementById('f-location').value : undefined;
  const duration = document.getElementById('f-duration').value;
  const outSupply = document.getElementById('f-out-supply').value;
  const applyCount = gameCountApplies(role, gametype);
  const gamecount = applyCount ? Number(document.getElementById('f-gamecount').value) : 1;
  const total = calcAmount(role, { gametype, location, duration, gamecount, outSupply });

  document.getElementById('f-unit-amount').textContent = yen(total);
  document.getElementById('f-unit-amount-detail').textContent = amountBreakdownText(role, { gametype, location, gamecount, outSupply });
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

function outSupplyRow(r) {
  if (r.location !== 'out') return null;
  if (r.outSupply === 'bento') return { label: '弁当（気仙管外）', inKind: true };
  return { label: '交通費（気仙管外）', amount: OUT_SUPPLEMENT };
}

function buildReceiptRows(r) {
  if (r.role === 'referee') {
    if (r.gametype === 'practice_game') {
      const base = RULES.referee.gametype.practice_game.base[r.duration] ?? 0;
      const rows = [{ label: DURATION_LABEL[r.duration] || '', amount: base }];
      const supply = outSupplyRow(r);
      if (supply) rows.push(supply);
      return rows;
    }
    if (r.gametype === 'official_game') {
      const unit = RULES.referee.gametype.official_game.flat;
      return [{ label: `公式戦（${yen(unit)} × ${r.gamecount || 1}試合）`, amount: r.amount }];
    }
  }
  if (r.role === 'commissioner') {
    const gamecount = r.gamecount || 1;
    const honorarium = RULES.commissioner.honorarium * gamecount;
    const rows = [{ label: `謝礼（${yen(RULES.commissioner.honorarium)} × ${gamecount}試合）`, amount: honorarium }];
    const supply = outSupplyRow(r);
    if (supply) rows.push(supply);
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
        .map((row) => `<tr><td class="rc-item-label">${escapeHtml(row.label)}</td><td class="rc-num">${row.inKind ? '支給' : numFmt(row.amount) + ' 円'}</td></tr>`)
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
 * バックアップ（Excel出力・CSV取込）
 * ============================================================ */
const BACKUP_HEADER = ['日付', '氏名', '区分', '試合種別', '活動場所', '拘束時間', '試合数', '管外支給', '内容', '支給額', '大会開催地', '備考'];
const DURATION_SIMPLE_LABEL = { half: '半日', full: '1日' };
const DURATION_SIMPLE_REVERSE = { 半日: 'half', '1日': 'full' };
const ROLE_LABEL_REVERSE = { 帯同審判: 'referee', コミッショナー: 'commissioner', その他: 'other' };
const LOCATION_LABEL_REVERSE = { 気仙管内: 'in', 気仙管外: 'out' };
const OUT_SUPPLY_LABEL_REVERSE = { 交通費: 'transport', 弁当: 'bento' };
const GAMETYPE_LABEL_REVERSE = { 練習試合: 'practice_game', 公式戦: 'official_game' };

function buildBackupRows() {
  return records.map((r) => [
    r.date,
    r.name,
    roleLabel(r.role),
    r.role === 'referee' ? RULES.referee.gametype[r.gametype]?.label ?? '' : '',
    r.location ? LOCATION_LABEL[r.location] : '',
    r.duration ? DURATION_SIMPLE_LABEL[r.duration] ?? '' : '',
    r.gamecount ?? '',
    r.location === 'out' ? OUT_SUPPLY_LABEL[r.outSupply] ?? OUT_SUPPLY_LABEL.transport : '',
    r.otherContent ?? '',
    r.amount,
    r.venue ?? '',
    r.note ?? '',
  ]);
}

function handleBackupExportClick() {
  if (records.length === 0) {
    alert('出力できる記録がありません');
    return;
  }
  const rows = buildBackupRows();
  const bytes = buildXlsxFile('謝礼金記録', BACKUP_HEADER, rows);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  downloadBytes(bytes, `謝礼金_バックアップ_${today}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  showToast('バックアップを出力しました');
}

function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length > 0);
  return lines.map((line) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  });
}

/* CSVの1行(cells)を、バックアップ形式のヘッダー(header)を手がかりに記録オブジェクトへ変換する。
 * 必須項目が欠けている・区分や試合種別が認識できない場合はnullを返す */
function parseBackupRow(cells, header) {
  const idx = (name) => header.indexOf(name);
  const get = (name) => {
    const i = idx(name);
    return i === -1 ? '' : (cells[i] ?? '').trim();
  };

  const date = get('日付');
  const name = get('氏名');
  const role = ROLE_LABEL_REVERSE[get('区分')];
  const amount = Number(get('支給額'));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name || !role || !Number.isFinite(amount)) return null;

  const record = { date, name, role, amount, venue: get('大会開催地'), note: get('備考') };

  if (role === 'referee') {
    const gametype = GAMETYPE_LABEL_REVERSE[get('試合種別')];
    if (!gametype) return null;
    record.gametype = gametype;
    if (gametype === 'practice_game') {
      const location = LOCATION_LABEL_REVERSE[get('活動場所')];
      const duration = DURATION_SIMPLE_REVERSE[get('拘束時間')];
      if (!location || !duration) return null;
      record.location = location;
      record.duration = duration;
    } else {
      const gc = Number(get('試合数'));
      record.gamecount = Number.isFinite(gc) && gc > 0 ? gc : 1;
    }
  } else if (role === 'commissioner') {
    const location = LOCATION_LABEL_REVERSE[get('活動場所')];
    if (!location) return null;
    record.location = location;
    const gc = Number(get('試合数'));
    record.gamecount = Number.isFinite(gc) && gc > 0 ? gc : 1;
  } else if (role === 'other') {
    const otherContent = get('内容');
    if (!otherContent) return null;
    record.otherContent = otherContent;
  }

  if (record.location === 'out') {
    record.outSupply = OUT_SUPPLY_LABEL_REVERSE[get('管外支給')] || 'transport';
  }

  return record;
}

function handleImportCsv(text) {
  const resultEl = document.getElementById('import-result');
  const rows = parseCsv(text);
  if (rows.length === 0) {
    resultEl.textContent = 'ファイルが空です';
    return;
  }
  const header = rows[0].map((h) => h.trim());
  if (!header.includes('日付') || !header.includes('氏名') || !header.includes('区分') || !header.includes('支給額')) {
    resultEl.textContent = 'CSVの形式が正しくありません（日付・氏名・区分・支給額の列が必要です）';
    return;
  }

  let added = 0;
  let duplicated = 0;
  let invalid = 0;
  const toAdd = [];

  rows.slice(1).forEach((cells) => {
    if (cells.length < 2) return;
    const record = parseBackupRow(cells, header);
    if (!record) {
      invalid++;
      return;
    }

    const isDuplicate = records.some(
      (r) =>
        r.date === record.date &&
        r.name === record.name &&
        r.role === record.role &&
        r.gametype === record.gametype &&
        r.location === record.location &&
        r.duration === record.duration &&
        r.gamecount === record.gamecount &&
        r.outSupply === record.outSupply &&
        r.otherContent === record.otherContent &&
        Number(r.amount) === record.amount
    );
    if (isDuplicate) {
      duplicated++;
      return;
    }

    toAdd.push(record);
    added++;
  });

  if (toAdd.length > 0) {
    window.FirebaseData.addRecords(toAdd).catch((err) => {
      console.error('addRecords failed', err);
      alert('取込に失敗しました: ' + err.message);
    });
  }

  const resultLines = [`${added}件を追加しました`];
  if (duplicated > 0) resultLines.push(`（重複のためスキップ: ${duplicated}件）`);
  if (invalid > 0) resultLines.push(`（形式不正のためスキップ: ${invalid}件）`);
  resultEl.textContent = resultLines.join(' ');
  if (added > 0) showToast(`${added}件をインポートしました`);
}

function initBackup() {
  document.getElementById('btn-backup-export').addEventListener('click', handleBackupExportClick);
  document.getElementById('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleImportCsv(String(reader.result));
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });
}

/* ============================================================
 * 封筒印刷（長形3号・120x235mm、対象期間内の記録がある全員分）
 * ============================================================ */
function formatDisplayName(name) {
  return name.length === 4 ? name.slice(0, 2) + '　' + name.slice(2) : name;
}

function reiwaYearOf(y) {
  return y - 2018;
}

/* 単月なら「令和8年7月分」、複数月かつ同じ年度内なら「令和8年4月〜7月分」、
 * 年をまたぐ場合は「令和7年12月〜令和8年3月分」のように両方の年を表記する */
function formatEnvelopePeriod(startMonth, endMonth) {
  const [sy, sm] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  if (startMonth === endMonth) return `令和${reiwaYearOf(sy)}年${sm}月分`;
  if (sy === ey) return `令和${reiwaYearOf(sy)}年${sm}月〜${em}月分`;
  return `令和${reiwaYearOf(sy)}年${sm}月〜令和${reiwaYearOf(ey)}年${em}月分`;
}

function populateEnvelopeMonthOptions() {
  const thisMonth = monthKey(new Date().toISOString());
  const months = [...new Set([...records.map((r) => monthKey(r.date)), thisMonth].filter(Boolean))].sort().reverse();
  const optsHtml = months.map((m) => `<option value="${m}">${m}</option>`).join('');
  ['env-start-month', 'env-end-month'].forEach((id) => {
    const sel = document.getElementById(id);
    const keep = sel.value;
    sel.innerHTML = optsHtml;
    sel.value = months.includes(keep) ? keep : months[0] || '';
  });
}

function buildEnvelopeEntries(startMonth, endMonth) {
  const totals = new Map();
  records
    .filter((r) => {
      const mk = monthKey(r.date);
      return mk >= startMonth && mk <= endMonth;
    })
    .forEach((r) => {
      totals.set(r.name, (totals.get(r.name) || 0) + (Number(r.amount) || 0));
    });
  return [...totals.entries()]
    .map(([name, total]) => ({ name, total }))
    .filter((e) => e.total > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

function renderEnvelopePrintArea(entries, period, feeLabel) {
  const area = document.getElementById('envelope-print-area');
  area.innerHTML = entries
    .map(
      (e) => `
      <div class="envelope-page">
        <div class="env-top">
          <img class="env-logo" src="logo.png" alt="KESEN LARUS BASKETBALL CLUB">
          <div class="env-logo-rule"></div>
        </div>
        <div class="env-mid">
          <div class="env-name-block"><div class="env-name">${escapeHtml(formatDisplayName(e.name))}<span class="sama">様</span></div></div>
          <div class="env-period-block">
            <span class="env-label">対象期間</span>
            <div class="env-period">${escapeHtml(period)}</div>
            <div class="env-fee-type">${escapeHtml(feeLabel)}</div>
          </div>
          <div class="env-amount-block"><span class="env-amount-num">${numFmt(e.total)}</span><span class="env-amount-unit">円</span></div>
        </div>
        <div class="env-footer">KESEN LARUS BASKETBALL CLUB</div>
      </div>`
    )
    .join('');
}

/* 封筒は120x235mmの長形3号だが、精算書PDF(A4想定)と@pageサイズが競合するため、
 * 印刷直前だけ動的にスタイルを差し込み、印刷後に取り除く */
function printWithEnvelopePageSize() {
  const style = document.createElement('style');
  style.textContent = '@page { size: 120mm 235mm; margin: 0; }';
  document.head.appendChild(style);
  const cleanup = () => {
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60000);
  window.print();
}

function handleEnvelopePrintClick() {
  const start = document.getElementById('env-start-month').value;
  const end = document.getElementById('env-end-month').value;
  if (!start || !end) {
    alert('開始月・終了月を選択してください');
    return;
  }
  if (start > end) {
    alert('開始月は終了月と同じか、それより前の月を選択してください');
    return;
  }
  const entries = buildEnvelopeEntries(start, end);
  if (entries.length === 0) {
    alert('指定した期間に支給記録がありません');
    return;
  }
  renderEnvelopePrintArea(entries, formatEnvelopePeriod(start, end), '謝礼金');
  printWithEnvelopePageSize();
}

function initEnvelope() {
  populateEnvelopeMonthOptions();
  document.getElementById('btn-envelope-print').addEventListener('click', handleEnvelopePrintClick);
}

/* ============================================================
 * ダッシュボード
 * ============================================================ */
const CATEGORY_CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const PEOPLE_CHART_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
const FISCAL_MONTH_LABELS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月'];
const DASH_CATEGORY_DEFS = [
  { label: '帯同審判(練習試合)', match: (r) => r.role === 'referee' && r.gametype === 'practice_game' },
  { label: '帯同審判(公式戦)', match: (r) => r.role === 'referee' && r.gametype === 'official_game' },
  { label: 'コミッショナー', match: (r) => r.role === 'commissioner' },
  { label: 'その他', match: (r) => r.role === 'other' },
];
const DASH_PEOPLE_CHART_LIMIT = 12;

/* 年度は4月始まり(その年の4月〜翌年3月)。fiscalYearOfは年度の開始年(西暦)を返す */
function fiscalYearOf(dateStr) {
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(5, 7));
  return m >= 4 ? y : y - 1;
}

function fiscalMonthIndex(dateStr) {
  const m = Number(dateStr.slice(5, 7));
  return m >= 4 ? m - 4 : m + 8;
}

function fiscalYearLabel(fy) {
  const reiwaYear = fy - 2018;
  return `令和${reiwaYear}年度（${fy}年4月〜${fy + 1}年3月）`;
}

function getFiscalYearsWithData() {
  const years = new Set(records.map((r) => fiscalYearOf(r.date)));
  years.add(fiscalYearOf(new Date().toISOString().slice(0, 10)));
  return [...years].sort((a, b) => b - a);
}

function computeAnnualData(fiscalYear) {
  const yearRecords = records.filter((r) => fiscalYearOf(r.date) === fiscalYear);

  const monthly = Array(12).fill(0);
  yearRecords.forEach((r) => {
    monthly[fiscalMonthIndex(r.date)] += Number(r.amount) || 0;
  });
  const total = monthly.reduce((a, b) => a + b, 0);
  const count = yearRecords.length;

  const categories = DASH_CATEGORY_DEFS.map((def) => ({
    label: def.label,
    total: yearRecords.filter(def.match).reduce((s, r) => s + (Number(r.amount) || 0), 0),
  }));

  const amountByName = new Map();
  const countByName = new Map();
  yearRecords.forEach((r) => {
    amountByName.set(r.name, (amountByName.get(r.name) || 0) + (Number(r.amount) || 0));
    countByName.set(r.name, (countByName.get(r.name) || 0) + 1);
  });
  const people = [...amountByName.keys()]
    .map((name) => ({ name, amount: amountByName.get(name), count: countByName.get(name) }))
    .sort((a, b) => b.amount - a.amount);

  const monthsWithData = monthly.filter((v) => v > 0).length;
  const monthlyAverage = monthsWithData === 0 ? 0 : Math.round(total / monthsWithData);
  const topPerson = people[0] || null;

  return { fiscalYear, monthly, total, count, categories, people, monthlyAverage, topPerson };
}

function initDashboard() {
  document.getElementById('dash-year').addEventListener('change', renderDashboard);
}

function renderDashboard() {
  const yearSel = document.getElementById('dash-year');
  const years = getFiscalYearsWithData();
  const keep = yearSel.value ? Number(yearSel.value) : fiscalYearOf(new Date().toISOString().slice(0, 10));
  yearSel.innerHTML = years.map((y) => `<option value="${y}">${escapeHtml(fiscalYearLabel(y))}</option>`).join('');
  yearSel.value = years.includes(keep) ? keep : years[0];

  const data = computeAnnualData(Number(yearSel.value));
  renderDashTiles(data);
  renderMonthlyChart(data);
  renderCategoryChart(data);
  renderPeopleChart(data);
}

function renderDashTiles(data) {
  const tiles = [
    { label: '年間合計費用', value: yen(data.total) },
    { label: '支払件数', value: `${data.count} 件` },
    { label: '活動月平均費用', value: yen(data.monthlyAverage), sub: '記録のある月の平均' },
    {
      label: '支払額トップ',
      value: data.topPerson ? data.topPerson.name : '-',
      sub: data.topPerson ? `${yen(data.topPerson.amount)}（${data.topPerson.count}件）` : '',
    },
  ];
  document.getElementById('dash-tiles').innerHTML = tiles
    .map(
      (t) => `
    <div class="stat-tile">
      <div class="stat-tile-label">${escapeHtml(t.label)}</div>
      <div class="stat-tile-value">${escapeHtml(String(t.value))}</div>
      ${t.sub ? `<div class="stat-tile-sub">${escapeHtml(t.sub)}</div>` : ''}
    </div>`
    )
    .join('');
}

function showChartTooltip(evt, text) {
  const tip = document.getElementById('chart-tooltip');
  tip.textContent = text;
  tip.style.left = evt.clientX + 'px';
  tip.style.top = evt.clientY + 'px';
  tip.classList.add('show');
}
function moveChartTooltip(evt) {
  const tip = document.getElementById('chart-tooltip');
  tip.style.left = evt.clientX + 'px';
  tip.style.top = evt.clientY + 'px';
}
function hideChartTooltip() {
  document.getElementById('chart-tooltip').classList.remove('show');
}

function renderBarChart(containerId, items, colors, options = {}) {
  const container = document.getElementById(containerId);
  const max = Math.max(...items.map((i) => i.value), 1);
  const showValueLabel = options.showValueLabel !== false;

  container.innerHTML = items
    .map((item, i) => {
      const heightPct = item.value > 0 ? Math.max((item.value / max) * 100, 2) : 0;
      const color = typeof colors === 'function' ? colors(i) : colors[i % colors.length];
      const tooltip = `${item.label}: ${yen(item.value)}`;
      return `
      <div class="chart-bar-col" data-tooltip="${escapeHtml(tooltip)}">
        ${showValueLabel && item.value > 0 ? `<div class="chart-bar-value">${yen(item.value)}</div>` : ''}
        <div class="chart-bar" style="height:${heightPct}%; background:${color}"></div>
        <div class="chart-bar-label">${escapeHtml(item.label)}</div>
      </div>`;
    })
    .join('');

  container.querySelectorAll('.chart-bar-col').forEach((col) => {
    col.addEventListener('mouseenter', (e) => showChartTooltip(e, col.dataset.tooltip));
    col.addEventListener('mousemove', moveChartTooltip);
    col.addEventListener('mouseleave', hideChartTooltip);
  });
}

function renderMonthlyChart(data) {
  const items = data.monthly.map((v, i) => ({ label: FISCAL_MONTH_LABELS[i], value: v }));
  renderBarChart('dash-monthly-chart', items, ['var(--primary)'], { showValueLabel: false });

  document.getElementById('dash-monthly-table').innerHTML = items
    .map((it) => `<tr><td>${escapeHtml(it.label)}</td><td class="num">${yen(it.value)}</td></tr>`)
    .join('');
}

function renderCategoryChart(data) {
  renderBarChart(
    'dash-category-chart',
    data.categories.map((c) => ({ label: c.label, value: c.total })),
    CATEGORY_CHART_COLORS
  );

  document.getElementById('dash-category-legend').innerHTML = data.categories
    .map(
      (c, i) =>
        `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${CATEGORY_CHART_COLORS[i]}"></span>${escapeHtml(c.label)}</span>`
    )
    .join('');

  document.getElementById('dash-category-table').innerHTML = data.categories
    .map((c) => {
      const pct = data.total === 0 ? 0 : Math.round((c.total / data.total) * 100);
      return `<tr><td>${escapeHtml(c.label)}</td><td class="num">${yen(c.total)}</td><td class="num">${pct}%</td></tr>`;
    })
    .join('');
}

function renderPeopleChart(data) {
  const chartPeople = data.people.slice(0, DASH_PEOPLE_CHART_LIMIT);
  renderBarChart(
    'dash-people-chart',
    chartPeople.map((p) => ({ label: p.name, value: p.amount })),
    PEOPLE_CHART_COLORS
  );

  document.getElementById('dash-people-legend').innerHTML =
    chartPeople
      .map(
        (p, i) =>
          `<span class="chart-legend-item"><span class="chart-legend-swatch" style="background:${PEOPLE_CHART_COLORS[i % PEOPLE_CHART_COLORS.length]}"></span>${escapeHtml(p.name)}</span>`
      )
      .join('') + (data.people.length > DASH_PEOPLE_CHART_LIMIT ? `<span class="chart-legend-item">他 ${data.people.length - DASH_PEOPLE_CHART_LIMIT} 名</span>` : '');

  document.getElementById('dash-people-table').innerHTML = data.people
    .map((p) => {
      const pct = data.total === 0 ? 0 : Math.round((p.amount / data.total) * 100);
      return `<tr><td>${escapeHtml(p.name)}</td><td class="num">${yen(p.amount)}</td><td class="num">${p.count}件</td><td class="num">${pct}%</td></tr>`;
    })
    .join('');
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
          renderDashboard();
          populateEnvelopeMonthOptions();
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
  initDashboard();
  initBackup();
  initEnvelope();
  initAuth();
});
