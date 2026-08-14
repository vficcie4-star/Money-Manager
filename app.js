/* ==========================================================================
   MoneyTracker — app.js
   (Added Next Payment sort toggle in Loan view; disables drag while sorted)
   ========================================================================== */

/* ---------------------------- IndexedDB layer ---------------------------- */
const DB_NAME = 'MoneyTrackerDB';
const DB_VERSION = 3;
const STORE = 'tx';
const GROUP_STORE = 'groups';
const SETTINGS_STORE = 'settings';
let db;

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORE)){
        const store = _db.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
        store.createIndex('code', 'code', { unique:false });
        store.createIndex('transactionType', 'transactionType', { unique:false });
        store.createIndex('date', 'date', { unique:false });
      }
      if (!_db.objectStoreNames.contains(GROUP_STORE)){
        _db.createObjectStore(GROUP_STORE, { keyPath:'id', autoIncrement:true });
      }
      if (!_db.objectStoreNames.contains(SETTINGS_STORE)){
        _db.createObjectStore(SETTINGS_STORE, { keyPath:'key' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbAddMany(records){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    records.forEach(r => store.add(r));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function dbPut(record){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function dbGetAll(){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function dbDeleteIds(ids){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function dbClearAll(){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* Groups */
function dbGetAllGroups(){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUP_STORE, 'readonly');
    const req = tx.objectStore(GROUP_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
function dbSaveGroup(group){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUP_STORE, 'readwrite');
    const store = tx.objectStore(GROUP_STORE);
    const req = group.id ? store.put(group) : store.add(group);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = (e) => reject(e.target.error);
  });
}
function dbDeleteGroup(id){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUP_STORE, 'readwrite');
    tx.objectStore(GROUP_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* Settings */
function dbGetSetting(key){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const req = tx.objectStore(SETTINGS_STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = (e) => reject(e.target.error);
  });
}
function dbSetSetting(key, value){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* ------------------------------ App state -------------------------------- */
let allTx = [];
let allGroups = [];
let walletAccounts = null;
let currentView = 'report';
let loanOrder = null; // persisted array of loan codes in preferred order

// NEW: sort state for Next Payment column: null (original) or 'asc' (oldest-first)
let loanNextSort = null;

async function init(){
  await openDB();
  allTx = await dbGetAll();
  allGroups = await dbGetAllGroups();
  const savedWallet = await dbGetSetting('walletAccounts');
  walletAccounts = Array.isArray(savedWallet) ? savedWallet : null;
  loanOrder = await dbGetSetting('loanOrder') || null;
  bindNav();
  bindGlobalUI();
  navigate('report');
}

async function reload(){
  allTx = await dbGetAll();
}
async function reloadGroups(){
  allGroups = await dbGetAllGroups();
}

/* ------------------------------- Helpers --------------------------------- */
function fmtMoney(n){
  n = Number(n) || 0;
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return neg ? `(${s})` : s;
}
function parseMoney(str){
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const cleaned = String(str).replace(/[,()\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const v = parseFloat(cleaned);
  return isNaN(v) ? 0 : v;
}
function localISO(d){
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayStr(){
  return localISO(new Date());
}
function fmtDate(d){
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'2-digit' });
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), 2200);
}
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }
function earliestDateRecorded(){
  const dates = allTx.map(t => t.date).filter(Boolean);
  if (!dates.length) return todayStr();
  return dates.slice().sort()[0];
}

/* Accounting-format input */
function wireMoneyInput(el){
  el.addEventListener('blur', () => {
    const v = parseMoney(el.value);
    el.dataset.raw = v;
    el.value = v ? fmtMoney(v) : '';
  });
  el.addEventListener('focus', () => {
    const v = parseMoney(el.value);
    el.value = v ? String(v) : '';
  });
}
function moneyVal(el){ return parseMoney(el.value); }

/* Autocomplete */
function attachAutocomplete(inputEl, listEl, sourceFn){
  function render(){
    const q = inputEl.value.trim().toLowerCase();
    const opts = sourceFn().filter(o => o && (!q || o.toLowerCase().includes(q)));
    if (!opts.length){ listEl.classList.remove('open'); listEl.innerHTML=''; return; }
    listEl.innerHTML = opts.slice(0,8).map(o => `<div>${escapeHtml(o)}</div>`).join('');
    listEl.classList.add('open');
  }
  inputEl.addEventListener('focus', render);
  inputEl.addEventListener('input', render);
  listEl.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'DIV'){
      inputEl.value = e.target.textContent;
      listEl.classList.remove('open');
      inputEl.dispatchEvent(new Event('change'));
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target !== inputEl) listEl.classList.remove('open');
  });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ------------------------------- Modal ------------------------------------ */
function openModal(html, wide=false){
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modal');
  modal.className = 'modal' + (wide ? ' wide' : '');
  modal.innerHTML = html;
  overlay.classList.add('open');
}
function closeModal(){
  document.getElementById('modalOverlay').classList.remove('open');
  document.getElementById('modal').innerHTML = '';
}
document.getElementById('modalOverlay').addEventListener('mousedown', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});

/* -------------------------------- Nav -------------------------------------- */
function bindNav(){
  document.querySelectorAll('.nav-btn[data-view], .mnav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view));
  });
}
function navigate(view){
  currentView = view;
  document.querySelectorAll('.nav-btn[data-view], .mnav-btn[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const renderers = { report: renderReport, income: () => renderLedger('Income'),
    expense: () => renderLedger('Expense'), transfer: () => renderLedger('Transfer'), loan: renderLoan };
  (renderers[view] || renderReport)();
}

/* ---------------------------- Export / Import / Clear ------------------------------ */
const EXPORT_HEADERS = ['Date','Transaction Type','From Account','To Account','Code','Amount','Category','SubCategory','Remarks'];

function bindGlobalUI(){
  document.getElementById('btnExport').addEventListener('click', exportExcel);
  document.getElementById('fileImport').addEventListener('change', importExcel);
  document.getElementById('btnClear').addEventListener('click', openClearTransactionsForm);

  const mExport = document.getElementById('btnExportMobile');
  const mImport = document.getElementById('fileImportMobile');
  const mClear = document.getElementById('btnClearMobile');
  if (mExport) mExport.addEventListener('click', exportExcel);
  if (mImport) mImport.addEventListener('change', importExcel);
  if (mClear) mClear.addEventListener('click', openClearTransactionsForm);
}

function exportExcel(){
  const rows = [EXPORT_HEADERS];
  allTx.slice().sort((a,b) => (a.date||'').localeCompare(b.date||'')).forEach(t => {
    rows.push([t.date||'', t.transactionType||'', t.fromAccount||'', t.toAccount||'',
      t.code||'', Number(t.amount)||0, t.category||'', t.subCategory||'', t.remarks||'']);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
  XLSX.writeFile(wb, `MoneyTracker_${todayStr()}.xlsx`);
}

async function importExcel(e){
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Importing will clear ALL existing data and replace it with this file. Continue?')){
    e.target.value = '';
    return;
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type:'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:true });
  const [header, ...body] = rows;
  const records = body.filter(r => r && r.length && r[0]).map(r => ({
    date: normalizeDate(r[0]),
    transactionType: r[1] || '',
    fromAccount: r[2] || '',
    toAccount: r[3] || '',
    code: r[4] || '',
    amount: parseMoney(r[5]),
    category: r[6] || '',
    subCategory: r[7] || '',
    remarks: r[8] || ''
  }));
  await dbClearAll();
  await dbAddMany(records);
  await reload();
  e.target.value = '';
  toast(`Imported ${records.length} transactions`);

  // Reopen loan modal if previously open
  const overlay = document.getElementById('modalOverlay');
  const modalTitleEl = overlay.querySelector('.modal-title');
  if (overlay.classList.contains('open') && modalTitleEl && currentView === 'loan') {
    const codeSpan = overlay.querySelector('.view-sub span');
    if (codeSpan) {
      const currentCode = codeSpan.textContent.trim();
      closeModal();
      setTimeout(() => {
        openLoanDetail(currentCode);
        renderLoan();
      }, 200);
    } else {
      navigate(currentView);
    }
  } else {
    navigate(currentView);
  }
}
function normalizeDate(v){
  if (v instanceof Date) return localISO(v);
  if (typeof v === 'number'){
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  return String(v || '').slice(0,10);
}

function openClearTransactionsForm(){
  const types = [
    { value:'Income', label:'Income' },
    { value:'Expense', label:'Expense' },
    { value:'Transfer', label:'Transfer' },
    { value:'Loan', label:'Loan (release + payments)' }
  ];
  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">Clear Transaction</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <div class="hint" style="margin-bottom:14px">Check the transaction types to permanently delete. This cannot be undone.</div>
    <form id="clearForm">
      <div class="field" style="display:flex;flex-direction:column;gap:10px">
        ${types.map(t => `
          <label style="display:flex;align-items:center;gap:9px;font-size:14px;font-weight:500">
            <input type="checkbox" value="${t.value}" style="width:16px;height:16px">
            ${t.label}
          </label>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="mCancel">Cancel</button>
        <button type="submit" class="btn btn-danger">Clear Selected</button>
      </div>
    </form>
  `);
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  document.getElementById('clearForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const checked = Array.from(e.target.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
    if (!checked.length){ toast('Select at least one type'); return; }
    if (!confirm(`Permanently delete all selected transactions (${checked.join(', ')})? This cannot be undone.`)) return;
    const typeSet = new Set();
    checked.forEach(c => { if (c === 'Loan'){ typeSet.add('Loan Release'); typeSet.add('Loan Payment'); } else typeSet.add(c); });
    const ids = allTx.filter(t => typeSet.has(t.transactionType)).map(t => t.id);
    await dbDeleteIds(ids);
    await reload();
    closeModal();
    toast('Transactions cleared');
    navigate(currentView);
  });
}

/* =============================================================================
   Suggestion pools
   ============================================================================= */
const LEDGER_TYPES = ['Income','Expense','Transfer'];
function ledgerTx(){ return allTx.filter(t => LEDGER_TYPES.includes(t.transactionType)); }
function suggestAccounts(){
  const rows = ledgerTx();
  return uniq([...rows.map(t=>t.fromAccount), ...rows.map(t=>t.toAccount)]);
}
function suggestCategoriesForType(type){ return uniq(allTx.filter(t=>t.transactionType===type).map(t=>t.category)); }
function suggestSubCategoriesForType(type){ return uniq(allTx.filter(t=>t.transactionType===type).map(t=>t.subCategory)); }

/* =============================================================================
   Report view
   ============================================================================= */
const reportFilter = { startDate: '', endDate: '' };

function accountStats(startDate, endDate){
  const stats = {};
  function bump(name, field, amt){
    if (!name) return;
    if (!stats[name]) stats[name] = { income:0, expense:0, transferIn:0, transferOut:0 };
    stats[name][field] += amt;
  }
  const filteredTx = ledgerTx().filter(t => {
    if (!t.date) return true;
    if (startDate && t.date < startDate) return false;
    if (endDate && t.date > endDate) return false;
    return true;
  });
  filteredTx.forEach(t => {
    const amt = Number(t.amount||0);
    if (t.transactionType === 'Income') bump(t.toAccount, 'income', amt);
    else if (t.transactionType === 'Expense') bump(t.fromAccount, 'expense', amt);
    else if (t.transactionType === 'Transfer'){
      bump(t.toAccount, 'transferIn', amt);
      bump(t.fromAccount, 'transferOut', amt);
    }
  });
  const out = {};
  Object.entries(stats).forEach(([name, s]) => {
    out[name] = { ...s, balance: s.income - s.expense + s.transferIn - s.transferOut };
  });
  return out;
}

function sumStats(list){
  return list.reduce((acc, s) => ({
    income: acc.income + s.income, expense: acc.expense + s.expense,
    transferIn: acc.transferIn + s.transferIn, transferOut: acc.transferOut + s.transferOut,
    balance: acc.balance + s.balance
  }), { income:0, expense:0, transferIn:0, transferOut:0, balance:0 });
}

function statsRowHtml(name, s, indent=false, mobileOrder=false){
  const nameCell = `<td${indent ? ' style="padding-left:30px;color:var(--text-dim)"' : ''} data-account="${escapeHtml(name)}">${escapeHtml(name)}</td>`;
  if (!mobileOrder){
    return `
      <tr class="no-hover" data-account-row="${escapeHtml(name)}">
        ${nameCell}
        <td class="num">${fmtMoney(s.income)}</td>
        <td class="num">${fmtMoney(s.expense)}</td>
        <td class="num">${fmtMoney(s.transferIn - s.transferOut)}</td>
        <td class="num"><b>${fmtMoney(s.balance)}</b></td>
      </tr>`;
  } else {
    return `
      <tr class="no-hover" data-account-row="${escapeHtml(name)}">
        ${nameCell}
        <td class="num"><b>${fmtMoney(s.balance)}</b></td>
        <td class="num">${fmtMoney(s.income)}</td>
        <td class="num">${fmtMoney(s.expense)}</td>
        <td class="num">${fmtMoney(s.transferIn - s.transferOut)}</td>
      </tr>`;
  }
}
function groupTotalRowHtml(g, total, isOpen, mobileOrder=false){
  const left = `<td><span style="display:inline-block;width:12px">${isOpen?'▾':'▸'}</span><b>${escapeHtml(g.name)}</b> <span class="hint" style="display:inline">(${g.accounts.length})</span> <button class="icon-btn" data-edit-group="${g.id}" title="Edit group" style="font-size:12px">✎</button></td>`;
  if (!mobileOrder){
    return `
      <tr class="no-hover" data-group-toggle="${g.id}" style="cursor:pointer;background:#F8F7F1">
        ${left}
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num"><b>${fmtMoney(total.balance)}</b></td>
      </tr>`;
  } else {
    return `
      <tr class="no-hover" data-group-toggle="${g.id}" style="cursor:pointer;background:#F8F7F1">
        ${left}
        <td class="num"><b>${fmtMoney(total.balance)}</b></td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td class="num">—</td>
      </tr>`;
  }
}
function walletBalance(stats){
  const names = walletAccounts === null ? Object.keys(stats) : walletAccounts.filter(n => stats[n]);
  return names.reduce((s,n) => s + (stats[n] ? stats[n].balance : 0), 0);
}

let expandedGroups = new Set();

function renderReport(){
  const main = document.getElementById('main');
  const isMobile = window.innerWidth <= 860;
  const startDefault = reportFilter.startDate || earliestDateRecorded();
  const endDefault = reportFilter.endDate || todayStr();
  const stats = accountStats(reportFilter.startDate || startDefault, reportFilter.endDate || endDefault);
  const allAccountNames = Object.keys(stats);
  const grouped = new Set();
  allGroups.forEach(g => g.accounts.forEach(a => grouped.add(a)));
  const ungrouped = allAccountNames.filter(a => !grouped.has(a)).sort((a,b)=>a.localeCompare(b));

  let groupRows = allGroups.map(g => {
    const memberStats = g.accounts.map(a => stats[a] || { income:0,expense:0,transferIn:0,transferOut:0,balance:0 });
    const total = sumStats(memberStats);
    const isOpen = expandedGroups.has(g.id);
    return `
      ${groupTotalRowHtml(g, total, isOpen, isMobile)}
      ${isOpen ? g.accounts.map(a => statsRowHtml(a, stats[a] || {income:0,expense:0,transferIn:0,transferOut:0,balance:0}, true, isMobile)).join('') : ''}
    `;
  }).join('');

  let ungroupedRows = ungrouped.map(name => statsRowHtml(name, stats[name], false, isMobile)).join('');
  const wallet = walletBalance(stats);

  const dateFilterHtml = `
    <div class="filter-row" style="margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        From:
        <input type="date" id="reportStartDate" value="${reportFilter.startDate || startDefault}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        To:
        <input type="date" id="reportEndDate" value="${reportFilter.endDate || endDefault}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <button class="btn btn-small" id="btnApplyDateFilter">Apply</button>
      ${((reportFilter.startDate || '') || (reportFilter.endDate || '')) ? `<button class="btn btn-ghost btn-small" id="btnClearDateFilter">Clear</button>` : ''}
    </div>
  `;

  const theadHtml = isMobile
    ? '<thead><tr><th>Account</th><th class="num">Balance</th><th class="num">Income</th><th class="num">Expense</th><th class="num">Transfer</th></tr></thead>'
    : '<thead><tr><th>Account</th><th class="num">Income</th><th class="num">Expense</th><th class="num">Transfer</th><th class="num">Balance</th></tr></thead>';

  main.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Report</h1><div class="view-sub">Per-account view — Income, Expense, Transfer &amp; Balance</div></div>
      <button class="btn btn-primary" id="btnNewGroup">+ New Group</button>
    </div>
    <div class="summary-row">
      <div class="stat-card" id="walletCard" style="cursor:pointer">
        <div class="label">Balance Wallet</div>
        <div class="value">${fmtMoney(wallet)}</div>
        <div class="hint" style="margin-top:4px">Tap to choose which accounts count</div>
      </div>
    </div>
    ${dateFilterHtml}
    <div class="table-wrap">
      <table>
        ${theadHtml}
        <tbody>
          ${groupRows}
          ${ungroupedRows || (!allGroups.length ? `<tr class="empty-row"><td colspan="5">No Income, Expense, or Transfer transactions${(reportFilter.startDate||reportFilter.endDate)?' in this date range':''} yet.</td></tr>` : '')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btnNewGroup').addEventListener('click', () => openGroupForm(null));
  document.getElementById('walletCard').addEventListener('click', () => openWalletForm(stats));
  document.getElementById('btnApplyDateFilter').addEventListener('click', () => {
    reportFilter.startDate = document.getElementById('reportStartDate').value;
    reportFilter.endDate = document.getElementById('reportEndDate').value;
    renderReport();
  });
  const clearBtn = document.getElementById('btnClearDateFilter');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      reportFilter.startDate = '';
      reportFilter.endDate = '';
      renderReport();
    });
  }
  main.querySelectorAll('[data-group-toggle]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-group]')) return;
      const id = Number(tr.dataset.groupToggle);
      if (expandedGroups.has(id)) expandedGroups.delete(id); else expandedGroups.add(id);
      renderReport();
    });
  });
  main.querySelectorAll('[data-edit-group]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openGroupForm(Number(b.dataset.editGroup));
  }));
  main.querySelectorAll('[data-account-row]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-group]')) return;
      const acctCell = tr.querySelector('[data-account]');
      if (!acctCell) return;
      const account = acctCell.getAttribute('data-account');
      openAccountModal(account);
    });
  });
}

function openAccountModal(account){
  const acctTx = ledgerTx().filter(t => (t.fromAccount === account) || (t.toAccount === account));
  const start = acctTx.map(t => t.date).filter(Boolean).sort()[0] || earliestDateRecorded();
  const end = todayStr();
  const rowsHtml = acctTx.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(t => `
    <tr>
      <td>${fmtDate(t.date)}</td>
      <td>${escapeHtml(t.transactionType)}</td>
      <td>${escapeHtml(t.fromAccount || '—')}</td>
      <td>${escapeHtml(t.toAccount || '—')}</td>
      <td class="num">${fmtMoney(t.amount)}</td>
      <td>${escapeHtml(t.category || '')}${t.subCategory? (' / ' + escapeHtml(t.subCategory)) : ''}</td>
      <td>${escapeHtml(t.remarks || '')}</td>
    </tr>
  `).join('') || `<tr class="empty-row"><td colspan="7">No transactions for ${escapeHtml(account)} yet.</td></tr>`;

  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">${escapeHtml(account)}</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <div class="hint" style="margin-bottom:10px">Filter transactions for this account.</div>
    <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim)">From:<input type="date" id="acctStart" value="${start}" style="margin-left:6px"></label>
      <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim)">To:<input type="date" id="acctEnd" value="${end}" style="margin-left:6px"></label>
      <button class="btn btn-small" id="acctApply">Apply</button>
    </div>
    <div class="table-wrap" style="max-height:360px;overflow:auto">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th class="num">Amount</th><th>Category</th><th>Remarks</th></tr></thead>
        <tbody id="acctBody">${rowsHtml}</tbody>
      </table>
    </div>
    <div class="modal-actions" style="margin-top:12px">
      <button class="btn" id="mClose2">Close</button>
    </div>
  `, true);

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mClose2').addEventListener('click', closeModal);

  function refreshAccountTable(){
    const s = document.getElementById('acctStart').value;
    const e = document.getElementById('acctEnd').value;
    const filtered = ledgerTx().filter(t => ((t.fromAccount === account) || (t.toAccount === account)) &&
      (!s || !t.date || t.date >= s) && (!e || !t.date || t.date <= e));
    const html = filtered.slice().sort((a,b) => (b.date||'').localeCompare(a.date||'')).map(t => `
      <tr>
        <td>${fmtDate(t.date)}</td>
        <td>${escapeHtml(t.transactionType)}</td>
        <td>${escapeHtml(t.fromAccount || '—')}</td>
        <td>${escapeHtml(t.toAccount || '—')}</td>
        <td class="num">${fmtMoney(t.amount)}</td>
        <td>${escapeHtml(t.category || '')}${t.subCategory? (' / ' + escapeHtml(t.subCategory)) : ''}</td>
        <td>${escapeHtml(t.remarks || '')}</td>
      </tr>
    `).join('') || `<tr class="empty-row"><td colspan="7">No transactions in this range.</td></tr>`;
    document.getElementById('acctBody').innerHTML = html;
  }

  document.getElementById('acctApply').addEventListener('click', refreshAccountTable);
}

/* =============================================================================
   Group & Wallet modals
   ============================================================================= */
function openWalletForm(stats){
  const names = Object.keys(stats).sort((a,b)=>a.localeCompare(b));
  const selected = walletAccounts === null ? new Set(names) : new Set(walletAccounts);
  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">Balance Wallet Accounts</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <div class="hint" style="margin-bottom:10px">Only checked accounts are included in the Balance Wallet total.</div>
    <form id="walletForm">
      <div class="field">
        <div style="max-height:280px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px 12px">
          ${names.length ? names.map(a => `
            <label style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;font-size:13.5px">
              <span style="display:flex;align-items:center;gap:8px"><input type="checkbox" value="${escapeHtml(a)}" ${selected.has(a)?'checked':''}>${escapeHtml(a)}</span>
              <span class="hint">${fmtMoney(stats[a].balance)}</span>
            </label>
          `).join('') : '<div class="hint">No accounts yet.</div>'}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" id="btnSelectAll">Select All</button>
        <button type="button" class="btn" id="mCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  document.getElementById('btnSelectAll').addEventListener('click', () => {
    document.querySelectorAll('#walletForm input[type="checkbox"]').forEach(c => c.checked = true);
  });
  document.getElementById('walletForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const checked = Array.from(e.target.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
    walletAccounts = checked;
    await dbSetSetting('walletAccounts', checked);
    closeModal();
    toast('Balance Wallet updated');
    renderReport();
  });
}

function openGroupForm(groupId){
  const editing = allGroups.find(g => g.id === groupId) || null;
  const stats = accountStats(reportFilter.startDate || reportFilter.startDate || earliestDateRecorded(), reportFilter.endDate || todayStr());
  const accounts = Object.keys(stats).sort((a,b)=>a.localeCompare(b));
  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">${editing ? 'Edit Group' : 'New Group'}</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <form id="groupForm">
      <div class="field"><label>Group Name</label>
        <input type="text" name="name" value="${editing ? escapeHtml(editing.name) : ''}" required>
      </div>
      <div class="field">
        <label>Accounts in this group</label>
        <div style="max-height:220px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px 12px">
          ${accounts.length ? accounts.map(a => `
            <label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13.5px">
              <input type="checkbox" value="${escapeHtml(a)}" ${editing && editing.accounts.includes(a) ? 'checked' : ''}>
              ${escapeHtml(a)}
            </label>
          `).join('') : '<div class="hint">No accounts yet — add an Income, Expense, or Transfer first.</div>'}
        </div>
      </div>
      <div class="modal-actions">
        ${editing ? '<button type="button" class="btn btn-danger" id="btnDeleteGroup" style="margin-right:auto">Delete Group</button>' : ''}
        <button type="button" class="btn" id="mCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Group</button>
      </div>
    </form>
  `);
  const form = document.getElementById('groupForm');
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  const delBtn = document.getElementById('btnDeleteGroup');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm(`Delete group "${editing.name}"? Accounts themselves are not affected.`)) return;
    await dbDeleteGroup(editing.id);
    await reloadGroups();
    closeModal();
    toast('Group deleted');
    renderReport();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const selected = Array.from(form.querySelectorAll('input[type="checkbox"]:checked')).map(c => c.value);
    const record = { name: form.name.value.trim(), accounts: selected };
    if (editing) record.id = editing.id;
    await dbSaveGroup(record);
    await reloadGroups();
    closeModal();
    toast('Group saved');
    renderReport();
  });
}

/* =============================================================================
   LEDGER (Income / Expense / Transfer)
   ============================================================================= */
const LEDGER_CFG = {
  Income:   { icon:'＋', cls:'income',   fields:['account','category','subCategory'] },
  Expense:  { icon:'－', cls:'expense',  fields:['account','category','subCategory'] },
  Transfer: { icon:'⇄', cls:'transfer', fields:['fromAccount','toAccount'] }
};
const ledgerFilters = {
  Income:  { account:'', category:'', startDate:'', endDate:'' },
  Expense: { account:'', category:'', startDate:'', endDate:'' },
  Transfer: { startDate:'', endDate:'' }
};

function renderLedger(type){
  const cfg = LEDGER_CFG[type];
  const isTransfer = type === 'Transfer';
  const allRows = allTx.filter(t => t.transactionType === type);
  const filter = ledgerFilters[type];
  const startDefault = filter.startDate || earliestDateRecorded();
  const endDefault = filter.endDate || todayStr();

  let rows = allRows;
  if (filter.startDate || filter.endDate){
    rows = rows.filter(t => {
      if (!t.date) return true;
      if (filter.startDate && t.date < filter.startDate) return false;
      if (filter.endDate && t.date > filter.endDate) return false;
      return true;
    });
  }
  if (!isTransfer && filter){
    if (filter.account) rows = rows.filter(t => (type==='Income'?t.toAccount:t.fromAccount) === filter.account);
    if (filter.category) rows = rows.filter(t => t.category === filter.category);
  }
  rows = rows.slice().sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const main = document.getElementById('main');

  let filterHtml = '';
  if (!isTransfer){
    const accountOpts = uniq(allRows.map(t => type==='Income'?t.toAccount:t.fromAccount)).sort((a,b)=>a.localeCompare(b));
    const catOpts = uniq(allRows.map(t => t.category)).sort((a,b)=>a.localeCompare(b));
    filterHtml = `
      <div class="filter-row">
        <select id="filterAccount">
          <option value="">All Accounts</option>
          ${accountOpts.map(a => `<option value="${escapeHtml(a)}" ${filter.account===a?'selected':''}>${escapeHtml(a)}</option>`).join('')}
        </select>
        <select id="filterCategory">
          <option value="">All Categories</option>
          ${catOpts.map(c => `<option value="${escapeHtml(c)}" ${filter.category===c?'selected':''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim)">
          From: <input type="date" id="ledgerStart" value="${filter.startDate || startDefault}" style="margin-left:6px">
        </label>
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim)">
          To: <input type="date" id="ledgerEnd" value="${filter.endDate || endDefault}" style="margin-left:6px">
        </label>
        <button class="btn btn-small" id="btnApplyLedgerDate">Apply</button>
        ${(filter.account||filter.category) ? `<button type="button" class="btn btn-ghost btn-small" id="btnClearFilter">Clear filter</button>` : ''}
      </div>
    `;
  } else {
    filterHtml = `
      <div class="filter-row">
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim)">
          From: <input type="date" id="ledgerStart" value="${filter.startDate || startDefault}" style="margin-left:6px">
        </label>
        <label style="display:flex;align-items:center;gap:6px;color:var(--text-dim)">
          To: <input type="date" id="ledgerEnd" value="${filter.endDate || endDefault}" style="margin-left:6px">
        </label>
        <button class="btn btn-small" id="btnApplyLedgerDate">Apply</button>
      </div>
    `;
  }

  main.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">${type}</h1><div class="view-sub">${rows.length} transaction${rows.length===1?'':'s'}</div></div>
      <button class="btn btn-primary ${cfg.cls}" id="btnAdd">+ Add ${type}</button>
    </div>
    ${filterHtml}
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date</th>
          ${isTransfer ? '<th>From Account</th><th>To Account</th>' : '<th>Account</th><th>Category</th><th>SubCategory</th>'}
          <th class="num">Amount</th><th>Remarks</th><th></th>
        </tr></thead>
        <tbody id="ledgerBody">
          ${rows.length ? rows.map(t => `
            <tr data-id="${t.id}">
              <td>${fmtDate(t.date)}</td>
              ${isTransfer
                ? `<td>${escapeHtml(t.fromAccount||'—')}</td><td>${escapeHtml(t.toAccount||'—')}</td>`
                : `<td>${escapeHtml((type==='Income' ? t.toAccount : t.fromAccount) || '—')}</td><td>${escapeHtml(t.category||'—')}</td><td>${escapeHtml(t.subCategory||'—')}</td>`}
              <td class="num">${fmtMoney(t.amount)}</td>
              <td>${escapeHtml(t.remarks||'')}</td>
              <td class="row-actions"><button class="icon-btn" data-del="${t.id}" title="Delete">✕</button></td>
            </tr>
          `).join('') : `<tr class="empty-row"><td colspan="${isTransfer?6:7}">No ${type.toLowerCase()} transactions${(filter&&(filter.account||filter.category))?' match this filter':' yet'}.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('btnAdd').addEventListener('click', () => openLedgerForm(type));
  document.getElementById('btnApplyLedgerDate').addEventListener('click', () => {
    ledgerFilters[type].startDate = document.getElementById('ledgerStart').value;
    ledgerFilters[type].endDate = document.getElementById('ledgerEnd').value;
    renderLedger(type);
  });

  if (!isTransfer){
    document.getElementById('filterAccount').addEventListener('change', (e) => { filter.account = e.target.value; renderLedger(type); });
    document.getElementById('filterCategory').addEventListener('change', (e) => { filter.category = e.target.value; renderLedger(type); });
    const clearBtn = document.getElementById('btnClearFilter');
    if (clearBtn) clearBtn.addEventListener('click', () => { filter.account=''; filter.category=''; renderLedger(type); });
  }
  main.querySelectorAll('#ledgerBody tr[data-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      const rec = allTx.find(t => t.id === Number(tr.dataset.id));
      if (rec) openLedgerForm(type, rec);
    });
  });
  main.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this transaction?')) return;
    await dbDeleteIds([Number(b.dataset.del)]);
    await reload();
    renderLedger(type);
  }));
}

/* SubCategory suggestions filtered by Category */
function openLedgerForm(type, editing=null){
  const cfg = LEDGER_CFG[type];
  const accountSuggestions = suggestAccounts();
  const catSuggestions = suggestCategoriesForType(type);
  const subSuggestions = suggestSubCategoriesForType(type);
  const isTransfer = type === 'Transfer';

  const dateVal = editing ? editing.date : todayStr();
  const amountVal = editing ? fmtMoney(editing.amount) : '';
  const remarksVal = editing ? (editing.remarks || '') : '';

  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">${editing ? 'Edit' : 'Add'} ${type}</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <form id="ledgerForm">
      <div class="field"><label>Date</label><input type="date" name="date" value="${dateVal}" required></div>
      ${isTransfer ? `
        <div class="field-row">
          <div class="field">
            <label>From Account</label>
            <input type="text" name="fromAccount" autocomplete="off" value="${editing?escapeHtml(editing.fromAccount||''):''}" required>
            <div class="autocomplete-list" id="acFrom"></div>
          </div>
          <div class="field">
            <label>To Account</label>
            <input type="text" name="toAccount" autocomplete="off" value="${editing?escapeHtml(editing.toAccount||''):''}" required>
            <div class="autocomplete-list" id="acTo"></div>
          </div>
        </div>
        <div class="field"><label>Amount</label><input type="text" name="amount" placeholder="0.00" value="${amountVal}" required></div>
      ` : `
        <div class="field-row">
          <div class="field">
            <label>Account</label>
            <input type="text" name="account" autocomplete="off" value="${editing?escapeHtml((type==='Income'?editing.toAccount:editing.fromAccount)||''):''}" required>
            <div class="autocomplete-list" id="acAccount"></div>
          </div>
          <div class="field"><label>Amount</label><input type="text" name="amount" placeholder="0.00" value="${amountVal}" required></div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Category</label>
            <input type="text" name="category" autocomplete="off" value="${editing?escapeHtml(editing.category||''):''}">
            <div class="autocomplete-list" id="acCat"></div>
          </div>
          <div class="field">
            <label>SubCategory</label>
            <input type="text" name="subCategory" autocomplete="off" value="${editing?escapeHtml(editing.subCategory||''):''}">
            <div class="autocomplete-list" id="acSub"></div>
          </div>
        </div>
      `}
      <div class="field"><label>Remarks</label><textarea name="remarks">${escapeHtml(remarksVal)}</textarea></div>
      <div class="modal-actions">
        ${editing ? `<button type="button" class="btn btn-danger" id="btnDeleteTx" style="margin-right:auto">Delete</button>` : ''}
        <button type="button" class="btn" id="mCancel">Cancel</button>
        <button type="submit" class="btn btn-primary ${cfg.cls}">Save ${type}</button>
      </div>
    </form>
  `);
  const form = document.getElementById('ledgerForm');
  wireMoneyInput(form.amount);
  if (editing) form.amount.dataset.raw = editing.amount;
  if (isTransfer){
    attachAutocomplete(form.fromAccount, document.getElementById('acFrom'), () => accountSuggestions);
    attachAutocomplete(form.toAccount, document.getElementById('acTo'), () => accountSuggestions);
  } else {
    attachAutocomplete(form.account, document.getElementById('acAccount'), () => accountSuggestions);
    attachAutocomplete(form.category, document.getElementById('acCat'), () => catSuggestions);
    const getSubSuggestions = () => {
      const cat = form.category.value.trim();
      if (!cat) return subSuggestions;
      return uniq(allTx.filter(t=>t.transactionType===type && t.category===cat).map(t=>t.subCategory));
    };
    attachAutocomplete(form.subCategory, document.getElementById('acSub'), getSubSuggestions);
  }
  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  const delBtn = document.getElementById('btnDeleteTx');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('Delete this transaction?')) return;
    await dbDeleteIds([editing.id]);
    await reload();
    closeModal();
    toast(`${type} deleted`);
    renderLedger(type);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let rec;
    if (isTransfer){
      rec = {
        date: form.date.value, transactionType:'Transfer',
        fromAccount: form.fromAccount.value.trim(), toAccount: form.toAccount.value.trim(),
        code:'', amount: moneyVal(form.amount), category:'', subCategory:'', remarks: form.remarks.value.trim()
      };
    } else {
      rec = {
        date: form.date.value, transactionType: type,
        fromAccount: type === 'Expense' ? form.account.value.trim() : '',
        toAccount: type === 'Income' ? form.account.value.trim() : '',
        code:'', amount: moneyVal(form.amount),
        category: form.category.value.trim(), subCategory: form.subCategory.value.trim(),
        remarks: form.remarks.value.trim()
      };
    }
    if (editing){
      rec.id = editing.id;
      rec.code = editing.code || '';
      await dbPut(rec);
    } else {
      await dbAddMany([rec]);
    }
    await reload();
    closeModal();
    toast(`${type} saved`);
    renderLedger(type);
  });
}

/* =============================================================================
   LOAN helpers + view updates (Next Payment calculation included)
   ============================================================================= */
function loanGroups(){
  const releases = allTx.filter(t => t.transactionType === 'Loan Release');
  const codes = uniq(releases.map(t => t.code));
  return codes.map(code => {
    const lines = releases.filter(t => t.code === code);
    const net = lines.find(l => l.category === 'Net Amount');
    const fees = lines.find(l => l.category === 'Fees');
    const interest = lines.find(l => l.category === 'Interest');
    const principal = (Number(net?.amount)||0) + (Number(fees?.amount)||0);
    return {
      code,
      date: net?.date || lines[0]?.date || '',
      debtor: net?.toAccount || lines[0]?.toAccount || '',
      account: net?.fromAccount || lines[0]?.fromAccount || '',
      principal,
      fees: Number(fees?.amount)||0,
      interest: Number(interest?.amount)||0,
      remarksRaw: net?.remarks || ''
    };
  }).sort((a,b) => (b.date||'').localeCompare(a.date||''));
}
function loanPaid(code){
  return allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === code)
    .reduce((s,t) => s + Number(t.amount||0), 0);
}
function loanPaidCount(code){
  return allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === code && t.category === 'Payment').length;
}
function loanBalance(code){
  const g = loanGroups().find(x => x.code === code);
  if (!g) return 0;
  return (g.principal + g.interest) - loanPaid(code);
}
function parseLoanRemarks(raw){
  const parts = String(raw||'').split('|');
  const maybeStart = parts[5] || '';
  const hasStart = /^\d{4}-\d{2}-\d{2}$/.test(maybeStart);
  return {
    interestRate: parts[0] || '',
    repaymentAmount: parseMoney(parts[1]),
    frequency: parts[2] || 'Monthly',
    count: parseInt(parts[3]) || 0,
    dateSpec: parts[4] || '',
    startPaymentDate: hasStart ? maybeStart : '',
    userRemarks: (hasStart ? parts.slice(6) : parts.slice(5)).join('|') || ''
  };
}
function repaymentDateLabel(info){
  if (info.frequency === 'Flexible') return 'Flexible';
  if (info.frequency === 'Semi-Monthly'){
    const days = info.dateSpec.split(',').filter(Boolean);
    return days.length ? `${days.join(' & ')} of month` : '—';
  }
  return info.dateSpec ? `${info.dateSpec} of month` : '—';
}

/* Build schedule utilities */
function addMonths(dateStr, n){
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + n);
  return d;
}
function setDay(date, day){
  const d = new Date(date);
  const maxDay = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day, maxDay));
  return d;
}
function iso(d){ return localISO(d); }

function buildSchedule(g, info){
  const schedule = [];
  if (info.frequency === 'Flexible'){
    for (let i=1;i<=info.count;i++) schedule.push({ seq:i, date:'', flexible:true });
    return schedule;
  }
  const anchorStr = info.startPaymentDate || g.date;
  const anchor = new Date(anchorStr + 'T00:00:00');
  if (info.frequency === 'Monthly'){
    const day = parseInt(info.dateSpec) || 1;
    let offset = 0;
    let d = setDay(anchor, day);
    if (d < anchor){ offset = 1; d = setDay(addMonths(anchorStr, 1), day); }
    for (let i=1;i<=info.count;i++){
      schedule.push({ seq:i, date: iso(d) });
      offset++;
      d = setDay(addMonths(anchorStr, offset), day);
    }
    return schedule;
  }
  if (info.frequency === 'Semi-Monthly'){
    const days = info.dateSpec.split(',').map(n => parseInt(n)).filter(Boolean).sort((a,b)=>a-b);
    if (days.length < 2) days.push(days[0]+15 || 30);
    let cursorMonth = 0;
    const candidates = [];
    while (candidates.length < info.count + days.length){
      for (const day of days){
        const d = setDay(addMonths(anchorStr, cursorMonth), day);
        if (d >= anchor) candidates.push(d);
      }
      cursorMonth++;
    }
    candidates.sort((a,b) => a-b);
    candidates.slice(0, info.count).forEach((d,i) => schedule.push({ seq:i+1, date: iso(d) }));
    return schedule;
  }
  return schedule;
}

/* Find next unpaid scheduled date */
function getNextPaymentDateForCode(code){
  const g = loanGroups().find(x => x.code === code);
  if (!g) return '';
  const info = parseLoanRemarks(g.remarksRaw);
  const schedule = buildSchedule(g, info);
  const payments = allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === code && t.category === 'Payment');
  for (const row of schedule){
    if (!row.date) continue;
    const paidOnDate = payments.some(p => p.date === row.date);
    if (!paidOnDate) return row.date;
  }
  return '';
}

const loanFilter = { debtor:'', account:'', balance:'all' };

/* Persisted custom loan ordering */
async function moveLoanCode(draggedCode, targetCode) {
  const groups = loanGroups();
  const allCodes = groups.map(g => g.code);
  const order = Array.isArray(loanOrder) && loanOrder.length ? loanOrder.slice() : allCodes.slice();
  allCodes.forEach(c => { if (!order.includes(c)) order.push(c); });
  const from = order.indexOf(draggedCode);
  let to = order.indexOf(targetCode);
  if (from === -1 || to === -1 || from === to) return;
  order.splice(from, 1);
  if (from < to) to--;
  order.splice(to, 0, draggedCode);
  await dbSetSetting('loanOrder', order);
  loanOrder = order;
  renderLoan();
}

/* Render Loan view with new column order and Next Payment sort toggle:
   #, Debtor, Next Payment, Repayment Amount, Account, Payment Count, Balance, Amount, Code
*/
function renderLoan(){
  const groupsAll = loanGroups();
  let orderedCodes;
  if (Array.isArray(loanOrder) && loanOrder.length) {
    orderedCodes = loanOrder.filter(c => groupsAll.some(g => g.code === c));
    groupsAll.map(g => g.code).forEach(c => { if (!orderedCodes.includes(c)) orderedCodes.push(c); });
  } else {
    orderedCodes = groupsAll.map(g => g.code);
  }
  const groups = orderedCodes.map(code => groupsAll.find(g => g.code === code)).filter(Boolean);

  const debtorOpts = uniq(groups.map(g=>g.debtor)).sort((a,b)=>a.localeCompare(b));
  const accountOpts = uniq(groups.map(g=>g.account)).sort((a,b)=>a.localeCompare(b));

  let filtered = groups;
  if (loanFilter.debtor) filtered = filtered.filter(g => g.debtor === loanFilter.debtor);
  if (loanFilter.account) filtered = filtered.filter(g => g.account === loanFilter.account);
  if (loanFilter.balance !== 'all'){
    filtered = filtered.filter(g => {
      const bal = loanBalance(g.code);
      return loanFilter.balance === 'zero' ? Math.abs(bal) < 0.005 : bal > 0.005;
    });
  }

  // Compute display order based on loanNextSort state
  let displayGroups = filtered;
  if (loanNextSort === 'asc'){
    const mapped = filtered.map(g => ({ g, next: getNextPaymentDateForCode(g.code) || '9999-12-31' }));
    mapped.sort((a,b) => (a.next < b.next ? -1 : (a.next > b.next ? 1 : 0)));
    displayGroups = mapped.map(x => x.g);
  }

  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Loan</h1><div class="view-sub">${displayGroups.length} of ${groups.length} loan${groups.length===1?'':'s'}</div></div>
      <button class="btn btn-primary loan" id="btnAddLoan">+ Add Loan</button>
    </div>
    <div class="filter-row">
      <select id="filterDebtor">
        <option value="">All Debtors</option>
        ${debtorOpts.map(d => `<option value="${escapeHtml(d)}" ${loanFilter.debtor===d?'selected':''}>${escapeHtml(d)}</option>`).join('')}
      </select>
      <select id="filterLoanAccount">
        <option value="">All Accounts</option>
        ${accountOpts.map(a => `<option value="${escapeHtml(a)}" ${loanFilter.account===a?'selected':''}>${escapeHtml(a)}</option>`).join('')}
      </select>
      <select id="filterBalance">
        <option value="all" ${loanFilter.balance==='all'?'selected':''}>All Balances</option>
        <option value="zero" ${loanFilter.balance==='zero'?'selected':''}>Balance = 0</option>
        <option value="positive" ${loanFilter.balance==='positive'?'selected':''}>Balance &gt; 0</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th></th><th>#</th><th>Debtor</th>
          <th>Next Payment <button id="btnToggleNextSort" class="icon-btn" title="${loanNextSort === 'asc' ? 'Showing oldest first — click to restore original' : 'Sort by next payment (oldest first)'}">${loanNextSort === 'asc' ? '↑' : '⇅'}</button></th>
          <th class="num">Repayment Amount</th><th>Account</th><th>Payment Count</th><th class="num">Balance</th><th class="num">Amount</th><th>Code</th><th></th>
        </tr></thead>
        <tbody id="loanBody">
          ${displayGroups.length ? displayGroups.map((g,i) => {
            const info = parseLoanRemarks(g.remarksRaw);
            const paidCount = loanPaidCount(g.code);
            const nextPaymentDate = getNextPaymentDateForCode(g.code);
            // when sorted, disable draggable attribute in the DOM
            const draggableAttr = loanNextSort === null ? 'draggable="true"' : '';
            return `
            <tr data-code="${escapeHtml(g.code)}" ${draggableAttr}>
              <td style="width:32px;text-align:center"><span class="drag-handle" style="cursor:grab;user-select:none;font-size:16px;padding:4px 6px;display:inline-block">☰</span></td>
              <td>${i+1}</td>
              <td>${escapeHtml(g.debtor)}</td>
              <td>${nextPaymentDate ? fmtDate(nextPaymentDate) : '—'}</td>
              <td class="num">${fmtMoney(info.repaymentAmount)}</td>
              <td>${escapeHtml(g.account)}</td>
              <td>${paidCount} of ${info.count || 0}</td>
              <td class="num">${fmtMoney(loanBalance(g.code))}</td>
              <td class="num">${fmtMoney(g.principal)}</td>
              <td style="font-family:var(--font-mono)">${escapeHtml(g.code)}</td>
              <td class="row-actions">
                <button class="icon-btn" data-edit="${escapeHtml(g.code)}" title="Edit loan">✎</button>
                <button class="icon-btn" data-view-tx="${escapeHtml(g.code)}" title="Transactions">▦</button>
                <button class="icon-btn" data-del="${escapeHtml(g.code)}" title="Delete loan">✕</button>
              </td>
            </tr>
          `}).join('') : `<tr class="empty-row"><td colspan="11">No loans${(loanFilter.debtor||loanFilter.account||loanFilter.balance!=='all')?' match this filter':' yet'}.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btnAddLoan').addEventListener('click', () => openLoanForm());
  document.getElementById('filterDebtor').addEventListener('change', e => { loanFilter.debtor = e.target.value; renderLoan(); });
  document.getElementById('filterLoanAccount').addEventListener('change', e => { loanFilter.account = e.target.value; renderLoan(); });
  document.getElementById('filterBalance').addEventListener('change', e => { loanFilter.balance = e.target.value; renderLoan(); });

  // Toggle Next Payment sorting
  const sortBtn = document.getElementById('btnToggleNextSort');
  sortBtn.addEventListener('click', () => {
    loanNextSort = loanNextSort === 'asc' ? null : 'asc';
    renderLoan();
  });

  main.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const g = loanGroups().find(x => x.code === b.dataset.edit);
    if (g) openLoanForm(g);
  }));
  main.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this loan and ALL its payment history? This cannot be undone.')) return;
    const code = b.dataset.del;
    const ids = allTx.filter(t => t.code === code).map(t => t.id);
    await dbDeleteIds(ids);
    await reload();
    toast('Loan deleted');
    renderLoan();
  }));

  // Transactions button
  main.querySelectorAll('[data-view-tx]').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    openLoanTransactions(b.dataset.viewTx);
  }));

  // If not sorted, enable drag handlers; otherwise disable dragging
  const rows = document.querySelectorAll('#loanBody tr[data-code]');
  if (loanNextSort === null) {
    rows.forEach(tr => {
      const handle = tr.querySelector('.drag-handle');
      if (handle){
        handle.addEventListener('mousedown', (ev) => {
          tr.setAttribute('draggable', 'true');
        });
      }
      tr.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', tr.dataset.code);
        tr.classList.add('dragging');
        const h = tr.querySelector('.drag-handle');
        if (h) h.style.cursor = 'grabbing';
      });
      tr.addEventListener('dragend', () => {
        Array.from(rows).forEach(r => r.classList.remove('dragging','drag-over'));
        const h2 = tr.querySelector('.drag-handle');
        if (h2) h2.style.cursor = 'grab';
        tr.setAttribute('draggable', 'true');
      });
      tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        Array.from(rows).forEach(r => r.classList.remove('drag-over'));
        tr.classList.add('drag-over');
      });
      tr.addEventListener('dragleave', () => {
        tr.classList.remove('drag-over');
      });
      tr.addEventListener('drop', async (e) => {
        e.preventDefault();
        const draggedCode = e.dataTransfer.getData('text/plain');
        const targetCode = tr.dataset.code;
        if (draggedCode && targetCode && draggedCode !== targetCode) {
          await moveLoanCode(draggedCode, targetCode);
        }
      });
    });
  } else {
    // ensure rows are not draggable in the DOM when sorted
    rows.forEach(r => r.removeAttribute('draggable'));
  }

  // Row click opens loan detail
  main.querySelectorAll('#loanBody tr[data-code]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]') || e.target.closest('[data-edit]') || e.target.closest('[data-view-tx]')) return;
      openLoanDetail(tr.dataset.code);
    });
  });
}

/* --- Transactions modal + edit/delete per-line --- */
function openLoanTransactions(code){
  const txs = allTx.filter(t => t.code === code).slice().sort((a,b) => ((a.date||'') + String(a.id)).localeCompare((b.date||'') + String(b.id)));
  const rowsHtml = txs.map(t => `
    <tr data-id="${t.id}">
      <td>${fmtDate(t.date)}</td>
      <td>${escapeHtml(t.transactionType)}</td>
      <td>${escapeHtml(t.fromAccount || '—')}</td>
      <td>${escapeHtml(t.toAccount || '—')}</td>
      <td class="num">${fmtMoney(t.amount)}</td>
      <td>${escapeHtml(t.category || '')}</td>
      <td>${escapeHtml(t.subCategory || '')}</td>
      <td>${escapeHtml(t.remarks || '')}</td>
      <td class="row-actions">
        <button class="icon-btn" data-edit-tx="${t.id}" title="Edit">✎</button>
        <button class="icon-btn" data-delete-tx="${t.id}" title="Delete">✕</button>
      </td>
    </tr>
  `).join('') || `<tr class="empty-row"><td colspan="9">No transactions for ${escapeHtml(code)}.</td></tr>`;

  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">Transactions — ${escapeHtml(code)}</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <div style="max-height:420px;overflow:auto" class="table-wrap"">
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>From</th><th>To</th><th class="num">Amount</th><th>Category</th><th>SubCat</th><th>Remarks</th><th></th></tr></thead>
        <tbody id="loanTxBody">${rowsHtml}</tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button class="btn" id="mClose2">Close</button>
    </div>
  `, true);

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mClose2').addEventListener('click', closeModal);

  // edit handlers (pass callback that receives newCode if changed)
  document.querySelectorAll('[data-edit-tx]').forEach(b => b.addEventListener('click', (e) => {
    const id = Number(b.dataset.editTx);
    const tx = allTx.find(x => x.id === id);
    if (tx) openEditTransaction(tx, async (newCode) => {
      await reload();
      // reopen transactions modal for the updated code (if changed) or the original code
      openLoanTransactions(newCode || code);
      renderLoan();
    });
  }));

  // delete handlers
  document.querySelectorAll('[data-delete-tx]').forEach(b => b.addEventListener('click', async (e) => {
    const id = Number(b.dataset.deleteTx);
    if (!confirm('Delete this transaction? This cannot be undone.')) return;
    await dbDeleteIds([id]);
    await reload();
    toast('Transaction deleted');
    openLoanTransactions(code);
    renderLoan();
  }));
}

/* --- Edit single transaction modal with Regenerate Code for Loan Release --- */
/* onSaved callback receives optional newCode (string) to let callers reopen updated code group */
function openEditTransaction(tx, onSaved){
  const isLoanRelease = tx.transactionType === 'Loan Release';
  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">Edit Transaction</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <form id="editTxForm">
      <div class="field-row">
        <div class="field"><label>Date</label><input type="date" name="date" value="${tx.date || ''}" required></div>
        <div class="field"><label>Type</label><input type="text" readonly value="${escapeHtml(tx.transactionType)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>From Account</label><input type="text" name="fromAccount" value="${escapeHtml(tx.fromAccount || '')}"></div>
        <div class="field"><label>To Account</label><input type="text" name="toAccount" value="${escapeHtml(tx.toAccount || '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Amount</label><input type="text" name="amount" id="editAmount" value="${fmtMoney(tx.amount)}" required></div>
        <div class="field"><label>Code</label><input type="text" name="code" id="editCode" ${isLoanRelease ? '' : 'readonly'} value="${escapeHtml(tx.code || '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Category</label><input type="text" name="category" value="${escapeHtml(tx.category || '')}"></div>
        <div class="field"><label>SubCategory</label><input type="text" name="subCategory" value="${escapeHtml(tx.subCategory || '')}"></div>
      </div>
      <div class="field"><label>Remarks</label><textarea name="remarks">${escapeHtml(tx.remarks || '')}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" id="btnDeleteSingle" style="margin-right:auto">Delete</button>
        ${isLoanRelease ? '<button type="button" class="btn" id="btnRegenerateCode">Regenerate Code</button>' : ''}
        <button type="button" class="btn" id="mCancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `, true);

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);

  const amtEl = document.getElementById('editAmount');
  const codeEl = document.getElementById('editCode');
  wireMoneyInput(amtEl);
  amtEl.dataset.raw = tx.amount;

  // Regenerate code only for Loan Release: FromAccount-ToAccount-Amount (ensure uniqueness)
  if (isLoanRelease){
    document.getElementById('btnRegenerateCode').addEventListener('click', () => {
      const from = document.querySelector('[name="fromAccount"]').value.trim() || '—';
      const to = document.querySelector('[name="toAccount"]').value.trim() || '—';
      const amt = parseMoney(amtEl.value || amtEl.dataset.raw || '0');
      let base = `${from}-${to}-${amt}`;
      const existing = new Set(allTx.map(t => t.code));
      if (!existing.has(base)){
        codeEl.value = base;
        toast('Code regenerated');
        return;
      }
      let suffix = 2;
      let cand = `${base}-${suffix}`;
      while (existing.has(cand)) { suffix++; cand = `${base}-${suffix}`; }
      codeEl.value = cand;
      toast('Code regenerated (unique)');
    });
  }

  document.getElementById('btnDeleteSingle').addEventListener('click', async () => {
    if (!confirm('Delete this transaction?')) return;
    await dbDeleteIds([tx.id]);
    await reload();
    closeModal();
    toast('Transaction deleted');
    if (onSaved) await onSaved(tx.code);
  });

  document.getElementById('editTxForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const updated = {
      id: tx.id,
      date: form.date.value,
      transactionType: tx.transactionType,
      fromAccount: form.fromAccount.value.trim(),
      toAccount: form.toAccount.value.trim(),
      code: form.code.value,
      amount: moneyVal(amtEl),
      category: form.category.value.trim(),
      subCategory: form.subCategory.value.trim(),
      remarks: form.remarks.value.trim()
    };

    // If changing code for a Loan Release and payments exist for old code, warn user
    if (tx.transactionType === 'Loan Release' && updated.code !== (tx.code || '')){
      const paymentsExist = allTx.some(t => t.transactionType === 'Loan Payment' && t.code === (tx.code || ''));
      if (paymentsExist){
        if (!confirm('There are existing Loan Payment lines linked to the current code. Changing the code now will NOT update those payments (they will remain linked to the old code). Continue?')) {
          return;
        }
      }
    }

    await dbPut(updated);
    await reload();
    toast('Transaction updated');
    closeModal();
    // Call onSaved with the updated code (so callers can reopen correct group)
    if (onSaved) await onSaved(updated.code);
    renderLoan();
  });
}

/* =============================================================================
   Loan form, schedule, and detail (kept behavior)
   ============================================================================= */
function openLoanForm(editing=null){
  const releases = allTx.filter(t => t.transactionType === 'Loan Release');
  const debtors = uniq(releases.map(t => t.toAccount));
  const accounts = uniq(releases.map(t => t.fromAccount));
  const info = editing ? parseLoanRemarks(editing.remarksRaw) : null;

  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">${editing ? 'Edit Loan' : 'Add Loan'}</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <form id="loanForm">
      <div class="field-row">
        <div class="field"><label>Date Released</label><input type="date" name="date" value="${editing?editing.date:todayStr()}" required></div>
        <div class="field">
          <label>Code${editing?'':' (auto)'}</label>
          <input type="text" id="codePreview" readonly style="background:#F1EFE6;color:#8A6A2A;font-family:var(--font-mono);" value="${editing?escapeHtml(editing.code):''}">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Debtor</label>
          <input type="text" name="debtor" id="fDebtor" autocomplete="off" value="${editing?escapeHtml(editing.debtor):''}" required>
          <div class="autocomplete-list" id="acDebtor"></div>
        </div>
        <div class="field">
          <label>Account</label>
          <input type="text" name="account" id="fAccount" autocomplete="off" value="${editing?escapeHtml(editing.account):''}" required>
          <div class="autocomplete-list" id="acAccount"></div>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Amount</label><input type="text" name="amount" id="fAmount" placeholder="0.00" value="${editing?fmtMoney(editing.principal):''}" required></div>
        <div class="field"><label>Fees</label><input type="text" name="fees" id="fFees" placeholder="0.00" value="${editing?fmtMoney(editing.fees):''}"></div>
        <div class="field"><label>Interest</label><input type="text" name="interest" id="fInterest" placeholder="0.00" value="${editing?fmtMoney(editing.interest):''}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Monthly Interest Rate (%)</label><input type="text" name="interestRate" placeholder="e.g. 5" value="${editing?escapeHtml(info.interestRate):''}"></div>
        <div class="field"><label>Repayment Amount</label><input type="text" name="repaymentAmount" placeholder="0.00" value="${editing?fmtMoney(info.repaymentAmount):''}" required></div>
      </div>
      <div class="field">
        <label>Repayment Frequency</label>
        <div class="radio-group" id="freqGroup">
          <button type="button" class="radio-chip${(!editing||info.frequency==='Monthly')?' active':''}" data-freq="Monthly">Monthly</button>
          <button type="button" class="radio-chip${(editing&&info.frequency==='Semi-Monthly')?' active':''}" data-freq="Semi-Monthly">Semi-Monthly</button>
          <button type="button" class="radio-chip${(editing&&info.frequency==='Flexible')?' active':''}" data-freq="Flexible">Flexible</button>
        </div>
        <input type="hidden" name="frequency" value="${editing?info.frequency:'Monthly'}">
      </div>
      <div class="field-row">
        <div class="field"><label>Repayment Count</label><input type="number" name="repaymentCount" min="1" value="${editing?info.count:''}" required></div>
        <div class="field"><label>Start Payment Date</label><input type="date" name="startPaymentDate" value="${editing?(info.startPaymentDate||editing.date):todayStr()}"></div>
      </div>
      <div class="field-row">
        <div class="field" id="dateField1"><label>Repayment Date</label>
          <select name="repayDate1">${dateOptions(editing && info.frequency!=='Flexible' ? (parseInt(info.dateSpec.split(',')[0])||1) : 1)}</select>
        </div>
        <div class="field" id="dateField2" style="display:none"><label>2nd Repayment Date</label>
          <select name="repayDate2">${dateOptions(editing && info.frequency==='Semi-Monthly' ? (parseInt(info.dateSpec.split(',')[1])||15) : 15)}</select>
        </div>
      </div>
      <div class="field"><label>Remarks</label><textarea name="remarks">${editing?escapeHtml(info.userRemarks):''}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="mCancel">Cancel</button>
        <button type="submit" class="btn btn-primary loan">Save Loan</button>
      </div>
    </form>
  `, true);

  const form = document.getElementById('loanForm');
  wireMoneyInput(document.getElementById('fAmount'));
  wireMoneyInput(document.getElementById('fFees'));
  wireMoneyInput(document.getElementById('fInterest'));
  wireMoneyInput(form.repaymentAmount);
  if (editing){
    document.getElementById('fAmount').dataset.raw = editing.principal;
    document.getElementById('fFees').dataset.raw = editing.fees;
    document.getElementById('fInterest').dataset.raw = editing.interest;
    form.repaymentAmount.dataset.raw = info.repaymentAmount;
  }

  attachAutocomplete(document.getElementById('fDebtor'), document.getElementById('acDebtor'), () => debtors);
  attachAutocomplete(document.getElementById('fAccount'), document.getElementById('acAccount'), () => accounts);

  function updateCodePreview(){
    if (editing) return;
    const d = document.getElementById('fDebtor').value.trim() || '—';
    const a = document.getElementById('fAccount').value.trim() || '—';
    const amt = document.getElementById('fAmount').dataset.raw || document.getElementById('fAmount').value || '0';
    document.getElementById('codePreview').value = `${a}-${d}-${amt}`;
  }
  ['input','change','blur'].forEach(ev => {
    document.getElementById('fDebtor').addEventListener(ev, updateCodePreview);
    document.getElementById('fAccount').addEventListener(ev, updateCodePreview);
    document.getElementById('fAmount').addEventListener(ev, updateCodePreview);
  });

  let freq = editing ? info.frequency : 'Monthly';
  document.getElementById('dateField1').style.display = freq === 'Flexible' ? 'none' : '';
  document.getElementById('dateField2').style.display = freq === 'Semi-Monthly' ? '' : 'none';
  document.querySelectorAll('#freqGroup .radio-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#freqGroup .radio-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      freq = chip.dataset.freq;
      form.frequency.value = freq;
      document.getElementById('dateField1').style.display = freq === 'Flexible' ? 'none' : '';
      document.getElementById('dateField2').style.display = freq === 'Semi-Monthly' ? '' : 'none';
    });
  });

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mCancel').addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const debtor = form.debtor.value.trim();
    const account = form.account.value.trim();
    const amount = moneyVal(document.getElementById('fAmount'));
    const fees = moneyVal(document.getElementById('fFees'));
    const interest = moneyVal(document.getElementById('fInterest'));
    const repaymentAmount = moneyVal(form.repaymentAmount);
    const interestRate = form.interestRate.value.trim();
    const repaymentCount = form.repaymentCount.value.trim();
    const startPaymentDate = form.startPaymentDate.value || form.date.value;

    let dateSpec = '';
    if (freq === 'Monthly') dateSpec = form.repayDate1.value;
    else if (freq === 'Semi-Monthly') dateSpec = `${form.repayDate1.value},${form.repayDate2.value}`;

    let code;
    if (editing){
      code = editing.code;
    } else {
      code = `${account}-${debtor}-${amount}`;
      let suffix = 1;
      const existingCodes = new Set(allTx.map(t => t.code));
      let candidate = code;
      while (existingCodes.has(candidate)){ suffix++; candidate = `${code}-${suffix}`; }
      code = candidate;
    }

    const combinedRemarks = [interestRate, repaymentAmount, freq, repaymentCount, dateSpec, startPaymentDate, form.remarks.value.trim()].join('|');

    const records = [
      { date: form.date.value, transactionType:'Loan Release', fromAccount:account, toAccount:debtor,
        code, amount: amount - fees, category:'Net Amount', subCategory:'', remarks: combinedRemarks },
      { date: form.date.value, transactionType:'Loan Release', fromAccount:account, toAccount:debtor,
        code, amount: fees, category:'Fees', subCategory:'', remarks:'' },
      { date: form.date.value, transactionType:'Loan Release', fromAccount:account, toAccount:debtor,
        code, amount: interest, category:'Interest', subCategory:'', remarks:'' }
    ];

    if (editing){
      const oldIds = allTx.filter(t => t.transactionType==='Loan Release' && t.code === editing.code).map(t=>t.id);
      await dbDeleteIds(oldIds);
    }
    await dbAddMany(records);
    await reload();
    closeModal();
    toast(editing ? 'Loan updated' : 'Loan saved');
    renderLoan();
  });
}
function dateOptions(defaultVal=1){
  let opts = '';
  for (let i=1;i<=30;i++) opts += `<option value="${i}" ${i===defaultVal?'selected':''}>${i}</option>`;
  return opts;
}

/* Loan detail / schedule */
function openLoanDetail(code){
  const g = loanGroups().find(x => x.code === code);
  if (!g) return;
  const info = parseLoanRemarks(g.remarksRaw);
  const schedule = buildSchedule(g, info);
  const payments = allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === code);
  const total = g.principal + g.interest;
  const paid = loanPaid(code);
  const balance = total - paid;

  function findPaidRow(date){
    return payments.filter(p => p.date === date);
  }

  const rowsHtml = schedule.map(row => {
    const paidLines = row.date ? findPaidRow(row.date) : [];
    const isPaid = paidLines.some(p => p.category === 'Payment');
    const addAmt = paidLines.find(p => p.category === 'Additional Payment');
    return `
      <div class="schedule-row ${isPaid?'paid':''}" data-seq="${row.seq}" data-date="${row.date}">
        <span class="seq">${row.seq}</span>
        ${row.flexible
          ? `<input type="date" class="sdate-input" style="width:130px" value="${row.date||''}" ${isPaid?'disabled':''}>`
          : `<span class="sdate">${fmtDate(row.date)}</span>`}
        <span class="samt">${fmtMoney(info.repaymentAmount)}</span>
        <span class="sadd"><input type="text" placeholder="Additional" value="${addAmt?fmtMoney(addAmt.amount):''}" ${isPaid?'disabled':''}></span>
        <label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--text-dim)">
          <input type="checkbox" class="paidbox" ${isPaid?'checked':''}> Paid
        </label>
      </div>
    `;
  }).join('');

  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">${escapeHtml(g.debtor)}</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <div class="view-sub" style="margin-bottom:10px">Code: <span style="font-family:var(--font-mono)">${escapeHtml(g.code)}</span></div>
    <div class="loan-summary-grid" id="loanSummaryGrid">
      <div>Account<b>${escapeHtml(g.account)}</b></div>
      <div>Date Released<b>${fmtDate(g.date)}</b></div>
      <div>Principal<b>${fmtMoney(g.principal)}</b></div>
      <div>Fees<b>${fmtMoney(g.fees)}</b></div>
      <div>Interest<b>${fmtMoney(g.interest)}</b></div>
      <div>Interest Rate<b>${escapeHtml(info.interestRate)}%</b></div>
      <div>Total Payable<b>${fmtMoney(total)}</b></div>
      <div>Frequency<b>${escapeHtml(info.frequency)}</b></div>
      <div>Start Payment<b>${fmtDate(info.startPaymentDate || g.date)}</b></div>
      <div id="paidToDateDisplay">Paid to Date<b>${fmtMoney(paid)}</b></div>
      <div id="balanceDisplay">Balance<b>${fmtMoney(balance)}</b></div>
    </div>
    ${info.userRemarks ? `<div class="hint" style="margin-bottom:10px">Remarks: ${escapeHtml(info.userRemarks)}</div>` : ''}
    <div style="max-height:340px;overflow-y:auto" id="scheduleList">
      ${rowsHtml || '<div class="hint">No repayment schedule.</div>'}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn" id="btnEditLoan">Edit Loan</button>
      <button type="button" class="btn" id="btnViewAllTx">View All Transactions</button>
      <button type="button" class="btn" id="mClose2">Close</button>
    </div>
  `, true);

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mClose2').addEventListener('click', closeModal);
  document.getElementById('btnEditLoan').addEventListener('click', () => { closeModal(); openLoanForm(g); });
  document.getElementById('btnViewAllTx').addEventListener('click', () => openLoanTransactions(g.code));

  document.querySelectorAll('#scheduleList .paidbox').forEach(box => {
    box.addEventListener('change', async (e) => {
      const row = box.closest('.schedule-row');
      const seq = row.dataset.seq;
      const scheduleRow = schedule.find(s => String(s.seq) === seq);
      let date = row.dataset.date;
      if (scheduleRow.flexible){
        date = row.querySelector('.sdate-input').value;
        if (!date){ toast('Pick a date first'); box.checked = false; return; }
      }
      if (box.checked){
        const addInput = row.querySelector('.sadd input');
        const addAmount = parseMoney(addInput.value);
        const records = [{
          date, transactionType:'Loan Payment', fromAccount:g.debtor, toAccount:g.account,
          code: g.code, amount: info.repaymentAmount, category:'Payment', subCategory:'', remarks:''
        }];
        if (addAmount > 0){
          records.push({
            date, transactionType:'Loan Payment', fromAccount:g.debtor, toAccount:g.account,
            code: g.code, amount: addAmount, category:'Additional Payment', subCategory:'', remarks:''
          });
        }
        await dbAddMany(records);
        toast('Payment recorded');
      } else {
        const ids = allTx.filter(t => t.transactionType==='Loan Payment' && t.code===g.code && t.date===date).map(t=>t.id);
        await dbDeleteIds(ids);
        toast('Payment reverted');
      }
      await reload();
      const allPayments = allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === code);
      const paidLines = date ? allPayments.filter(p => p.date === date) : [];
      const isPaid = paidLines.some(p => p.category === 'Payment');
      const addAmt = paidLines.find(p => p.category === 'Additional Payment');
      row.classList.toggle('paid', isPaid);
      const chk = row.querySelector('.paidbox');
      const addInput = row.querySelector('.sadd input');
      chk.checked = isPaid;
      const sdateInput = row.querySelector('.sdate-input');
      if (sdateInput) sdateInput.disabled = isPaid;
      addInput.disabled = isPaid;
      addInput.value = addAmt ? fmtMoney(addAmt.amount) : '';
      const newPaid = loanPaid(code);
      const newBalance = total - newPaid;
      document.getElementById('paidToDateDisplay').innerHTML = `Paid to Date<b>${fmtMoney(newPaid)}</b>`;
      document.getElementById('balanceDisplay').innerHTML = `Balance<b>${fmtMoney(newBalance)}</b>`;
      renderLoan();
    });
  });
}

/* ------------------------------- Boot -------------------------------------- */
init();
