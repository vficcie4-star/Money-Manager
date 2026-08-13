/* ==========================================================================
   MoneyTracker — app.js
   Vanilla JS + IndexedDB. No build step — open index.html directly, or
   serve via GitHub Pages for phone + laptop access.

   Every row in IndexedDB mirrors one line of the Excel export:
   { id, date, transactionType, fromAccount, toAccount, code,
     amount, category, subCategory, remarks }
   ========================================================================== */

/* ---------------------------- IndexedDB layer ---------------------------- */
const DB_NAME = 'MoneyTrackerDB';
const DB_VERSION = 3;
const STORE = 'tx';
const GROUP_STORE = 'groups';       // account groups for the Report view — NOT touched by Excel import/export
const SETTINGS_STORE = 'settings';  // key/value app settings (e.g. Balance Wallet account selection)
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

function idbAddMany(records){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    records.forEach(r => store.add(r));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function idbPut(record){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function idbGetAll(){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function idbDeleteIds(ids){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    ids.forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

function idbClearAll(){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* ---- account groups (Report view only — survives Excel import/export) ---- */
function idbGetAllGroups(){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUP_STORE, 'readonly');
    const req = tx.objectStore(GROUP_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
function idbSaveGroup(group){ // add (no id) or update (has id)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUP_STORE, 'readwrite');
    const store = tx.objectStore(GROUP_STORE);
    const req = group.id ? store.put(group) : store.add(group);
    req.onsuccess = () => resolve(req.result);
    tx.onerror = (e) => reject(e.target.error);
  });
}
function idbDeleteGroup(id){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(GROUP_STORE, 'readwrite');
    tx.objectStore(GROUP_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* ---- settings (key/value) ---- */
function idbGetSetting(key){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const req = tx.objectStore(SETTINGS_STORE).get(key);
    req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
    req.onerror = (e) => reject(e.target.error);
  });
}
function idbSetSetting(key, value){
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

/* ==========================================================================
   FILE-FOLDER STORAGE — store all data as one JSON file inside a folder you
   pick on your PC or phone (File System Access API), instead of the browser's
   own local storage. Falls back to the in-browser IndexedDB above in
   browsers that don't support the API (Firefox, iOS Safari).
   ========================================================================== */
const FS_SUPPORTED = typeof window.showDirectoryPicker === 'function';
const DATA_FILE_NAME = 'moneytracker-data.json';
const HANDLE_DB_NAME = 'MoneyTrackerHandleDB';
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = 'handles';

let dirHandle = null;         // FileSystemDirectoryHandle currently linked, or null
let storageMode = 'browser';  // 'folder' | 'browser' | 'needs-permission'

function openHandleDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB_NAME, HANDLE_DB_VERSION);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(HANDLE_STORE)) e.target.result.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
async function saveDirHandle(handle){
  const hdb = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = hdb.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).put(handle, 'dir');
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}
async function loadDirHandle(){
  const hdb = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = hdb.transaction(HANDLE_STORE, 'readonly');
    const req = tx.objectStore(HANDLE_STORE).get('dir');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
}
async function clearDirHandle(){
  const hdb = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = hdb.transaction(HANDLE_STORE, 'readwrite');
    tx.objectStore(HANDLE_STORE).delete('dir');
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}
async function verifyPermissionSilent(handle){
  try{ return (await handle.queryPermission({ mode:'readwrite' })) === 'granted'; }
  catch{ return false; }
}
async function verifyPermission(handle){
  try{
    if ((await handle.queryPermission({ mode:'readwrite' })) === 'granted') return true;
    return (await handle.requestPermission({ mode:'readwrite' })) === 'granted';
  }catch{ return false; }
}
async function folderStillReachable(handle){
  try{ await handle.keys().next(); return true; }
  catch{ return false; }
}
async function readDataFile(){
  try{
    const fileHandle = await dirHandle.getFileHandle(DATA_FILE_NAME, { create:false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    return text ? JSON.parse(text) : null;
  }catch(err){
    if (err.name === 'NotFoundError') return null; // folder exists but no data file yet — empty
    throw err;
  }
}
async function writeDataFile(data){
  const fileHandle = await dirHandle.getFileHandle(DATA_FILE_NAME, { create:true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}
async function persist(){
  if (storageMode !== 'folder' || !dirHandle) return;
  await writeDataFile({ transactions: allTx, groups: allGroups, walletAccounts, loanOrder });
}
async function loadFromFolder(){
  const reachable = await folderStillReachable(dirHandle);
  if (!reachable){ const e = new Error('folder-missing'); e.code='folder-missing'; throw e; }
  const data = await readDataFile();
  if (data){
    allTx = data.transactions || [];
    allGroups = data.groups || [];
    walletAccounts = data.walletAccounts ?? null;
    loanOrder = data.loanOrder || [];
  } else {
    // Not linked to an existing data file in this folder yet — starts empty.
    allTx = [];
    allGroups = [];
    walletAccounts = null;
    loanOrder = [];
    await persist(); // create the file now so the folder is visibly linked
  }
}
async function chooseStorageFolder(){
  if (!FS_SUPPORTED){
    toast("This browser can't link a folder — try Chrome or Edge");
    return false;
  }
  try{
    const handle = await window.showDirectoryPicker();
    const ok = await verifyPermission(handle);
    if (!ok){ toast('Permission denied'); return false; }
    dirHandle = handle;
    await saveDirHandle(handle);
    storageMode = 'folder';
    await loadFromFolder();
    toast(`Storage linked to "${handle.name}"`);
    return true;
  }catch(err){
    if (err.name !== 'AbortError') toast('Could not open that folder');
    return false;
  }
}
async function reconnectStorage(){
  if (!dirHandle) return false;
  const ok = await verifyPermission(dirHandle);
  if (!ok){ toast('Permission denied'); return false; }
  try{
    storageMode = 'folder';
    await loadFromFolder();
    hideStorageBanner();
    updateStorageStatusUI();
    navigate(currentView);
    toast('Storage reconnected');
    return true;
  }catch(err){
    storageMode = 'browser';
    allTx = await idbGetAll();
    allGroups = await idbGetAllGroups();
    showStorageBanner('missing');
    updateStorageStatusUI();
    toast('That folder is no longer accessible');
    return false;
  }
}
async function switchToBrowserStorage(){
  await clearDirHandle();
  dirHandle = null;
  storageMode = 'browser';
  allTx = await idbGetAll();
  allGroups = await idbGetAllGroups();
  const savedWallet = await idbGetSetting('walletAccounts');
  walletAccounts = Array.isArray(savedWallet) ? savedWallet : null;
  const savedLoanOrder = await idbGetSetting('loanOrder');
  loanOrder = Array.isArray(savedLoanOrder) ? savedLoanOrder : [];
  updateStorageStatusUI();
}

/* ---- Dispatcher functions: same names the rest of the app already calls,
        but they route to the linked folder file or to IndexedDB depending
        on storageMode. ---- */
async function dbAddMany(records){
  if (storageMode === 'folder'){
    let nextId = allTx.reduce((m,t) => Math.max(m, t.id||0), 0) + 1;
    records.forEach(r => { r.id = nextId++; allTx.push(r); });
    await persist();
    return;
  }
  return idbAddMany(records);
}
async function dbPut(record){
  if (storageMode === 'folder'){
    const idx = allTx.findIndex(t => t.id === record.id);
    if (idx >= 0) allTx[idx] = record; else allTx.push(record);
    await persist();
    return;
  }
  return idbPut(record);
}
async function dbGetAll(){
  if (storageMode === 'folder') return allTx;
  return idbGetAll();
}
async function dbDeleteIds(ids){
  if (storageMode === 'folder'){
    const idSet = new Set(ids);
    allTx = allTx.filter(t => !idSet.has(t.id));
    await persist();
    return;
  }
  return idbDeleteIds(ids);
}
async function dbClearAll(){
  if (storageMode === 'folder'){
    allTx = [];
    await persist();
    return;
  }
  return idbClearAll();
}
async function dbGetAllGroups(){
  if (storageMode === 'folder') return allGroups;
  return idbGetAllGroups();
}
async function dbSaveGroup(group){
  if (storageMode === 'folder'){
    if (group.id){
      const idx = allGroups.findIndex(g => g.id === group.id);
      if (idx >= 0) allGroups[idx] = group;
    } else {
      group.id = allGroups.reduce((m,g) => Math.max(m, g.id||0), 0) + 1;
      allGroups.push(group);
    }
    await persist();
    return group.id;
  }
  return idbSaveGroup(group);
}
async function dbDeleteGroup(id){
  if (storageMode === 'folder'){
    allGroups = allGroups.filter(g => g.id !== id);
    await persist();
    return;
  }
  return idbDeleteGroup(id);
}
async function dbGetSetting(key){
  if (storageMode === 'folder'){
    if (key === 'walletAccounts') return walletAccounts;
    if (key === 'loanOrder') return loanOrder;
    return undefined;
  }
  return idbGetSetting(key);
}
async function dbSetSetting(key, value){
  if (storageMode === 'folder'){
    if (key === 'walletAccounts') walletAccounts = value;
    if (key === 'loanOrder') loanOrder = value;
    await persist();
    return;
  }
  return idbSetSetting(key, value);
}

/* ---- Storage banner + Storage modal UI ---- */
function showStorageBanner(kind){
  const b = document.getElementById('storageBanner');
  if (!b) return;
  if (kind === 'reconnect'){
    b.innerHTML = `<span>⚠ Storage folder needs to be reconnected — your data is not loaded until then.</span> <button class="btn btn-small" id="bannerReconnect">Reconnect Storage</button>`;
  } else if (kind === 'missing'){
    b.innerHTML = `<span>⚠ The linked storage folder is missing or was moved.</span> <button class="btn btn-small" id="bannerChoose">Choose Storage</button>`;
  } else { // 'choose'
    b.innerHTML = `<span>📁 Data is only saved in this browser right now.</span> <button class="btn btn-small" id="bannerChoose">Choose a PC/Phone Folder</button> <button class="btn btn-ghost btn-small" id="bannerDismiss">Dismiss</button>`;
  }
  b.style.display = 'flex';
  const reconnect = document.getElementById('bannerReconnect');
  if (reconnect) reconnect.addEventListener('click', reconnectStorage);
  const choose = document.getElementById('bannerChoose');
  if (choose) choose.addEventListener('click', async () => {
    const ok = await chooseStorageFolder();
    if (ok){ hideStorageBanner(); updateStorageStatusUI(); navigate(currentView); }
  });
  const dismiss = document.getElementById('bannerDismiss');
  if (dismiss) dismiss.addEventListener('click', hideStorageBanner);
}
function hideStorageBanner(){
  const b = document.getElementById('storageBanner');
  if (b) b.style.display = 'none';
}
function updateStorageStatusUI(){
  const label = storageMode === 'folder' ? 'Storage: Folder'
    : storageMode === 'needs-permission' ? 'Storage: Reconnect'
    : 'Storage: Browser';
  document.querySelectorAll('#storageLabel, #storageLabelMobile').forEach(el => el.textContent = label);
}
function openStorageModal(){
  let statusHtml;
  if (storageMode === 'folder'){
    statusHtml = `Linked to a folder${dirHandle && dirHandle.name ? `: <b>${escapeHtml(dirHandle.name)}</b>` : ''} on this device. All data is saved as <span style="font-family:var(--font-mono)">${DATA_FILE_NAME}</span> inside it — no browser storage is used.`;
  } else if (storageMode === 'needs-permission'){
    statusHtml = `A folder was linked before, but this browser needs permission re-confirmed before it can read or write it.`;
  } else {
    statusHtml = FS_SUPPORTED
      ? `Currently saving inside this browser only. Link a folder on your PC or phone to keep a real file backup that survives clearing browser data, and that you can move between devices. If the folder has no <span style="font-family:var(--font-mono)">${DATA_FILE_NAME}</span> yet, the app starts empty there — export/import Excel to move your current browser data over.`
      : `Currently saving inside this browser only. This browser doesn't support linking a folder — try Chrome or Edge (on desktop or Android) to enable it.`;
  }
  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">Storage</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <div class="hint" style="margin-bottom:16px;line-height:1.6;font-size:13px">${statusHtml}</div>
    <div class="modal-actions" style="justify-content:flex-start;flex-wrap:wrap">
      ${FS_SUPPORTED ? `<button class="btn btn-primary" id="btnPickFolder">${storageMode==='folder'?'Change Folder':'Choose Folder'}</button>` : ''}
      ${storageMode === 'needs-permission' ? `<button class="btn" id="btnReconnect2">Reconnect</button>` : ''}
      ${storageMode === 'folder' ? `<button class="btn btn-ghost" id="btnUnlink">Use Browser Storage Instead</button>` : ''}
    </div>
  `);
  document.getElementById('mClose').addEventListener('click', closeModal);
  const pick = document.getElementById('btnPickFolder');
  if (pick) pick.addEventListener('click', async () => {
    const ok = await chooseStorageFolder();
    if (ok){ closeModal(); hideStorageBanner(); updateStorageStatusUI(); navigate(currentView); }
  });
  const rec = document.getElementById('btnReconnect2');
  if (rec) rec.addEventListener('click', async () => { const ok = await reconnectStorage(); if (ok) closeModal(); });
  const unlink = document.getElementById('btnUnlink');
  if (unlink) unlink.addEventListener('click', async () => {
    if (!confirm('Switch back to in-browser storage? The folder and its file are left untouched, but this app will stop reading or writing it until you link it again.')) return;
    await switchToBrowserStorage();
    closeModal();
    navigate(currentView);
    toast('Switched to browser storage');
  });
}

/* ------------------------------ App state -------------------------------- */
let allTx = [];             // in-memory mirror of the tx store
let allGroups = [];         // in-memory mirror of the groups store
let walletAccounts = null;  // null = "all accounts"; else array of included account names
let loanOrder = [];         // persistent ordering of loan codes
let currentView = 'report';

async function init(){
  bindNav();
  bindGlobalUI();
  await initStorage();
  navigate('report');
}

async function initStorage(){
  await openDB(); // IndexedDB is still opened — it's the fallback store, and the target when switching back to browser storage
  if (FS_SUPPORTED){
    try{
      const handle = await loadDirHandle();
      if (handle){
        dirHandle = handle;
        if (await verifyPermissionSilent(handle)){
          try{
            storageMode = 'folder';
            await loadFromFolder();
            updateStorageStatusUI();
            // ensure loanOrder is populated (may be present in file)
            loanOrder = loanOrder || [];
            return;
          }catch(err){
            // Handle remembered, permission granted, but the folder itself is gone/moved
            storageMode = 'browser';
            allTx = await idbGetAll();
            allGroups = await idbGetAllGroups();
            const savedWallet = await idbGetSetting('walletAccounts');
            walletAccounts = Array.isArray(savedWallet) ? savedWallet : null;
            const savedLoanOrder = await idbGetSetting('loanOrder');
            loanOrder = Array.isArray(savedLoanOrder) ? savedLoanOrder : [];
            updateStorageStatusUI();
            showStorageBanner('missing');
            return;
          }
        } else {
          // Try to request permission now (may require user gesture) — if browser blocks, fall back to banner
          try {
            const ok = await verifyPermission(handle);
            if (ok){
              dirHandle = handle;
              storageMode = 'folder';
              await loadFromFolder();
              updateStorageStatusUI();
              loanOrder = loanOrder || [];
              return;
            } else {
              storageMode = 'needs-permission';
              allTx = [];
              allGroups = [];
              walletAccounts = null;
              loanOrder = [];
              updateStorageStatusUI();
              showStorageBanner('reconnect');
              return;
            }
          } catch (err) {
            storageMode = 'needs-permission';
            allTx = [];
            allGroups = [];
            walletAccounts = null;
            loanOrder = [];
            updateStorageStatusUI();
            showStorageBanner('reconnect');
            return;
          }
        }
      }
    }catch(err){ /* fall through to browser storage below */ }
  }
  storageMode = 'browser';
  allTx = await idbGetAll();
  allGroups = await idbGetAllGroups();
  const savedWallet = await idbGetSetting('walletAccounts');
  walletAccounts = Array.isArray(savedWallet) ? savedWallet : null;
  const savedLoanOrder = await idbGetSetting('loanOrder');
  loanOrder = Array.isArray(savedLoanOrder) ? savedLoanOrder : [];
  updateStorageStatusUI();
  if (FS_SUPPORTED) showStorageBanner('choose');
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

/* Accounting-format input: live formats on blur, keeps raw number in dataset */
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

/* Simple autocomplete: text input + suggestion list from an array of strings */
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
  document.getElementById('btnStorage').addEventListener('click', openStorageModal);

  const mExport = document.getElementById('btnExportMobile');
  const mImport = document.getElementById('fileImportMobile');
  const mClear = document.getElementById('btnClearMobile');
  const mStorage = document.getElementById('btnStorageMobile');
  if (mExport) mExport.addEventListener('click', exportExcel);
  if (mImport) mImport.addEventListener('change', importExcel);
  if (mClear) mClear.addEventListener('click', openClearTransactionsForm);
  if (mStorage) mStorage.addEventListener('click', openStorageModal);
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

  // Check if the Loan Detail modal is currently open; if so, close and reopen it
  const overlay = document.getElementById('modalOverlay');
  const modalTitleEl = overlay.querySelector('.modal-title');
  if (overlay.classList.contains('open') && modalTitleEl && currentView === 'loan') {
    // We need to find the code currently being viewed
    const codeSpan = overlay.querySelector('.view-sub span');
    if (codeSpan) {
      const currentCode = codeSpan.textContent.trim();
      // Close the modal
      closeModal();
      // Re-open the loan detail with the same code using fresh data
      setTimeout(() => {
        openLoanDetail(currentCode);
        // Also ensure the main Loan table is up to date
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
  if (typeof v === 'number'){ // excel serial date
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
   Shared suggestion pools — Income / Expense / Transfer only (Loan is separate)
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
   REPORT VIEW — per-account Income/Expense/Transfer/Balance, with custom groups
   ============================================================================= */
// Store current date filter state
const reportFilter = { startDate: '', endDate: '' };

function accountStats(startDate, endDate){
  // stats keyed by account name, built only from Income/Expense/Transfer rows
  const stats = {};
  function bump(name, field, amt){
    if (!name) return;
    if (!stats[name]) stats[name] = { income:0, expense:0, transferIn:0, transferOut:0 };
    stats[name][field] += amt;
  }
  
  // Filter transactions by date range
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
function statsRowHtml(name, s, indent=false){
  return `
    <tr data-account="${escapeHtml(name)}">
      <td data-label="Account"${indent ? ' style="padding-left:30px;color:var(--text-dim)"' : ''}>${escapeHtml(name)}</td>
      <td class="num" data-label="Income">${fmtMoney(s.income)}</td>
      <td class="num" data-label="Expense">${fmtMoney(s.expense)}</td>
      <td class="num" data-label="Transfer">${fmtMoney(s.transferIn - s.transferOut)}</td>
      <td class="num" data-label="Balance"><b>${fmtMoney(s.balance)}</b></td>
    </tr>`;
}
function groupTotalRowHtml(g, total, isOpen){
  return `
    <tr class="no-hover" data-group-toggle="${g.id}" style="cursor:pointer;background:#F8F7F1">
      <td data-label="Group"><span style="display:inline-block;width:12px">${isOpen?'▾':'▸'}</span><b>${escapeHtml(g.name)}</b> <span class="hint" style="display:inline">(${g.accounts.length})</span> <button class="icon-btn" data-edit-group="${g.id}" title="Edit group" style="font-size:12px">✎</button></td>
      <td class="num" data-label="Income">—</td>
      <td class="num" data-label="Expense">—</td>
      <td class="num" data-label="Transfer">—</td>
      <td class="num" data-label="Balance"><b>${fmtMoney(total.balance)}</b></td>
    </tr>`;
}
function walletBalance(stats){
  const names = walletAccounts === null ? Object.keys(stats) : walletAccounts.filter(n => stats[n]);
  return names.reduce((s,n) => s + (stats[n] ? stats[n].balance : 0), 0);
}

let expandedGroups = new Set();

function renderReport(){
  const main = document.getElementById('main');

  // Ensure report date defaults: start = earliest transaction recorded overall, end = today
  const earliestAll = allTx.reduce((m,t) => (t && t.date && (!m || t.date < m) ? t.date : m), null) || todayStr();
  if (!reportFilter.startDate) reportFilter.startDate = earliestAll;
  if (!reportFilter.endDate) reportFilter.endDate = todayStr();

  // Get stats with date filter applied
  const stats = accountStats(reportFilter.startDate, reportFilter.endDate);
  const allAccountNames = Object.keys(stats);
  const grouped = new Set();
  allGroups.forEach(g => g.accounts.forEach(a => grouped.add(a)));
  const ungrouped = allAccountNames.filter(a => !grouped.has(a)).sort((a,b)=>a.localeCompare(b));

  let groupRows = allGroups.map(g => {
    const memberStats = g.accounts.map(a => stats[a] || { income:0,expense:0,transferIn:0,transferOut:0,balance:0 });
    const total = sumStats(memberStats);
    const isOpen = expandedGroups.has(g.id);
    return `
      ${groupTotalRowHtml(g, total, isOpen)}
      ${isOpen ? g.accounts.map(a => statsRowHtml(a, stats[a] || {income:0,expense:0,transferIn:0,transferOut:0,balance:0}, true)).join('') : ''}
    `;
  }).join('');

  let ungroupedRows = ungrouped.map(name => statsRowHtml(name, stats[name])).join('');
  const wallet = walletBalance(stats);

  // Build date filter HTML
  const dateFilterHtml = `
    <div class="filter-row" style="margin-bottom:12px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        From:
        <input type="date" id="reportStartDate" value="${reportFilter.startDate}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        To:
        <input type="date" id="reportEndDate" value="${reportFilter.endDate}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <button class="btn btn-small" id="btnApplyDateFilter">Apply</button>
      ${(reportFilter.startDate || reportFilter.endDate) ? `<button class="btn btn-ghost btn-small" id="btnClearDateFilter">Clear</button>` : ''}
    </div>
  `;

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
      <table class="report-table">
        <thead><tr><th>Account</th><th class="num">Income</th><th class="num">Expense</th><th class="num">Transfer</th><th class="num">Balance</th></tr></thead>
        <tbody>
          ${groupRows}
          ${ungroupedRows || (!allGroups.length ? `<tr class="empty-row"><td colspan="5">No Income, Expense, or Transfer transactions${(reportFilter.startDate||reportFilter.endDate)?' in this date range':''} yet.</td></tr>` : '')}
        </tbody>
      </table>
    </div>
  `;

  // Bind events
  document.getElementById('btnNewGroup').addEventListener('click', () => openGroupForm(null));
  document.getElementById('walletCard').addEventListener('click', () => openWalletForm(stats));

  // Click an account row -> pop up that account's Income/Expense/Transfer transactions
  main.querySelectorAll('tbody tr[data-account]').forEach(tr => {
    tr.addEventListener('click', () => openAccountTransactionsModal(tr.dataset.account, stats));
  });
  
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
}

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

/* Popup shown when an account row on the Report screen is clicked — every
   Income / Expense / Transfer line touching that account, newest first.
   Respects the Report screen's current From/To date filter. */
function openAccountTransactionsModal(name, stats){
  const s = stats[name] || { income:0, expense:0, transferIn:0, transferOut:0, balance:0 };

  // build the full set of rows for that account (unfiltered), so we can compute earliest
  const allAccountRows = ledgerTx().filter(t => {
    if (t.transactionType === 'Income') return t.toAccount === name;
    if (t.transactionType === 'Expense') return t.fromAccount === name;
    if (t.transactionType === 'Transfer') return t.fromAccount === name || t.toAccount === name;
    return false;
  });

  const firstDate = allAccountRows.reduce((m,t) => (t.date && (!m || t.date < m) ? t.date : m), null) || todayStr();
  const popupStart = firstDate;
  const popupEnd = todayStr();

  // function to get the rows filtered by provided start/end
  function filteredRows(startDate, endDate){
    return ledgerTx().filter(t => {
      if (startDate && t.date && t.date < startDate) return false;
      if (endDate && t.date && t.date > endDate) return false;
      if (t.transactionType === 'Income') return t.toAccount === name;
      if (t.transactionType === 'Expense') return t.fromAccount === name;
      if (t.transactionType === 'Transfer') return t.fromAccount === name || t.toAccount === name;
      return false;
    }).sort((a,b) => (b.date||'').localeCompare(a.date||''));
  }

  // initial rows
  let rows = filteredRows(popupStart, popupEnd);

  const rowsHtml = rows.map(t => {
    const cls = t.transactionType.toLowerCase();
    let detail, sign;
    if (t.transactionType === 'Income'){ detail = t.category || 'Income'; sign = '+'; }
    else if (t.transactionType === 'Expense'){ detail = t.category || 'Expense'; sign = '-'; }
    else if (t.toAccount === name){ detail = `From ${t.fromAccount || '—'}`; sign = '+'; }
    else { detail = `To ${t.toAccount || '—'}`; sign = '-'; }
    return `
      <div class="acct-tx-row">
        <span class="tag ${cls}">${t.transactionType}</span>
        <span data-label="Date">${fmtDate(t.date)}</span>
        <span data-label="Detail">${escapeHtml(detail)}</span>
        <span class="atx-remarks" data-label="Remarks">${escapeHtml(t.remarks||'—')}</span>
        <span class="atx-amt num ${sign==='+'?'amt-pos':'amt-neg'}" data-label="Amount">${sign}${fmtMoney(t.amount)}</span>
      </div>`;
  }).join('');

  openModal(`
    <div class="modal-close-row">
      <h3 class="modal-title">${escapeHtml(name)}</h3>
      <button class="modal-x" id="mClose">✕</button>
    </div>
    <div style="margin-bottom:10px" class="filter-row">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        From: <input type="date" id="acctStartDate" value="${popupStart}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        To: <input type="date" id="acctEndDate" value="${popupEnd}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <button class="btn btn-small" id="btnApplyAcctDate">Apply</button>
      <button class="btn btn-ghost btn-small" id="btnClearAcctDate">Clear</button>
    </div>

    <div class="loan-summary-grid" style="background:var(--line-soft)">
      <div>Income<b style="color:var(--income)">${fmtMoney(s.income)}</b></div>
      <div>Expense<b style="color:var(--expense)">${fmtMoney(s.expense)}</b></div>
      <div>Transfer<b>${fmtMoney(s.transferIn - s.transferOut)}</b></div>
      <div>Balance<b>${fmtMoney(s.balance)}</b></div>
    </div>
    <div class="acct-tx-list" id="acctTxList">
      ${rowsHtml || `<div class="hint" style="padding:26px 0;text-align:center">No transactions for this account.</div>`}
    </div>
    <div class="modal-actions"><button type="button" class="btn" id="mClose2">Close</button></div>
  `, true);

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mClose2').addEventListener('click', closeModal);

  document.getElementById('btnApplyAcctDate').addEventListener('click', () => {
    const s = document.getElementById('acctStartDate').value;
    const e = document.getElementById('acctEndDate').value;
    const newRows = filteredRows(s, e);
    const html = newRows.map(t => {
      const cls = t.transactionType.toLowerCase();
      let detail, sign;
      if (t.transactionType === 'Income'){ detail = t.category || 'Income'; sign = '+'; }
      else if (t.transactionType === 'Expense'){ detail = t.category || 'Expense'; sign = '-'; }
      else if (t.toAccount === name){ detail = `From ${t.fromAccount || '—'}`; sign = '+'; }
      else { detail = `To ${t.toAccount || '—'}`; sign = '-'; }
      return `
        <div class="acct-tx-row">
          <span class="tag ${cls}">${t.transactionType}</span>
          <span data-label="Date">${fmtDate(t.date)}</span>
          <span data-label="Detail">${escapeHtml(detail)}</span>
          <span class="atx-remarks" data-label="Remarks">${escapeHtml(t.remarks||'—')}</span>
          <span class="atx-amt num ${sign==='+'?'amt-pos':'amt-neg'}" data-label="Amount">${sign}${fmtMoney(t.amount)}</span>
        </div>`;
    }).join('') || `<div class="hint" style="padding:26px 0;text-align:center">No transactions for this account in that range.</div>`;
    document.getElementById('acctTxList').innerHTML = html;
  });

  document.getElementById('btnClearAcctDate').addEventListener('click', () => {
    document.getElementById('acctStartDate').value = popupStart;
    document.getElementById('acctEndDate').value = popupEnd;
    const newRows = filteredRows(popupStart, popupEnd);
    const html = newRows.map(t => {
      const cls = t.transactionType.toLowerCase();
      let detail, sign;
      if (t.transactionType === 'Income'){ detail = t.category || 'Income'; sign = '+'; }
      else if (t.transactionType === 'Expense'){ detail = t.category || 'Expense'; sign = '-'; }
      else if (t.toAccount === name){ detail = `From ${t.fromAccount || '—'}`; sign = '+'; }
      else { detail = `To ${t.toAccount || '—'}`; sign = '-'; }
      return `
        <div class="acct-tx-row">
          <span class="tag ${cls}">${t.transactionType}</span>
          <span data-label="Date">${fmtDate(t.date)}</span>
          <span data-label="Detail">${escapeHtml(detail)}</span>
          <span class="atx-remarks" data-label="Remarks">${escapeHtml(t.remarks||'—')}</span>
          <span class="atx-amt num ${sign==='+'?'amt-pos':'amt-neg'}" data-label="Amount">${sign}${fmtMoney(t.amount)}</span>
        </div>`;
    }).join('') || `<div class="hint" style="padding:26px 0;text-align:center">No transactions for this account.</div>`;
    document.getElementById('acctTxList').innerHTML = html;
  });
}

/* =============================================================================
   INCOME / EXPENSE / TRANSFER — shared "simple ledger" view
   ============================================================================= */
const LEDGER_CFG = {
  Income:   { icon:'＋', cls:'income',   fields:['account','category','subCategory'] },
  Expense:  { icon:'－', cls:'expense',  fields:['account','category','subCategory'] },
  Transfer: { icon:'⇄', cls:'transfer', fields:['fromAccount','toAccount'] }
};
// ledgerFilters now includes startDate/endDate defaults for each ledger type
const ledgerFilters = {
  Income:  { account:'', category:'', startDate:'', endDate:'' },
  Expense: { account:'', category:'', startDate:'', endDate:'' },
  Transfer:{ startDate:'', endDate:'' }
};

function renderLedger(type){
  const cfg = LEDGER_CFG[type];
  const isTransfer = type === 'Transfer';
  const allRows = allTx.filter(t => t.transactionType === type);
  const filter = ledgerFilters[type];

  // set default date range: start = earliest transaction recorded overall, end = today
  const earliestAll = allTx.reduce((m,t) => (t && t.date && (!m || t.date < m) ? t.date : m), null) || todayStr();
  const defaultStart = earliestAll;
  const defaultEnd = todayStr();
  if (!filter.startDate) filter.startDate = defaultStart;
  if (!filter.endDate) filter.endDate = defaultEnd;

  // apply date filtering in addition to existing account/category filters
  let rows = allRows.filter(t => {
    if (filter.startDate && t.date && t.date < filter.startDate) return false;
    if (filter.endDate && t.date && t.date > filter.endDate) return false;
    return true;
  });

  if (!isTransfer && filter){
    if (filter.account) rows = rows.filter(t => (type==='Income'?t.toAccount:t.fromAccount) === filter.account);
    if (filter.category) rows = rows.filter(t => t.category === filter.category);
  }
  rows = rows.slice().sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const main = document.getElementById('main');

  // build date filter HTML
  const dateFilterHtml = `
    <div class="filter-row">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        From: <input type="date" id="ledgerStartDate" value="${filter.startDate}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim)">
        To: <input type="date" id="ledgerEndDate" value="${filter.endDate}" style="padding:6px 10px;border:1px solid var(--line);border-radius:var(--radius-sm);font-size:13px">
      </label>
      <button class="btn btn-small" id="btnApplyLedgerDateFilter">Apply</button>
      ${(filter.startDate||filter.endDate) ? `<button class="btn btn-ghost btn-small" id="btnClearLedgerDateFilter">Clear</button>` : ''}
    </div>
  `;

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
        ${(filter.account||filter.category) ? `<button type="button" class="btn btn-ghost btn-small" id="btnClearFilter">Clear filter</button>` : ''}
      </div>
    `;
    filterHtml = dateFilterHtml + filterHtml;
  } else {
    // transfer: only date filters
    filterHtml = dateFilterHtml;
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
  if (!isTransfer){
    document.getElementById('filterAccount').addEventListener('change', (e) => { filter.account = e.target.value; renderLedger(type); });
    document.getElementById('filterCategory').addEventListener('change', (e) => { filter.category = e.target.value; renderLedger(type); });
    const clearBtn = document.getElementById('btnClearFilter');
    if (clearBtn) clearBtn.addEventListener('click', () => { filter.account=''; filter.category=''; renderLedger(type); });
  }

  // date filter bindings
  document.getElementById('btnApplyLedgerDateFilter').addEventListener('click', () => {
    const s = document.getElementById('ledgerStartDate').value;
    const e = document.getElementById('ledgerEndDate').value;
    filter.startDate = s;
    filter.endDate = e;
    renderLedger(type);
  });
  const cl = document.getElementById('btnClearLedgerDateFilter');
  if (cl) cl.addEventListener('click', () => {
    filter.startDate = '';
    filter.endDate = '';
    renderLedger(type);
  });

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

    // SubCategory: show suggestions that belong to the currently-selected Category for this transaction type
    attachAutocomplete(form.subCategory, document.getElementById('acSub'), () => {
      const cat = (form.category && form.category.value || '').trim();
      if (!cat) {
        // if no category selected, fall back to all subcategories for the type
        return uniq(allTx.filter(t => t.transactionType === type).map(t => t.subCategory));
      }
      // show subcategories that have been used WITH that category for this type
      return uniq(allTx.filter(t => t.transactionType === type && t.category === cat).map(t => t.subCategory));
    });
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
   LOAN VIEW
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
  });
}
function loanPaid(code){
  return allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === code)
    .reduce((s,t) => s + Number(t.amount||0), 0);
}
function loanBalance(code){
  const g = loanGroups().find(x => x.code === code);
  if (!g) return 0;
  return (g.principal + g.interest) - loanPaid(code);
}
function parseLoanRemarks(raw){
  // InterestRate|RepaymentAmount|Frequency|Count|Date(s)|StartPaymentDate|UserRemarks
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

const loanFilter = { debtor:'', account:'', balance:'all' };

async function saveLoanOrder(order){
  loanOrder = order.slice();
  await dbSetSetting('loanOrder', loanOrder);
  toast('Order saved');
}

function ensureLoanOrderIncludesAll(groups){
  const codes = groups.map(g => g.code);
  if (!loanOrder || !loanOrder.length) {
    loanOrder = codes.slice();
    return;
  }
  // add missing codes to end preserving existing order
  codes.forEach(c => { if (!loanOrder.includes(c)) loanOrder.push(c); });
}

function sortGroupsByLoanOrder(groups){
  if (!loanOrder || !loanOrder.length) return groups.slice().sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const map = new Map(groups.map(g => [g.code, g]));
  const ordered = [];
  loanOrder.forEach(code => { if (map.has(code)) ordered.push(map.get(code)); });
  // append any groups not in loanOrder
  groups.forEach(g => { if (!loanOrder.includes(g.code)) ordered.push(g); });
  return ordered;
}

function renderLoan(){
  const groupsRaw = loanGroups();
  // Ensure loanOrder includes all existing loan codes
  ensureLoanOrderIncludesAll(groupsRaw);
  // Apply ordering
  const groupsOrdered = sortGroupsByLoanOrder(groupsRaw);

  const debtorOpts = uniq(groupsOrdered.map(g=>g.debtor)).sort((a,b)=>a.localeCompare(b));
  const accountOpts = uniq(groupsOrdered.map(g=>g.account)).sort((a,b)=>a.localeCompare(b));

  let filtered = groupsOrdered.slice();
  if (loanFilter.debtor) filtered = filtered.filter(g => g.debtor === loanFilter.debtor);
  if (loanFilter.account) filtered = filtered.filter(g => g.account === loanFilter.account);
  if (loanFilter.balance !== 'all'){
    filtered = filtered.filter(g => {
      const bal = loanBalance(g.code);
      return loanFilter.balance === 'zero' ? Math.abs(bal) < 0.005 : bal > 0.005;
    });
  }

  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Loan</h1><div class="view-sub">${filtered.length} of ${groupsOrdered.length} loan${groupsOrdered.length===1?'':'s'}</div></div>
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
          <th></th><th>#</th><th>Date Released</th><th>Debtor</th><th>Account</th>
          <th class="num">Amount</th><th>Repayment Date</th><th class="num">Repayment Amount</th>
          <th class="num">Total Payment Count</th><th class="num">Balance</th><th></th>
        </tr></thead>
        <tbody id="loanBody">
          ${filtered.length ? filtered.map((g,i) => {
            const info = parseLoanRemarks(g.remarksRaw);
            const paymentCount = allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === g.code).length;
            const totalCount = info.count || '—';
            return `
            <tr data-code="${escapeHtml(g.code)}">
              <td class="drag-cell"><span class="drag-handle" title="Drag to reorder" style="cursor:grab">☰</span></td>
              <td>${i+1}</td>
              <td>${fmtDate(g.date)}</td>
              <td>${escapeHtml(g.debtor)}</td>
              <td>${escapeHtml(g.account)}</td>
              <td class="num">${fmtMoney(g.principal)}</td>
              <td>${escapeHtml(repaymentDateLabel(info))}</td>
              <td class="num">${fmtMoney(info.repaymentAmount)}</td>
              <td class="num">${escapeHtml(String(paymentCount))} of ${escapeHtml(String(totalCount))}</td>
              <td class="num">${fmtMoney(loanBalance(g.code))}</td>
              <td class="row-actions">
                <button class="icon-btn" data-edit="${escapeHtml(g.code)}" title="Edit loan">✎</button>
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
  main.querySelectorAll('#loanBody tr[data-code]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]') || e.target.closest('[data-edit]')) return;
      openLoanDetail(tr.dataset.code);
    });
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
    // remove from loanOrder if present
    if (loanOrder && loanOrder.includes(code)){
      loanOrder = loanOrder.filter(c => c !== code);
      await dbSetSetting('loanOrder', loanOrder);
    }
    toast('Loan deleted');
    renderLoan();
  }));

  // --- Drag & drop handlers for reorder ---
  let draggedCode = null;
  const loanRows = main.querySelectorAll('#loanBody tr[data-code]');
  loanRows.forEach(tr => {
    tr.draggable = true;
    const code = tr.dataset.code;

    tr.addEventListener('dragstart', (e) => {
      draggedCode = code;
      tr.style.opacity = '0.5';
      try{ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', code); }catch{}
    });

    tr.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      tr.style.borderTop = '2px solid rgba(143,160,133,0.8)';
    });

    tr.addEventListener('dragleave', () => {
      tr.style.borderTop = '';
    });

    tr.addEventListener('drop', async (e) => {
      e.preventDefault();
      tr.style.borderTop = '';
      const targetCode = tr.dataset.code;
      if (!draggedCode || draggedCode === targetCode) return;
      // compute new order
      const groupsAll = loanGroups();
      ensureLoanOrderIncludesAll(groupsAll);
      let currentOrder = loanOrder.slice();
      // remove dragged
      currentOrder = currentOrder.filter(c => c !== draggedCode);
      // insert before target
      const idx = currentOrder.indexOf(targetCode);
      if (idx === -1) currentOrder.push(draggedCode);
      else currentOrder.splice(idx, 0, draggedCode);
      await saveLoanOrder(currentOrder);
      renderLoan();
    });

    tr.addEventListener('dragend', () => {
      draggedCode = null;
      tr.style.opacity = '';
      document.querySelectorAll('#loanBody tr').forEach(r => r.style.borderTop = '');
    });
  });
}

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
    if (editing) return; // code stays fixed once created, so existing payments stay linked
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

  // frequency toggle
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
      code = editing.code; // keep the same code so existing payments stay linked
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

    // If new loan, add to loanOrder (front)
    if (!editing){
      loanOrder = loanOrder || [];
      loanOrder = [code, ...loanOrder.filter(c => c !== code)];
      await dbSetSetting('loanOrder', loanOrder);
    }

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

/* ---------------------------- Loan detail / schedule ------------------------ */
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
  // Start Payment Date anchors the schedule (falls back to the release date for older loans)
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
      <button type="button" class="btn" id="mClose2">Close</button>
    </div>
  `, true);

  document.getElementById('mClose').addEventListener('click', closeModal);
  document.getElementById('mClose2').addEventListener('click', closeModal);
  document.getElementById('btnEditLoan').addEventListener('click', () => { closeModal(); openLoanForm(g); });

  // --- FIX: Update only the row, don't destroy the modal ---
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
      
      // 1. Save / Delete in DB
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

      // 2. Reload data in memory
      await reload();
      
      // 3. Update only the visual state of this row (instead of recreating the whole modal)
      const allPayments = allTx.filter(t => t.transactionType === 'Loan Payment' && t.code === code);
      const paidLines = date ? allPayments.filter(p => p.date === date) : [];
      const isPaid = paidLines.some(p => p.category === 'Payment');
      const addAmt = paidLines.find(p => p.category === 'Additional Payment');
      
      // Update row styling and inputs
      row.classList.toggle('paid', isPaid);
      const chk = row.querySelector('.paidbox');
      const addInput = row.querySelector('.sadd input');
      chk.checked = isPaid;
      
      // Disable/enable flexible date and additional amount
      const sdateInput = row.querySelector('.sdate-input');
      if (sdateInput) sdateInput.disabled = isPaid;
      addInput.disabled = isPaid;
      addInput.value = addAmt ? fmtMoney(addAmt.amount) : '';
      
      // 4. Update the summary numbers in the modal
      const newPaid = loanPaid(code);
      const newBalance = total - newPaid;
      document.getElementById('paidToDateDisplay').innerHTML = `Paid to Date<b>${fmtMoney(newPaid)}</b>`;
      document.getElementById('balanceDisplay').innerHTML = `Balance<b>${fmtMoney(newBalance)}</b>`;
      
      // 5. Update the background table (behind the modal)
      renderLoan();
    });
  });
}

/* ------------------------------- Boot -------------------------------------- */
init();
