// ============================================================
//  ADMIN CONFIG — ĐỔI EMAIL NÀY THÀNH EMAIL ADMIN CỦA BẠN
// ============================================================
window.ADMIN_EMAIL = 'ongchuexcel@gmail.com'; // Admin cố định

// ============================================================
//  STATE & STORAGE
// ============================================================
// ============================================================
//  STATE
// ============================================================
let _guestUID = 'guest_' + (localStorage.getItem('lexon_guest_uid') || (() => { const id = 'g'+Date.now(); localStorage.setItem('lexon_guest_uid', id); return id; })());
function getUID() {
  const u = window._currentUser;
  if (u && u.uid) return u.uid;
  return _guestUID;
}
function isAdmin() {
  const u = window._currentUser;
  return u && u.email === window.ADMIN_EMAIL;
}
function isLoggedIn() {
  return !!(window._currentUser && window._currentUser.email);
}
let words = [];
let packs = [];
let currentPack = null;
let editingPackId = null;
let pendingImport = [];
let studyQueue = [];
let currentIndex = 0;
let isFlipped = false;
let correctStreak = 0;
let listFilter = 'all';

// ── LOOP SIZE ── (0 = tắt, 5-10 = bật)
let loopSize = parseInt(localStorage.getItem('lexon_loop_size') || '0');
// loopWindow: mảng chỉ số trong studyQueue đang trong vòng lặp
let loopWindow = [];
let loopWindowIndex = 0;


// ============================================================
//  FIREBASE HELPERS
// ============================================================
function userDoc() {
  return window._doc(window._db, 'users', getUID());
}
function packDoc(packId) {
  return window._doc(window._db, 'users', getUID(), 'packs', packId);
}

async function savePacks() {
  const now = Date.now();
  const packsToSave = packs.map(p => ({
    id: p.id,
    name: p.name,
    desc: p.desc || '',
    createdAt: p.createdAt || now,
    pinned: !!p.pinned,
    published: !!p.published,
    sortOrder: p.sortOrder ?? 9999,
    _wordCount: p._wordCount || 0,
    _masteredCount: p._masteredCount || 0,
  }));
  IDB.set('__packlist__', { packs: packsToSave, updatedAt: now }).catch(() => {});
  if (navigator.onLine) {
    window._setDoc(userDoc(), { packs: packsToSave, updatedAt: now }, { merge: true })
      .catch(e => console.warn('savePacks Firebase error:', e.message));
  }
}

async function loadPacks() {
  try {
    const cached = await IDB.get('__packlist__');
    if (cached && cached.packs?.length) return cached.packs;
  } catch(e) {}
  try {
    const snap = await window._getDoc(userDoc());
    if (snap.exists() && snap.data().packs) {
      const p = snap.data().packs;
      IDB.set('__packlist__', { packs: p, updatedAt: snap.data().updatedAt || Date.now() }).catch(() => {});
      return p;
    }
  } catch(e) { console.warn('loadPacks error:', e.message); }
  return [];
}

async function saveData() {
  if (!currentPack) return;
  const now = Date.now();
  const badge = document.getElementById('cloudBadge');

  // ── ADMIN PACK: lưu progress (mastered + hidden) ──
  if (currentPack._isAdminPack) {
    const prog = {}, hiddenMap = {};
    words.forEach(w => {
      if (w.mastered) prog[w.word] = true;
      if (w.hidden)   hiddenMap[w.word] = true;
    });
    const cached = await IDB.get('ap::' + currentPack.id).catch(() => null);
    if (cached) {
      await IDB.set('ap::' + currentPack.id, {
        ...cached,
        _progress: prog,
        _hidden: hiddenMap,
        _progressUpdatedAt: now
      }).catch(() => {});
    }
    if (badge) { badge.textContent = '📦 Đã lưu local'; badge.style.color = 'var(--neon-green)'; }
    if (navigator.onLine) {
      const progRef = window._doc(window._db, 'users', getUID(), 'adminProgress', currentPack.id);
      window._setDoc(progRef, { progress: prog, hidden: hiddenMap, updatedAt: now }, { merge: true })
        .then(() => { if (badge) { badge.textContent = '☁ Đã lưu'; badge.style.color = 'var(--neon-green)'; } })
        .catch(e => console.warn('saveAdminProgress error:', e.message));
    }
    return;
  }

  // ── OWN PACK: serialize rõ ràng tất cả fields kể cả hidden ──
  const wordsToSave = words.map(w => ({
    word: w.word || '',
    meaning: w.meaning || '',
    phonetics: w.phonetics || '',
    description: w.description || '',
    example: w.example || '',
    example_vi: w.example_vi || '',
    type: w.type || '',
    level: w.level || '',
    mastered: !!w.mastered,
    hidden: !!w.hidden,
    art_source:   w.art_source   || '',
    art_url:      w.art_url      || '',
    art_ctx_vi:   w.art_ctx_vi   || '',
    art_quote:    w.art_quote    || '',
    art_quote_vi: w.art_quote_vi || '',
  }));

  await IDB.set(currentPack.id, { words: wordsToSave, updatedAt: now }).catch(() => {});
  const p = packs.find(x => x.id === currentPack.id);
  if (p) {
    p._wordCount     = wordsToSave.filter(w => !w.hidden).length;
    p._masteredCount = wordsToSave.filter(w => w.mastered && !w.hidden).length;
  }
  if (badge) { badge.textContent = '📦 Đã lưu local'; badge.style.color = 'rgba(57,255,20,0.7)'; }

  if (navigator.onLine) {
    window._setDoc(packDoc(currentPack.id),
      { words: wordsToSave, name: currentPack.name, desc: currentPack.desc || '', updatedAt: now },
      { merge: true })
      .then(async () => {
        if (badge) { badge.textContent = '☁ Đã lưu'; badge.style.color = 'var(--neon-green)'; }
        const thisPack = packs.find(x => x.id === currentPack.id);
        if (isAdmin() && thisPack?.published) {
          await window._setDoc(window._doc(window._db, 'adminPacks', currentPack.id), {
            words: wordsToSave.map(w => ({ ...w, mastered: false, hidden: false })),
            wordCount: wordsToSave.length, updatedAt: now
          }, { merge: true }).catch(() => {});
          await _bumpAppVersion();
        }
      })
      .catch(e => {
        console.warn('saveData Firebase error:', e.message);
        if (badge) { badge.textContent = '📦 Local (chưa sync)'; badge.style.color = 'rgba(255,230,0,0.7)'; }
      });
  } else {
    if (badge) { badge.textContent = '📦 Offline'; badge.style.color = 'rgba(255,230,0,0.7)'; }
  }
}

async function loadData() {
  if (!currentPack) return false;

  // ── ADMIN PACK ──
  if (currentPack._isAdminPack) {
    const cached = await IDB.get('ap::' + currentPack.id).catch(() => null);
    if (cached && cached.words?.length) {
      const prog      = cached._progress || {};
      const hiddenMap = cached._hidden   || {};
      // Restore mastered + hidden từ IDB
      words = cached.words.map(w => ({ ...w, mastered: !!prog[w.word], hidden: !!hiddenMap[w.word] }));
      return true;
    }
    // Cache miss → load Firebase
    try {
      const packSnap = await window._getDoc(window._doc(window._db, 'adminPacks', currentPack.id));
      if (!packSnap.exists()) return false;
      const data      = packSnap.data();
      const packWords = data.words || [];
      const progSnap  = await window._getDoc(
        window._doc(window._db, 'users', getUID(), 'adminProgress', currentPack.id)
      ).catch(() => null);
      const prog      = progSnap?.exists() ? (progSnap.data().progress || {}) : {};
      const hiddenMap = progSnap?.exists() ? (progSnap.data().hidden   || {}) : {};
      await IDB.set('ap::' + currentPack.id, {
        words: packWords, updatedAt: data.updatedAt || Date.now(),
        _progress: prog, _hidden: hiddenMap
      }).catch(() => {});
      words = packWords.map(w => ({ ...w, mastered: !!prog[w.word], hidden: !!hiddenMap[w.word] }));
      return true;
    } catch(e) { console.warn('loadAdminPackData error:', e.message); return false; }
  }

  // ── OWN PACK ──
  const cached = await IDB.get(currentPack.id).catch(() => null);
  if (cached && cached.words?.length) {
    words = cached.words; // đã có mastered + hidden đầy đủ từ saveData
    const p = packs.find(x => x.id === currentPack.id);
    if (p) {
      p._wordCount     = words.filter(w => !w.hidden).length;
      p._masteredCount = words.filter(w => w.mastered && !w.hidden).length;
    }
    const badge = document.getElementById('cloudBadge');
    if (badge) { badge.innerHTML = '📦 <span style="color:var(--neon-green)">Local</span>'; badge.style.color='rgba(57,255,20,0.5)'; }
    return true;
  }
  // Cache miss → load Firebase
  try {
    const snap = await window._getDoc(packDoc(currentPack.id));
    if (snap.exists() && snap.data().words?.length) {
      const data = snap.data();
      words = data.words; // Firebase đã có mastered + hidden từ saveData mới
      await IDB.set(currentPack.id, { words, updatedAt: data.updatedAt || Date.now() }).catch(() => {});
      return true;
    }
  } catch(e) { console.warn('loadData error:', e.message); }
  return false;
}

// ============================================================
//  PACK SCREEN
// ============================================================
async function showPacksScreen() {
  statsStopSession();
  document.getElementById('screen-packs').classList.add('active');
  document.getElementById('screen-study').classList.remove('active');
  currentPack = null; words = [];
  if (!packs || !packs.length) packs = await loadPacks();
  refreshStatsBar();
  if (isLoggedIn()) {
    document.getElementById('mainNav').classList.add('visible');
    switchMainTab('packs');
  } else {
    renderPacksGrid();
  }
}

async function renderPacksGrid() {
  const grid = document.getElementById('packsGrid');
  grid.innerHTML = '';
  const icons = ['📘','📗','📙','📕','📒','📓','📔','📑'];

  // ── Sort helper: pinned nhóm riêng, trong nhóm sort theo sortOrder ──
  function sortBySortOrder(arr, pinnedKey) {
    return [...arr].sort((a, b) => {
      const pa = a[pinnedKey] ? 1 : 0;
      const pb = b[pinnedKey] ? 1 : 0;
      if (pa !== pb) return pb - pa; // pinned lên đầu
      const oa = a.sortOrder ?? 9999;
      const ob = b.sortOrder ?? 9999;
      return oa !== ob ? oa - ob : (a.name || '').localeCompare(b.name || '');
    });
  }

  if (isAdmin()) {
    // ── ADMIN: pack của mình, có input sortOrder ──
    const addCard = document.createElement('div');
    addCard.className = 'pack-add-card';
    addCard.innerHTML = '<div class="pack-add-icon">⊕</div><div class="pack-add-label">TẠO GÓI MỚI</div>';
    addCard.onclick = () => openPackModal();
    grid.appendChild(addCard);

    const sorted = sortBySortOrder(packs, 'pinned');
    sorted.forEach((pack, i) => {
      const total      = pack._wordCount     ?? 0;
      const mastered   = pack._masteredCount ?? 0;
      const pct        = total ? Math.round(mastered / total * 100) : 0;
      const isPublished = !!pack.published;
      const isPinned    = !!pack.pinned;
      const orderVal    = pack.sortOrder ?? '';
      const card = document.createElement('div');
      card.className = 'pack-card' + (isPinned ? ' pinned' : '');
      card.innerHTML = `
        <div class="pack-order-num">${orderVal !== '' && orderVal !== 9999 ? '#' + orderVal : '#—'}</div>
        <div class="pack-actions">
          <button class="pack-action-btn edit" onclick="editPack('${pack.id}',event)">✎</button>
          <button class="pack-action-btn" onclick="deletePack('${pack.id}',event)">✕</button>
        </div>
        <div class="pack-icon">${icons[i % icons.length]}</div>
        <div class="pack-name">${h(pack.name)}</div>
        <div class="pack-meta">${pack.desc ? h(pack.desc) + '<br>' : ''}${total} từ · ${mastered} đã thuộc</div>
        <div class="pack-progress-bar"><div class="pack-progress-fill" style="width:${pct}%"></div></div>
        
        <button class="btn-publish ${isPublished ? 'published' : ''}" onclick="togglePublish('${pack.id}',event)">
          ${isPublished ? '🌐 Đang public · Bấm để ẩn' : '📤 Publish cho học viên'}
        </button>
        <div class="pin-toggle-wrap${isPinned ? ' active' : ''}" onclick="event.stopPropagation()">
          <label class="pin-toggle">
            <input type="checkbox" ${isPinned ? 'checked' : ''} onchange="togglePin('${pack.id}',this)">
            <span class="pin-toggle-track"></span>
          </label>
          <span class="pin-toggle-label">PIN</span>
        </div>
        <div class="pack-sort-wrap" onclick="event.stopPropagation()">
          <span class="pack-sort-label">STT</span>
          <input class="pack-sort-input" type="number" min="1" max="9999"
            value="${orderVal !== '' && orderVal !== 9999 ? orderVal : ''}"
            placeholder="—"
            id="sort-input-${pack.id}">
          <button class="pack-sort-save" onclick="savePackSortOrder('${pack.id}',this)">Lưu</button>
        </div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pack-actions') || e.target.closest('.btn-publish') ||
            e.target.closest('.pin-toggle-wrap') || e.target.closest('.pack-sort-wrap')) return;
        openPack(pack);
      });
      grid.appendChild(card);
    });

  } else {
    // ── USER: pack admin (giáo trình) + pack riêng ──

    loadAdminPacks().then(async adminPacks => {
      if (!adminPacks.length) return;
      // (section label removed)

      for (let i = 0; i < adminPacks.length; i++) {
        const pack = adminPacks[i];
        let idbData = null;
        try { idbData = await IDB.get('ap::' + pack.id); } catch(e) {}
        pack._idbData = idbData;
        pack._pinned  = !!(idbData?._pinned);
      }

      // Sort theo sortOrder (field từ adminPack), trong nhóm pin/không-pin
      const sorted = sortBySortOrder(adminPacks, '_pinned');

      for (let i = 0; i < sorted.length; i++) {
        const pack    = sorted[i];
        const idbData = pack._idbData;
        const total   = idbData?.words?.length ?? (pack.wordCount || 0);
        const prog    = idbData?._progress || {};
        const mastered = idbData?.words ? idbData.words.filter(w => prog[w.word]).length : 0;
        const pct     = total ? Math.round(mastered / total * 100) : 0;
        const isPinned = !!(idbData?._pinned);
        const orderVal = pack.sortOrder ?? '';

        const card = document.createElement('div');
        card.className = 'pack-card shared-pack-card' + (isPinned ? ' pinned' : '');
        card.innerHTML = `
          <div class="pack-icon">${icons[i % icons.length]}</div>
          <div class="pack-name">${h(pack.name)}</div>
          <div class="pack-meta">${pack.desc ? h(pack.desc) + '<br>' : ''}${total} từ · ${mastered} đã thuộc</div>
          <div class="pack-progress-bar"><div class="pack-progress-fill" style="width:${pct}%"></div></div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
            
            
          </div>
          <div class="pin-toggle-wrap${isPinned ? ' active' : ''}" onclick="event.stopPropagation()">
            <label class="pin-toggle">
              <input type="checkbox" ${isPinned ? 'checked' : ''} onchange="toggleAdminPackPin('${pack.id}',this)">
              <span class="pin-toggle-track"></span>
            </label>
            <span class="pin-toggle-label">PIN</span>
          </div>
        `;
        card.addEventListener('click', (e) => {
          if (e.target.closest('.pin-toggle-wrap')) return;
          openAdminPack(pack);
        });
        grid.appendChild(card);
      }
    }).catch(() => {});

    // Pack riêng của user
    if (packs.length) {
      // (section label removed)
    }

    const addCard = document.createElement('div');
    addCard.className = 'pack-add-card';
    addCard.innerHTML = '<div class="pack-add-icon">⊕</div><div class="pack-add-label">TẠO GÓI MỚI</div>';
    addCard.onclick = () => openPackModal();
    grid.appendChild(addCard);

    const sortedPacks = sortBySortOrder(packs, 'pinned');
    sortedPacks.forEach((pack, i) => {
      const total    = pack._wordCount     ?? 0;
      const mastered = pack._masteredCount ?? 0;
      const pct      = total ? Math.round(mastered / total * 100) : 0;
      const isPinned = !!pack.pinned;
      const orderVal = pack.sortOrder ?? '';
      const card = document.createElement('div');
      card.className = 'pack-card' + (isPinned ? ' pinned' : '');
      card.innerHTML = `
        <div class="pack-actions">
          <button class="pack-action-btn edit" onclick="editPack('${pack.id}',event)">✎</button>
          <button class="pack-action-btn" onclick="deletePack('${pack.id}',event)">✕</button>
        </div>
        <div class="pack-icon">${icons[i % icons.length]}</div>
        <div class="pack-name">${h(pack.name)}</div>
        <div class="pack-meta">${pack.desc ? h(pack.desc) + '<br>' : ''}${total} từ · ${mastered} đã thuộc</div>
        <div class="pack-progress-bar"><div class="pack-progress-fill" style="width:${pct}%"></div></div>
        
        <div class="pin-toggle-wrap${isPinned ? ' active' : ''}" onclick="event.stopPropagation()">
          <label class="pin-toggle">
            <input type="checkbox" ${isPinned ? 'checked' : ''} onchange="togglePin('${pack.id}',this)">
            <span class="pin-toggle-track"></span>
          </label>
          <span class="pin-toggle-label">PIN</span>
        </div>
      `;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pack-actions') || e.target.closest('.pin-toggle-wrap')) return;
        openPack(pack);
      });
      grid.appendChild(card);
    });
  }
}

async function openPack(pack) {
  currentPack = pack;
  document.getElementById('studyPackName').textContent = pack.name;
  document.getElementById('screen-packs').classList.remove('active');
  document.getElementById('screen-study').classList.add('active');
  statsStartSession();
  xpRecordOpenPack(pack.id); // ✦ XP vào học
  switchTab('input');
  words = [];

  // Kiểm tra kết nối Firebase
  const badge = document.getElementById('cloudBadge');
  if (badge) { badge.textContent = '☁ Đang kết nối...'; badge.style.color = 'rgba(255,255,255,0.4)'; }

  const loaded = await loadData();
  if (loaded) {
    if (badge) { badge.textContent = '☁ Đã đồng bộ'; badge.style.color = 'var(--neon-cyan)'; }
  } else {
    if (badge) { badge.textContent = '☁ Chưa có dữ liệu'; badge.style.color = 'rgba(255,255,255,0.3)'; }
  }

  buildQueue(); renderList(); updateStudyBadge();
}

function updateStudyBadge() {
  const m = words.filter(w => w.mastered).length;
  document.getElementById('studyPackBadge').textContent = `${words.length} từ · ${m} đã thuộc`;
}

function backToPacks() { showPacksScreen(); }

// ============================================================
//  PACK MODAL
// ============================================================
function openPackModal(packId) {
  editingPackId = packId || null;
  document.getElementById('packModalTitle').textContent = packId ? '✎ Đổi tên gói' : '✦ Tạo gói từ vựng mới';
  document.getElementById('packNameInput').value = packId ? (packs.find(p=>p.id===packId)?.name||'') : '';
  document.getElementById('packDescInput').value = packId ? (packs.find(p=>p.id===packId)?.desc||'') : '';
  document.getElementById('packModal').classList.add('show');
  setTimeout(() => document.getElementById('packNameInput').focus(), 100);
}
function closePackModal() {
  document.getElementById('packModal').classList.remove('show');
  editingPackId = null;
}
async function savePackModal() {
  const name = document.getElementById('packNameInput').value.trim();
  if (!name) { showToast('error', '⚠ Vui lòng nhập tên gói!'); return; }
  const desc = document.getElementById('packDescInput').value.trim();
  if (editingPackId) {
    const p = packs.find(p => p.id === editingPackId);
    if (p) { p.name = name; p.desc = desc; }
  } else {
    packs.push({ id: 'pack_' + Date.now(), name, desc, createdAt: Date.now() });
  }
  await savePacks();
  closePackModal();
  renderPacksGrid();
  showToast('success', '✓ Đã lưu!');
}
function editPack(id, e) { e.stopPropagation(); openPackModal(id); }

async function togglePin(id, checkbox) {
  const p = packs.find(p => p.id === id);
  if (!p) return;
  p.pinned = checkbox.checked;
  // Update wrap class immediately for instant visual feedback
  const wrap = checkbox.closest('.pin-toggle-wrap');
  if (wrap) wrap.classList.toggle('active', p.pinned);
  await savePacks();
  renderPacksGrid();
  showToast('success', p.pinned ? '⭐ Đã ghim lên đầu' : '☆ Đã bỏ ghim');
}

async function toggleAdminPackPin(id, checkbox) {
  const isPinned = checkbox.checked;
  let idbData = null;
  try { idbData = await IDB.get('ap::' + id); } catch(e) {}
  if (!idbData) idbData = {};
  idbData._pinned = isPinned;
  try { await IDB.set('ap::' + id, idbData); } catch(e) {}
  // Sync pin lên Firestore để đồng bộ thiết bị khác
  if (navigator.onLine) {
    window._setDoc(
      window._doc(window._db, 'users', getUID(), 'adminPackPins', id),
      { pinned: isPinned, updatedAt: Date.now() },
      { merge: true }
    ).catch(() => {});
  }
  const wrap = checkbox.closest('.pin-toggle-wrap');
  if (wrap) wrap.classList.toggle('active', isPinned);
  renderPacksGrid();
  showToast('success', isPinned ? '⭐ Đã ghim lên đầu' : '☆ Đã bỏ ghim');
}
async function savePackSortOrder(packId, btn) {
  const input = document.getElementById('sort-input-' + packId);
  if (!input) return;
  const val = parseInt(input.value);
  if (isNaN(val) || val < 1) { showToast('error', '⚠ Nhập số từ 1 trở lên'); return; }

  const pack = packs.find(p => p.id === packId);
  if (!pack) return;
  pack.sortOrder = val;
  await savePacks();

  // Nếu pack đã publish → cập nhật sortOrder trên adminPacks để user thấy đúng thứ tự
  if (pack.published && navigator.onLine) {
    window._setDoc(
      window._doc(window._db, 'adminPacks', packId),
      { sortOrder: val, updatedAt: Date.now() },
      { merge: true }
    ).then(() => _bumpAppVersion()).catch(() => {});
  }

  // Feedback nút
  btn.textContent = '✓ Đã lưu';
  btn.classList.add('saved');
  setTimeout(() => { btn.textContent = 'Lưu'; btn.classList.remove('saved'); }, 1800);

  renderPacksGrid();
}

async function deletePack(id, e) {
  e.stopPropagation();
  const p = packs.find(p => p.id === id);
  if (!confirm(`Xóa gói "${p?.name}"? Toàn bộ từ vựng sẽ bị mất.`)) return;
  try { await window._deleteDoc(packDoc(id)); } catch(err) {}
  // Nếu admin đang xóa, xóa luôn adminPacks tương ứng nếu đã publish
  if (isAdmin() && p?.published) {
    try { await window._deleteDoc(window._doc(window._db, 'adminPacks', id)); } catch(err) {}
  }
  packs = packs.filter(p => p.id !== id);
  await savePacks();
  renderPacksGrid();
  showToast('success', '🗑 Đã xóa');
}
document.getElementById('packModal').addEventListener('click', e => { if (e.target.id==='packModal') closePackModal(); });
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('packNameInput').addEventListener('keydown', e => { if (e.key==='Enter') savePackModal(); });
});

// ============================================================
//  TABS
// ============================================================
function switchTab(tab) {
  ['input','flashcard','list','articles'].forEach((t,i) => {
    document.querySelectorAll('.tab-btn')[i].classList.toggle('active', t===tab);
    document.querySelectorAll('.panel')[i].classList.toggle('active', t===tab);
  });
  if (tab==='flashcard') renderFlashcard();
  if (tab==='list')      renderList();
  if (tab==='articles')  renderSavedArticles();
}

// ============================================================
//  EXCEL IMPORT
// ============================================================
function handleDragOver(e) { e.preventDefault(); document.getElementById('dropzone').classList.add('drag-over'); }
function handleDragLeave() { document.getElementById('dropzone').classList.remove('drag-over'); }
function handleDrop(e) {
  e.preventDefault(); handleDragLeave();
  const f = e.dataTransfer.files[0]; if(f) processExcelFile(f);
}
function handleFileSelect(e) {
  const f = e.target.files[0]; if(f) processExcelFile(f);
  e.target.value='';
}

function processExcelFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) { showToast('error','✕ Chỉ hỗ trợ .xlsx hoặc .xls'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), {type:'array'});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
      if (!rows || rows.length===0) { showToast('error','✕ File trống hoặc không đọc được.'); return; }

      // Column aliases (lowercase)
      const COL = {
        word:        ['word'],
        meaning:     ['nghĩa tiếng việt','meaning','nghia tieng viet','nghĩa','ngha tieng vit'],
        phonetics:   ['phonetics','phonetic','phiên âm','phien am'],
        description: ['description','descrition','mô tả','mo ta','desc','note'],
        example:     ['example','ví dụ','vi du'],
        example_vi:  ['example vi','ví dụ vi','vi du vi','example_vi','ví dụ tiếng việt','vi du tieng viet'],
        type:        ['type','loại từ','loai tu'],
        level:       ['level','cấp độ','cap do'],
        art_source:  ['article_source','nguồn báo','nguon bao','bài báo','bai bao'],
        art_url:     ['article_url','url','link'],
        art_ctx_vi:  ['article_context_vi','ngữ cảnh vi','ngu canh vi','context_vi'],
        art_quote:   ['article_quote','trích dẫn gốc','trich dan goc','trích dẫn','quote'],
        art_quote_vi:['article_quote_vi','dịch câu','dich cau','quote_vi'],
      };

      function getCol(row, aliases) {
        const keys = Object.keys(row).map(k => k.toLowerCase().trim());
        for (const a of aliases) {
          const i = keys.indexOf(a);
          if (i >= 0) return String(Object.values(row)[i]).trim();
        }
        return '';
      }

      const parsed = [];
      rows.forEach(row => {
        const word    = getCol(row, COL.word);
        const meaning = getCol(row, COL.meaning);
        if (!word || !meaning) return;
        parsed.push({
          word, meaning,
          phonetics:   getCol(row, COL.phonetics),
          description: getCol(row, COL.description),
          example:     getCol(row, COL.example),
          example_vi:  getCol(row, COL.example_vi),
          type:        getCol(row, COL.type),
          level:       getCol(row, COL.level),
          art_source:  getCol(row, COL.art_source),
          art_url:     getCol(row, COL.art_url),
          art_ctx_vi:  getCol(row, COL.art_ctx_vi),
          art_quote:   getCol(row, COL.art_quote),
          art_quote_vi:getCol(row, COL.art_quote_vi),
          mastered:    false,
        });
      });

      if (!parsed.length) { showToast('error','✕ Không tìm thấy cột "Word" và "Nghĩa tiếng Việt".'); return; }

      pendingImport = parsed.filter(p => !words.find(w => w.word.toLowerCase()===p.word.toLowerCase()));
      showImportModal(parsed.length, pendingImport.length);
    } catch(err) { showToast('error','✕ Lỗi đọc file: '+err.message); }
  };
  reader.readAsArrayBuffer(file);
}

function showImportModal(total, newCount) {
  document.getElementById('modalSub').innerHTML =
    `📊 Tổng: <strong style="color:#fff">${total}</strong> từ &nbsp;·&nbsp; `+
    `✨ Mới: <strong style="color:var(--neon-green)">${newCount}</strong> &nbsp;·&nbsp; `+
    `⊘ Trùng: <strong style="color:rgba(255,255,255,0.4)">${total-newCount}</strong>`;

  const list = document.getElementById('modalList');
  list.innerHTML = pendingImport.length ? pendingImport.map(w=>`
    <div class="modal-row">
      <div class="mw">${h(w.word)}</div>
      <div class="mm">${h(w.meaning)}${w.phonetics?` <span style="color:var(--neon-cyan);font-size:0.7rem">/${h(w.phonetics)}/</span>`:''}${w.type?` <span style="color:rgba(255,255,255,0.3);font-size:0.7rem">${h(w.type)}</span>`:''}</div>
      ${w.level?`<div class="mn">${h(w.level)}</div>`:''}
    </div>`).join('') :
    `<div style="padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-size:0.82rem">Không có từ mới nào.</div>`;

  document.getElementById('importModal').classList.add('show');
}

function confirmImport() {
  const n = pendingImport.length;
  words.push(...pendingImport);
  pendingImport = [];
  closeModal();
  const cb = document.getElementById('cloudBadge');
  if (cb) { cb.textContent = '☁ Đang lưu...'; cb.style.color = 'var(--neon-yellow)'; }
  saveData();
}

function closeModal() { document.getElementById('importModal').classList.remove('show'); pendingImport=[]; }

// ============================================================
//  TEXT IMPORT
// ============================================================
function importText() {
  const raw = document.getElementById('wordInput').value.trim();
  if (!raw) { showToast('error','✕ Ô nhập đang trống.'); return; }
  const added = [];
  raw.split('\n').filter(l=>l.trim()).forEach(line=>{
    const p = line.split('-').map(s=>s.trim());
    if (p.length<2||!p[0]||!p[1]) return;
    if (words.find(w=>w.word.toLowerCase()===p[0].toLowerCase())) return;
    added.push({word:p[0],meaning:p[1],phonetics:'',description:'',example:p[3]||'',type:p[2]||'',level:'',mastered:false});
  });
  if (!added.length) { showToast('error','✕ Không có từ mới (đã tồn tại hoặc sai định dạng).'); return; }
  words.push(...added);
  document.getElementById('wordInput').value='';
  saveData(); buildQueue();
  showToast('success',`✓ Đã thêm ${added.length} từ. Đang lưu lên Firebase...`);
}

function showToast(type, msg) {
  const t = document.getElementById('importToast');
  t.className = 'import-toast '+type;
  t.textContent = msg;
  clearTimeout(t._t);
  t._t = setTimeout(()=>{ t.className='import-toast'; }, 4200);
}

function clearAllData() {
  if (!confirm('Xóa toàn bộ từ vựng?\nHành động này không thể hoàn tác!')) return;
  words=[]; saveData(); buildQueue();
  showToast('success','✓ Đã xóa toàn bộ dữ liệu.');
}

let autoPlay = true;   // auto-speak when flashcard loads
let reversedMode = false; // show Vietnamese first
let fcLevelFilter = 'all'; // level filter for flashcard queue

// ============================================================
//  TEXT-TO-SPEECH ENGINE
//
//  Nguồn âm thanh theo thứ tự ưu tiên:
//  1. Google Translate TTS  — chuẩn, tự nhiên, miễn phí
//  2. Dictionary.com audio  — fallback thứ 2
//  3. Web Speech API        — fallback cuối (offline)
// ============================================================
let ttsAudio = null;

function initTTS() {
  // pre-create audio element
  ttsAudio = new Audio();
  ttsAudio.crossOrigin = 'anonymous';
}

// Tạo URL Google Translate TTS
function googleTTSUrl(word, lang) {
  // Dùng proxy translate.googleapis.com — không cần key, hoạt động trực tiếp
  const tl = lang === 'en-GB' ? 'en-gb' : 'en';
  return `https://translate.googleapis.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(word)}&tl=${tl}&total=1&idx=0&textlen=${word.length}&client=gtx&prev=input&ttsspeed=1`;
}

function speakWord(word, accent, btnId) {
  if (!word) return;

  // Dừng âm đang phát
  if (ttsAudio) { ttsAudio.pause(); ttsAudio.src = ''; }
  document.querySelectorAll('.fc-speak-btn,.speak-btn').forEach(b => b.classList.remove('playing'));

  const setPlaying = (on) => {
    if (!btnId) return;
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('playing', on);
  };

  // ── Thử Google Translate TTS ──
  const url = googleTTSUrl(word, accent);
  const audio = ttsAudio;
  audio.src = url;

  setPlaying(true);

  audio.onended = audio.onerror = (e) => {
    setPlaying(false);
    // Nếu Google TTS lỗi → fallback Web Speech API
    if (e.type === 'error') speakFallback(word, accent, btnId);
  };

  audio.play().catch(() => {
    setPlaying(false);
    speakFallback(word, accent, btnId);
  });
}

// Fallback: Web Speech API (offline, giọng hệ thống)
function speakFallback(word, accent, btnId) {
  if (!('speechSynthesis' in window)) return;
  const utt = new SpeechSynthesisUtterance(word);
  utt.lang  = accent === 'en-GB' ? 'en-GB' : 'en-US';
  utt.rate  = 0.88;

  const setPlaying = (on) => {
    if (!btnId) return;
    const btn = document.getElementById(btnId);
    if (btn) btn.classList.toggle('playing', on);
  };

  setPlaying(true);
  utt.onend = utt.onerror = () => setPlaying(false);
  speechSynthesis.cancel();
  speechSynthesis.speak(utt);
}

function autoSpeakCurrent() {
  if (!autoPlay) return;
  // Chế độ đảo ngược: mặt trước là tiếng Việt → KHÔNG đọc khi load thẻ mới
  if (reversedMode) return;
  const c = studyQueue[currentIndex];
  if (c) setTimeout(() => speakWord(c.word, 'en-US', 'btnUS'), 500);
}

// ============================================================
//  QUEUE
// ============================================================
function buildQueue() {
  let pool = words.filter(w => !w.mastered && !w.hidden);
  if (fcLevelFilter !== 'all') {
    if (fcLevelFilter === '__none__') pool = pool.filter(w => !w.level || !w.level.trim());
    else pool = pool.filter(w => (w.level||'').trim().toLowerCase() === fcLevelFilter.toLowerCase());
  }
  studyQueue = pool.map(w=>({...w}));
  for (let i=studyQueue.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [studyQueue[i],studyQueue[j]]=[studyQueue[j],studyQueue[i]]; }
  currentIndex=0; isFlipped=false; correctStreak=0;
  // Init loop window
  _initLoopWindow();
}

// ── LOOP WINDOW HELPERS ──
function _initLoopWindow() {
  if (!loopSize || studyQueue.length === 0) { loopWindow = []; loopWindowIndex = 0; return; }
  // Lấy min(loopSize, studyQueue.length) từ đầu queue
  loopWindow = studyQueue.slice(0, Math.min(loopSize, studyQueue.length)).map((_, i) => i);
  loopWindowIndex = 0;
  currentIndex = loopWindow[0];
}

function _loopNextCard() {
  if (!loopSize || !loopWindow.length) return false; // fallback to normal
  loopWindowIndex = (loopWindowIndex + 1) % loopWindow.length;
  currentIndex = loopWindow[loopWindowIndex];
  return true;
}

function _loopOnMastered(masteredQueueIdx) {
  if (!loopSize || !loopWindow.length) return;
  // Xóa từ đã thuộc khỏi loopWindow
  loopWindow = loopWindow.filter(i => i !== masteredQueueIdx);
  // Thêm từ tiếp theo vào loopWindow nếu có
  const nextIdx = loopSize + (studyQueue.length - studyQueue.filter((_, i) => loopWindow.includes(i) || i === masteredQueueIdx).length);
  // Cách đơn giản: tìm từ chưa có trong loopWindow, lấy cái đầu tiên sau max của loopWindow
  const inWindow = new Set(loopWindow);
  const candidates = studyQueue.map((_, i) => i).filter(i => !inWindow.has(i) && i !== masteredQueueIdx);
  if (candidates.length) {
    loopWindow.push(candidates[0]);
  }
  // Clamp loopWindowIndex
  if (loopWindow.length === 0) { loopWindowIndex = 0; return; }
  loopWindowIndex = loopWindowIndex % loopWindow.length;
  currentIndex = loopWindow[loopWindowIndex];
}

// ── SET LOOP SIZE (từ profile) ──
function setLoopSize(n) {
  loopSize = n;
  localStorage.setItem('lexon_loop_size', n);
  _updateLoopUI();
  // Rebuild queue với loop mode mới
  if (studyQueue.length) {
    if (loopSize) _initLoopWindow();
    else { currentIndex = 0; loopWindow = []; }
    const panel = document.getElementById('panel-flashcard');
    if (panel && panel.classList.contains('active')) renderFlashcard();
  }
}

function _updateLoopUI() {
  // Cập nhật buttons trong profile
  document.querySelectorAll('.loop-size-btn').forEach((btn, i) => {
    const val = i + 5;
    btn.classList.toggle('active', loopSize === val);
  });
  const offBtn = document.getElementById('loopOffBtn');
  if (offBtn) offBtn.classList.toggle('active', loopSize === 0);
  const badge = document.getElementById('loopStatusBadge');
  const badgeText = document.getElementById('loopStatusText');
  if (badge && badgeText) {
    if (loopSize > 0) {
      badge.style.display = 'inline-flex';
      badgeText.textContent = `Đang bật vòng ${loopSize} từ`;
    } else {
      badge.style.display = 'none';
    }
  }
}

// Gọi khi mở profile để sync UI
function _syncLoopUIOnOpen() { _updateLoopUI(); }




function renderFlashcard() {
  const el = document.getElementById('fc-content');
  if (!words.length) { el.innerHTML='<div class="warn-box">⚠ Chưa có từ vựng. Vào tab "Nhập Từ" để thêm!</div>'; return; }
  const rem = words.filter(w=>!w.mastered && !w.hidden);
  if (!rem.length) {
    el.innerHTML=`<div class="card celebration"><span class="celebration-icon">🎉</span><h2>Xuất Sắc!</h2><p>Bạn đã thuộc hết <strong style="color:var(--neon-green)">${words.length}</strong> từ vựng!</p><button class="btn-restart" onclick="resetMastered()">↺ Học Lại</button></div>`;
    return;
  }
  if (!studyQueue.length||currentIndex>=studyQueue.length) buildQueue();
  if (!studyQueue.length) {
    const levelOpts = [
      `<option value="all" ${fcLevelFilter==='all'?'selected':''}>Tất cả</option>`,
      ...[...new Set(words.filter(w=>w.level&&w.level.trim()).map(w=>w.level.trim()))].sort()
        .map(lv=>`<option value="${h(lv)}" ${fcLevelFilter===lv?'selected':''}>${h(lv)}</option>`),
      ...(words.some(w=>!w.level||!w.level.trim())?[`<option value="__none__" ${fcLevelFilter==='__none__'?'selected':''}>Chưa phân level</option>`]:[])
    ].join('');
    el.innerHTML = `
      <div class="fc-controls" style="margin-bottom:20px">
        <button class="dl-toggle-btn" onclick="dlOpen()">
          <span class="dl-toggle-dot"></span>DEEP LEARNING
        </button>
        <div class="autoplay-toggle">
          <label class="toggle-switch">
            <input type="checkbox" id="reversedToggle" ${reversedMode?'checked':''} onchange="reversedMode=this.checked;isFlipped=false;renderFlashcard()">
            <span class="toggle-track"></span>
          </label>
          <span class="toggle-label">🔄 Đảo ngược</span>
        </div>
        <div class="level-filter-wrap">
          <span class="level-filter-label">📚 Level</span>
          <select class="level-filter-select" onchange="fcLevelFilter=this.value;buildQueue();renderFlashcard()">${levelOpts}</select>
        </div>
      </div>
      <div class="warn-box" style="justify-content:center;flex-direction:column;gap:10px;text-align:center">
        <div>🎉 Đã thuộc hết từ ở level này!</div>
        <div style="font-size:0.75rem;opacity:0.7">Chọn level khác ở trên để tiếp tục học</div>
      </div>`;
    return;
  }
  const c = studyQueue[currentIndex];
  const m = words.filter(w=>w.mastered && !w.hidden).length;
  const total = words.filter(w=>!w.hidden).length;
  const prog = total ? Math.round((m/total)*100) : 0;

  el.innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><div class="stat-value">${studyQueue.length - currentIndex}</div><div class="stat-label">Còn lại</div></div>
      <div class="stat-card"><div class="stat-value">${m}</div><div class="stat-label">Đã thuộc</div></div>
      <div class="stat-card"><div class="stat-value">${correctStreak}</div><div class="stat-label">Streak 🔥</div></div>
    </div>
    ${loopSize && loopWindow.length ? `
    <div style="text-align:center;margin-bottom:10px">
      <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 16px;background:rgba(0,245,255,0.07);border:1px solid rgba(0,245,255,0.2);border-radius:20px;font-size:0.68rem;font-family:'Space Mono',monospace;color:var(--neon-cyan);letter-spacing:0.04em">
        <span style="opacity:0.6">🔁 Vòng</span>
        <span style="font-weight:700">${loopWindowIndex + 1} / ${loopWindow.length}</span>
        <span style="opacity:0.4">·</span>
        <span style="opacity:0.6">Tổng window: ${loopWindow.length} từ</span>
      </div>
    </div>` : ''}

    <div class="fc-controls">
      <div class="prog-wrap"><div class="prog-bar" style="width:${prog}%"></div></div>
      <button class="dl-toggle-btn" id="dlToggleBtn" onclick="dlOpen()">
        <span class="dl-toggle-dot"></span>DEEP LEARNING
      </button>
      <div class="autoplay-toggle">
        <label class="toggle-switch">
          <input type="checkbox" id="reversedToggle" ${reversedMode?'checked':''} onchange="reversedMode=this.checked;isFlipped=false;renderFlashcard()">
          <span class="toggle-track"></span>
        </label>
        <span class="toggle-label">🔄 Đảo ngược</span>
      </div>
      <div class="level-filter-wrap">
        <span class="level-filter-label">📚 Level</span>
        <select class="level-filter-select" onchange="fcLevelFilter=this.value;buildQueue();renderFlashcard()">
          <option value="all" ${fcLevelFilter==='all'?'selected':''}>Tất cả</option>
          ${[...new Set(words.filter(w=>w.level&&w.level.trim()).map(w=>w.level.trim()))].sort()
            .map(lv=>`<option value="${h(lv)}" ${fcLevelFilter===lv?'selected':''}>${h(lv)}</option>`).join('')}
          ${words.some(w=>!w.level||!w.level.trim())?`<option value="__none__" ${fcLevelFilter==='__none__'?'selected':''}>Chưa phân level</option>`:''}
        </select>
      </div>
    </div>
    <div class="fc-scene">
      <div class="flashcard" id="theCard" onclick="flipCard()">

        <div class="fc-face fc-front">
          <div class="fc-hint">${reversedMode ? 'Tiếng Việt – Nhấp để xem tiếng Anh ↕' : 'Nhấp để xem nghĩa ↕'}</div>
          ${reversedMode ? `
            <div class="fc-word">${h(c.meaning)}</div>
            ${c.description?`<div class="fc-desc">${h(c.description)}</div>`:''}
          ` : `
            <div class="fc-word">${h(c.word)}</div>
            ${c.phonetics?`<div class="fc-phonetic">/${h(c.phonetics)}/</div>`:''}
            ${c.type?`<div class="fc-type">${h(c.type)}</div>`:''}
            ${c.level?`<div class="fc-level">${h(c.level)}</div>`:''}
            <div class="fc-speak-row" onclick="event.stopPropagation()">
              <button class="fc-speak-btn fc-speak-us" id="btnUS" onclick="speakWord('${c.word.replace(/'/g,"\\'")}','en-US','btnUS')">🔊 US</button>
              <button class="fc-speak-btn fc-speak-uk" id="btnUK" onclick="speakWord('${c.word.replace(/'/g,"\\'")}','en-GB','btnUK')">🔊 UK</button>
              <a class="fc-cambridge-link" href="https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(c.word)}" target="_blank" onclick="event.stopPropagation()">📖 Cambridge</a>
            </div>
          `}
          ${c.example?`<div class="fc-example" style="margin-top:6px" onclick="event.stopPropagation()">🗣 ${h(c.example)}</div>`:''}
          <button class="fc-art-btn" onclick="openArtDrawer(studyQueue[currentIndex]);event.stopPropagation()">📰 xem ngữ cảnh báo chí →</button>
          <button class="fc-root-btn" onclick="openRootWord(studyQueue[currentIndex]);event.stopPropagation()">🌱 Root word →</button>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-hint">${reversedMode ? 'Tiếng Anh' : 'Nghĩa tiếng Việt'}</div>
          ${reversedMode ? `
            <div class="fc-word">${h(c.word)}</div>
            ${c.phonetics?`<div class="fc-phonetic">/${h(c.phonetics)}/</div>`:''}
            ${c.type?`<div class="fc-type">${h(c.type)}</div>`:''}
            ${c.level?`<div class="fc-level">${h(c.level)}</div>`:''}
            <div class="fc-speak-row" onclick="event.stopPropagation()">
              <button class="fc-speak-btn fc-speak-us" id="btnUS2" onclick="speakWord('${c.word.replace(/'/g,"\\'")}','en-US','btnUS2')">🔊 US</button>
              <button class="fc-speak-btn fc-speak-uk" id="btnUK2" onclick="speakWord('${c.word.replace(/'/g,"\\'")}','en-GB','btnUK2')">🔊 UK</button>
              <a class="fc-cambridge-link" href="https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(c.word)}" target="_blank" onclick="event.stopPropagation()">📖 Cambridge</a>
            </div>
          ` : `
            <div class="fc-word">${h(c.meaning)}</div>
            ${c.description?`<div class="fc-desc">${h(c.description)}</div>`:''}
            <div style="margin-top:8px;font-size:0.8rem;color:rgba(255,255,255,0.38)">${h(c.word)}${c.phonetics?` &nbsp;<span style="color:var(--neon-cyan)">/${h(c.phonetics)}/</span>`:''}</div>
            <div class="fc-speak-row" onclick="event.stopPropagation()">
              <button class="fc-speak-btn fc-speak-us" id="btnUS2" onclick="speakWord('${c.word.replace(/'/g,"\\'")}','en-US','btnUS2')">🔊 US</button>
              <button class="fc-speak-btn fc-speak-uk" id="btnUK2" onclick="speakWord('${c.word.replace(/'/g,"\\'")}','en-GB','btnUK2')">🔊 UK</button>
            </div>
          `}
          ${reversedMode
            ? (c.example    ? `<div class="fc-example" style="margin-top:6px" onclick="event.stopPropagation()">🗣 ${h(c.example)}</div>` : '')
            : (c.example_vi ? `<div class="fc-example" style="margin-top:6px" onclick="event.stopPropagation()">🗣 ${h(c.example_vi)}</div>`
               : c.example  ? `<div class="fc-example" style="margin-top:6px" onclick="event.stopPropagation()">🗣 ${h(c.example)}</div>` : '')
          }
          <button class="fc-art-btn" onclick="openArtDrawer(studyQueue[currentIndex]);event.stopPropagation()">📰 xem ngữ cảnh báo chí →</button>
          <button class="fc-root-btn" onclick="openRootWord(studyQueue[currentIndex]);event.stopPropagation()">🌱 Root word →</button>
        </div>
        <!-- Sizer: đẩy chiều cao theo nội dung thực của mặt front -->
        <div class="fc-sizer" aria-hidden="true">
          <div class="fc-hint" style="opacity:0">_</div>
          <div class="fc-word" style="background:none;-webkit-text-fill-color:transparent">${reversedMode ? h(c.meaning) : h(c.word)}</div>
          ${c.phonetics ? `<div class="fc-phonetic" style="opacity:0">_</div>` : ''}
          ${c.type      ? `<div class="fc-type"     style="opacity:0">_</div>` : ''}
          ${c.level     ? `<div class="fc-level"    style="opacity:0">_</div>` : ''}
          <div class="fc-speak-row" style="opacity:0"><button class="fc-speak-btn fc-speak-us">🔊 US</button><button class="fc-speak-btn fc-speak-uk">🔊 UK</button></div>
          ${c.example   ? `<div class="fc-example"  style="opacity:0">🗣 ${h(c.example)}</div>` : ''}
          <button class="fc-art-btn" style="opacity:0">📰 xem ngữ cảnh báo chí →</button>
        </div>
      </div>
    </div>
    <div class="action-row-v2">
      <button class="btn-nav-arrow btn-nav-prev" onclick="prevCard()" ${(!loopSize && currentIndex===0)?'disabled':''} title="Quay lại (←)">
        <span class="nav-arrow-icon">←</span>
        <span class="nav-arrow-label">Quay lại</span>
      </button>
      <button class="btn btn-mastered" onclick="markMastered()">✓ Đã Thuộc!</button>
      <button class="btn-nav-arrow btn-nav-next" onclick="skipWord()" title="Bỏ qua (→)">
        <span class="nav-arrow-icon">→</span>
        <span class="nav-arrow-label">Bỏ qua</span>
      </button>
    </div>
    <button class="btn-luyen-tap" onclick="openLuyenTap()">
      <span class="lt-icon">⚡</span>
      <div>
        <span class="lt-label">Luyện tập cùng AI</span>
      </div>
    </button>
    <div class="arrow-nav-hint-row">
      <span class="arrow-nav-hint">Phím ← → &nbsp;·&nbsp; Vuốt trái/phải &nbsp;·&nbsp; Space lật</span>
    </div>
  `;

  isFlipped=false;
  autoSpeakCurrent();
  // Auto-scale fc-word nếu text quá dài
  setTimeout(() => {
    document.querySelectorAll('.fc-word').forEach(el => {
      const len = el.textContent.trim().length;
      if (len > 30) el.style.fontSize = 'clamp(0.9rem, 3.5vw, 1.4rem)';
      else if (len > 20) el.style.fontSize = 'clamp(1rem, 4vw, 1.8rem)';
      else if (len > 12) el.style.fontSize = 'clamp(1.2rem, 4.5vw, 2.1rem)';
      else el.style.fontSize = '';
    });
  }, 30);
}

function flipCard() {
  const c=document.getElementById('theCard'); if(!c)return;
  const wasFlipped = isFlipped;
  isFlipped=!isFlipped;
  c.classList.toggle('flipped',isFlipped);
  if (!wasFlipped) { statsRecordFlip(); }
  xpOnFlashcardAction(); // ✦ XP active time

  // Chế độ đảo ngược: đọc từ khi lật sang mặt tiếng Anh (isFlipped = true)
  if (reversedMode && autoPlay && isFlipped) {
    const cur = studyQueue[currentIndex];
    if (cur) setTimeout(() => speakWord(cur.word, 'en-US', 'btnUS2'), 300);
  }
}

function handleKey(e) {
  if(e.key==='ArrowRight'){ e.preventDefault(); skipWord(); }
  if(e.key==='ArrowLeft'){  e.preventDefault(); prevCard(); }
  if(e.key===' '){ e.preventDefault(); flipCard(); }
}

// Global arrow key support (when typing input is not focused)
document.addEventListener('keydown', function(e) {
  const activeEl = document.activeElement;
  const isTyping = activeEl && (activeEl.tagName==='INPUT'||activeEl.tagName==='TEXTAREA');
  const isFlashcardPanel = document.getElementById('panel-flashcard')?.classList.contains('active');
  if (!isFlashcardPanel) return;
  if (isTyping) return; // let handleKey deal with it
  if(e.key==='ArrowRight'){ e.preventDefault(); skipWord(); }
  if(e.key==='ArrowLeft'){  e.preventDefault(); prevCard(); }
  if(e.key===' '||e.key==='ArrowUp'||e.key==='ArrowDown'){ e.preventDefault(); flipCard(); }
});

// ── SWIPE SUPPORT (mobile) ──
(function() {
  let swipeStartX = 0, swipeStartY = 0, swipeStartTime = 0;
  const MIN_SWIPE = 50, MAX_VERTICAL_RATIO = 0.7, MAX_TIME = 400;

  document.addEventListener('touchstart', function(e) {
    const t = e.touches[0];
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    swipeStartTime = Date.now();
  }, { passive: true });

  document.addEventListener('touchend', function(e) {
    const isFlashcardPanel = document.getElementById('panel-flashcard')?.classList.contains('active');
    if (!isFlashcardPanel) return;
    // Ignore if overlay is open
    if (document.querySelector('.art-overlay.open')) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    const dt = Date.now() - swipeStartTime;
    if (dt > MAX_TIME) return;
    if (Math.abs(dx) < MIN_SWIPE) return;
    if (Math.abs(dy) / Math.abs(dx) > MAX_VERTICAL_RATIO) return;
    if (dx < 0) {
      skipWord();
    } else {
      prevCard();
    }
  }, { passive: true });
})();

function skipWord()    { correctStreak=0; xpOnFlashcardAction(); nextCard(); } // ✦ XP
function nextCard() {
  if (loopSize && loopWindow.length) {
    // Loop mode: xoay vòng trong window
    loopWindowIndex = (loopWindowIndex + 1) % loopWindow.length;
    currentIndex = loopWindow[loopWindowIndex];
  } else {
    currentIndex++;
    if(currentIndex>=studyQueue.length) buildQueue();
  }
  isFlipped=false; renderFlashcard();
}
function prevCard() {
  if (loopSize && loopWindow.length) {
    loopWindowIndex = (loopWindowIndex - 1 + loopWindow.length) % loopWindow.length;
    currentIndex = loopWindow[loopWindowIndex];
    isFlipped=false; renderFlashcard();
  } else {
    if(currentIndex>0){ currentIndex--; isFlipped=false; renderFlashcard(); }
  }
}

function markMastered() {
  if(!studyQueue[currentIndex])return;
  const w=studyQueue[currentIndex].word;
  const i=words.findIndex(x=>x.word===w);
  if(i>=0){words[i].mastered=true; saveData(); recordStudyActivity(1); refreshStatsBar(); challengeRecordStudyDay();}
  // ✦ XP
  const masteredBtn = document.querySelector('.btn-mastered');
  xpOnMastered(masteredBtn);

  const masteredIdx = currentIndex;
  studyQueue.splice(currentIndex,1);

  if (loopSize && loopWindow.length) {
    // Update loopWindow: xóa idx cũ, thêm từ mới vào nếu có
    // Sau splice, các idx > masteredIdx giảm đi 1
    loopWindow = loopWindow
      .filter(idx => idx !== masteredIdx)
      .map(idx => idx > masteredIdx ? idx - 1 : idx);
    // Thêm từ tiếp theo chưa có trong window
    const inWindow = new Set(loopWindow);
    const candidates = studyQueue.map((_, i) => i).filter(i => !inWindow.has(i));
    if (candidates.length) loopWindow.push(candidates[0]);
    if (loopWindow.length === 0) { buildQueue(); return; }
    loopWindowIndex = loopWindowIndex % loopWindow.length;
    currentIndex = loopWindow[loopWindowIndex];
  } else {
    if(currentIndex>=studyQueue.length) currentIndex=0;
    if(!studyQueue.length) buildQueue();
  }
  isFlipped=false; renderFlashcard(); updateStudyBadge();
}

function resetMastered() { words.forEach(w=>w.mastered=false); saveData(); buildQueue(); renderFlashcard(); updateStudyBadge(); }

// ============================================================
//  LIST
// ============================================================
function setFilter(f,btn) {
  listFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

function renderList() {
  const tbody=document.getElementById('wordTableBody');
  const emptyEl=document.getElementById('listEmpty');
  if(!tbody)return;
  const visible = words.filter(w=>!w.hidden);
  document.getElementById('totalCount').textContent = visible.length;
  document.getElementById('masteredCount').textContent = visible.filter(w=>w.mastered).length;

  let filtered;
  if(listFilter==='mastered')  filtered = words.filter(w=>w.mastered && !w.hidden);
  else if(listFilter==='learning') filtered = words.filter(w=>!w.mastered && !w.hidden);
  else if(listFilter==='hidden')   filtered = words.filter(w=>w.hidden);
  else filtered = words; // 'all' = tất cả kể cả hidden (mờ đi)

  if(!filtered.length){tbody.innerHTML='';emptyEl.style.display='block';return;}
  emptyEl.style.display='none';
  tbody.innerHTML=filtered.map(w=>{
    const ri=words.indexOf(w);
    const lv=(w.level||'').trim().toLowerCase().replace(/\s/g,'');
    const hiddenStyle = w.hidden ? 'opacity:0.3;' : '';
    const hideIcon = w.hidden ? '👁' : '🚫';
    const hideTitle = w.hidden ? 'Hiện lại từ này' : 'Ẩn từ này khỏi danh sách học';
    return `<tr style="${hiddenStyle}">
      <td style="color:rgba(255,255,255,0.2);font-size:0.7rem">${ri+1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:7px">
          <div>
            <div class="td-word" style="${w.hidden?'text-decoration:line-through;':''}">${h(w.word)}</div>
            ${w.phonetics?`<div class="td-phonetic">/${h(w.phonetics)}/</div>`:''}
          </div>
          ${!w.hidden?`<button class="speak-btn" onclick="speakWord('${w.word.replace(/'/g,"\\'")}','en-US',null)" title="Phát âm US">🔊</button>`:''}
        </div>
      </td>
      <td class="td-meaning">${h(w.meaning)}${w.type?` <span style="color:rgba(255,255,255,0.3);font-size:0.7rem">${h(w.type)}</span>`:''}</td>
      <td style="text-align:center">${lv?`<span class="lv lv-${lv}">${h(w.level)}</span>`:''}</td>
      <td style="text-align:center">${w.mastered?'<span style="color:var(--neon-green)">✓</span>':'<span style="color:rgba(255,255,255,0.15)">·</span>'}</td>
      <td style="text-align:center"><button class="btn-hide-word" onclick="toggleHideWord(${ri})" title="${hideTitle}">${hideIcon}</button></td>
      <td><button class="chip-remove" onclick="removeWord(${ri})">✕</button></td>
    </tr>`;
  }).join('');
}

function removeWord(idx) {
  const word=words[idx]?.word; if(!word)return;
  if(!confirm(`Xóa từ "${word}"?`))return;
  words.splice(idx,1); saveData(); buildQueue(); renderList(); updateStudyBadge();
}

function toggleHideWord(idx) {
  if(!words[idx])return;
  words[idx].hidden = !words[idx].hidden;
  if(words[idx].hidden) words[idx].mastered = false; // reset mastered khi ẩn
  saveData(); buildQueue(); renderList(); updateStudyBadge();
}

function copyLearningWords() {
  const learning = words.filter(w => !w.mastered && !w.hidden).map(w => w.word);
  if(!learning.length){ showToast('error','⚠ Không có từ nào đang học.'); return; }
  navigator.clipboard.writeText(learning.join('\n')).then(() => {
    const btn = document.getElementById('btnCopyWords');
    if(btn){ btn.classList.add('copied'); btn.textContent='✓ Đã copy '+learning.length+' từ'; }
    setTimeout(()=>{ if(btn){ btn.classList.remove('copied'); btn.innerHTML='⎘ Copy từ đang học'; } }, 2500);
  }).catch(()=> showToast('error','✕ Không copy được, trình duyệt không hỗ trợ.'));
}

// ============================================================
//  UTIL
// ============================================================
function h(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================
//  AUTH & ACCESS CONTROL
// ============================================================
async function checkAccess(user) {
  // Admin luôn có quyền
  if (user.email === window.ADMIN_EMAIL) return 'approved';
  try {
    const snap = await window._getDoc(window._doc(window._db, 'users', user.uid));
    if (snap.exists()) {
      return snap.data().accessStatus || 'pending';
    }
  } catch(e) {}
  return 'pending';
}

async function signInWithGoogle() {
  const msgEl = document.getElementById('loginStatusMsg');
  if (msgEl) { msgEl.textContent = '⟳ Đang đăng nhập...'; msgEl.style.color = 'rgba(255,255,255,0.4)'; }
  try {
    const provider = new window._GoogleAuthProvider();
    await window._signInWithPopup(window._auth, provider);
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      if (msgEl) { msgEl.textContent = '✕ Đăng nhập thất bại: ' + e.message; msgEl.style.color = 'var(--neon-pink)'; }
    } else {
      if (msgEl) { msgEl.textContent = ''; }
    }
  }
}

// ── SYNC THỦ CÔNG ──
async function _setSyncBtns(loading) {
  const up = document.getElementById('syncUpBtn');
  const dn = document.getElementById('syncDownBtn');
  if (up) { up.disabled = loading; up.querySelector('span:last-child').textContent = loading ? '⟳ Đang tải...' : 'Tải lên cloud'; }
  if (dn) { dn.disabled = loading; dn.querySelector('span:last-child').textContent = loading ? '⟳ Đang tải...' : 'Tải cloud xuống'; }
}

async function manualPush() {
  if (!isLoggedIn()) { showToast('error','⚠ Chưa đăng nhập'); return; }
  if (!navigator.onLine) { showToast('error','⚠ Không có mạng'); return; }
  await _setSyncBtns(true);
  try {
    const now = Date.now();

    // 1. Words từng own pack — tính lại counts từ IDB thực tế
    const packsToSave = [];
    for (const pack of packs) {
      const cached = await IDB.get(pack.id).catch(() => null);
      const ws = cached?.words || [];
      // Tính lại từ words thực tế, không dùng metadata cũ
      const wordCount     = ws.filter(w => !w.hidden).length;
      const masteredCount = ws.filter(w => w.mastered && !w.hidden).length;
      packsToSave.push({
        id: pack.id, name: pack.name, desc: pack.desc||'',
        createdAt: pack.createdAt || now,
        pinned: !!pack.pinned, published: !!pack.published,
        _wordCount: wordCount,
        _masteredCount: masteredCount,
      });
      if (ws.length) {
        await window._setDoc(packDoc(pack.id),
          { words: ws, name: pack.name, desc: pack.desc||'', updatedAt: now },
          { merge: true });
      }
    }

    // 2. Pack metadata với counts đã tính lại
    await window._setDoc(userDoc(), { packs: packsToSave, updatedAt: now }, { merge: true });
    packs = packsToSave; // cập nhật local luôn

    // 3. Progress admin packs (mastered + hidden)
    const allKeys = await IDB.getAllKeys().catch(() => []);
    for (const key of allKeys) {
      if (!key.startsWith('ap::')) continue;
      const cached = await IDB.get(key).catch(() => null);
      if (!cached) continue;
      const packId = key.replace('ap::', '');
      if (cached._progress !== undefined || cached._hidden !== undefined) {
        await window._setDoc(
          window._doc(window._db, 'users', getUID(), 'adminProgress', packId),
          { progress: cached._progress||{}, hidden: cached._hidden||{}, updatedAt: now },
          { merge: true });
      }
      if (cached._pinned !== undefined) {
        await window._setDoc(
          window._doc(window._db, 'users', getUID(), 'adminPackPins', packId),
          { pinned: !!cached._pinned, updatedAt: now },
          { merge: true });
      }
    }
    showToast('success', '☁ Đã tải lên cloud thành công!');
  } catch(e) {
    showToast('error', '✕ Lỗi: ' + e.message);
  } finally { await _setSyncBtns(false); }
}

async function manualPull() {
  if (!isLoggedIn()) { showToast('error','⚠ Chưa đăng nhập'); return; }
  if (!navigator.onLine) { showToast('error','⚠ Không có mạng'); return; }
  if (!confirm('Tải dữ liệu từ cloud về sẽ ghi đè trạng thái hiện tại trên máy này. Tiếp tục?')) return;
  await _setSyncBtns(true);
  try {
    const now = Date.now();

    // 1. Pack metadata (pinned, name...)
    const userSnap = await window._getDoc(userDoc());
    if (!userSnap.exists()) { showToast('error','⚠ Không có dữ liệu trên cloud'); return; }
    const remotePacks = userSnap.data().packs || [];

    // 2. Words từng own pack — ghi đè IDB hoàn toàn, tính lại counts
    for (const pack of remotePacks) {
      const snap = await window._getDoc(packDoc(pack.id)).catch(() => null);
      if (snap?.exists() && snap.data().words?.length) {
        const remoteWords = snap.data().words;
        // Ghi đè IDB — không merge, không giữ local cũ
        await IDB.set(pack.id, { words: remoteWords, updatedAt: snap.data().updatedAt || now });
        // Tính lại count từ words thực tế (không dùng metadata cũ)
        pack._wordCount     = remoteWords.filter(w => !w.hidden).length;
        pack._masteredCount = remoteWords.filter(w => w.mastered && !w.hidden).length;
      }
    }

    // Lưu packlist với counts đã tính lại
    await IDB.set('__packlist__', { packs: remotePacks, updatedAt: now });
    packs = remotePacks;

    // 3. Progress admin packs (mastered + hidden) — ghi đè dù IDB có hay không
    const progSnaps = await window._getDocs(
      window._collection(window._db, 'users', getUID(), 'adminProgress')
    ).catch(() => null);
    if (progSnaps) {
      for (const doc of progSnaps.docs) {
        // Lấy IDB hiện tại để giữ words cache, chỉ ghi đè progress
        let cached = await IDB.get('ap::' + doc.id).catch(() => null);
        if (!cached) cached = {}; // Không có cache vẫn phải ghi progress
        await IDB.set('ap::' + doc.id, {
          ...cached,
          _progress: doc.data().progress || {},
          _hidden:   doc.data().hidden   || {},
          _progressUpdatedAt: doc.data().updatedAt || now
        });
      }
    }

    // 4. Admin pack pins — ghi đè dù IDB có hay không
    const pinSnaps = await window._getDocs(
      window._collection(window._db, 'users', getUID(), 'adminPackPins')
    ).catch(() => null);
    if (pinSnaps) {
      for (const doc of pinSnaps.docs) {
        let cached = await IDB.get('ap::' + doc.id).catch(() => null);
        if (!cached) cached = {};
        await IDB.set('ap::' + doc.id, { ...cached, _pinned: !!doc.data().pinned });
      }
    }

    renderPacksGrid();
    showToast('success', '⬇ Đã tải dữ liệu mới nhất từ cloud!');
  } catch(e) {
    showToast('error', '✕ Lỗi: ' + e.message);
  } finally { await _setSyncBtns(false); }
}

async function handleSignOut() {
  if (!confirm('Đăng xuất khỏi LEXON?')) return;
  closeProfile();
  await window._signOut(window._auth);
}

function showAccessDenied(user) {
  document.getElementById('loginOverlay').classList.remove('show');
  document.getElementById('accessDeniedOverlay').classList.add('show');
  document.getElementById('accessDeniedBox').innerHTML = `
    <div class="access-denied-box">
      <span class="access-denied-icon">🚫</span>
      <div class="access-denied-title">Truy cập bị từ chối</div>
      <div class="access-denied-email">${h(user.email)}</div>
      <div class="access-denied-msg">Tài khoản của bạn chưa được cấp quyền truy cập LEXON.<br>Vui lòng liên hệ admin để được kích hoạt.</div>
      <button class="btn-signout" style="width:100%;justify-content:center" onclick="handleSignOut()">⊖ Đăng xuất & thử tài khoản khác</button>
    </div>`;
}

function showAccessPending(user) {
  document.getElementById('loginOverlay').classList.remove('show');
  document.getElementById('accessDeniedOverlay').classList.add('show');
  document.getElementById('accessDeniedBox').innerHTML = `
    <div class="access-pending-box">
      <span class="access-denied-icon">⏳</span>
      <div class="access-pending-title">Chờ duyệt tài khoản</div>
      <div class="access-denied-email">${h(user.email)}</div>
      <div class="access-pending-msg">Tài khoản của bạn đã được ghi nhận và đang chờ admin phê duyệt.<br><br>Sau khi được duyệt, hãy đăng xuất rồi đăng nhập lại.</div>
      <button class="btn-signout" style="width:100%;justify-content:center" onclick="handleSignOut()">⊖ Đăng xuất</button>
    </div>`;
}

// Cập nhật giao diện auth bar
function updateAuthBar() {
  const bar = document.getElementById('authBar');
  const u = window._currentUser;

  if (u && u.email) {
    const initials = (u.displayName || u.email).charAt(0).toUpperCase();
    const avatarHTML = u.photoURL
      ? `<img src="${u.photoURL}" class="auth-avatar" alt="avatar" referrerpolicy="no-referrer">`
      : `<div class="auth-avatar-placeholder">${initials}</div>`;

    const adminBadge = isAdmin()
      ? `<span class="auth-badge-admin">⬡ Admin</span>`
      : '';

    bar.innerHTML = `
      ${isAdmin() ? `<button class="admin-btn-admin" onclick="openAdminPanel()">⬡ Admin Panel</button>` : ''}
      <div class="auth-user-chip" onclick="openProfile()">
        ${avatarHTML}
        <span class="auth-name">${h(u.displayName || u.email.split('@')[0])}</span>
        ${adminBadge}
      </div>
    `;
  } else {
    bar.innerHTML = `
      <button class="btn-google" onclick="signInWithGoogle()" id="loginBtn">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
        Đăng nhập
      </button>
    `;
  }
}

// ============================================================
//  PROFILE PANEL
// ============================================================
async function openProfile() {
  const u = window._currentUser;
  if (!u || !u.email) return;

  // Avatar
  const initials = (u.displayName || u.email).charAt(0).toUpperCase();
  document.getElementById('profileBigAvatar').innerHTML = u.photoURL
    ? `<img src="${u.photoURL}" class="profile-big-avatar" referrerpolicy="no-referrer">`
    : `<div class="profile-big-avatar-placeholder">${initials}</div>`;

  document.getElementById('profileName').textContent = u.displayName || u.email.split('@')[0];
  document.getElementById('profileEmail').textContent = u.email;

  document.getElementById('profileOverlay').classList.add('show');
  _syncLoopUIOnOpen();
  _syncReviewModeUI();

  try {
    const snap = await window._getDoc(userDoc());
    const data = snap.exists() ? snap.data() : {};

    // Streak & history
    const history = data.studyHistory || {};
    const histDays = Object.keys(history).sort().reverse();

    // Calculate streak
    let streak = 0;
    const today = new Date().toISOString().slice(0,10);
    let checkDay = new Date();
    while (true) {
      const dayStr = checkDay.toISOString().slice(0,10);
      if (history[dayStr]) { streak++; checkDay.setDate(checkDay.getDate()-1); }
      else break;
    }
    document.getElementById('streakCount').textContent = streak;

    // History list
    const histEl = document.getElementById('profileHistory');
    const recent = histDays.slice(0,5);
    if (recent.length) {
      histEl.innerHTML = recent.map(d => `
        <div class="profile-hist-row">
          <span class="profile-hist-date">${d}</span>
          <span class="profile-hist-val">${history[d]} từ đã học</span>
        </div>`).join('');
    } else {
      histEl.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:0.75rem;padding:8px 10px">Chưa có lịch sử học tập.</div>';
    }
  } catch(e) { console.warn('profile load error', e); }
}

function closeProfile(e) {
  if (!e || e.target === document.getElementById('profileOverlay')) {
    document.getElementById('profileOverlay').classList.remove('show');
  }
}

// Ghi lại hoạt động học trong ngày
async function recordStudyActivity(wordCount) {
  if (!isLoggedIn()) return;
  try {
    const today = new Date().toISOString().slice(0,10);
    const snap = await window._getDoc(userDoc());
    const existing = snap.exists() ? (snap.data().studyHistory || {}) : {};
    existing[today] = (existing[today] || 0) + wordCount;
    await window._setDoc(userDoc(), { studyHistory: existing }, { merge: true });
  } catch(e) {}
}



// ── MAIN NAV TAB SWITCHER ──
function switchMainTab(tab) {
  document.getElementById('mainTabPacks').style.display = tab === 'packs' ? '' : 'none';
  document.getElementById('mainTabChallenge').style.display = tab === 'challenge' ? '' : 'none';
  document.getElementById('mainNavPacks').classList.toggle('active', tab === 'packs');
  document.getElementById('mainNavChallenge').classList.toggle('active', tab === 'challenge');
  if (tab === 'packs') renderPacksGrid();
  if (tab === 'challenge') loadAndRenderChallenge();
}

// ============================================================
//  CHALLENGE SYSTEM
//  Firebase: /challenges/{challengeId}
//  Structure: { name, desc, createdAt, createdBy, durationDays, active }
//  User participation: /users/{uid}/challenges/{challengeId}
//  Structure: { joinedAt, studyDays:[], status:'active'|'success'|'failed' }
// ============================================================

async function loadAndRenderChallenge() {
  const container = document.getElementById('challengeCardContainer');
  if (!isLoggedIn() || !container) return;

  try {
    // Load active challenge (take the most recent active one)
    const snap = await window._getDocs(window._collection(window._db, 'challenges'));
    const challenges = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.active);
    if (!challenges.length) {
      // Admin sees create button even if no challenge
      if (isAdmin()) {
          container.innerHTML = `<button class="btn-challenge-create" onclick="openChallengeModal()">＋ Tạo thử thách mới</button>`;
      }
      return;
    }

    const challenge = challenges.sort((a,b) => b.createdAt - a.createdAt)[0];
    // Load user participation
    const uid = getUID();
    const userChalRef = window._doc(window._db, 'users', uid, 'challenges', challenge.id);
    const userChalSnap = await window._getDoc(userChalRef).catch(()=>null);
    const userChal = userChalSnap && userChalSnap.exists() ? userChalSnap.data() : null;

    // Check/update status
    let status = userChal ? userChal.status : null;
    let studyDays = userChal ? (userChal.studyDays || []) : [];

    if (status === 'active') {
      // Check if user missed a day
      const today = new Date().toISOString().slice(0,10);
      const joinDate = new Date(userChal.joinedAt);
      const daysSinceJoin = Math.floor((Date.now() - joinDate.getTime()) / 86400000);
      if (daysSinceJoin > 0) {
        // Build expected days between join and yesterday
        let missed = false;
        for (let i = 0; i < Math.min(daysSinceJoin, challenge.durationDays); i++) {
          const d = new Date(joinDate); d.setDate(d.getDate() + i);
          const ds = d.toISOString().slice(0,10);
          if (ds < today && !studyDays.includes(ds)) { missed = true; break; }
        }
        if (missed) {
          status = 'failed';
          await window._setDoc(userChalRef, { status: 'failed' }, { merge: true });
          showChallengeToast('💔 Bạn đã gián đoạn thử thách. Đừng nản — thử lại nhé!');
        }
      }
      // Check if completed
      if (studyDays.length >= challenge.durationDays) {
        status = 'success';
        await window._setDoc(userChalRef, { status: 'success' }, { merge: true });
        showChallengeToast('🏆 Chúc mừng! Bạn đã hoàn thành thử thách ' + challenge.name + '!');
      }
    }

    // Load all participants for display
    const allUsersSnap = await window._getDocs(window._collection(window._db, 'users')).catch(()=>null);
    const participants = [];
    if (allUsersSnap) {
      for (const userDoc of allUsersSnap.docs) {
        const ucSnap = await window._getDoc(window._doc(window._db, 'users', userDoc.id, 'challenges', challenge.id)).catch(()=>null);
        if (ucSnap && ucSnap.exists()) {
          const uc = ucSnap.data();
          const udata = userDoc.data();
          participants.push({
            name: udata.displayName || udata.email?.split('@')[0] || 'Ẩn danh',
            status: uc.status || 'active',
            days: (uc.studyDays || []).length
          });
        }
      }
    }

    renderChallengeCard(challenge, status, studyDays, participants);
  const dot = document.getElementById('challengeNavDot');
  if (dot) dot.style.display = (status === 'active' || !status) ? 'inline-block' : 'none';
  } catch(e) { console.warn('Challenge load error:', e); }
}

function renderChallengeCard(challenge, userStatus, studyDays, participants) {
  const container = document.getElementById('challengeCardContainer');
  const dur = challenge.durationDays || 7;
  const today = new Date().toISOString().slice(0,10);
  const totalJoined = participants.length;

  // Build day dots (only if joined)
  let dotsHtml = '';
  if (userStatus) {
    const dots = [];
    for (let i = 1; i <= dur; i++) {
      // We can't know exact day positions without joinedAt here, so just use index
      const isDone = studyDays.length >= i;
      const isCurrent = studyDays.length === i - 1 && userStatus === 'active';
      const isFailed = userStatus === 'failed' && !isDone;
      let cls = '';
      if (isDone) cls = 'done';
      else if (isCurrent) cls = 'today';
      else if (isFailed) cls = 'failed';
      dots.push(`<div class="challenge-day-dot ${cls}">${i}</div>`);
    }
    dotsHtml = `<div class="challenge-days">${dots.join('')}</div>`;
  }

  // Progress
  const pct = userStatus ? Math.round((studyDays.length / dur) * 100) : 0;
  const progressHtml = userStatus ? `
    <div class="challenge-progress-wrap">
      <div class="challenge-progress-label">
        <span>${studyDays.length}/${dur} ngày</span>
        <span>${pct}%</span>
      </div>
      <div class="challenge-progress-bar">
        <div class="challenge-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>` : '';

  // Action button
  let actionHtml = '';
  if (!userStatus) {
    actionHtml = `<button class="btn-challenge-join" onclick="joinChallenge('${challenge.id}')">⚡ Tham gia ngay</button>`;
  } else if (userStatus === 'active') {
    actionHtml = `<span class="btn-challenge-joined">✓ Đang tham gia</span>`;
  } else if (userStatus === 'success') {
    actionHtml = `<span class="challenge-status-tag success">🏆 Hoàn thành!</span>
      <button class="btn-challenge-join" onclick="joinChallenge('${challenge.id}')">↺ Thử lại</button>`;
  } else if (userStatus === 'failed') {
    actionHtml = `<span class="challenge-status-tag failed">✕ Đã gián đoạn</span>
      <button class="btn-challenge-join" onclick="joinChallenge('${challenge.id}')">↺ Thử lại</button>`;
  }

  if (isAdmin()) {
    actionHtml += ` <button class="btn-challenge-create" onclick="openChallengeModal()">✎ Sửa/Tạo mới</button>`;
    if (challenge.active) {
      actionHtml += ` <button class="btn-challenge-create" style="color:rgba(255,0,110,0.5);border-color:rgba(255,0,110,0.2)" onclick="endChallenge('${challenge.id}')">✕ Kết thúc</button>`;
    }
  }

  // Participants chips
  const chipHtml = participants.slice(0, 12).map(p => {
    let cls = p.status === 'success' ? 'chip-done' : p.status === 'failed' ? 'chip-failed' : 'chip-active';
    let icon = p.status === 'success' ? '🏆' : p.status === 'failed' ? '✕' : '🔥';
    return `<div class="challenge-participant-chip ${cls}">${icon} ${p.name} <span class="chip-days">${p.days}ng</span></div>`;
  }).join('');
  const moreChips = participants.length > 12 ? `<div class="challenge-participant-chip">+${participants.length-12} người</div>` : '';

  container.innerHTML = `
    <div class="challenge-card">
      <div class="challenge-header">
        <div class="challenge-title">${challenge.name}</div>
        <div class="challenge-badge">⏱ ${dur} NGÀY</div>
      </div>
      ${challenge.desc ? `<div class="challenge-desc">${challenge.desc}</div>` : ''}
      <div class="challenge-meta">
        <div class="challenge-meta-item">👥 <strong>${totalJoined}</strong> người đang tham gia</div>
        <div class="challenge-meta-item">✦ <strong>${participants.filter(p=>p.status==='success').length}</strong> đã hoàn thành</div>
      </div>
      ${dotsHtml}
      ${progressHtml}
      <div class="challenge-actions">${actionHtml}</div>
      ${totalJoined > 0 ? `
      <div class="challenge-participants">
        <div class="challenge-participants-title">Người tham gia</div>
        <div class="challenge-participants-list">${chipHtml}${moreChips}</div>
      </div>` : ''}
    </div>`;
}

async function joinChallenge(challengeId) {
  if (!isLoggedIn()) return;
  const uid = getUID();
  const today = new Date().toISOString().slice(0,10);
  const userChalRef = window._doc(window._db, 'users', uid, 'challenges', challengeId);
  await window._setDoc(userChalRef, {
    joinedAt: Date.now(), studyDays: [], status: 'active'
  });
  showChallengeToast('⚡ Đã tham gia thử thách! Chúc bạn thành công!');
  loadAndRenderChallenge();
}

async function endChallenge(challengeId) {
  if (!isAdmin()) return;
  if (!confirm('Kết thúc thử thách này? Người tham gia sẽ không còn thấy nó nữa.')) return;
  await window._setDoc(window._doc(window._db, 'challenges', challengeId), { active: false }, { merge: true });
  loadAndRenderChallenge();
}

// Called daily when user studies — mark today as a study day in active challenges
async function challengeRecordStudyDay() {
  if (!isLoggedIn()) return;
  const uid = getUID();
  const today = new Date().toISOString().slice(0,10);
  try {
    const snap = await window._getDocs(window._collection(window._db, 'challenges'));
    const activeChallenges = snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>c.active);
    for (const ch of activeChallenges) {
      const ref = window._doc(window._db, 'users', uid, 'challenges', ch.id);
      const ucSnap = await window._getDoc(ref).catch(()=>null);
      if (!ucSnap || !ucSnap.exists()) continue;
      const uc = ucSnap.data();
      if (uc.status !== 'active') continue;
      const days = uc.studyDays || [];
      if (!days.includes(today)) {
        days.push(today);
        await window._setDoc(ref, { studyDays: days }, { merge: true });
      }
    }
  } catch(e) {}
}

function openChallengeModal() {
  document.getElementById('challengeCreateModal').classList.add('show');
}
function closeChallengeModal() {
  document.getElementById('challengeCreateModal').classList.remove('show');
  document.getElementById('challengeNameInput').value = '';
  document.getElementById('challengeDescInput').value = '';
}
async function saveChallenge() {
  if (!isAdmin()) return;
  const name = document.getElementById('challengeNameInput').value.trim();
  if (!name) { alert('Vui lòng nhập tên thử thách!'); return; }
  const desc = document.getElementById('challengeDescInput').value.trim();
  const id = 'ch_' + Date.now();
  await window._setDoc(window._doc(window._db, 'challenges', id), {
    name, desc, durationDays: 7, active: true,
    createdAt: Date.now(), createdBy: getUID()
  });
  closeChallengeModal();
  showChallengeToast('✦ Đã tạo thử thách thành công!');
  loadAndRenderChallenge();
}

function showChallengeToast(msg) {
  const existing = document.querySelector('.challenge-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'challenge-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

// ============================================================
// ============================================================
//  STATS BAR — giờ học, từ đã xem, từ đã thuộc
// ============================================================

let _statsSessionStart = null;  // Date when current study session began
let _statsSessionActive = false;

// Start tracking time when entering study screen
function statsStartSession() {
  if (!_statsSessionActive) {
    _statsSessionStart = Date.now();
    _statsSessionActive = true;
  }
}

// Stop tracking and save elapsed minutes to Firebase
async function statsStopSession() {
  if (!_statsSessionActive || !_statsSessionStart) return;
  const elapsedMs = Date.now() - _statsSessionStart;
  _statsSessionActive = false;
  _statsSessionStart = null;
  const elapsedMin = Math.round(elapsedMs / 60000);
  if (elapsedMin < 1) return; // skip sessions under 1 min
  if (!isLoggedIn()) return;
  try {
    const snap = await window._getDoc(userDoc());
    const d = snap.exists() ? snap.data() : {};
    const newTotal = (d.totalStudyMinutes || 0) + elapsedMin;
    await window._setDoc(userDoc(), { totalStudyMinutes: newTotal }, { merge: true });
  } catch(e) {}
}

// ============================================================
//  ACTIVE TIME TRACKER — idle detection 2 phút
//  Lưu vào Firestore: activeMinutesByDay: { 'YYYY-MM-DD': minutes }
// ============================================================
let _activeLastInteraction = 0;
let _activeAccumSec = 0;          // giây active tích lũy trong ngày (chưa flush)
let _activeTickTimer = null;
const ACTIVE_IDLE_SECS = 120;     // 2 phút không tương tác = idle

function activeTimeRecordInteraction() {
  const now = Date.now();
  if (_activeLastInteraction > 0) {
    const gap = (now - _activeLastInteraction) / 1000;
    if (gap < ACTIVE_IDLE_SECS) {
      _activeAccumSec += gap;  // khoảng thời gian này là active
    }
    // gap >= 2 phút → bỏ qua, không tính
  }
  _activeLastInteraction = now;

  // Flush mỗi 60 giây tích lũy
  if (_activeAccumSec >= 60) {
    const mins = Math.floor(_activeAccumSec / 60);
    _activeAccumSec -= mins * 60;
    _activeTimeFlush(mins);
  }
}

async function _activeTimeFlush(mins) {
  if (!isLoggedIn() || mins < 1) return;
  // Cập nhật in-memory ngay để tổng kết hiển thị đúng
  _xpSession.todayActiveMin += mins;
  try {
    const today = new Date().toISOString().slice(0,10);
    const ref = window._doc(window._db, 'users', getUID(), 'xp', 'data');
    const snap = await window._getDoc(ref).catch(() => null);
    const d = snap && snap.exists() ? snap.data() : {};
    const byDay = d.activeMinutesByDay || {};
    byDay[today] = (byDay[today] || 0) + mins;
    await window._setDoc(ref, { activeMinutesByDay: byDay }, { merge: true });
  } catch(e) { console.warn('[ActiveTime] flush error', e); }
}

// Flush khi rời trang / ẩn tab
async function activeTimeFlushOnExit() {
  if (_activeLastInteraction > 0 && _activeAccumSec > 0) {
    const mins = Math.floor(_activeAccumSec / 60);
    _activeAccumSec = 0;
    await _activeTimeFlush(mins);
  }
}

// Record a word flip (word seen)
async function statsRecordFlip() {
  if (!isLoggedIn()) return;
  try {
    const snap = await window._getDoc(userDoc());
    const d = snap.exists() ? snap.data() : {};
    const newVal = (d.totalWordsSeen || 0) + 1;
    await window._setDoc(userDoc(), { totalWordsSeen: newVal }, { merge: true });
    refreshStatsBar();
  } catch(e) {}
}

// Format minutes → "2g 15p" or "45p"
function fmtMinutes(m) {
  if (m < 60) return m + 'p';
  const h = Math.floor(m / 60), min = m % 60;
  return h + 'g ' + (min > 0 ? min + 'p' : '');
}

// Pop animation helper
function popPill(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('pop');
  void el.offsetWidth;
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 400);
}

// Load and display stats bar
async function refreshStatsBar() {
  if (!isLoggedIn()) { document.getElementById('statsBar').style.display = 'none'; return; }
  try {
    const snap = await window._getDoc(userDoc());
    const d = snap.exists() ? snap.data() : {};
    const mins = d.totalStudyMinutes || 0;

    // Dùng metadata cache từ packs[] thay vì load lại Firebase
    let mastered = 0;
    if (packs && packs.length) {
      mastered = packs.reduce((sum, p) => sum + (p._masteredCount || 0), 0);
    } else {
      // Fallback lần đầu chưa có cache: tính từ IDB
      const userPacks = d.packs || [];
      await Promise.all(userPacks.map(async p => {
        try {
          const cached = await IDB.get(p.id);
          if (cached && cached.words) mastered += cached.words.filter(w => w.mastered).length;
        } catch(e) {}
      }));
    }

    document.getElementById('statHoursVal').textContent = '⏱ ' + fmtMinutes(mins) + ' học';
    document.getElementById('statsBar').style.display = '';
  } catch(e) {}
}

// ============================================================
//  ADMIN PUBLISH SYSTEM
//  Firestore: /adminPacks/{packId} — public cho mọi user approved
//  Progress:  /users/{uid}/adminProgress/{packId}
// ============================================================

let _cachedAdminPacks = null; // memory cache trong session

// ── Tăng version app mỗi khi admin thay đổi data ──
async function _bumpAppVersion() {
  const newVersion = Date.now();
  await window._setDoc(
    window._doc(window._db, 'appMeta', 'version'),
    { version: newVersion, updatedAt: newVersion },
    { merge: true }
  ).catch(e => console.warn('bumpVersion error:', e));
  return newVersion;
}

// Admin bật/tắt publish cho pack
async function togglePublish(packId, e) {
  if (e) e.stopPropagation();
  if (!isAdmin()) return;
  const pack = packs.find(p => p.id === packId);
  if (!pack) return;

  const willPublish = !pack.published;

  try {
    if (willPublish) {
      // Lấy words mới nhất từ pack của admin
      const cached = await IDB.get(packId).catch(() => null);
      const words = cached?.words || [];
      if (!words.length) {
        // Fallback: load từ Firebase
        const snap = await window._getDoc(packDoc(packId));
        const ws = snap.exists() ? snap.data().words || [] : [];
        await window._setDoc(window._doc(window._db, 'adminPacks', packId), {
          id: packId, name: pack.name, desc: pack.desc || '',
          words: ws.map(w => ({ ...w, mastered: false })),
          wordCount: ws.length, sortOrder: pack.sortOrder ?? 9999,
          published: true, updatedAt: Date.now()
        });
      } else {
        await window._setDoc(window._doc(window._db, 'adminPacks', packId), {
          id: packId, name: pack.name, desc: pack.desc || '',
          words: words.map(w => ({ ...w, mastered: false })),
          wordCount: words.length, sortOrder: pack.sortOrder ?? 9999,
          published: true, updatedAt: Date.now()
        });
      }
    } else {
      // Ẩn pack — xóa khỏi adminPacks
      await window._deleteDoc(window._doc(window._db, 'adminPacks', packId)).catch(() => {});
    }

    pack.published = willPublish;
    await _bumpAppVersion(); // báo cho user biết có data mới
    await savePacks();
    _cachedAdminPacks = null; // reset cache
    renderPacksGrid();
    showToast('success', willPublish ? '🌐 Đã publish cho học viên' : '🔒 Đã ẩn khỏi học viên');
  } catch(e) {
    showToast('error', '✕ Lỗi: ' + e.message);
  }
}

// Load danh sách admin packs (IDB-first + background sync)
async function loadAdminPacks() {
  if (_cachedAdminPacks !== null) return _cachedAdminPacks;

  // Thử IDB trước
  try {
    const cached = await IDB.get('__adminpacks__').catch(() => null);
    if (cached && cached.packs?.length) {
      _cachedAdminPacks = cached.packs;
      _syncAdminPacksInBackground();
      return _cachedAdminPacks;
    }
  } catch(e) {}

  // Fallback: load từ Firebase
  return _fetchAdminPacksFromFirebase();
}

async function _fetchAdminPacksFromFirebase() {
  try {
    const snap = await window._getDocs(window._collection(window._db, 'adminPacks'));
    const result = snap.docs
      .map(d => ({ ...d.data(), id: d.id }))
      .filter(p => p.published !== false);
    _cachedAdminPacks = result;
    await IDB.set('__adminpacks__', { packs: result, updatedAt: Date.now() }).catch(() => {});
    return result;
  } catch(e) { console.warn('loadAdminPacks error:', e); return []; }
}

async function _syncAdminPacksInBackground() {
  try {
    const fresh = await _fetchAdminPacksFromFirebase();
    _cachedAdminPacks = fresh;
  } catch(e) {}
}

// Mở pack của admin để học (tương tự openSharedPack cũ)
async function openAdminPack(pack) {
  currentPack = { ...pack, _isAdminPack: true };
  document.getElementById('studyPackName').textContent = pack.name;
  document.getElementById('screen-packs').classList.remove('active');
  document.getElementById('screen-study').classList.add('active');
  statsStartSession();

  // Ẩn tab Nhập Từ với admin pack
  const inputTab = document.getElementById('tabInput');
  if (inputTab) inputTab.style.display = 'none';

  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', i===1));
  document.querySelectorAll('.panel').forEach((p,i) => p.classList.toggle('active', i===1));

  const fcContent = document.getElementById('fc-content');
  if (fcContent) fcContent.innerHTML = '<div class="warn-box" style="justify-content:center">⟳ Đang tải từ vựng...</div>';

  const badge = document.getElementById('cloudBadge');
  if (badge) { badge.innerHTML = '⬡ <span style="color:var(--neon-yellow)">Giáo trình</span>'; badge.style.color = 'rgba(255,230,0,0.5)'; }

  words = [];
  const loaded = await loadData();

  if (!loaded) {
    if (fcContent) fcContent.innerHTML = '<div class="warn-box">✕ Không tải được gói từ vựng.</div>';
    return;
  }

  buildQueue(); renderFlashcard(); renderList(); updateStudyBadge();
}



// ============================================================
//  ADMIN PANEL
// ============================================================
let _allUsersData = [];

async function openAdminPanel() {
  if (!isAdmin()) return;
  document.getElementById('adminOverlay').classList.add('show');
  switchAdminTab('users');
  await loadAdminData();
  _adminLoadSettingsUI();
}

function closeAdminPanel() {
  document.getElementById('adminOverlay').classList.remove('show');
}

function closeAdmin(e) {
  if (e.target === document.getElementById('adminOverlay')) closeAdminPanel();
}

function switchAdminTab(tab) {
  ['users','settings'].forEach(t => {
    document.getElementById('adminTab-' + t)?.classList.toggle('active', t === tab);
    document.getElementById('adminPanel-' + t)?.classList.toggle('active', t === tab);
  });
}

function _adminLoadSettingsUI() {
  // Load current XP values vào inputs
  const v = XP_VALUES;
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
  set('xpSet-LOGIN_DAILY',   v.LOGIN_DAILY);
  set('xpSet-MASTERED',      v.MASTERED);
  set('xpSet-ACTIVE_10MIN',  v.ACTIVE_10MIN);
  set('xpSet-ARTICLE_OPEN',  v.ARTICLE_OPEN);
  set('xpSet-OPEN_PACK',     v.OPEN_PACK);
  set('xpSet-CELEBRATE_EVERY', CELEBRATE_EVERY);
  set('xpSet-STREAK_3',  v.STREAK_BONUS[3]  || 2);
  set('xpSet-STREAK_7',  v.STREAK_BONUS[7]  || 5);
  set('xpSet-STREAK_14', v.STREAK_BONUS[14] || 10);
  set('xpSet-STREAK_21', v.STREAK_BONUS[21] || 20);
}

async function adminSaveXPValues() {
  if (!isAdmin()) return;
  const get = id => parseInt(document.getElementById(id)?.value) || 0;
  XP_VALUES.LOGIN_DAILY  = get('xpSet-LOGIN_DAILY');
  XP_VALUES.MASTERED     = get('xpSet-MASTERED');
  XP_VALUES.ACTIVE_10MIN = get('xpSet-ACTIVE_10MIN');
  XP_VALUES.ARTICLE_OPEN = get('xpSet-ARTICLE_OPEN');
  XP_VALUES.OPEN_PACK    = get('xpSet-OPEN_PACK');
  try {
    await window._setDoc(
      window._doc(window._db, 'appConfig', 'scoring'),
      { xpValues: {
          LOGIN_DAILY:  XP_VALUES.LOGIN_DAILY,
          MASTERED:     XP_VALUES.MASTERED,
          ACTIVE_10MIN: XP_VALUES.ACTIVE_10MIN,
          ARTICLE_OPEN: XP_VALUES.ARTICLE_OPEN,
          OPEN_PACK:    XP_VALUES.OPEN_PACK,
        }
      }, { merge: true }
    );
    const btn = document.getElementById('adminSaveXP');
    if (btn) { btn.textContent = '✓ Đã lưu!'; btn.classList.add('saved'); setTimeout(() => { btn.textContent = '✓ Lưu cài đặt XP'; btn.classList.remove('saved'); }, 2000); }
  } catch(e) { alert('Lỗi lưu: ' + e.message); }
}

async function adminSaveCelebrateSettings() {
  if (!isAdmin()) return;
  const get = id => parseInt(document.getElementById(id)?.value) || 0;
  CELEBRATE_EVERY = get('xpSet-CELEBRATE_EVERY') || 5;
  XP_VALUES.STREAK_BONUS = {
    3:  get('xpSet-STREAK_3'),
    7:  get('xpSet-STREAK_7'),
    14: get('xpSet-STREAK_14'),
    21: get('xpSet-STREAK_21'),
  };
  try {
    await window._setDoc(
      window._doc(window._db, 'appConfig', 'scoring'),
      { celebrateEvery: CELEBRATE_EVERY,
        xpValues: { STREAK_BONUS: XP_VALUES.STREAK_BONUS }
      }, { merge: true }
    );
    const btn = document.getElementById('adminSaveCelebrate');
    if (btn) { btn.textContent = '✓ Đã lưu!'; btn.classList.add('saved'); setTimeout(() => { btn.textContent = '✓ Lưu cài đặt chúc mừng'; btn.classList.remove('saved'); }, 2000); }
  } catch(e) { alert('Lỗi lưu: ' + e.message); }
}

async function loadAdminData() {
  const listEl = document.getElementById('adminUsersList');
  listEl.innerHTML = '<div class="admin-loading">⟳ Đang tải dữ liệu người dùng...</div>';

  try {
    const usersSnap = await window._getDocs(window._collection(window._db, 'users'));
    _allUsersData = [];
    let totalPacks = 0, totalWords = 0, totalMastered = 0;

    // Load each user's packs
    await Promise.all(usersSnap.docs.map(async (userSnap) => {
      const userData = userSnap.data();
      const uid = userSnap.id;
      const userPacks = userData.packs || [];
      totalPacks += userPacks.length;

      let uWords = 0, uMastered = 0;
      const packSnaps = await Promise.all(
        userPacks.map(p => window._getDoc(window._doc(window._db,'users',uid,'packs',p.id)).catch(()=>null))
      );
      packSnaps.forEach(s => {
        if (s && s.exists()) {
          const ws = s.data().words || [];
          uWords += ws.length;
          uMastered += ws.filter(w=>w.mastered).length;
        }
      });
      totalWords += uWords;
      totalMastered += uMastered;

      _allUsersData.push({
        uid, email: userData.email || '—',
        displayName: userData.displayName || userData.email?.split('@')[0] || 'Ẩn danh',
        photoURL: userData.photoURL || '',
        isAdmin: userData.email === window.ADMIN_EMAIL,
        accessStatus: userData.accessStatus || 'pending',
        packs: userPacks.length, words: uWords, mastered: uMastered,
        lastSeen: userData.lastSeen || 0,
      });
    }));

    // Sort by lastSeen
    _allUsersData.sort((a,b) => b.lastSeen - a.lastSeen);

    // Update stats
    document.getElementById('astatUsers').textContent = _allUsersData.length;
    document.getElementById('astatPending').textContent = _allUsersData.filter(u=>u.accessStatus==='pending').length;
    document.getElementById('astatWords').textContent = totalWords;
    document.getElementById('astatMastered').textContent = totalMastered;

    renderAdminUsers(_allUsersData);
  } catch(e) {
    listEl.innerHTML = `<div class="admin-loading" style="color:var(--neon-pink)">✕ Lỗi tải dữ liệu: ${e.message}</div>`;
  }
}

function renderAdminUsers(users) {
  const listEl = document.getElementById('adminUsersList');
  if (!users.length) {
    listEl.innerHTML = '<div class="admin-loading">Không tìm thấy người dùng nào.</div>';
    return;
  }
  listEl.innerHTML = users.map(u => {
    const initials = u.displayName.charAt(0).toUpperCase();
    const avatarHTML = u.photoURL
      ? `<img src="${u.photoURL}" class="admin-user-ava" referrerpolicy="no-referrer">`
      : `<div class="admin-user-ava-ph">${initials}</div>`;
    const lastSeenStr = u.lastSeen ? new Date(u.lastSeen).toLocaleDateString('vi-VN') : '—';
    const adminTag = u.isAdmin ? ' <span style="color:var(--neon-yellow);font-size:0.6rem">⬡ ADMIN</span>' : '';
    const statusBadge = u.isAdmin ? '<span class="status-approved">⬡ admin</span>'
      : u.accessStatus === 'approved' ? '<span class="status-approved">✓ approved</span>'
      : u.accessStatus === 'denied'   ? '<span class="status-denied">✕ denied</span>'
      : '<span class="status-pending">⏳ pending</span>';
    const actionBtns = u.isAdmin ? '' : `
      ${u.accessStatus !== 'approved' ? `<button class="admin-approve-btn" onclick="adminSetAccess('${u.uid}','approved')">✓ Duyệt</button>` : `<button class="admin-revoke-btn" onclick="adminSetAccess('${u.uid}','denied')">⊖ Thu hồi</button>`}
    `;
    return `
      <div class="admin-user-row">
        ${avatarHTML}
        <div class="admin-user-info">
          <div class="admin-user-name">${h(u.displayName)}${adminTag}</div>
          <div class="admin-user-email">${h(u.email)}</div>
          <div style="margin-top:3px">${statusBadge}</div>
        </div>
        <div class="admin-user-stats">
          <span>${u.packs}</span> gói · <span>${u.words}</span> từ<br>
          <span style="color:var(--neon-green)">${u.mastered}</span> đã thuộc<br>
          <span style="color:rgba(255,255,255,0.2)">${lastSeenStr}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;align-items:flex-end">
          ${actionBtns}
          <button class="admin-pack-btn admin-pack-btn-view" onclick="openAdminDetail('${u.uid}')">👁 Chi tiết</button>
          ${!u.isAdmin ? `<button class="admin-del-btn" onclick="adminDeleteUser('${u.uid}','${h(u.displayName)}')">✕ Xóa</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function filterAdminUsers() {
  const q = document.getElementById('adminSearch').value.toLowerCase();
  if (!q) { renderAdminUsers(_allUsersData); return; }
  const filtered = _allUsersData.filter(u =>
    u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );
  renderAdminUsers(filtered);
}

async function adminDeleteUser(uid, name) {
  if (!confirm(`Xóa tài khoản "${name}"?\n\nHành động này sẽ xóa toàn bộ gói từ vựng của người dùng này và không thể hoàn tác!`)) return;
  try {
    // Delete all packs first
    const userSnap = await window._getDoc(window._doc(window._db,'users',uid));
    if (userSnap.exists()) {
      const userPacks = userSnap.data().packs || [];
      await Promise.all(userPacks.map(p =>
        window._deleteDoc(window._doc(window._db,'users',uid,'packs',p.id)).catch(()=>{})
      ));
    }
    await window._deleteDoc(window._doc(window._db,'users',uid));
    _allUsersData = _allUsersData.filter(u => u.uid !== uid);
    renderAdminUsers(_allUsersData);
    document.getElementById('astatUsers').textContent = _allUsersData.length;
  } catch(e) {
    alert('Lỗi xóa user: ' + e.message);
  }
}

async function adminSetAccess(uid, status) {
  try {
    await window._setDoc(window._doc(window._db,'users',uid), { accessStatus: status }, { merge: true });
    const u = _allUsersData.find(x => x.uid === uid);
    if (u) u.accessStatus = status;
    const q = document.getElementById('adminSearch').value;
    filterAdminUsers();
    const label = status === 'approved' ? '✓ Đã cấp quyền' : '⊖ Đã thu hồi quyền';
    // Flash notification
    const notif = document.createElement('div');
    notif.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0d0d1f;border:1px solid rgba(57,255,20,0.3);border-radius:12px;padding:10px 20px;color:var(--neon-green);font-size:0.8rem;font-family:Syne,sans-serif;z-index:999;animation:fadeUp 0.3s ease';
    notif.textContent = label;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 2500);
  } catch(e) { alert('Lỗi: ' + e.message); }
}

// ============================================================
//  ADMIN USER DETAIL
// ============================================================
let _currentDetailUID = null;
let _currentDetailPacks = [];
let _currentDetailData = {};

async function openAdminDetail(uid) {
  _currentDetailUID = uid;
  _currentDetailPacks = [];
  const u = _allUsersData.find(x => x.uid === uid);
  if (!u) return;

  document.getElementById('adminDetailOverlay').classList.add('show');
  switchDetailTab('overview', document.querySelector('.admin-detail-tab'));

  // Avatar
  const initials = u.displayName.charAt(0).toUpperCase();
  document.getElementById('adminDetailAvatar').innerHTML = u.photoURL
    ? `<img src="${u.photoURL}" class="admin-detail-ava" referrerpolicy="no-referrer">`
    : `<div class="admin-detail-ava-ph">${initials}</div>`;
  document.getElementById('adminDetailName').textContent = u.displayName;
  document.getElementById('adminDetailEmail').textContent = u.email;

  // Load full user data
  try {
    const [userSnap, xpSnap] = await Promise.all([
      window._getDoc(window._doc(window._db,'users',uid)),
      window._getDoc(window._doc(window._db,'users',uid,'xp','data')).catch(()=>null),
    ]);
    _currentDetailData = userSnap.exists() ? userSnap.data() : {};
    const xpData       = xpSnap && xpSnap.exists() ? xpSnap.data() : {};
    const userPacks    = _currentDetailData.packs || [];
    const studyHistory = _currentDetailData.studyHistory || {};

    // XP & engagement stats
    const totalXP     = xpData.total || 0;
    const streak      = xpData.loginStreakDays || 0;
    const activeByDay = xpData.activeMinutesByDay || {};
    const totalMins   = Object.values(activeByDay).reduce((s,v)=>s+(v||0),0);
    const readingDone = (xpData.readingDone || []).length;
    const fmtMin = m => m < 60 ? m+'p' : Math.floor(m/60)+'g'+(m%60 ? (m%60)+'p' : '');

    // Pack details
    const packResults = await Promise.all(
      userPacks.map(async p => {
        try {
          const ps = await window._getDoc(window._doc(window._db,'users',uid,'packs',p.id));
          const words = ps.exists() ? (ps.data().words || []) : [];
          return { ...p, words, mastered: words.filter(w=>w.mastered).length };
        } catch(e) { return { ...p, words:[], mastered:0 }; }
      })
    );
    _currentDetailPacks = packResults;

    const totalWords    = packResults.reduce((s,p)=>s+p.words.length,0);
    const totalMastered = packResults.reduce((s,p)=>s+p.mastered,0);
    const totalDays     = Object.keys(studyHistory).length;

    // Overview stats — 6 chỉ số
    document.getElementById('adminDetailStats').style.gridTemplateColumns = 'repeat(3,1fr)';
    document.getElementById('adminDetailStats').innerHTML = `
      <div class="admin-user-stat"><div class="admin-user-stat-val yellow">${totalXP}</div><div class="admin-user-stat-lbl">Tổng XP</div></div>
      <div class="admin-user-stat"><div class="admin-user-stat-val green">${totalMastered}</div><div class="admin-user-stat-lbl">Đã thuộc</div></div>
      <div class="admin-user-stat"><div class="admin-user-stat-val">${totalWords}</div><div class="admin-user-stat-lbl">Tổng từ</div></div>
      <div class="admin-user-stat"><div class="admin-user-stat-val" style="color:var(--neon-purple)">${fmtMin(totalMins)}</div><div class="admin-user-stat-lbl">Giờ học</div></div>
      <div class="admin-user-stat"><div class="admin-user-stat-val yellow">${streak}</div><div class="admin-user-stat-lbl">Streak 🔥</div></div>
      <div class="admin-user-stat"><div class="admin-user-stat-val" style="color:var(--neon-pink)">${readingDone}</div><div class="admin-user-stat-lbl">Bài đọc</div></div>
    `;

    // Overview info
    const lastSeen = u.lastSeen ? new Date(u.lastSeen).toLocaleString('vi-VN') : '—';
    const joinDate = u.approvedAt ? new Date(u.approvedAt).toLocaleDateString('vi-VN') : '—';
    document.getElementById('adminDetailInfo').innerHTML = `
      <div>🆔 UID: <span style="color:rgba(255,255,255,0.5);font-size:0.65rem">${uid}</span></div>
      <div>📧 Email: <span style="color:var(--neon-cyan)">${h(u.email)}</span></div>
      <div>📦 Gói từ: <span style="color:#fff;font-weight:700">${packResults.length} gói · ${totalWords} từ</span></div>
      <div>📅 Số ngày học: <span style="color:#fff;font-weight:700">${totalDays} ngày</span></div>
      <div>🗓 Tham gia: <span style="color:rgba(255,255,255,0.6)">${joinDate}</span></div>
      <div>🕒 Hoạt động cuối: <span style="color:rgba(255,255,255,0.6)">${lastSeen}</span></div>
    `;

    // Packs tab
    renderAdminDetailPacks();

    // History tab — gộp tất cả nguồn dữ liệu theo ngày
    const allDates = new Set([
      ...Object.keys(studyHistory),
      ...Object.keys(activeByDay),
      ...Object.keys(xpData).filter(k=>k.startsWith('day_')).map(k=>k.slice(4)),
    ]);
    const sortedDates = [...allDates].sort().reverse();

    // Build history HTML
    const buildHistRows = () => sortedDates.slice(0,90).map(d => {
      const w     = studyHistory[d] || 0;
      const m     = activeByDay[d]  || 0;
      const xpDay = xpData['day_'+d];
      const xp    = xpDay && typeof xpDay==='object' ? (xpDay.xp||0) : (xpDay||0);
      const fade  = (!w && !m && !xp) ? 'opacity:0.3;' : '';
      return '<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:4px;' +
        'padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.72rem;' + fade + '">' +
        '<span style="font-family:monospace;color:rgba(255,255,255,0.5)">'+d+'</span>' +
        '<span style="text-align:right;color:var(--neon-cyan);font-weight:700">'+(w||'—')+'</span>' +
        '<span style="text-align:right;color:var(--neon-purple)">'+(m?fmtMin(m):'—')+'</span>' +
        '<span style="text-align:right;color:var(--neon-yellow)">'+(xp||'—')+'</span>' +
        '</div>';
    }).join('');

    const histHeader = '<div style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:4px;' +
      'font-size:0.58rem;color:rgba(255,255,255,0.3);letter-spacing:0.1em;text-transform:uppercase;' +
      'padding:6px 10px;border-bottom:1px solid rgba(255,255,255,0.06);font-family:monospace;margin-bottom:2px">' +
      '<span>Ngày</span><span style="text-align:right">Từ học</span>' +
      '<span style="text-align:right">Active</span><span style="text-align:right">XP</span></div>';

    document.getElementById('adminDetailHistory').innerHTML = sortedDates.length
      ? histHeader + buildHistRows()
      : '<div style="color:rgba(255,255,255,0.25);font-size:0.78rem;padding:20px;text-align:center">Chưa có lịch sử hoạt động.</div>';

  } catch(e) {
    document.getElementById('adminDetailStats').innerHTML = `<div style="color:var(--neon-pink);font-size:0.8rem;grid-column:span 3">✕ Lỗi tải dữ liệu: ${e.message}</div>`;
  }
}

function renderAdminDetailPacks(viewPackId) {
  const el = document.getElementById('adminDetailPacksView');
  if (viewPackId !== undefined) {
    // Show words inside a pack
    const pack = _currentDetailPacks.find(p=>p.id===viewPackId);
    if (!pack) return;
    const pct = pack.words.length ? Math.round(pack.mastered/pack.words.length*100) : 0;
    el.innerHTML = `
      <button class="admin-back-btn" onclick="renderAdminDetailPacks()">← Quay lại danh sách gói</button>
      <div style="margin-bottom:12px">
        <div style="font-family:'Syne',sans-serif;font-size:0.9rem;font-weight:800;color:#fff;margin-bottom:4px">${h(pack.name)}</div>
        <div style="font-size:0.7rem;color:rgba(255,255,255,0.35)">${pack.words.length} từ · ${pack.mastered} đã thuộc · ${pct}% hoàn thành</div>
      </div>
      <div class="admin-words-wrap">
        <table class="admin-words-table">
          <thead><tr><th>#</th><th>Từ</th><th>Nghĩa</th><th>Level</th><th>✓</th><th></th></tr></thead>
          <tbody>${pack.words.map((w,i)=>`
            <tr>
              <td style="color:rgba(255,255,255,0.2)">${i+1}</td>
              <td><div style="font-weight:700;color:#fff;font-family:'Syne',sans-serif">${h(w.word)}</div>${w.phonetics?`<div style="color:var(--neon-cyan);font-size:0.65rem">/${h(w.phonetics)}/</div>`:''}</td>
              <td style="color:rgba(255,255,255,0.65)">${h(w.meaning)}</td>
              <td>${w.level?`<span style="font-size:0.6rem;padding:2px 6px;background:rgba(191,0,255,0.12);border:1px solid rgba(191,0,255,0.25);border-radius:20px;color:var(--neon-purple)">${h(w.level)}</span>`:''}</td>
              <td style="text-align:center">${w.mastered?'<span style="color:var(--neon-green)">✓</span>':'<span style="color:rgba(255,255,255,0.15)">·</span>'}</td>
              <td><button class="admin-pack-btn admin-pack-btn-del" style="padding:3px 8px" onclick="adminToggleMastered('${viewPackId}',${i})">
                ${w.mastered?'↩ Bỏ thuộc':'✓ Đánh thuộc'}
              </button></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } else {
    if (!_currentDetailPacks.length) {
      el.innerHTML = '<div style="color:rgba(255,255,255,0.25);font-size:0.78rem;padding:24px;text-align:center">Người dùng chưa có gói từ vựng nào.</div>';
      return;
    }
    el.innerHTML = `<div class="admin-pack-list">${_currentDetailPacks.map(p=>{
      const pct = p.words.length ? Math.round(p.mastered/p.words.length*100) : 0;
      return `<div class="admin-pack-item">
        <div class="admin-pack-item-header">
          <div>
            <div class="admin-pack-item-name">${h(p.name)}</div>
            <div class="admin-pack-item-meta">${p.words.length} từ · ${p.mastered} đã thuộc</div>
          </div>
          <div style="font-family:'Syne',sans-serif;font-size:0.75rem;font-weight:800;color:var(--neon-cyan)">${pct}%</div>
        </div>
        <div class="admin-pack-item-bar"><div class="admin-pack-item-fill" style="width:${pct}%"></div></div>
        <div class="admin-pack-actions">
          <button class="admin-pack-btn admin-pack-btn-view" onclick="renderAdminDetailPacks('${p.id}')">👁 Xem từ vựng</button>
          <button class="admin-pack-btn admin-pack-btn-del" onclick="adminDeletePack('${p.id}','${h(p.name)}')">✕ Xóa gói</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }
}

async function adminToggleMastered(packId, wordIdx) {
  const pack = _currentDetailPacks.find(p=>p.id===packId);
  if (!pack || !pack.words[wordIdx]) return;
  pack.words[wordIdx].mastered = !pack.words[wordIdx].mastered;
  pack.mastered = pack.words.filter(w=>w.mastered).length;
  try {
    await window._setDoc(
      window._doc(window._db,'users',_currentDetailUID,'packs',packId),
      { words: pack.words, updatedAt: Date.now() }, { merge: true }
    );
    renderAdminDetailPacks(packId);
  } catch(e) { alert('Lỗi lưu: ' + e.message); }
}

async function adminDeletePack(packId, packName) {
  if (!confirm(`Xóa gói "${packName}"?\nToàn bộ từ vựng trong gói sẽ bị mất vĩnh viễn.`)) return;
  try {
    await window._deleteDoc(window._doc(window._db,'users',_currentDetailUID,'packs',packId));
    _currentDetailPacks = _currentDetailPacks.filter(p=>p.id!==packId);
    // Update packs list in user doc
    const newPacks = (_currentDetailData.packs||[]).filter(p=>p.id!==packId);
    await window._setDoc(window._doc(window._db,'users',_currentDetailUID), { packs: newPacks }, { merge: true });
    _currentDetailData.packs = newPacks;
    renderAdminDetailPacks();
    // Update summary
    const u = _allUsersData.find(x=>x.uid===_currentDetailUID);
    if (u) { u.packs--; }
  } catch(e) { alert('Lỗi xóa gói: ' + e.message); }
}

function switchDetailTab(tab, btn) {
  document.querySelectorAll('.admin-detail-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.admin-detail-panel-content').forEach(p=>p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('detail-tab-'+tab).classList.add('active');
}

function closeAdminDetail() {
  document.getElementById('adminDetailOverlay').classList.remove('show');
  _currentDetailUID = null;
}

// ============================================================
//  INIT
// ============================================================
function initApp() {
  initTTS();
  updateAuthBar();
  xpInit(); // ✦ XP engine start
  runInitialDownload(); // tải IndexedDB trước, xong gọi showPacksScreen
}

// ── Tải tất cả gói xuống IndexedDB — version-based cache ──
async function runInitialDownload() {

  // 1. Load metadata packs của chính user (IDB-first)
  packs = await loadPacks();

  // Admin chỉ quản lý pack, không cần download admin packs
  if (isAdmin()) {
    showPacksScreen();
    return;
  }

  // 2. Đọc version hiện tại từ IDB
  let localVersion = 0;
  try {
    const v = await IDB.get('__appversion__');
    localVersion = v?.version || 0;
  } catch(e) {}

  // 3. Nếu offline → dùng cache hiện có, vào app luôn
  if (!navigator.onLine) {
    console.log('[offline] Using cached data, localVersion:', localVersion);
    await _loadMetaFromCache();
    showPacksScreen();
    return;
  }

  // 4. Fetch version từ Firebase — chỉ 1 read duy nhất
  let remoteVersion = 0;
  try {
    const snap = await window._getDoc(window._doc(window._db, 'appMeta', 'version'));
    remoteVersion = snap.exists() ? (snap.data().version || 0) : 0;
  } catch(e) {
    console.warn('[version] Cannot fetch, using cache');
    await _loadMetaFromCache();
    showPacksScreen();
    return;
  }

  console.log('[version] local:', localVersion, 'remote:', remoteVersion);

  // 5. Version giống nhau → dùng cache 100%, không tải gì thêm
  if (remoteVersion && localVersion === remoteVersion) {
    console.log('[version] Cache is fresh — 0 Firebase reads');
    await _loadMetaFromCache();
    showPacksScreen();
    return;
  }

  // 6. Version khác (hoặc lần đầu) → download tất cả admin packs
  const adminPacks = await _fetchAdminPacksFromFirebase();
  console.log('[download] Admin packs to sync:', adminPacks.length);

  // Kiểm tra IDB — pack nào đã có cache?
  let cachedKeys = [];
  try { cachedKeys = await IDB.getAllKeys(); } catch(e) {}
  const cachedSet = new Set(cachedKeys);

  // Đọc metadata từ IDB cho own packs đã cache
  for (const p of packs) {
    if (cachedSet.has(p.id)) {
      try {
        const cached = await IDB.get(p.id);
        if (cached?.words) {
          p._wordCount     = cached.words.length;
          p._masteredCount = cached.words.filter(w => w.mastered).length;
        }
      } catch(e) {}
    }
  }

  // Tìm pack cần tải/cập nhật
  const ownNeed = packs.filter(p => !cachedSet.has(p.id));
  const adminNeed = [];
  for (const p of adminPacks) {
    const key = 'ap::' + p.id;
    if (!cachedSet.has(key)) {
      adminNeed.push({ ...p, _reason: 'new' });
    } else {
      try {
        const cached = await IDB.get(key);
        if ((p.updatedAt || 0) > (cached?.updatedAt || 0)) {
          adminNeed.push({ ...p, _reason: 'updated' });
        }
      } catch(e) { adminNeed.push({ ...p, _reason: 'new' }); }
    }
  }

  const needDownload = [
    ...ownNeed.map(p  => ({ ...p, _source: 'own' })),
    ...adminNeed.map(p => ({ ...p, _source: 'admin' }))
  ];
  console.log('[download] Need:', needDownload.length, '(own:', ownNeed.length, 'admin:', adminNeed.length, ')');

  if (!needDownload.length) {
    // Không có gì mới → cập nhật version và vào app
    await IDB.set('__appversion__', { version: remoteVersion, cachedAt: Date.now() }).catch(() => {});
    showPacksScreen();
    return;
  }

  // 7. Hiện loading overlay
  const overlay = document.getElementById('initLoadingOverlay');
  const titleEl = document.getElementById('initLoadingTitle');
  const subEl   = document.getElementById('initLoadingSub');
  const fillEl  = document.getElementById('initProgressFill');
  const labelEl = document.getElementById('initProgressLabel');
  const listEl  = document.getElementById('initPackList');

  overlay.classList.add('show');
  titleEl.textContent = localVersion ? '↻ Đang cập nhật dữ liệu...' : 'Đang tải bộ từ vựng...';
  listEl.innerHTML    = '';
  fillEl.style.width  = '0%';
  fillEl.style.background = 'linear-gradient(90deg,var(--neon-cyan),var(--neon-purple))';

  // Fun messages xoay vòng trong lúc chờ
  const funMessages = [
    '☕ Rót ly cà phê chờ xíu nha...',
    '🔍 Đang soi xem admin có lén thêm từ mới không...',
    '🎯 Đang gói từ vựng cẩn thận để khỏi rơi...',
    '💡 Mẹo: Học 15 phút mỗi ngày hiệu quả hơn học 2 tiếng/tuần!',
    '📦 Đang xếp từ vào hộp cho gọn gàng...',
  ];
  let msgIdx = 0;
  subEl.textContent = funMessages[0];
  const msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % funMessages.length;
    subEl.style.opacity = 0;
    setTimeout(() => { subEl.textContent = funMessages[msgIdx]; subEl.style.opacity = 1; }, 200);
  }, 1800);

  const icons = ['📘','📗','📙','📕','📒','📓','📔','📑'];
  let done = 0;

  for (let i = 0; i < needDownload.length; i++) {
    const pack       = needDownload[i];
    const isAdminPack = pack._source === 'admin';
    const icon        = icons[i % icons.length];

    const row = document.createElement('div');
    row.className = 'init-pack-row loading';
    row.innerHTML = `
      <span class="init-pack-icon">${icon}</span>
      <span class="init-pack-name">${h(pack.name)}${isAdminPack ? ` <span style="font-size:0.55rem;color:var(--neon-yellow);opacity:0.7">${pack._reason==='updated'?'⟳':'⬡'}</span>` : ''}</span>
      <span class="init-pack-status loading">⟳</span>
    `;
    listEl.appendChild(row);
    listEl.scrollTop = listEl.scrollHeight;

    try {
      let ws = [];
      if (isAdminPack) {
        ws = pack.words || [];
        const progSnap = await window._getDoc(
          window._doc(window._db, 'users', getUID(), 'adminProgress', pack.id)
        ).catch(() => null);
        const prog = progSnap?.exists() ? (progSnap.data().progress || {}) : {};
        await IDB.set('ap::' + pack.id, { words: ws, updatedAt: pack.updatedAt || Date.now(), _progress: prog });
      } else {
        const snap = await window._getDoc(packDoc(pack.id));
        if (snap.exists()) ws = snap.data().words || [];
        await IDB.set(pack.id, { words: ws, updatedAt: Date.now() });
        const orig = packs.find(x => x.id === pack.id);
        if (orig) { orig._wordCount = ws.length; orig._masteredCount = ws.filter(w => w.mastered).length; }
      }

      row.className = 'init-pack-row done';
      row.querySelector('.init-pack-status').className = 'init-pack-status done';
      row.querySelector('.init-pack-status').textContent = `✓ ${ws.length} từ`;
    } catch(e) {
      console.warn('[download] Failed:', pack.name, e);
      row.querySelector('.init-pack-status').textContent = '✕';
      row.style.opacity = '0.4';
    }

    done++;
    fillEl.style.width  = Math.round(done / needDownload.length * 100) + '%';
    labelEl.textContent = `${done} / ${needDownload.length} gói`;
  }

  // 8. Lưu version mới vào IDB — lần sau sẽ dùng cache
  await IDB.set('__appversion__', { version: remoteVersion, cachedAt: Date.now() }).catch(() => {});
  savePacks().catch(() => {});

  clearInterval(msgTimer);
  titleEl.textContent = '✓ Hoàn tất!';
  subEl.textContent   = localVersion ? 'Dữ liệu đã được cập nhật.' : 'Từ nay mở app sẽ không cần tải lại.';
  fillEl.style.background = 'linear-gradient(90deg,var(--neon-green),var(--neon-cyan))';

  await new Promise(r => setTimeout(r, 900));
  overlay.classList.remove('show');
  showPacksScreen();
}

// Load metadata từ IDB cache (không cần Firebase)
async function _loadMetaFromCache() {
  try {
    const cachedKeys = await IDB.getAllKeys();
    const cachedSet = new Set(cachedKeys);
    for (const p of packs) {
      if (cachedSet.has(p.id)) {
        const cached = await IDB.get(p.id).catch(() => null);
        if (cached?.words) {
          p._wordCount     = cached.words.length;
          p._masteredCount = cached.words.filter(w => w.mastered).length;
        }
      }
    }
  } catch(e) {}
}



// Save study time when user leaves or hides the page
document.addEventListener('visibilitychange', () => { if (document.hidden) { statsStopSession(); activeTimeFlushOnExit(); } });
window.addEventListener('beforeunload', () => { statsStopSession(); activeTimeFlushOnExit(); });

async function handleAuthChange(user) {
  updateAuthBar();
  if (user && user.email) {
    const userRef = window._doc(window._db, 'users', user.uid);
    const isAdminUser = user.email === window.ADMIN_EMAIL;

    // ── Offline-first: đọc accessStatus từ IDB cache trước ──
    const IDB_ACCESS_KEY = 'access::' + user.uid;
    let cachedAccess = null;
    try {
      const c = await IDB.get(IDB_ACCESS_KEY);
      cachedAccess = c?.accessStatus || null;
    } catch(e) {}

    // Nếu offline và có cache → vào app luôn, không chờ Firebase
    if (!navigator.onLine && cachedAccess) {
      console.log('[offline] Using cached access:', cachedAccess);
      if (cachedAccess === 'approved' || isAdminUser) {
        document.getElementById('loginOverlay').classList.remove('show');
        document.getElementById('accessDeniedOverlay').classList.remove('show');
        initApp();
      } else if (cachedAccess === 'denied') {
        showAccessDenied(user);
      } else {
        showAccessPending(user);
      }
      return;
    }

    // Online: đọc/ghi Firestore bình thường
    try {
      const snap = await window._getDoc(userRef).catch(()=>null);
      const existing = snap && snap.exists() ? snap.data() : null;

      if (!existing) {
        await window._setDoc(userRef, {
          email: user.email,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
          isAdmin: isAdminUser,
          accessStatus: isAdminUser ? 'approved' : 'pending',
          lastSeen: Date.now()
        }).catch(()=>{});
      } else {
        await window._setDoc(userRef, {
          email: user.email,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
          isAdmin: isAdminUser,
          lastSeen: Date.now()
        }, { merge: true }).catch(()=>{});
      }

      const currentSnap = await window._getDoc(userRef).catch(()=>null);
      const access = isAdminUser
        ? 'approved'
        : (currentSnap && currentSnap.exists() ? currentSnap.data().accessStatus : 'pending') || 'pending';

      // Lưu accessStatus vào IDB để dùng offline lần sau
      await IDB.set(IDB_ACCESS_KEY, { accessStatus: access, email: user.email }).catch(()=>{});

      if (access === 'approved') {
        document.getElementById('loginOverlay').classList.remove('show');
        document.getElementById('accessDeniedOverlay').classList.remove('show');
        initApp();
      } else if (access === 'denied') {
        showAccessDenied(user);
      } else {
        showAccessPending(user);
      }
    } catch(e) {
      // Firebase lỗi nhưng có cache → dùng cache
      if (cachedAccess) {
        console.warn('[auth] Firebase error, using cached access:', cachedAccess);
        if (cachedAccess === 'approved' || isAdminUser) {
          document.getElementById('loginOverlay').classList.remove('show');
          document.getElementById('accessDeniedOverlay').classList.remove('show');
          initApp();
        } else {
          showAccessPending(user);
        }
      } else {
        // Không có cache, không có mạng → hiện thông báo
        showToast('error', '⚠ Không có mạng. Vui lòng kết nối lần đầu để xác thực.');
      }
    }
  } else {
    document.getElementById('accessDeniedOverlay').classList.remove('show');
    document.getElementById('loginOverlay').classList.add('show');
    const msgEl = document.getElementById('loginStatusMsg');
    if (msgEl) msgEl.textContent = '';
  }
}

// Tự khởi động khi Firebase sẵn sàng
window.addEventListener('firebase-ready', () => {
  handleAuthChange(window._currentUser);
});

// Lắng nghe thay đổi auth sau lần đầu
window.addEventListener('auth-changed', () => {
  handleAuthChange(window._currentUser);
});

// ── Service Worker — PWA offline hoàn chỉnh ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('[SW] Registered'))
    .catch(e => console.warn('[SW] Failed:', e));
}

// ============================================================
//  ✦ XP SCORING ENGINE
//  Firestore path: /users/{uid}/xp { total, log[], lastLoginDate,
//                                    activeMinutes, sessionStart }
//  Milestones hardcoded: 10,20,50 rồi cứ +50
// ============================================================

const XP_VALUES = {
  LOGIN_DAILY:   5,   // đăng nhập mỗi ngày
  MASTERED:      10,  // bấm "Đã thuộc"
  ACTIVE_10MIN:  8,   // mỗi 10 phút active
  ARTICLE_OPEN:  5,   // mở article context
  OPEN_PACK:     3,   // vào học một gói bất kỳ
  STREAK_BONUS: { 3:2, 7:5, 14:10, 21:20 }, // bonus ngày streak liên tiếp
};

// Milestones XP (vẫn giữ để dùng trong history chart)
function _getMilestones() {
  const ms = [10, 20, 50];
  for (let i = 100; i <= 9950; i += 50) ms.push(i);
  return ms;
}
const XP_MILESTONES = _getMilestones();

// Celebrate config — load từ Firestore appConfig, fallback về default
let CELEBRATE_EVERY = 5;  // cứ N từ đã thuộc → chúc mừng
let _mavisApiKey = '';  // load từ Firestore appConfig, chỉ admin mới set
let _totalMasteredSession = 0; // đếm tổng từ đã thuộc trong session (kể cả reset)

async function _loadAppConfig() {
  try {
    const ref = window._doc(window._db, 'appConfig', 'scoring');
    const snap = await window._getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      if (d.xpValues) {
        if (d.xpValues.LOGIN_DAILY  !== undefined) XP_VALUES.LOGIN_DAILY  = d.xpValues.LOGIN_DAILY;
        if (d.xpValues.MASTERED     !== undefined) XP_VALUES.MASTERED     = d.xpValues.MASTERED;
        if (d.xpValues.ACTIVE_10MIN !== undefined) XP_VALUES.ACTIVE_10MIN = d.xpValues.ACTIVE_10MIN;
        if (d.xpValues.ARTICLE_OPEN !== undefined) XP_VALUES.ARTICLE_OPEN = d.xpValues.ARTICLE_OPEN;
        if (d.xpValues.OPEN_PACK    !== undefined) XP_VALUES.OPEN_PACK    = d.xpValues.OPEN_PACK;
        if (d.xpValues.STREAK_BONUS !== undefined) XP_VALUES.STREAK_BONUS = d.xpValues.STREAK_BONUS;
      }
      if (d.celebrateEvery !== undefined) CELEBRATE_EVERY = d.celebrateEvery;
      if (d.mavisApiKey      !== undefined) _mavisApiKey      = d.mavisApiKey;
    }
  } catch(e) { console.warn('[AppConfig] load error', e); }
}

// State
let _xpSession = {
  total: 0,          // tổng XP hiện tại (load từ Firestore)
  todayXP: 0,        // XP kiếm được hôm nay
  todayMastered: 0,
  todayArticles: 0,
  todayActiveMin: 0,
  loginStreakDays: 0,
  loaded: false,
};

let _activeTimer = null;
let _activeSeconds = 0;
let _lastInteraction = 0;
const ACTIVE_IDLE_THRESHOLD = 60; // giây không tương tác → dừng đếm

// ── Load XP từ Firestore ──
async function xpLoad() {
  if (!isLoggedIn()) return;
  try {
    const ref = window._doc(window._db, 'users', getUID(), 'xp', 'data');
    const snap = await window._getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      const today = new Date().toISOString().slice(0,10);
      const dayKey = 'day_' + today;
      const todayData = d[dayKey] || {};

      _xpSession.total          = d.total || 0;
      _xpSession.loginStreakDays = d.loginStreakDays || 0;

      // Load lại số liệu hôm nay
      _xpSession.todayXP        = typeof todayData === 'object' ? (todayData.xp       || 0) : (todayData || 0);
      _xpSession.todayMastered  = typeof todayData === 'object' ? (todayData.mastered  || 0) : 0;
      _xpSession.todayArticles  = typeof todayData === 'object' ? (todayData.articles  || 0) : 0;
      // Active minutes: đọc từ activeMinutesByDay (lưu riêng bởi _activeTimeFlush)
      const byDay = d.activeMinutesByDay || {};
      _xpSession.todayActiveMin = byDay[today] || 0;
    }
    _xpSession.loaded = true;
  } catch(e) { console.warn('[XP] load error', e); }
}

// ── Lưu XP lên Firestore (debounced) ──
let _xpSaveTimer = null;
function _xpScheduleSave() {
  clearTimeout(_xpSaveTimer);
  _xpSaveTimer = setTimeout(_xpSave, 3000);
}
async function _xpSave() {
  if (!isLoggedIn()) return;
  try {
    const ref = window._doc(window._db, 'users', getUID(), 'xp', 'data');
    const today = new Date().toISOString().slice(0,10);
    await window._setDoc(ref, {
      total: _xpSession.total,
      loginStreakDays: _xpSession.loginStreakDays,
      lastUpdated: Date.now(),
      // Lưu tất cả chỉ số hôm nay vào object theo ngày
      ['day_' + today]: {
        xp:       _xpSession.todayXP,
        mastered: _xpSession.todayMastered,
        articles: _xpSession.todayArticles,
      },
    }, { merge: true });
  } catch(e) { console.warn('[XP] save error', e); }
}

// ── Core: cộng điểm ──
function xpAdd(amount, reason) {
  if (!isLoggedIn() || amount <= 0) return;
  const prev = _xpSession.total;
  _xpSession.total += amount;
  _xpSession.todayXP += amount;
  _xpScheduleSave();

  // XP milestone tracking (dùng cho history chart)
  // Celebration theo từ được xử lý riêng trong xpOnMastered
}

// ── Celebration theo từ đã thuộc ──
function _fireMasteredCelebration(total, every) {
  const el = document.createElement('div');
  el.id = 'xp-milestone-toast';
  el.innerHTML = `
    <div style="
      position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) scale(0.8);
      z-index:99999; text-align:center;
      background:rgba(5,5,15,0.95);
      border:1.5px solid rgba(57,255,20,0.5);
      border-radius:20px; padding:28px 40px;
      font-family:'Syne',sans-serif;
      box-shadow:0 0 60px rgba(57,255,20,0.15);
      animation: xpMilestoneIn 0.4s cubic-bezier(0.175,0.885,0.32,1.275) forwards;
    ">
      <div style="font-size:2.2rem;margin-bottom:8px">🎉</div>
      <div style="font-size:0.6rem;letter-spacing:0.25em;text-transform:uppercase;color:rgba(57,255,20,0.7);margin-bottom:8px">Chúc mừng!</div>
      <div style="font-size:1rem;font-weight:800;color:#fff;line-height:1.4">Bạn đã thuộc thêm</div>
      <div style="font-size:3rem;font-weight:800;color:var(--neon-green);line-height:1.1">${every}</div>
      <div style="font-size:1rem;font-weight:800;color:#fff">từ vựng</div>
      <div style="font-size:0.7rem;color:rgba(255,255,255,0.3);margin-top:8px">Tổng đã thuộc hôm nay: ${total} từ</div>
    </div>
  `;
  document.body.appendChild(el);

  // Thêm keyframe nếu chưa có
  if (!document.getElementById('xp-milestone-style')) {
    const s = document.createElement('style');
    s.id = 'xp-milestone-style';
    s.textContent = `
      @keyframes xpMilestoneIn {
        0%   { opacity:0; transform:translate(-50%,-50%) scale(0.7); }
        100% { opacity:1; transform:translate(-50%,-50%) scale(1); }
      }
    `;
    document.head.appendChild(s);
  }

  setTimeout(() => {
    el.querySelector('div').style.transition = 'opacity 0.5s, transform 0.5s';
    el.querySelector('div').style.opacity = '0';
    el.querySelector('div').style.transform = 'translate(-50%,-60%) scale(0.9)';
    setTimeout(() => el.remove(), 600);
  }, 2200);
}

// ── Micro XP badge (nổi lên tại điểm tương tác) ──
function _xpFloatBadge(amount, sourceEl) {
  const badge = document.createElement('div');
  badge.textContent = '+' + amount + ' XP';
  badge.style.cssText = `
    position:fixed; z-index:9998; pointer-events:none;
    font-family:'Space Mono',monospace; font-size:0.72rem; font-weight:700;
    color:var(--neon-yellow); text-shadow:0 0 8px rgba(255,230,0,0.6);
    animation: xpFloat 0.9s ease-out forwards;
  `;
  if (!document.getElementById('xp-float-style')) {
    const s = document.createElement('style');
    s.id = 'xp-float-style';
    s.textContent = `
      @keyframes xpFloat {
        0%   { opacity:1; transform:translateY(0); }
        100% { opacity:0; transform:translateY(-36px); }
      }
    `;
    document.head.appendChild(s);
  }

  // Đặt vị trí gần element nếu có, không thì giữa màn hình
  if (sourceEl) {
    const r = sourceEl.getBoundingClientRect();
    badge.style.left = (r.left + r.width/2 - 20) + 'px';
    badge.style.top  = (r.top - 8) + 'px';
  } else {
    badge.style.left = '50%';
    badge.style.top  = '40%';
    badge.style.transform = 'translateX(-50%)';
  }
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 950);
}

// ── Active time tracker ──
function xpRecordInteraction() {
  _lastInteraction = Date.now();
  if (!_activeTimer) {
    _activeTimer = setInterval(() => {
      const now = Date.now();
      if ((now - _lastInteraction) / 1000 > ACTIVE_IDLE_THRESHOLD) {
        // Idle quá lâu → dừng timer
        clearInterval(_activeTimer);
        _activeTimer = null;
        return;
      }
      _activeSeconds++;
      if (_activeSeconds > 0 && _activeSeconds % 600 === 0) {
        // Mỗi 10 phút active → cộng điểm
        _xpSession.todayActiveMin += 10;
        xpAdd(XP_VALUES.ACTIVE_10MIN, 'active_10min');
        showToast('success', `⏱ +${XP_VALUES.ACTIVE_10MIN} XP — 10 phút học tập!`);
      }
    }, 1000);
  }
}

// ── Điểm đăng nhập hàng ngày + streak ──
async function xpRecordDailyLogin() {
  if (!isLoggedIn()) return;
  try {
    const today = new Date().toISOString().slice(0,10);
    const ref = window._doc(window._db, 'users', getUID(), 'xp', 'data');
    const snap = await window._getDoc(ref);
    const d = snap.exists() ? snap.data() : {};

    if (d.lastLoginDate === today) return; // đã tính hôm nay rồi

    // Tính streak
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
    let streak = (d.lastLoginDate === yesterday) ? (d.loginStreakDays || 0) + 1 : 1;
    _xpSession.loginStreakDays = streak;

    let xp = XP_VALUES.LOGIN_DAILY;
    // Bonus streak
    const bonusKeys = Object.keys(XP_VALUES.STREAK_BONUS).map(Number).sort((a,b)=>b-a);
    for (const k of bonusKeys) {
      if (streak >= k) { xp += XP_VALUES.STREAK_BONUS[k]; break; }
    }

    await window._setDoc(ref, {
      lastLoginDate: today,
      loginStreakDays: streak,
    }, { merge: true });

    xpAdd(xp, 'daily_login');

    if (streak > 1) {
      showToast('success', `🔥 Streak ${streak} ngày! +${xp} XP`);
    }
  } catch(e) { console.warn('[XP] daily login error', e); }
}

// ── Điểm vào học pack (1 lần/ngày/pack) ──
const _xpOpenedPacksToday = new Set();
function xpRecordOpenPack(packId) {
  const key = new Date().toISOString().slice(0,10) + '::' + packId;
  if (_xpOpenedPacksToday.has(key)) return;
  _xpOpenedPacksToday.add(key);
  xpAdd(XP_VALUES.OPEN_PACK, 'open_pack');
}

// ── Public API cho các action ──
function xpOnMastered(btnEl) {
  _xpSession.todayMastered++;
  _totalMasteredSession++;
  xpAdd(XP_VALUES.MASTERED, 'mastered'); // xpAdd đã gọi _xpScheduleSave
  _xpFloatBadge(XP_VALUES.MASTERED, btnEl);
  xpRecordInteraction();
  activeTimeRecordInteraction(); // ✦ active time

  // Chúc mừng mỗi CELEBRATE_EVERY từ đã thuộc
  if (CELEBRATE_EVERY > 0 && _totalMasteredSession % CELEBRATE_EVERY === 0) {
    _fireMasteredCelebration(_totalMasteredSession, CELEBRATE_EVERY);
  }
}

function xpOnArticleOpen() {
  _xpSession.todayArticles++;
  xpAdd(XP_VALUES.ARTICLE_OPEN, 'article_open'); // xpAdd đã gọi _xpScheduleSave
  xpRecordInteraction();
  activeTimeRecordInteraction(); // ✦ active time
}

function xpOnFlashcardAction() {
  xpRecordInteraction();
  activeTimeRecordInteraction(); // ✦ active time
}

// ── Tổng kết hôm nay ──
function showDailySummary() {
  // Flush active time tích lũy chưa được đẩy lên
  if (_activeLastInteraction > 0 && _activeAccumSec >= 60) {
    const mins = Math.floor(_activeAccumSec / 60);
    _activeAccumSec -= mins * 60;
    _xpSession.todayActiveMin += mins; // cập nhật in-memory ngay
    _activeTimeFlush(mins);
  }
  const s = _xpSession;
  const streak = s.loginStreakDays;
  const total  = s.total;

  // Tìm milestone tiếp theo
  const nextMs = XP_MILESTONES.find(m => m > total) || null;
  const toNext  = nextMs ? nextMs - total : 0;
  const fromPrev = nextMs
    ? (XP_MILESTONES[XP_MILESTONES.indexOf(nextMs) - 1] || 0)
    : (XP_MILESTONES[XP_MILESTONES.length - 1]);
  const pct = nextMs
    ? Math.round(((total - fromPrev) / (nextMs - fromPrev)) * 100)
    : 100;

  const html = `
    <div id="dailySummaryOverlay" onclick="if(event.target===this)closeDailySummary()" style="
      position:fixed;inset:0;z-index:10000;
      background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);
      display:flex;align-items:center;justify-content:center;padding:20px;
    ">
      <div style="
        background:#0d0d1f;border:1px solid rgba(0,245,255,0.2);
        border-radius:24px;padding:32px 28px;max-width:400px;width:100%;
        font-family:'Inter',sans-serif;
        box-shadow:0 0 80px rgba(0,245,255,0.06);
      ">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:0.6rem;letter-spacing:0.25em;text-transform:uppercase;color:rgba(255,255,255,0.3);font-family:'Space Mono',monospace;margin-bottom:8px">Tổng kết hôm nay</div>
          <div style="font-size:3rem;font-weight:800;font-family:'Syne',sans-serif;background:linear-gradient(135deg,var(--neon-cyan),var(--neon-purple));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">+${s.todayXP}</div>
          <div style="font-size:0.75rem;color:rgba(255,255,255,0.35)">XP kiếm được hôm nay</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px">
          ${_summaryCard('Đã thuộc', s.todayMastered + ' từ', 'var(--neon-green)')}
          ${_summaryCard('Thời gian active', s.todayActiveMin + ' phút', 'var(--neon-cyan)')}
          ${_summaryCard('Bài báo đã đọc', s.todayArticles + ' bài', 'var(--neon-purple)')}
          ${_summaryCard('Streak', streak + ' ngày 🔥', 'var(--neon-yellow)')}
        </div>

        <div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:rgba(255,255,255,0.4);margin-bottom:6px">
            <span>Tổng điểm: <strong style="color:#fff">${total}</strong></span>
            ${nextMs ? `<span>Mốc tiếp theo: <strong style="color:var(--neon-yellow)">${nextMs}</strong> (còn ${toNext})</span>` : '<span style="color:var(--neon-green)">✦ Đã đạt tất cả mốc!</span>'}
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--neon-cyan),var(--neon-purple));border-radius:3px;transition:width 0.6s ease"></div>
          </div>
        </div>

        <button onclick="closeDailySummary()" style="
          width:100%;padding:14px;border:none;border-radius:12px;
          background:linear-gradient(135deg,rgba(0,245,255,0.15),rgba(191,0,255,0.15));
          border:1px solid rgba(0,245,255,0.3);
          color:var(--neon-cyan);font-family:'Syne',sans-serif;font-size:0.85rem;
          font-weight:800;letter-spacing:0.08em;cursor:pointer;
          text-transform:uppercase;transition:all 0.2s;
        " onmouseover="this.style.background='linear-gradient(135deg,rgba(0,245,255,0.25),rgba(191,0,255,0.25))'"
           onmouseout="this.style.background='linear-gradient(135deg,rgba(0,245,255,0.15),rgba(191,0,255,0.15))'">
          ✓ Đóng
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function _summaryCard(label, val, color) {
  return `
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px 14px">
      <div style="font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.3);font-family:'Space Mono',monospace;margin-bottom:4px">${label}</div>
      <div style="font-size:1rem;font-weight:700;font-family:'Syne',sans-serif;color:${color}">${val}</div>
    </div>
  `;
}

function closeDailySummary() {
  const el = document.getElementById('dailySummaryOverlay');
  if (el) el.remove();
}

// ── Khởi động engine khi login xong ──
async function xpInit() {
  await _loadAppConfig(); // load XP values và celebrate config từ Firestore
  await xpLoad();
  await xpRecordDailyLogin();
}

// ============================================================
//  ◈ LỊCH SỬ HỌC — popup thống kê toàn bộ + biểu đồ
// ============================================================
async function showStudyHistory() {
  if (!isLoggedIn()) return;

  // Render skeleton trước, load data sau
  const overlay = document.createElement('div');
  overlay.id = 'studyHistoryOverlay';
  overlay.onclick = e => { if (e.target === overlay) closeStudyHistory(); };
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:10000;
    background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);
    display:flex;align-items:center;justify-content:center;padding:16px;
    overflow-y:auto;
  `;
  overlay.innerHTML = `
    <div id="studyHistoryBox" style="
      background:#0d0d1f;border:1px solid rgba(0,245,255,0.15);
      border-radius:24px;padding:28px 24px;width:100%;max-width:560px;
      font-family:'Inter',sans-serif;position:relative;
    ">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
        <div>
          <div style="font-size:0.55rem;letter-spacing:0.25em;text-transform:uppercase;color:rgba(255,255,255,0.25);font-family:'Space Mono',monospace;margin-bottom:4px">Thống kê học tập</div>
          <div style="font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:800;color:#fff">Lịch sử của bạn</div>
        </div>
        <button onclick="closeStudyHistory()" style="
          width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,0.06);
          border:none;color:rgba(255,255,255,0.4);font-size:1rem;cursor:pointer;
          display:flex;align-items:center;justify-content:center;transition:all 0.15s;flex-shrink:0;
        " onmouseover="this.style.background='rgba(255,0,110,0.15)';this.style.color='var(--neon-pink)'"
           onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.color='rgba(255,255,255,0.4)'">✕</button>
      </div>

      <!-- Stat cards -->
      <div id="shStatCards" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px">
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:1.5rem;font-weight:800;font-family:'Syne',sans-serif;color:var(--neon-cyan)">—</div>
          <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);letter-spacing:0.1em;text-transform:uppercase;font-family:'Space Mono',monospace;margin-top:3px">Tổng XP</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:1.5rem;font-weight:800;font-family:'Syne',sans-serif;color:var(--neon-green)">—</div>
          <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);letter-spacing:0.1em;text-transform:uppercase;font-family:'Space Mono',monospace;margin-top:3px">Từ đã thuộc</div>
        </div>
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:1.5rem;font-weight:800;font-family:'Syne',sans-serif;color:var(--neon-yellow)">—</div>
          <div style="font-size:0.6rem;color:rgba(255,255,255,0.3);letter-spacing:0.1em;text-transform:uppercase;font-family:'Space Mono',monospace;margin-top:3px">Streak 🔥</div>
        </div>
      </div>

      <!-- Chart -->
      <div style="margin-bottom:20px">
        <div style="font-size:0.58rem;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.25);font-family:'Space Mono',monospace;margin-bottom:10px">Thời gian active — 30 ngày gần nhất (phút)</div>
        <div style="position:relative;height:140px"><canvas id="shChart"></canvas></div>
      </div>

      <!-- XP milestone progress -->
      <div id="shMilestone" style="margin-bottom:20px"></div>

      <!-- Lịch sử ngày -->
      <div>
        <div style="font-size:0.58rem;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.25);font-family:'Space Mono',monospace;margin-bottom:10px">Lịch sử từng ngày</div>
        <div id="shDayList" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
          <div style="color:rgba(255,255,255,0.25);font-size:0.78rem;text-align:center;padding:20px">Đang tải...</div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Load Chart.js nếu chưa có
  if (!window.Chart) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // Load data
  try {
    const snap = await window._getDoc(userDoc());
    const d = snap.exists() ? snap.data() : {};
    const studyHistory = d.studyHistory || {};   // { 'YYYY-MM-DD': wordCount }
    const totalMins    = d.totalStudyMinutes || 0;

    // XP data
    const xpRef  = window._doc(window._db, 'users', getUID(), 'xp', 'data');
    const xpSnap = await window._getDoc(xpRef);
    const xpData = xpSnap.exists() ? xpSnap.data() : {};
    const totalXP = xpData.total || _xpSession.total || 0;
    const streak  = xpData.loginStreakDays || _xpSession.loginStreakDays || 0;

    // Tổng từ đang ở trạng thái mastered=true hiện tại
    // Đọc từ IDB theo đúng các pack user đang có, không scan toàn bộ
    let totalMastered = 0;
    try {
      // 1. Own packs
      for (const pack of (packs || [])) {
        const cached = await IDB.get(pack.id).catch(() => null);
        if (!cached) continue;
        const ws = cached.words || [];
        totalMastered += ws.filter(w => w.mastered && !w.hidden).length;
      }
      // 2. Admin packs — _progress phản ánh trạng thái hiện tại
      //    saveData() rebuild prog từ words.mastered nên reset là sạch
      const allKeys = await IDB.getAllKeys();
      for (const key of allKeys.filter(k => k.startsWith('ap::'))) {
        const cached = await IDB.get(key).catch(() => null);
        if (!cached) continue;
        const prog = cached._progress || {};
        totalMastered += Object.keys(prog).length;
      }
    } catch(e) {
      if (packs && packs.length) {
        totalMastered = packs.reduce((s, p) => s + (p._masteredCount || 0), 0);
      }
    }

    // Update stat cards
    const cards = document.querySelectorAll('#shStatCards > div > div:first-child');
    if (cards[0]) cards[0].textContent = totalXP;
    if (cards[1]) cards[1].textContent = totalMastered;
    if (cards[2]) cards[2].textContent = streak + ' ngày';

    // activeMinutesByDay từ xpData (lưu trong /users/{uid}/xp/data)
    const activeByDay = xpData.activeMinutesByDay || {};

    // Build 30 ngày gần nhất
    const labels = [], dataMin = [];
    for (let i = 29; i >= 0; i--) {
      const d2 = new Date(Date.now() - i * 86400000);
      const key = d2.toISOString().slice(0,10);
      const shortLabel = (d2.getMonth()+1) + '/' + d2.getDate();
      labels.push(shortLabel);
      dataMin.push(activeByDay[key] || 0);
    }

    // Vẽ chart
    const ctx = document.getElementById('shChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: dataMin,
          backgroundColor: dataMin.map(v => v > 0 ? 'rgba(0,245,255,0.55)' : 'rgba(255,255,255,0.05)'),
          borderColor:      dataMin.map(v => v > 0 ? 'rgba(0,245,255,0.9)' : 'rgba(255,255,255,0.08)'),
          borderWidth: 1,
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: {
          backgroundColor: 'rgba(5,5,15,0.95)',
          titleColor: 'rgba(255,255,255,0.4)',
          bodyColor: '#00f5ff',
          borderColor: 'rgba(0,245,255,0.2)',
          borderWidth: 1,
          callbacks: { label: ctx => ctx.raw + ' phút active' }
        }},
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.2)', font: { size: 9 }, maxTicksLimit: 10 } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: 'rgba(255,255,255,0.2)', font: { size: 9 } }, beginAtZero: true }
        }
      }
    });

    // Milestone progress
    const nextMs  = XP_MILESTONES.find(m => m > totalXP) || null;
    const prevMs  = nextMs ? (XP_MILESTONES[XP_MILESTONES.indexOf(nextMs) - 1] || 0) : XP_MILESTONES[XP_MILESTONES.length-1];
    const pct     = nextMs ? Math.round(((totalXP - prevMs) / (nextMs - prevMs)) * 100) : 100;
    const msEl = document.getElementById('shMilestone');
    if (msEl) msEl.innerHTML = `
      <div style="font-size:0.58rem;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.25);font-family:'Space Mono',monospace;margin-bottom:8px">Tiến độ đến mốc tiếp theo</div>
      <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:rgba(255,255,255,0.35);margin-bottom:6px">
        <span>Hiện tại: <strong style="color:var(--neon-cyan)">${totalXP} XP</strong></span>
        ${nextMs ? `<span>Mốc: <strong style="color:var(--neon-yellow)">${nextMs} XP</strong> (còn ${nextMs - totalXP})</span>` : `<span style="color:var(--neon-green)">✦ Đã đạt tất cả mốc!</span>`}
      </div>
      <div style="height:8px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--neon-cyan),var(--neon-purple));border-radius:4px;transition:width 0.8s ease"></div>
      </div>
    `;

    // Danh sách ngày gần nhất
    const dayListEl = document.getElementById('shDayList');
    const allDays = Object.keys(studyHistory).sort().reverse();
    if (!allDays.length) {
      dayListEl.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:0.78rem;text-align:center;padding:20px">Chưa có lịch sử học tập.</div>';
    } else {
      dayListEl.innerHTML = allDays.slice(0,30).map(day => {
        const wc = studyHistory[day];
        const dayXP = xpData['day_' + day] || 0;
        const isToday = day === new Date().toISOString().slice(0,10);
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;
            background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);
            border-radius:8px;padding:8px 12px;
            ${isToday ? 'border-color:rgba(0,245,255,0.2);' : ''}">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-family:'Space Mono',monospace;font-size:0.7rem;color:${isToday?'var(--neon-cyan)':'rgba(255,255,255,0.35)'}">
                ${isToday ? '▶ Hôm nay' : day}
              </span>
            </div>
            <div style="display:flex;gap:12px;font-size:0.68rem;font-family:'Space Mono',monospace">
              <span style="color:rgba(57,255,20,0.7)">${wc} từ</span>
              ${dayXP ? `<span style="color:rgba(255,230,0,0.6)">+${dayXP} XP</span>` : ''}
            </div>
          </div>`;
      }).join('');
    }

  } catch(e) {
    console.warn('[StudyHistory] error', e);
    const box = document.getElementById('shDayList');
    if (box) box.innerHTML = `<div style="color:var(--neon-pink);font-size:0.78rem;text-align:center;padding:20px">Không tải được dữ liệu.</div>`;
  }
}

function closeStudyHistory() {
  const el = document.getElementById('studyHistoryOverlay');
  if (el) el.remove();
}

// ── Offline/online banner ──
function _showOfflineBanner(show) {
  let el = document.getElementById('offlineBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'offlineBanner';
    el.style.cssText = `
      position:fixed; top:0; left:0; right:0; z-index:9999;
      background:rgba(255,140,0,0.92); backdrop-filter:blur(8px);
      color:#000; text-align:center; font-family:Syne,sans-serif;
      font-size:0.75rem; font-weight:700; letter-spacing:0.08em;
      padding:8px 16px; transform:translateY(-100%);
      transition:transform 0.3s ease;
    `;
    el.textContent = '⚡ OFFLINE — Đang dùng dữ liệu đã lưu';
    document.body.appendChild(el);
  }
  el.style.transform = show ? 'translateY(0)' : 'translateY(-100%)';
}

window.addEventListener('online',  () => _showOfflineBanner(false));
window.addEventListener('offline', () => _showOfflineBanner(true));
if (!navigator.onLine) _showOfflineBanner(true);

// ============================================================
//  ⚡ LUYỆN TẬP — AI-powered practice session
// ============================================================

let _ltWords = [];
let _ltGroups = [];
let _ltCurrentGroup = 0;
let _ltExercises = [];
let _ltCurrentEx = 0;
let _ltScore = 0;
let _ltTotal = 0;
let _ltIsSaved = false; // đã lưu lên Firebase chưa
const LT_MAX_WORDS = 20;

function openLuyenTap() {
  _ltWords = words.filter(w => !w.mastered && !w.hidden);

  let overlay = document.getElementById('luyentapOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'luyentapOverlay';
    overlay.className = 'lt-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="lt-modal">
      <div class="lt-modal-header">
        <div class="lt-modal-title">⚡ Luyện tập cùng AI</div>
        <button class="lt-close-btn" onclick="closeLuyenTap()">✕</button>
      </div>
      <div class="lt-modal-body" id="ltBody"></div>
    </div>
  `;

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';

  _ltRenderWordPreview();
}

async function _ltRenderWordPreview() {
  const body = document.getElementById('ltBody');
  const count = _ltWords.length;

  if (count < 3) {
    body.innerHTML = `
      <div class="lt-error">
        <div style="font-size:2rem">📭</div>
        <div>Cần ít nhất 3 từ chưa thuộc để luyện tập!</div>
        <button class="lt-retry-btn" onclick="closeLuyenTap()">Đóng</button>
      </div>`;
    return;
  }

  if (count > LT_MAX_WORDS) {
    body.innerHTML = `
      <div class="lt-preview">
        <div class="lt-preview-stats">
          <div class="lt-stat-box">
            <div class="lt-stat-num" style="color:var(--neon-yellow)">${count}</div>
            <div class="lt-stat-lbl">từ chưa thuộc</div>
          </div>
          <div class="lt-stat-box">
            <div class="lt-stat-num" style="color:var(--neon-green)">${words.filter(w=>w.mastered).length}</div>
            <div class="lt-stat-lbl">đã thuộc</div>
          </div>
          <div class="lt-stat-box">
            <div class="lt-stat-num" style="color:var(--neon-cyan)">${words.filter(w=>w.hidden).length}</div>
            <div class="lt-stat-lbl">đã ẩn</div>
          </div>
        </div>
        <div class="lt-limit-warn">
          <div class="lt-limit-icon">⚠</div>
          <div class="lt-limit-title">Quá nhiều từ để luyện tập</div>
          <div class="lt-limit-msg">
            Bạn đang có <strong>${count} từ</strong> chưa thuộc.<br>
            Tính năng này chỉ hoạt động với <strong>≤ ${LT_MAX_WORDS} từ</strong> để bài tập không quá dài và hiệu quả hơn.<br><br>
            Hãy <strong>học thêm vài từ</strong> trong flashcard hoặc <strong>ẩn bớt</strong> những từ chưa muốn học trước.
          </div>
        </div>
        <button class="lt-retry-btn" style="width:100%;padding:12px;margin-top:4px" onclick="closeLuyenTap()">← Quay lại flashcard</button>
      </div>`;
    return;
  }

  // ── Kiểm tra IDB local trước ──
  const cacheKey = 'lt::' + (currentPack?.id || 'default');
  const wordSnapshot = _ltWords.map(w => w.word).sort().join(',');
  let cached = null;
  try { cached = await IDB.get(cacheKey); } catch(e) {}

  const hasLocal = cached && cached.groups?.length;
  const hasSameWords = hasLocal && cached.wordSnapshot === wordSnapshot;
  const savedDate = cached ? new Date(cached.savedAt) : null;
  const dateStr = savedDate ? savedDate.toLocaleDateString('vi-VN', {
    day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
  }) : '';

  const wordChips = _ltWords.map(w => `
    <div class="lt-preview-word-row">
      <span class="lt-preview-word">${h(w.word)}</span>
      <span class="lt-preview-meaning">${h(w.meaning)}</span>
    </div>
  `).join('');

  // Banner bài đã lưu local
  const cachedBanner = hasLocal ? `
    <div class="lt-cached-banner">
      <div class="lt-cached-info">
        <span class="lt-cached-icon">💾</span>
        <div>
          <div class="lt-cached-title">${hasSameWords ? 'Có bài tập đã lưu trên máy' : 'Có bài cũ (danh sách từ đã thay đổi)'}</div>
          <div class="lt-cached-date">Lưu lúc ${dateStr} · ${cached.groups?.length || 0} nhóm</div>
        </div>
      </div>
      <button class="lt-cached-use-btn" onclick="_ltLoadCached()">▶ Dùng ngay</button>
    </div>
  ` : '';

  // Banner tải từ cloud (chỉ khi online + đăng nhập)
  const cloudBanner = isLoggedIn() ? `
    <div class="lt-cloud-pull-banner">
      <span class="lt-cached-icon">☁</span>
      <div style="flex:1">
        <div class="lt-cached-title" style="color:var(--neon-cyan)">Tải bài tập từ cloud</div>
        <div class="lt-cached-date">Bài tập bạn đã lưu trên thiết bị khác</div>
      </div>
      <button class="lt-cached-use-btn" id="ltPullBtn" style="border-color:rgba(0,245,255,0.35);color:var(--neon-cyan);background:rgba(0,245,255,0.08)" onclick="_ltPullFromFirebase()">⬇ Tải xuống</button>
    </div>
  ` : '';

  body.innerHTML = `
    <div class="lt-preview">
      <div class="lt-preview-stats">
        <div class="lt-stat-box">
          <div class="lt-stat-num" style="color:var(--neon-cyan)">${count}</div>
          <div class="lt-stat-lbl">từ sẽ luyện</div>
        </div>
        <div class="lt-stat-box">
          <div class="lt-stat-num" style="color:var(--neon-purple)">4</div>
          <div class="lt-stat-lbl">dạng bài tập</div>
        </div>
        <div class="lt-stat-box">
          <div class="lt-stat-num" style="color:var(--neon-green)">${Math.min(4, Math.ceil(count/5))}</div>
          <div class="lt-stat-lbl">nhóm từ</div>
        </div>
      </div>

      ${cachedBanner}
      ${cloudBanner}

      <div class="lt-preview-list-label">Danh sách từ sẽ luyện tập</div>
      <div class="lt-preview-word-list">${wordChips}</div>

      <button class="lt-start-ex-btn" style="margin-top:16px" onclick="_ltGenerate()">
        ✦ Tạo bài tập mới bằng AI →
      </button>
    </div>
  `;
}

function closeLuyenTap() {
  const overlay = document.getElementById('luyentapOverlay');
  if (overlay) {
    overlay.classList.remove('show');
    document.body.style.overflow = '';
  }
}

// ── Key Firebase: users/{uid}/luyenTap/{packId} ──
function _ltFirebaseRef() {
  const packId = currentPack?.id || 'default';
  return window._doc(window._db, 'users', getUID(), 'luyenTap', packId);
}

// Load từ IDB local (không gọi network)
async function _ltLoadCached() {
  const cacheKey = 'lt::' + (currentPack?.id || 'default');
  try {
    const cached = await IDB.get(cacheKey);
    if (!cached || !cached.groups?.length) {
      showToast('error', '⚠ Không tìm thấy bài tập đã lưu');
      return;
    }
    _ltGroups = cached.groups;
    _ltCurrentGroup = 0;
    _ltCurrentEx = 0;
    _ltScore = 0;
    _ltTotal = 0;
    _ltIsSaved = true; // đã có trên cloud (bài này từ cloud kéo về)
    _ltRenderGroupMenu();
  } catch(e) {
    showToast('error', '⚠ Lỗi tải bài tập: ' + e.message);
  }
}

// Lưu bài tập lên Firebase + cache IDB
async function _ltSaveToFirebase() {
  if (!isLoggedIn()) { showToast('error', '⚠ Cần đăng nhập để lưu'); return; }
  if (!_ltGroups.length) return;
  const btn = document.getElementById('ltSaveBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⟳ Đang lưu...'; }
  try {
    const now = Date.now();
    const packId = currentPack?.id || 'default';
    const wordSnapshot = _ltWords.map(w => w.word).sort().join(',');
    const payload = {
      groups: _ltGroups,
      wordSnapshot,
      packId,
      packName: currentPack?.name || '',
      savedAt: now
    };
    // Lưu Firebase
    await window._setDoc(_ltFirebaseRef(), payload, { merge: false });
    // Cache IDB luôn
    await IDB.set('lt::' + packId, payload).catch(() => {});
    _ltIsSaved = true;
    _ltRenderGroupMenu();
    showToast('success', '☁ Đã lưu bài tập lên cloud!');
  } catch(e) {
    showToast('error', '✕ Lỗi lưu: ' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '☁ Lưu bài tập lên cloud'; }
  }
}

// Kéo bài tập từ Firebase về (user chủ động nhấn)
async function _ltPullFromFirebase() {
  if (!isLoggedIn()) { showToast('error', '⚠ Cần đăng nhập'); return; }
  if (!navigator.onLine) { showToast('error', '⚠ Không có mạng'); return; }
  const body = document.getElementById('ltBody');
  // Hiện loading nhỏ
  const pullBtn = document.getElementById('ltPullBtn');
  if (pullBtn) { pullBtn.disabled = true; pullBtn.textContent = '⟳ Đang tải...'; }
  try {
    const snap = await window._getDoc(_ltFirebaseRef());
    if (!snap.exists() || !snap.data().groups?.length) {
      showToast('error', '⚠ Chưa có bài tập trên cloud cho gói này');
      if (pullBtn) { pullBtn.disabled = false; pullBtn.textContent = '⬇ Tải từ cloud'; }
      return;
    }
    const data = snap.data();
    // Lưu vào IDB
    const packId = currentPack?.id || 'default';
    await IDB.set('lt::' + packId, data).catch(() => {});
    _ltGroups = data.groups;
    _ltCurrentGroup = 0;
    _ltCurrentEx = 0;
    _ltScore = 0;
    _ltTotal = 0;
    _ltIsSaved = true;
    showToast('success', '⬇ Đã tải bài tập từ cloud!');
    _ltRenderGroupMenu();
  } catch(e) {
    showToast('error', '✕ Lỗi tải: ' + e.message);
    if (pullBtn) { pullBtn.disabled = false; pullBtn.textContent = '⬇ Tải từ cloud'; }
  }
}

async function _ltGenerate() {
  const apiKey = getMavisApiKey();
  if (!apiKey) {
    document.getElementById('ltBody').innerHTML = `
      <div class="lt-error">
        <div style="font-size:2rem">🔑</div>
        <div>Chưa có API Key. Admin cần cài đặt MAVIS API Key trong Admin Panel.</div>
        <button class="lt-retry-btn" onclick="closeLuyenTap()">Đóng</button>
      </div>`;
    return;
  }

  // Hiện loading
  document.getElementById('ltBody').innerHTML = `
    <div class="lt-loading">
      <div class="lt-loading-spinner"></div>
      <div class="lt-loading-title">AI đang tạo bài tập...</div>
      <div class="lt-loading-sub">Đang phân nhóm ${_ltWords.length} từ và viết đoạn văn</div>
    </div>`;
  const wordList = _ltWords.slice(0, 30).map(w =>
    `${w.word}|${w.meaning}|${w.type||''}|${w.level||''}`
  ).join('\n');

  const prompt = `Bạn là giáo viên tiếng Anh. Tôi có danh sách từ vựng sau (định dạng: từ|nghĩa|loại từ|level):

${wordList}

Hãy:
1. Phân nhóm các từ thành 2-4 nhóm theo chủ đề hoặc ngữ nghĩa liên quan (mỗi nhóm 3-8 từ)
2. Viết 1 đoạn văn ngắn (4-6 câu) bằng tiếng Anh tích hợp tự nhiên các từ trong nhóm
3. Tạo bài tập cho mỗi nhóm gồm 4 loại:
   - "mcq": 4-6 câu trắc nghiệm về nghĩa hoặc cách dùng (4 đáp án, 1 đúng)
   - "match": nối từ với nghĩa (4-6 cặp)
   - "fill": điền từ vào chỗ trống (3-5 câu, mỗi câu bỏ 1 từ trong nhóm)
   - "order": sắp xếp các từ thành câu hoàn chỉnh (2-3 câu)

QUY TẮC BẮT BUỘC cho bài "order":
- Trường "words" phải chứa ĐÚNG các từ cấu thành câu trong "answer", không thêm không bớt
- Ghép tất cả từ trong "words" lại (theo đúng thứ tự) phải ra đúng câu "answer"
- Ví dụ đúng: words: ["The","cat","sat"] → answer: "The cat sat"
- Ví dụ SAI: words: ["cat","sat"] nhưng answer: "The cat sat" (thiếu "The")

Trả về JSON hợp lệ, không có gì khác ngoài JSON:
{
  "groups": [
    {
      "theme": "tên chủ đề",
      "words": ["word1", "word2"],
      "passage": "đoạn văn tiếng Anh",
      "passage_vi": "dịch nghĩa tiếng Việt ngắn gọn",
      "exercises": {
        "mcq": [
          { "q": "câu hỏi", "opts": ["A","B","C","D"], "ans": 0 }
        ],
        "match": [
          { "word": "từ", "meaning": "nghĩa tiếng Việt" }
        ],
        "fill": [
          { "sentence": "câu với ___ thay từ cần điền", "answer": "từ cần điền", "hint": "gợi ý ngắn" }
        ],
        "order": [
          { "words": ["The","cat","sat"], "answer": "The cat sat" }
        ]
      }
    }
  ]
}`;

  try {
    const res = await fetch(`${MAVIS_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('API Key không hợp lệ');
      if (res.status === 402) throw new Error('Hết quota MAVIS');
      throw new Error(`Lỗi server ${res.status}`);
    }

    const data = await res.json();
    let text = '';
    if (Array.isArray(data.content)) text = data.content.map(b => b.text || '').join('');
    else if (typeof data.content === 'string') text = data.content;
    else if (data.choices) text = data.choices?.[0]?.message?.content || '';

    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    _ltGroups = parsed.groups || [];
    if (!_ltGroups.length) throw new Error('AI không trả về nhóm từ nào');

    // ── Post-process: đảm bảo order.words khớp chính xác với answer ──
    _ltGroups.forEach(g => {
      (g.exercises?.order || []).forEach(item => {
        if (!item.answer) return;
        // Tách answer thành từng từ → đây mới là nguồn sự thật
        const correctWords = item.answer.trim().split(/\s+/);
        // Chỉ ghi đè nếu words bị thiếu hoặc thừa so với answer
        const builtFromWords = (item.words || []).join(' ').toLowerCase().replace(/[.,!?]+$/,'').trim();
        const builtFromAnswer = correctWords.join(' ').toLowerCase().replace(/[.,!?]+$/,'').trim();
        if (builtFromWords !== builtFromAnswer) {
          item.words = correctWords; // fix: lấy từ answer
        }
      });
    });

    _ltCurrentGroup = 0;
    _ltCurrentEx = 0;
    _ltScore = 0;
    _ltTotal = 0;
    _ltIsSaved = false;

    _ltRenderGroupMenu();
  } catch(e) {
    document.getElementById('ltBody').innerHTML = `
      <div class="lt-error">
        <div style="font-size:2rem">⚠</div>
        <div>Không tạo được bài tập: ${e.message}</div>
        <button class="lt-retry-btn" onclick="_ltGenerate()">↺ Thử lại</button>
      </div>`;
  }
}

function _ltRenderGroupMenu() {
  const body = document.getElementById('ltBody');
  if (!body) return;

  const groupCards = _ltGroups.map((g, i) => `
    <div class="lt-group-card" onclick="_ltStartGroup(${i})">
      <div class="lt-group-icon">${['📘','📗','📙','📕'][i % 4]}</div>
      <div class="lt-group-info">
        <div class="lt-group-theme">${g.theme}</div>
        <div class="lt-group-words">${g.words.slice(0,5).join(', ')}${g.words.length>5?'...':''}</div>
        <div class="lt-group-meta">${g.words.length} từ · 4 dạng bài tập</div>
      </div>
      <div class="lt-group-arrow">→</div>
    </div>
  `).join('');

  const saveBtn = _ltIsSaved
    ? `<button class="lt-cloud-btn lt-cloud-saved" disabled>☁ Đã lưu lên cloud</button>`
    : `<button class="lt-cloud-btn lt-cloud-save" id="ltSaveBtn" onclick="_ltSaveToFirebase()">☁ Lưu bài tập lên cloud</button>`;

  body.innerHTML = `
    <div class="lt-menu">
      <div class="lt-menu-toolbar">
        <div>
          <div class="lt-menu-title">Chọn nhóm từ để luyện tập</div>
          <div class="lt-menu-sub">${_ltGroups.length} nhóm · ${_ltWords.length} từ đang học</div>
        </div>
        ${saveBtn}
      </div>
      <div class="lt-group-list">${groupCards}</div>
    </div>
  `;
}

function _ltStartGroup(groupIdx) {
  _ltCurrentGroup = groupIdx;
  _ltCurrentEx = 0;
  _ltScore = 0;
  _ltTotal = 0;
  _ltFillDone = 0;
  _ltFillCorrect = 0;
  const g = _ltGroups[groupIdx];
  const body = document.getElementById('ltBody');

  // Hiện đoạn văn trước
  body.innerHTML = `
    <div class="lt-passage-screen">
      <div class="lt-passage-header">
        <button class="lt-back-btn" onclick="_ltRenderGroupMenu()">← Quay lại</button>
        <div class="lt-passage-theme">${g.theme}</div>
      </div>
      <div class="lt-passage-words">
        ${g.words.map(w => {
          const wd = _ltWords.find(x => x.word === w);
          return `<span class="lt-word-chip">${w}${wd?.phonetics?` <em>/${wd.phonetics}/</em>`:''}</span>`;
        }).join('')}
      </div>
      <div class="lt-passage-box">
        <div class="lt-passage-label">📖 Đoạn văn</div>
        <div class="lt-passage-text">${_ltHighlight(g.passage, g.words)}</div>
        <div class="lt-passage-vi">${g.passage_vi}</div>
      </div>
      <button class="lt-start-ex-btn" onclick="_ltRenderExercise(${groupIdx}, 0)">
        Bắt đầu luyện tập →
      </button>
    </div>
  `;
}

function _ltHighlight(text, words) {
  let result = text;
  words.forEach(w => {
    const re = new RegExp('\\b(' + w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')\\b', 'gi');
    result = result.replace(re, '<mark class="lt-highlight">$1</mark>');
  });
  return result;
}

// Thứ tự bài tập
const _ltExOrder = ['mcq', 'match', 'fill', 'order'];
const _ltExNames = { mcq: '📝 Trắc Nghiệm', match: '🔗 Nối Từ', fill: '✏️ Điền Từ', order: '🔀 Sắp Xếp Câu' };

function _ltRenderExercise(groupIdx, exIdx) {
  // Hết bài tập → kết quả
  if (exIdx === -1 || exIdx >= _ltExOrder.length) {
    _ltRenderGroupResult(groupIdx);
    return;
  }

  _ltCurrentGroup = groupIdx;
  _ltCurrentEx = exIdx;
  const g = _ltGroups[groupIdx];
  const exType = _ltExOrder[exIdx];
  const ex = g.exercises[exType];
  const body = document.getElementById('ltBody');

  if (!ex || !ex.length) {
    // Bỏ qua loại bài này nếu rỗng
    _ltRenderExercise(groupIdx, exIdx + 1);
    return;
  }

  const progress = `${exIdx + 1} / ${_ltExOrder.length}`;
  let content = '';

  if (exType === 'mcq') content = _ltBuildMCQ(ex, groupIdx, exIdx);
  else if (exType === 'match') content = _ltBuildMatch(ex, groupIdx, exIdx);
  else if (exType === 'fill') content = _ltBuildFill(ex, groupIdx, exIdx);
  else if (exType === 'order') content = _ltBuildOrder(ex, groupIdx, exIdx);

  body.innerHTML = `
    <div class="lt-exercise-screen">
      <div class="lt-ex-header">
        <button class="lt-back-btn" onclick="_ltStartGroup(${groupIdx})">← Đoạn văn</button>
        <div class="lt-ex-progress-wrap">
          <div class="lt-ex-type-label">${_ltExNames[exType]}</div>
          <div class="lt-ex-progress">${progress}</div>
        </div>
      </div>
      <div class="lt-ex-progress-bar">
        <div class="lt-ex-progress-fill" style="width:${(exIdx/(_ltExOrder.length))*100}%"></div>
      </div>
      <div id="ltExContent">${content}</div>
    </div>
  `;

  // Init sau khi render
  if (exType === 'match') _ltInitMatch(ex);
  if (exType === 'order') _ltInitOrder(ex);
  if (exType === 'mcq') setTimeout(() => _ltInitMCQ(ex, groupIdx, exIdx), 50);
}

// ── MCQ ──
function _ltBuildMCQ(questions, gi, ei) {
  return `
    <div class="lt-mcq">
      <div class="lt-mcq-count" id="ltMcqCount">Câu 1 / ${questions.length}</div>
      <div id="ltMcqContainer"></div>
      <div id="ltMcqScore" class="lt-score-row" style="display:none"></div>
      <button class="lt-next-ex-btn" id="ltMcqNext" style="display:none"
        onclick="_ltRenderExercise(${gi}, ${ei+1} < ${_ltExOrder.length} ? ${ei+1} : -1)">
        ${ei + 1 < _ltExOrder.length ? 'Bài tiếp theo →' : '🎉 Xem kết quả'}
      </button>
    </div>
  `;
}

// Render MCQ sau khi DOM ready
function _ltInitMCQ(questions, gi, ei) {
  let current = 0, correct = 0;

  function showQ(idx) {
    const q = questions[idx];
    const container = document.getElementById('ltMcqContainer');
    document.getElementById('ltMcqCount').textContent = `Câu ${idx+1} / ${questions.length}`;
    container.innerHTML = `
      <div class="lt-mcq-question">${q.q}</div>
      <div class="lt-mcq-opts">
        ${q.opts.map((opt, i) => `
          <button class="lt-mcq-opt" onclick="_ltMcqAnswer(this,${i},${q.ans},${idx},${questions.length})" data-idx="${i}">
            <span class="lt-opt-letter">${['A','B','C','D'][i]}</span>
            <span>${opt}</span>
          </button>
        `).join('')}
      </div>
    `;
  }
  showQ(0);

  window._ltMcqState = { current:0, correct:0, questions, gi, ei, showQ };
}

window._ltMcqAnswer = function(btn, chosen, correct, qIdx, total) {
  const state = window._ltMcqState;
  if (!state) return;
  const opts = document.querySelectorAll('.lt-mcq-opt');
  opts.forEach(b => b.disabled = true);
  opts[correct].classList.add('correct');
  if (chosen !== correct) { btn.classList.add('wrong'); }
  else { state.correct++; }

  setTimeout(() => {
    if (qIdx + 1 < total) {
      state.current++;
      state.showQ(state.current);
    } else {
      // Hiện kết quả MCQ
      document.getElementById('ltMcqScore').style.display = 'flex';
      document.getElementById('ltMcqScore').innerHTML = `
        <span>Kết quả:</span>
        <strong style="color:var(--neon-green)">${state.correct}/${total}</strong>
        <span>câu đúng</span>`;
      document.getElementById('ltMcqNext').style.display = 'block';
      _ltScore += state.correct;
      _ltTotal += total;
    }
  }, 900);
};

// ── MATCH ──
function _ltBuildMatch(pairs, gi, ei) {
  const shuffledMeanings = [...pairs].sort(() => Math.random() - 0.5);
  return `
    <div class="lt-match">
      <div class="lt-match-instruction">Nhấp vào một từ, rồi nhấp vào nghĩa tương ứng</div>
      <div class="lt-match-area">
        <div class="lt-match-col" id="ltMatchWords">
          ${pairs.map((p,i) => `<div class="lt-match-item lt-match-word" data-word="${p.word}" data-idx="${i}" onclick="_ltMatchSelect(this,'word')">${p.word}</div>`).join('')}
        </div>
        <div class="lt-match-col" id="ltMatchMeanings">
          ${shuffledMeanings.map((p,i) => `<div class="lt-match-item lt-match-meaning" data-word="${p.word}" onclick="_ltMatchSelect(this,'meaning')">${p.meaning}</div>`).join('')}
        </div>
      </div>
      <div id="ltMatchResult" class="lt-score-row" style="display:none"></div>
      <button class="lt-next-ex-btn" id="ltMatchNext" style="display:none"
        onclick="_ltRenderExercise(${gi}, ${ei+1} < ${_ltExOrder.length} ? ${ei+1} : -1)">
        ${ei + 1 < _ltExOrder.length ? 'Bài tiếp theo →' : '🎉 Xem kết quả'}
      </button>
    </div>
  `;
}

function _ltInitMatch(pairs) {
  window._ltMatchState = { selected: null, selectedType: null, correct: 0, done: 0, total: pairs.length };
}

window._ltMatchSelect = function(el, type) {
  const state = window._ltMatchState;
  if (!state || el.classList.contains('matched') || el.classList.contains('wrong-match')) return;

  if (!state.selected) {
    document.querySelectorAll('.lt-match-item').forEach(x => x.classList.remove('selected'));
    el.classList.add('selected');
    state.selected = el;
    state.selectedType = type;
  } else {
    if (state.selectedType === type) {
      // Chọn cùng loại → đổi selection
      document.querySelectorAll('.lt-match-item').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      state.selected = el;
      state.selectedType = type;
      return;
    }

    // Xác định wordEl và meaningEl
    const wordEl    = type === 'word'    ? el : state.selected;
    const meaningEl = type === 'meaning' ? el : state.selected;

    // Dùng data-word để tránh lỗi với textContent
    const wordKey = wordEl.dataset.word;
    // meaning item có data-word = từ tương ứng
    const isCorrect = meaningEl.dataset.word === wordKey;

    wordEl.classList.remove('selected');
    meaningEl.classList.remove('selected');
    state.selected = null;

    if (isCorrect) {
      wordEl.classList.add('matched');
      meaningEl.classList.add('matched');
      state.correct++;
    } else {
      wordEl.classList.add('wrong-match');
      meaningEl.classList.add('wrong-match');
      setTimeout(() => {
        wordEl.classList.remove('wrong-match');
        meaningEl.classList.remove('wrong-match');
      }, 700);
    }

    state.done++;

    if (state.correct === state.total) {
      document.getElementById('ltMatchResult').style.display = 'flex';
      document.getElementById('ltMatchResult').innerHTML =
        `<span>Nối đúng:</span><strong style="color:var(--neon-green)">${state.correct}/${state.total}</strong>`;
      document.getElementById('ltMatchNext').style.display = 'block';
      _ltScore += state.correct;
      _ltTotal += state.total;
    }
  }
};

// ── FILL IN THE BLANK ──
function _ltBuildFill(items, gi, ei) {
  return `
    <div class="lt-fill">
      <div class="lt-fill-instruction">Điền từ thích hợp vào chỗ trống</div>
      ${items.map((item, i) => `
        <div class="lt-fill-item" id="ltFillItem${i}">
          <div class="lt-fill-sentence">${item.sentence.replace('___', `<input class="lt-fill-input" id="ltFillInput${i}" placeholder="..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">`)}</div>
          <div class="lt-fill-hint">💡 ${item.hint}</div>
          <div class="lt-fill-feedback" id="ltFillFb${i}"></div>
          <button class="lt-fill-check" onclick="_ltCheckFill(${i},'${item.answer.replace(/'/g,"\\'")}',${items.length},${gi},${ei})">Kiểm tra</button>
        </div>
      `).join('')}
      <div id="ltFillScore" class="lt-score-row" style="display:none"></div>
      <button class="lt-next-ex-btn" id="ltFillNext" style="display:none"
        onclick="_ltRenderExercise(${gi}, ${ei+1} < ${_ltExOrder.length} ? ${ei+1} : -1)">
        ${ei + 1 < _ltExOrder.length ? 'Bài tiếp theo →' : '🎉 Xem kết quả'}
      </button>
    </div>
  `;
}

let _ltFillDone = 0, _ltFillCorrect = 0;
window._ltCheckFill = function(idx, answer, total, gi, ei) {
  const input = document.getElementById(`ltFillInput${idx}`);
  const fb = document.getElementById(`ltFillFb${idx}`);
  const btn = document.querySelector(`#ltFillItem${idx} .lt-fill-check`);
  if (!input || btn.disabled) return;

  const val = input.value.trim().toLowerCase();
  const correct = answer.toLowerCase();
  btn.disabled = true;
  input.disabled = true;

  if (val === correct) {
    fb.innerHTML = `<span class="lt-fb-correct">✓ Đúng rồi!</span>`;
    input.classList.add('fill-correct');
    _ltFillCorrect++;
  } else {
    fb.innerHTML = `<span class="lt-fb-wrong">✕ Sai — Đáp án: <strong>${answer}</strong></span>`;
    input.classList.add('fill-wrong');
  }

  _ltFillDone++;
  if (_ltFillDone >= total) {
    document.getElementById('ltFillScore').style.display = 'flex';
    document.getElementById('ltFillScore').innerHTML =
      `<span>Điền đúng:</span><strong style="color:var(--neon-green)">${_ltFillCorrect}/${total}</strong>`;
    document.getElementById('ltFillNext').style.display = 'block';
    _ltScore += _ltFillCorrect;
    _ltTotal += total;
    _ltFillDone = 0; _ltFillCorrect = 0;
  }
};

// ── ORDER WORDS ──
function _ltBuildOrder(items, gi, ei) {
  return `
    <div class="lt-order">
      <div class="lt-order-instruction">Sắp xếp các từ thành câu hoàn chỉnh — nhấn <strong>Kiểm tra</strong> sau khi xong</div>
      ${items.map((item, i) => {
        const shuffled = [...item.words].sort(() => Math.random() - 0.5);
        return `
          <div class="lt-order-item" id="ltOrderItem${i}">
            <div class="lt-order-drop" id="ltOrderDrop${i}"></div>
            <div class="lt-order-pool" id="ltOrderPool${i}">
              ${shuffled.map(w => `<button class="lt-order-word" data-word="${w.replace(/"/g,'&quot;')}" onclick="_ltOrderPickWord(this,${i})">${w}</button>`).join('')}
            </div>
            <div class="lt-order-actions-row">
              <button class="lt-order-reset-btn" onclick="_ltOrderReset(${i})">↺ Xóa</button>
              <button class="lt-order-check-btn" id="ltOrderCheck${i}"
                onclick="_ltOrderCheck(${i},'${item.answer.replace(/'/g,"\\'")}',${items.length},${gi},${ei})">
                ✓ Kiểm tra
              </button>
            </div>
            <div class="lt-order-feedback" id="ltOrderFb${i}"></div>
          </div>`;
      }).join('')}
      <div id="ltOrderScore" class="lt-score-row" style="display:none"></div>
      <button class="lt-next-ex-btn" id="ltOrderNext" style="display:none"
        onclick="_ltRenderExercise(${gi}, ${ei+1} < ${_ltExOrder.length} ? ${ei+1} : -1)">
        ${ei + 1 < _ltExOrder.length ? 'Bài tiếp theo →' : '🎉 Xem kết quả'}
      </button>
    </div>
  `;
}

function _ltInitOrder(items) {
  window._ltOrderState = { done: 0, correct: 0, total: items.length, checked: new Set() };
}

// Click từ trong pool → thêm vào drop
window._ltOrderPickWord = function(btn, itemIdx) {
  if (btn.classList.contains('used') || btn.disabled) return;
  btn.classList.add('used');
  const drop = document.getElementById(`ltOrderDrop${itemIdx}`);
  const chip = document.createElement('span');
  chip.className = 'lt-order-chip';
  chip.textContent = btn.dataset.word;
  // Click chip → trả về pool
  chip.onclick = () => {
    const fb = document.getElementById(`ltOrderFb${itemIdx}`);
    if (btn.disabled) return; // đã kiểm tra rồi
    chip.remove();
    btn.classList.remove('used');
    fb.innerHTML = ''; // xóa feedback cũ khi sửa
  };
  drop.appendChild(chip);
};

// Reset 1 câu
window._ltOrderReset = function(itemIdx) {
  const state = window._ltOrderState;
  if (state && state.checked.has(itemIdx)) return; // đã kiểm tra rồi
  const drop = document.getElementById(`ltOrderDrop${itemIdx}`);
  const pool = document.getElementById(`ltOrderPool${itemIdx}`);
  drop.innerHTML = '';
  pool.querySelectorAll('.lt-order-word').forEach(b => b.classList.remove('used'));
  document.getElementById(`ltOrderFb${itemIdx}`).innerHTML = '';
};

// Kiểm tra 1 câu khi nhấn nút
window._ltOrderCheck = function(itemIdx, answer, total, gi, ei) {
  const state = window._ltOrderState;
  if (!state || state.checked.has(itemIdx)) return;

  const drop = document.getElementById(`ltOrderDrop${itemIdx}`);
  const chips = Array.from(drop.querySelectorAll('.lt-order-chip'));
  if (!chips.length) {
    document.getElementById(`ltOrderFb${itemIdx}`).innerHTML =
      `<span class="lt-fb-wrong">⚠ Chưa xếp từ nào!</span>`;
    return;
  }

  // Lock lại
  state.checked.add(itemIdx);
  const pool = document.getElementById(`ltOrderPool${itemIdx}`);
  pool.querySelectorAll('.lt-order-word').forEach(b => { b.disabled = true; b.classList.add('used'); });
  chips.forEach(c => { c.style.cursor = 'default'; c.onclick = null; });
  document.getElementById(`ltOrderCheck${itemIdx}`).disabled = true;
  document.getElementById(`ltOrderCheck${itemIdx}`).style.opacity = '0.4';

  // So sánh — normalize khoảng trắng, bỏ dấu chấm cuối
  const built  = chips.map(c => c.textContent.trim()).join(' ').toLowerCase().replace(/[.,!?]+$/, '').trim();
  const expect = answer.toLowerCase().replace(/[.,!?]+$/, '').trim();

  const fb = document.getElementById(`ltOrderFb${itemIdx}`);
  if (built === expect) {
    fb.innerHTML = `<span class="lt-fb-correct">✓ Đúng rồi!</span>`;
    drop.style.borderColor = 'rgba(57,255,20,0.4)';
    state.correct++;
  } else {
    fb.innerHTML = `<span class="lt-fb-wrong">✕ Sai — Câu đúng: <em>${answer}</em></span>`;
    drop.style.borderColor = 'rgba(255,0,110,0.4)';
  }

  state.done++;
  if (state.done >= total) {
    document.getElementById('ltOrderScore').style.display = 'flex';
    document.getElementById('ltOrderScore').innerHTML =
      `<span>Đúng:</span><strong style="color:var(--neon-green)">${state.correct}/${total}</strong>`;
    document.getElementById('ltOrderNext').style.display = 'block';
    _ltScore += state.correct;
    _ltTotal += total;
  }
};

// ── Kết quả nhóm ──
function _ltRenderGroupResult(groupIdx) {
  const body = document.getElementById('ltBody');
  const pct = _ltTotal ? Math.round(_ltScore / _ltTotal * 100) : 0;
  const emoji = pct >= 80 ? '🎉' : pct >= 50 ? '👍' : '💪';
  body.innerHTML = `
    <div class="lt-result">
      <div class="lt-result-icon">${emoji}</div>
      <div class="lt-result-title">Hoàn thành nhóm!</div>
      <div class="lt-result-score">${_ltScore}<span>/${_ltTotal}</span></div>
      <div class="lt-result-pct">${pct}% chính xác</div>
      <div class="lt-result-actions">
        <button class="lt-result-btn" onclick="_ltRenderGroupMenu()">← Chọn nhóm khác</button>
        <button class="lt-result-btn primary" onclick="closeLuyenTap()">✓ Xong</button>
      </div>
    </div>
  `;
}



