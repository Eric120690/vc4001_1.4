// ============================================================
//  DEEP LEARNING MODE
// ============================================================
let dlDuration    = 15;
let dlQueue       = [];
let dlIndex       = 0;
let dlWordsCount  = 0;   // lượt học (kể cả lặp lại)
let dlMastered    = 0;   // số từ mark đã thuộc trong session
let dlTimerEnd    = 0;
let dlTimerRAF    = null;
let dlCorrectMap  = {};  // word -> số lần gõ đúng liên tiếp
let dlHardWords   = [];  // danh sách từ khó hiện tại
let dlInHardLoop  = false; // đang trong loop từ khó hay không
let dlHardLoopQueue = []; // queue riêng khi đang học loop từ khó

// Trạng thái ẩn/hiện từng field
let dlHideEN  = false;
let dlHideIPA = false;
let dlHideVI  = false;

const DL_MOTIVATE = [
  '🔥 Giữ đà đó!',
  '✨ Tuyệt vời, tiếp tục!',
  '💪 Bạn đang làm rất tốt!',
  '🧠 Não đang ghi nhớ đây!',
  '⚡ Thêm một từ nữa nào!',
  '🌟 Không dừng lại nhé!',
  '🎯 Tập trung thêm chút nữa!',
  '🚀 Đang bay cao đây!',
];

const DL_CHECKPOINT = [
  { n:5,  emoji:'🌱', text:'5 lượt xong rồi!',   sub:'Bạn đang khởi động tốt' },
  { n:10, emoji:'🔥', text:'10 lượt! Tuyệt!',    sub:'Não đang ghi nhớ sâu hơn rồi' },
  { n:15, emoji:'⚡', text:'15 lượt! Đỉnh!',     sub:'Bạn đang trong flow state' },
  { n:20, emoji:'🏆', text:'20 lượt! Xuất sắc!', sub:'Trí nhớ cơ bắp đang hình thành' },
  { n:30, emoji:'🌟', text:'30 lượt! Phi thường!',sub:'Bạn là một học máy rồi đây' },
];

// ── Open intro ──
function dlOpen() {
  if (!words.length) { showToast('error','⚠ Chưa có từ vựng.'); return; }
  _dlShowScreen('dlIntro');
  document.getElementById('dlOverlay').classList.add('show');
  document.getElementById('dlExitBtn').classList.remove('show');
}

// ── Duration select ──
function dlSetDuration(min, btn) {
  dlDuration = min;
  document.querySelectorAll('.dl-dur-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── Countdown 3-2-1 ──
function dlStartCountdown() {
  _dlShowScreen('dlCountdown');
  let n = 3;
  const numEl = document.getElementById('dlCountNum');
  numEl.textContent = n;
  const tick = () => {
    n--;
    if (n > 0) {
      numEl.style.animation = 'none'; void numEl.offsetWidth;
      numEl.style.animation = ''; numEl.textContent = n;
      setTimeout(tick, 900);
    } else { dlBeginSession(); }
  };
  setTimeout(tick, 900);
}

// ── Begin session ──
function dlBeginSession() {
  // Đảm bảo studyQueue đã được build (phòng trường hợp chưa vào tab flashcard)
  if (!studyQueue.length) buildQueue();

  // Lấy pool từ studyQueue (đã shuffle + filter level + filter mastered)
  // Fallback: nếu vẫn rỗng thì lấy từ words trực tiếp
  const pool = studyQueue.length
    ? [...studyQueue]
    : words.filter(w => !w.hidden && !w.mastered).map(w => ({...w}));

  // Ăn theo loopSize: đồng nhất với flashcard thường
  // loopSize > 0 → chỉ học N từ đầu pool (giống loopWindow trong flashcard)
  // loopSize = 0 → học toàn bộ pool
  if (loopSize > 0 && pool.length > 0) {
    dlQueue = pool.slice(0, Math.min(loopSize, pool.length));
  } else {
    dlQueue = [...pool];
  }

  dlIndex      = 0;
  dlWordsCount = 0;
  dlMastered   = 0;
  dlCorrectMap = {};
  dlHardWords  = [];
  dlInHardLoop = false;

  _dlShowScreen('dlSession');
  document.getElementById('dlExitBtn').classList.add('show');

  statsStartSession(); // bắt đầu đếm active time
  dlTimerEnd = Date.now() + dlDuration * 60 * 1000;
  dlTickTimer();

  // Reset field toggle state to active
  dlHideEN = dlHideIPA = dlHideVI = false;
  ['dlToggleEN','dlToggleIPA','dlToggleVI'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.classList.add('active');
  });

  dlRenderCard();
  // Init virtual keyboard or native input depending on screen size
  dlVkbInit();
  if (window.innerWidth > 768) {
    setTimeout(() => document.getElementById('dlInput')?.focus(), 200);
  }
}

// ── Timer ──
function dlTickTimer() {
  const remaining = dlTimerEnd - Date.now();
  if (remaining <= 0) { dlFinish(); return; }
  const totalMs = dlDuration * 60 * 1000;
  const pct     = (remaining / totalMs) * 100;
  const mins    = Math.floor(remaining / 60000);
  const secs    = Math.floor((remaining % 60000) / 1000);
  const fill    = document.getElementById('dlTimerFill');
  const clock   = document.getElementById('dlTimerClock');
  if (fill)  fill.style.width = pct + '%';
  if (clock) clock.textContent = `${mins}:${secs.toString().padStart(2,'0')}`;
  dlTimerRAF = setTimeout(dlTickTimer, 500);
}

// ── Render card ──
function dlRenderCard() {
  if (!dlQueue.length) return;
  if (dlIndex >= dlQueue.length) dlIndex = 0;
  const w = dlQueue[dlIndex];

  document.getElementById('dlCardProgress').textContent = `${dlWordsCount + 1} lượt`;

  const wordEl = document.getElementById('dlCardWord');
  wordEl.textContent = w.word || '';
  wordEl.style.opacity = dlHideEN ? '0' : '1';
  wordEl.style.filter  = dlHideEN ? 'blur(8px)' : 'none';
  wordEl.style.userSelect = dlHideEN ? 'none' : '';

  const ipaEl = document.getElementById('dlCardPhonetic');
  ipaEl.textContent   = w.phonetics ? `/${w.phonetics}/` : '';
  ipaEl.style.display = (!w.phonetics || dlHideIPA) ? 'none' : '';

  const viEl = document.getElementById('dlCardMeaning');
  viEl.textContent = w.meaning || '';
  viEl.style.opacity = dlHideVI ? '0' : '1';
  viEl.style.filter  = dlHideVI ? 'blur(8px)' : 'none';
  viEl.style.userSelect = dlHideVI ? 'none' : '';

  const inp = document.getElementById('dlInput');
  if (inp) { inp.value = ''; inp.className = 'dl-input'; if (window.innerWidth > 768) inp.focus(); }
  dlClearCharDiff();
  dlVkbReset();

  // Sync hard word button
  const isHard = dlHardWords.some(x => x.word === w.word);
  dlUpdateHardBtn(isHard);
  const hardBtn = document.getElementById('dlHardBtn');
  if (hardBtn) hardBtn.style.display = dlInHardLoop ? 'none' : '';
  dlUpdateHardCount();

  if (dlWordsCount > 0 && dlWordsCount % 3 === 0) dlShowMotivate();
  else document.getElementById('dlMotivate').textContent = '';

  const card = document.getElementById('dlWordCard');
  if (card) { card.style.animation = 'none'; void card.offsetWidth; card.style.animation = 'fadeUp 0.3s ease'; }
}

// ── Field toggles ──
function dlToggleField(field) {
  if (field === 'en') {
    dlHideEN = !dlHideEN;
    document.getElementById('dlToggleEN').classList.toggle('active', !dlHideEN);
    // Nếu bật lại EN (đang nhìn từ) → reset streak của từ hiện tại
    if (!dlHideEN && dlQueue[dlIndex]) {
      dlCorrectMap[dlQueue[dlIndex].word] = 0;
    }
  } else if (field === 'ipa') {
    dlHideIPA = !dlHideIPA;
    document.getElementById('dlToggleIPA').classList.toggle('active', !dlHideIPA);
  } else if (field === 'vi') {
    dlHideVI = !dlHideVI;
    document.getElementById('dlToggleVI').classList.toggle('active', !dlHideVI);
  }
  dlRenderCard(); // re-apply visibility
}

// ── Check input ──
function dlCheckInput() {
  const inp  = document.getElementById('dlInput');
  if (!inp) return;
  const val  = inp.value.trim().toLowerCase();
  const word = (dlQueue[dlIndex]?.word || '').toLowerCase().trim();
  if (!val) return;

  if (val === word) {
    dlClearCharDiff();
    inp.classList.add('correct');
    dlConfetti(inp);
    xpOnFlashcardAction(); // active time
    setTimeout(() => dlNext(word), 550);
  } else {
    dlCorrectMap[word] = 0;
    inp.classList.add('wrong');
    dlShowCharDiff(val, word);
    setTimeout(() => { inp.classList.remove('wrong'); inp.value = ''; inp.focus(); }, 800);
  }
}

// ── Hiển thị diff từng ký tự ──
function dlShowCharDiff(typed, correct) {
  const el    = document.getElementById('dlCharDiff');
  const label = document.getElementById('dlCharDiffLabel');
  if (!el) return;

  let html = '';
  const len = Math.max(typed.length, correct.length);
  for (let i = 0; i < len; i++) {
    const tc = typed[i];
    const cc = correct[i];
    if (!cc) {
      // Gõ thừa ký tự
      html += `<span class="dc-err">${_esc(tc)}</span>`;
    } else if (!tc) {
      // Thiếu ký tự
      html += `<span class="dc-mis">${_esc(cc)}</span>`;
    } else if (tc === cc) {
      html += `<span class="dc-ok">${_esc(tc)}</span>`;
    } else {
      html += `<span class="dc-err">${_esc(tc)}</span>`;
    }
  }
  el.innerHTML = html;
  el.classList.add('show');
  if (label) label.classList.add('show');
}

// ── Xóa diff khi bắt đầu gõ lại ──
function dlClearCharDiff() {
  const el    = document.getElementById('dlCharDiff');
  const label = document.getElementById('dlCharDiffLabel');
  if (el)    { el.classList.remove('show'); el.innerHTML = ''; }
  if (label) label.classList.remove('show');
}

function _esc(c) {
  return c === ' ' ? '&nbsp;' : c.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Next ── (gọi sau khi gõ đúng — truyền word vừa đúng)
function dlNext(correctWord) {
  dlWordsCount++;

  // Chỉ tính streak khi từ tiếng Anh đang bị ẩn (EN toggle off)
  // → người học phải tự nhớ, không được nhìn từ để gõ
  if (correctWord && dlHideEN) {
    dlCorrectMap[correctWord] = (dlCorrectMap[correctWord] || 0) + 1;
    if (dlCorrectMap[correctWord] >= 3) {
      dlCorrectMap[correctWord] = 0;
      _dlAutoAddWord(correctWord);
    }
  }

  dlIndex++;
  // Hard loop xoay vòng liên tục — chỉ kết thúc khi hết từ (dlMarkMastered xử lý)
  if (dlIndex >= dlQueue.length) dlIndex = 0;
  const cp = DL_CHECKPOINT.find(c => c.n === dlWordsCount);
  if (cp) dlShowCheckpoint(cp);
  dlRenderCard();
}

// ── Tự thay từ đã thuộc bằng từ mới (đúng 3 lần ở chế độ ẩn EN) ──
function _dlAutoAddWord(learnedWord) {
  // Mark mastered trong words array + sync flashcard
  const wIdx = words.findIndex(x => x.word === learnedWord);
  if (wIdx >= 0 && !words[wIdx].mastered) {
    words[wIdx].mastered = true;
    dlMastered++;
    saveData();
    studyQueue = studyQueue.filter(x => x.word !== learnedWord);
    recordStudyActivity(1);
    refreshStatsBar();
    updateStudyBadge();
    challengeRecordStudyDay();
    xpOnMastered(null);
    activeTimeRecordInteraction();
  }

  // 1. Xóa từ đã "nắm vững" khỏi dlQueue
  const removeIdx = dlQueue.findIndex(w => w.word === learnedWord);
  if (removeIdx !== -1) {
    dlQueue.splice(removeIdx, 1);
    if (dlIndex > removeIdx) dlIndex--;
    if (dlIndex >= dlQueue.length) dlIndex = 0;
  }

  // 2. Nếu loopSize đang bật: queue sau khi xóa < loopSize → thêm từ mới vào bù
  //    Nếu loopSize = 0 (tắt): luôn thêm từ mới vào
  const shouldAdd = (loopSize === 0) || (dlQueue.length < loopSize);
  if (!shouldAdd) {
    _dlShowSwapToast(learnedWord, null);
    return;
  }

  // 3. Tìm từ mới chưa có trong queue, chưa mastered
  const inQueue = new Set(dlQueue.map(x => x.word));
  const candidates = words.filter(w =>
    !w.mastered && !w.hidden && !inQueue.has(w.word) && w.word !== learnedWord
  );

  if (!candidates.length) {
    _dlShowSwapToast(learnedWord, null);
    return;
  }

  // 4. Chèn từ mới vào đúng vị trí vừa xóa
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  const insertAt = Math.min(removeIdx !== -1 ? removeIdx : dlQueue.length, dlQueue.length);
  dlQueue.splice(insertAt, 0, { ...picked });

  _dlShowSwapToast(learnedWord, picked.word);
}

function _dlShowSwapToast(removed, added) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);',
    'background:rgba(10,10,30,0.95);border:1px solid rgba(191,0,255,0.4);',
    'border-radius:20px;padding:8px 18px;',
    'font-family:"Space Mono",monospace;font-size:0.7rem;',
    'color:var(--neon-purple);z-index:500;',
    'animation:fadeUp 0.3s ease;white-space:nowrap;text-align:center;line-height:1.6;',
  ].join('');
  el.textContent = added
    ? '✦ ' + removed + ' → thay bằng: ' + added
    : '✦ ' + removed + ' đã nắm vững! Không còn từ mới.';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── Hard word: toggle ──
function dlToggleHard() {
  if (dlInHardLoop) return;
  const w = dlQueue[dlIndex];
  if (!w) return;

  const already = dlHardWords.findIndex(x => x.word === w.word);
  const maxHard = loopSize > 0 ? loopSize : 5;

  if (already >= 0) {
    // Bỏ đánh dấu → đưa từ trở lại queue tại vị trí hiện tại
    dlHardWords.splice(already, 1);
    // Chèn lại vào queue ngay sau vị trí hiện tại
    dlQueue.splice(dlIndex + 1, 0, {...w});
    dlUpdateHardBtn(false);
    dlUpdateHardCount();
    _dlToast('Đã bỏ "' + w.word + '" khỏi nhóm từ khó, đưa lại vào học');
  } else {
    if (dlHardWords.length >= maxHard) {
      _dlToast('Đã đủ ' + maxHard + ' từ khó trong vòng!', '#ff4444');
      return;
    }

    // Ghi nhớ từ rồi RÚT NGAY khỏi queue hiện tại
    dlHardWords.push({...w});
    dlQueue.splice(dlIndex, 1);

    // Bù từ mới vào queue (nếu loopSize bật và còn thiếu chỗ)
    const shouldFill = (loopSize === 0) || (dlQueue.length < loopSize);
    if (shouldFill) {
      const inQueue = new Set(dlQueue.map(x => x.word));
      const inHard  = new Set(dlHardWords.map(x => x.word));
      const cands = words.filter(wx =>
        !wx.mastered && !wx.hidden && !inQueue.has(wx.word) && !inHard.has(wx.word)
      );
      if (cands.length) {
        const picked = cands[Math.floor(Math.random() * cands.length)];
        dlQueue.splice(dlIndex, 0, {...picked}); // chèn vào đúng vị trí vừa xóa
      }
    }

    // Clamp index
    if (dlIndex >= dlQueue.length) dlIndex = 0;

    if (dlHardWords.length >= maxHard && !dlInHardLoop) {
      // Đủ loop từ khó → bắt đầu ngay
      _dlToast('⚑ Đủ ' + maxHard + ' từ khó — bắt đầu loop!');
      dlHardLoopQueue = [...dlQueue]; // snapshot queue hiện tại
      setTimeout(dlStartHardLoop, 800);
    } else {
      _dlToast('⚑ "' + w.word + '" vào nhóm từ khó (' + dlHardWords.length + '/' + maxHard + ')');
      dlRenderCard();
    }
  }
}

// ── Bắt đầu học loop từ khó ──
function dlStartHardLoop() {
  dlInHardLoop = true;
  const maxHard = loopSize > 0 ? loopSize : 5;

  // Lưu queue hiện tại, tạo queue mới chỉ gồm từ khó
  dlHardLoopQueue = [...dlQueue];
  dlQueue = dlHardWords.map(w => ({...w}));
  dlIndex = 0;

  // Hiện banner
  const banner = document.getElementById('dlHardBanner');
  const bannerText = document.getElementById('dlHardBannerText');
  if (banner) { banner.classList.add('visible'); }
  if (bannerText) bannerText.textContent = 'Loop từ khó — bấm Đã thuộc để kết thúc';

  // Ẩn hard count dots khi đang trong loop
  const countEl = document.getElementById('dlHardCount');
  if (countEl) countEl.classList.remove('visible');

  // Reset dlCorrectMap cho các từ khó để tính lại
  dlHardWords.forEach(hw => { dlCorrectMap[hw.word] = 0; });

  dlRenderCard();
  _dlCheckpointPopup('🔥', 'Loop từ khó bắt đầu!', 'Học đến khi tích hết ' + dlQueue.length + ' từ');
}

// ── Tạm dừng hard loop → về học bình thường, giữ nguyên dlHardWords ──
function dlPauseHardLoop() {
  dlInHardLoop = false;

  // Khôi phục queue cũ, bỏ các từ đang trong hard loop (chúng vẫn nằm trong dlHardWords)
  const hardSet = new Set(dlHardWords.map(x => x.word));
  dlQueue = dlHardLoopQueue.filter(w => !hardSet.has(w.word));

  // Nếu queue cũ rỗng, build lại
  if (!dlQueue.length) {
    buildQueue();
    const pool = studyQueue.length
      ? [...studyQueue]
      : words.filter(w => !w.hidden && !w.mastered).map(w => ({...w}));
    dlQueue = (loopSize > 0 && pool.length > 0)
      ? pool.slice(0, Math.min(loopSize, pool.length))
      : [...pool];
    // Bỏ các từ đang trong hard pool
    dlQueue = dlQueue.filter(w => !hardSet.has(w.word));
  }

  dlIndex = 0;

  // Ẩn banner
  const banner = document.getElementById('dlHardBanner');
  if (banner) banner.classList.remove('visible');

  // Hiện lại dots counter để người dùng thấy còn bao nhiêu từ khó đang chờ
  dlUpdateHardCount();

  dlRenderCard();
  _dlToast('Đã tạm dừng loop từ khó · ' + dlHardWords.length + ' từ đang chờ');
}

// ── Kết thúc hard loop → quay về queue thường ──
function dlEndHardLoop() {
  dlInHardLoop = false;
  dlHardWords  = []; // clear sau khi học xong

  // Khôi phục queue cũ, bỏ các từ khó đã học xong
  const hardSet = new Set(dlQueue.map(x => x.word));
  dlQueue = dlHardLoopQueue.filter(w => !hardSet.has(w.word));

  // Nếu queue cũ rỗng, lấy lại từ studyQueue
  if (!dlQueue.length) {
    buildQueue();
    dlQueue = studyQueue.length
      ? (loopSize > 0 ? [...studyQueue].slice(0, loopSize) : [...studyQueue])
      : words.filter(w => !w.hidden && !w.mastered).map(w => ({...w}));
  }

  dlIndex = 0;

  // Ẩn banner
  const banner = document.getElementById('dlHardBanner');
  if (banner) banner.classList.remove('visible');

  // Cập nhật lại dots (giờ = 0)
  dlUpdateHardCount();

  dlRenderCard();
  _dlCheckpointPopup('✅', 'Loop từ khó xong!', 'Tiếp tục học bình thường');
}

// ── Update nút hard trên thẻ ──
function dlUpdateHardBtn(isMarked) {
  const btn = document.getElementById('dlHardBtn');
  if (!btn) return;
  btn.classList.toggle('marked', isMarked);
  btn.textContent = isMarked ? '⚑ Từ khó (đã đánh dấu)' : '⚑ Từ khó';
}

// ── Update dots counter ──
function dlUpdateHardCount() {
  const maxHard = loopSize > 0 ? loopSize : 5;
  const countEl  = document.getElementById('dlHardCount');
  const countTxt = document.getElementById('dlHardCountText');
  const bar      = document.getElementById('dlHardCountBar');
  if (!countEl || !bar) return;

  countEl.classList.toggle('visible', dlHardWords.length > 0 && !dlInHardLoop);
  if (countTxt) countTxt.textContent = dlHardWords.length + ' / ' + maxHard + ' từ khó';

  bar.innerHTML = '';
  for (let i = 0; i < maxHard; i++) {
    const dot = document.createElement('div');
    dot.className = 'dl-hard-count-dot' + (i < dlHardWords.length ? ' filled' : '');
    bar.appendChild(dot);
  }
}

// ── Mini toast helper ──
function _dlToast(msg, color) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed;bottom:110px;left:50%;transform:translateX(-50%);',
    'background:rgba(10,10,30,0.95);border:1px solid rgba(255,140,0,0.4);',
    'border-radius:20px;padding:8px 18px;',
    'font-family:"Space Mono",monospace;font-size:0.7rem;',
    'color:' + (color || '#ff8c00') + ';z-index:500;',
    'animation:fadeUp 0.3s ease;white-space:nowrap;text-align:center;',
  ].join('');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ── Checkpoint popup helper (reuse existing) ──
function _dlCheckpointPopup(emoji, text, sub) {
  dlShowCheckpoint({ emoji, text, sub });
}

// ── Mark mastered: remove from queue, add new words ──
function dlMarkMastered() {
  if (!dlQueue.length) return;
  const w = dlQueue[dlIndex];

  // Mark in main words array + sync về flashcard
  const idx = words.findIndex(x => x.word === w.word);
  if (idx >= 0 && !words[idx].mastered) {
    words[idx].mastered = true;
    dlMastered++;
    saveData();
    studyQueue = studyQueue.filter(x => x.word !== w.word);
    recordStudyActivity(1);
    refreshStatsBar();
    updateStudyBadge();
    challengeRecordStudyDay();
    // XP + active time — giống flashcard thường
    xpOnMastered(document.getElementById('dlBtnMastered'));
    activeTimeRecordInteraction();
  }
  // Nếu đang trong hard loop → xóa khỏi dlHardWords để dots cập nhật đúng
  if (dlInHardLoop) {
    dlHardWords = dlHardWords.filter(x => x.word !== w.word);
  }

  // Remove from dlQueue
  dlQueue.splice(dlIndex, 1);

  // Thêm từ mới vào bù — KHÔNG thêm khi đang trong hard loop
  if (!dlInHardLoop) {
    const shouldAddNew = (loopSize === 0) || (dlQueue.length < loopSize);
    if (shouldAddNew) {
      const inQueue = new Set(dlQueue.map(x => x.word));
      const candidates = words.filter(w2 => !w2.mastered && !w2.hidden && !inQueue.has(w2.word));
      if (candidates.length) {
        dlQueue.push({ ...candidates[Math.floor(Math.random() * candidates.length)] });
      }
    }
  }

  if (!dlQueue.length) {
    if (dlInHardLoop) {
      // Hết từ trong hard loop → kết thúc hard loop, về học bình thường
      dlEndHardLoop();
    } else {
      dlFinish();
    }
    return;
  }

  if (dlIndex >= dlQueue.length) dlIndex = 0;
  dlWordsCount++;
  const cp = DL_CHECKPOINT.find(c => c.n === dlWordsCount);
  if (cp) dlShowCheckpoint(cp);

  dlConfetti(document.getElementById('dlInput'));
  dlRenderCard();
}

// ── Motivate ──
function dlShowMotivate() {
  const el  = document.getElementById('dlMotivate');
  const msg = DL_MOTIVATE[Math.floor(Math.random() * DL_MOTIVATE.length)];
  el.textContent = msg;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}

// ── Checkpoint popup ──
function dlShowCheckpoint(cp) {
  const el = document.createElement('div');
  el.className = 'dl-checkpoint';
  el.innerHTML = `<div class="dl-checkpoint-inner">
    <span class="dl-checkpoint-emoji">${cp.emoji}</span>
    <div class="dl-checkpoint-text">${cp.text}</div>
    <div class="dl-checkpoint-sub">${cp.sub}</div>
  </div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

// ── Confetti ──
function dlConfetti(anchor) {
  const colors = ['#bf00ff','#00f5ff','#39ff14','#ffe600','#ff006e'];
  const rect   = anchor ? anchor.getBoundingClientRect() : { left:window.innerWidth/2, top:window.innerHeight/2, width:0 };
  for (let i = 0; i < 14; i++) {
    const dot = document.createElement('div');
    dot.className = 'dl-confetti-dot';
    dot.style.cssText = `left:${rect.left + rect.width/2 + (Math.random()-0.5)*120}px;top:${rect.top}px;background:${colors[i%colors.length]};animation-duration:${0.6+Math.random()*0.6}s;animation-delay:${Math.random()*0.15}s;`;
    document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 1400);
  }
}

// ── Show summary screen ──
function dlShowSummary() {
  if (dlWordsCount === 0) { dlExit(); return; } // không học gì → thoát thẳng

  clearTimeout(dlTimerRAF);
  document.getElementById('dlExitBtn').classList.remove('show');

  const mins = dlDuration;
  const statsEl = document.getElementById('dlSummaryStats');
  statsEl.innerHTML = `
    <div class="dl-stat-card">
      <div class="dl-stat-val" style="color:var(--neon-cyan)">${dlWordsCount}</div>
      <div class="dl-stat-lbl">Lượt học</div>
    </div>
    <div class="dl-stat-card">
      <div class="dl-stat-val" style="color:var(--neon-green)">${dlMastered}</div>
      <div class="dl-stat-lbl">Đã thuộc</div>
    </div>
    <div class="dl-stat-card">
      <div class="dl-stat-val" style="color:var(--neon-purple)">${mins}</div>
      <div class="dl-stat-lbl">Phút học</div>
    </div>
  `;
  _dlShowScreen('dlSummary');
}

// ── Finish (timer hết) ──
function dlFinish() {
  dlShowSummary();
}

// ── Exit button (thoát giữa chừng) ──
function dlExit() {
  clearTimeout(dlTimerRAF);
  statsStopSession(); // dừng đếm active time
  activeTimeFlushOnExit();
  document.getElementById('dlOverlay').classList.remove('show');
  document.getElementById('dlExitBtn').classList.remove('show');
  _dlShowScreen('dlIntro');
}

// ── Helper: show one screen, hide the rest ──
function _dlShowScreen(id) {
  ['dlIntro','dlCountdown','dlSession','dlSummary'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = (s === id) ? '' : 'none';
  });
}

// ── Virtual Keyboard ──
const DL_VKB_ROWS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['⌫', 'z','x','c','v','b','n','m', 'ENTER'],
];
let dlVkbValue = '';

function dlVkbInit() {
  const isMobile = window.innerWidth <= 768;
  document.getElementById('dlDesktopInput').style.display = isMobile ? 'none' : '';
  const vkb = document.getElementById('dlVkb');
  if (!vkb) return;

  if (!isMobile) { vkb.style.display = 'none'; return; }
  vkb.style.display = 'flex';

  // Build rows
  DL_VKB_ROWS.forEach((row, ri) => {
    const rowEl = document.getElementById('dlVkbRow' + (ri+1));
    if (!rowEl) return;
    rowEl.innerHTML = '';
    row.forEach(key => {
      const btn = document.createElement('button');
      btn.className = 'dl-vkb-key';
      if (key === '⌫')    { btn.classList.add('wide'); btn.textContent = '⌫'; }
      else if (key === 'ENTER') { btn.classList.add('enter-key'); btn.textContent = 'ENTER'; }
      else                { btn.textContent = key; }
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        dlVkbPress(key);
      });
      rowEl.appendChild(btn);
    });
  });

  dlVkbValue = '';
  dlVkbRender();
}

function dlVkbPress(key) {
  if (key === '⌫') {
    dlVkbValue = dlVkbValue.slice(0, -1);
  } else if (key === 'ENTER') {
    dlVkbCheck();
    return;
  } else {
    dlVkbValue += key;
  }
  dlVkbRender();
}

function dlVkbRender() {
  const el = document.getElementById('dlVkbText');
  if (el) el.textContent = dlVkbValue;
}

function dlVkbCheck() {
  const val  = dlVkbValue.trim().toLowerCase();
  const word = (dlQueue[dlIndex]?.word || '').toLowerCase().trim();
  const disp = document.getElementById('dlVkbDisplay');
  if (!val) return;

  if (val === word) {
    disp.classList.add('correct');
    dlConfetti(disp);
    xpOnFlashcardAction(); // active time
    setTimeout(() => {
      disp.classList.remove('correct');
      dlVkbValue = ''; dlVkbRender();
      dlNext(word);
    }, 550);
  } else {
    dlCorrectMap[word] = 0;
    disp.classList.add('wrong');
    setTimeout(() => {
      disp.classList.remove('wrong');
      dlVkbValue = ''; dlVkbRender();
    }, 700);
  }
}

function dlVkbReset() {
  dlVkbValue = '';
  dlVkbRender();
  const disp = document.getElementById('dlVkbDisplay');
  if (disp) disp.className = 'dl-vkb-display';
}

// ── Exit button smart handler ──
function dlExitOrSummary() {
  const session = document.getElementById('dlSession');
  const isInSession = session && session.style.display !== 'none';
  if (isInSession && dlWordsCount > 0) {
    dlShowSummary();
  } else {
    dlExit();
  }
}
