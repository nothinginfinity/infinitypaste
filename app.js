// ─── InfinityPaste v3 — app.js ────────────────────────────────────
const STORAGE_KEY    = 'infinitypaste_queue';
const SETTINGS_KEY   = 'infinitypaste_settings';
const FILES_KEY      = 'infinitypaste_files';
const APIKEYS_KEY    = 'infinitypaste_apikeys';
const IDB_NAME       = 'infinitypaste_db';
const IDB_STORE      = 'recordings';
const IDB_VERSION    = 1;

// ─── State ────────────────────────────────────────────────────────
let queue    = [];
let files    = [];
let apiKeys  = { openai: '' };
let settings = { autoclear: false, shownumbers: true, separator: '\n\n---\n\n' };

// Recording state
let mediaRecorder    = null;
let recordingChunks  = [];
let recordingTimer   = null;
let recordingSeconds = 0;
let isRecording      = false;
let idbDb            = null; // IndexedDB handle
let recordings       = [];   // [{ id, name, duration, mimeType, size, added }] — metadata only

// Selection capture
let _capturedSelection = '';

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  loadQueue();
  loadSettings();
  loadFiles();
  loadApiKeys();
  renderQueue();
  renderFiles();
  updateBadge();
  applySettings();
  initCompose();
  initUploadInput();
  initSelectionCapture();
  initIDB().then(() => {
    loadRecordingsMeta().then(renderRecordings);
  });
  checkShareTarget();
}

// ─── IndexedDB ────────────────────────────────────────────────
function initIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { idbDb = e.target.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });
}

function idbPut(record) {
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(record).onsuccess = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function idbGet(id) {
  return new Promise((resolve, reject) => {
    const tx  = idbDb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function idbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id).onsuccess = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function idbClear() {
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear().onsuccess = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function idbGetAllMeta() {
  return new Promise((resolve, reject) => {
    const tx  = idbDb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result.map(r => ({
      id: r.id, name: r.name, duration: r.duration,
      mimeType: r.mimeType, size: r.size, added: r.added
    })));
    req.onerror = () => reject(req.error);
  });
}

// ─── Recordings metadata ──────────────────────────────────────
async function loadRecordingsMeta() {
  try { recordings = await idbGetAllMeta(); }
  catch { recordings = []; }
}

// ─── MediaRecorder ─────────────────────────────────────────
async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Pick best supported MIME
    const mime = [
      'audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'
    ].find(t => MediaRecorder.isTypeSupported(t)) || '';

    mediaRecorder   = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    recordingChunks = [];

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) recordingChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const usedMime = mediaRecorder.mimeType || mime || 'audio/webm';
      const blob = new Blob(recordingChunks, { type: usedMime });
      await saveRecording(blob, usedMime);
    };

    mediaRecorder.start(500); // collect chunks every 500ms
    isRecording = true;
    recordingSeconds = 0;
    setRecordingUI(true);
    startTimer();

  } catch (err) {
    showToast('Microphone access denied', 'error');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  stopTimer();
  setRecordingUI(false);
}

async function saveRecording(blob, mimeType) {
  const id    = Date.now();
  const ext   = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const name  = `Recording ${formatDate(new Date())}.${ext}`;
  const record = {
    id, name, mimeType, size: blob.size,
    duration: recordingSeconds,
    added: new Date().toISOString(),
    blob
  };
  await idbPut(record);
  recordings.push({ id, name, mimeType, size: blob.size, duration: recordingSeconds, added: record.added });
  renderRecordings();
  updateStats();
  showToast(`✓ Saved — ${formatDuration(recordingSeconds)}`);
}

// ─── Timer ─────────────────────────────────────────────────────
function startTimer() {
  recordingTimer = setInterval(() => {
    recordingSeconds++;
    document.getElementById('record-timer').textContent = formatDuration(recordingSeconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(recordingTimer);
  recordingTimer = null;
  document.getElementById('record-timer').textContent = '0:00';
}

// ─── Recording UI ──────────────────────────────────────────
function setRecordingUI(active) {
  const btn    = document.getElementById('record-btn');
  const icon   = document.getElementById('record-btn-icon');
  const status = document.getElementById('record-status');
  const wave   = document.getElementById('record-waveform');

  if (active) {
    btn.classList.add('record-btn--active');
    icon.textContent = '⏹️';
    status.textContent = 'Recording… tap to stop';
    wave.classList.add('record-waveform--active');
  } else {
    btn.classList.remove('record-btn--active');
    icon.textContent = '🎙️';
    status.textContent = 'Tap to record';
    wave.classList.remove('record-waveform--active');
  }
}

// ─── Render Recordings ──────────────────────────────────────
function renderRecordings() {
  const list  = document.getElementById('recordings-list');
  const empty = document.getElementById('recordings-empty');

  if (!recordings.length) {
    empty.style.display = 'flex';
    [...list.querySelectorAll('.recording-card')].forEach(el => el.remove());
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = '';
  list.appendChild(empty);

  // newest first
  [...recordings].reverse().forEach(rec => {
    const card = document.createElement('div');
    card.className = 'recording-card';
    card.id = `rec-${rec.id}`;
    card.innerHTML = `
      <div class="recording-info">
        <div class="recording-name">${escapeHtml(rec.name)}</div>
        <div class="recording-meta">${formatDuration(rec.duration)} · ${formatBytes(rec.size)} · ${formatTime(rec.added)}</div>
      </div>
      <div class="recording-actions">
        <button class="card-btn card-btn--play" onclick="playRecording(${rec.id})" id="play-btn-${rec.id}">▶️</button>
        <button class="card-btn card-btn--transcribe" onclick="transcribeRecording(${rec.id})" id="transcribe-btn-${rec.id}">📝</button>
        <button class="card-btn card-btn--delete" onclick="deleteRecording(${rec.id})">✕</button>
      </div>
      <audio id="audio-${rec.id}" style="display:none" controls></audio>
    `;
    list.appendChild(card);
  });
}

// ─── Play Recording ───────────────────────────────────────
let currentAudioEl = null;
let currentPlayId  = null;

async function playRecording(id) {
  // Stop any playing audio first
  if (currentAudioEl) {
    currentAudioEl.pause();
    currentAudioEl.src = '';
    if (currentPlayId) {
      const prevBtn = document.getElementById(`play-btn-${currentPlayId}`);
      if (prevBtn) prevBtn.textContent = '▶️';
    }
    if (currentPlayId === id) {
      currentAudioEl = null;
      currentPlayId  = null;
      return; // toggle off
    }
  }

  const rec = await idbGet(id);
  if (!rec || !rec.blob) { showToast('Recording not found', 'error'); return; }

  const url    = URL.createObjectURL(rec.blob);
  const audioEl = document.getElementById(`audio-${id}`);
  audioEl.src  = url;
  audioEl.style.display = 'block';
  audioEl.play();

  const btn = document.getElementById(`play-btn-${id}`);
  if (btn) btn.textContent = '⏸️';

  audioEl.onended = () => {
    btn.textContent = '▶️';
    audioEl.style.display = 'none';
    URL.revokeObjectURL(url);
    currentAudioEl = null;
    currentPlayId  = null;
  };

  currentAudioEl = audioEl;
  currentPlayId  = id;
}

// ─── Delete / Clear Recordings ──────────────────────────────
async function deleteRecording(id) {
  await idbDelete(id);
  recordings = recordings.filter(r => r.id !== id);
  renderRecordings();
  updateStats();
  showToast('Recording deleted');
}

async function clearAllRecordings() {
  if (!recordings.length) { showToast('No recordings to clear'); return; }
  await idbClear();
  recordings = [];
  renderRecordings();
  updateStats();
  showToast('All recordings cleared');
}

// ─── Transcribe (Whisper) ──────────────────────────────────
async function transcribeRecording(id) {
  if (!apiKeys.openai) {
    showToast('Add your OpenAI key in Settings → AI Keys', 'error');
    switchTab('settings');
    return;
  }

  const btn = document.getElementById(`transcribe-btn-${id}`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

  try {
    const rec = await idbGet(id);
    if (!rec || !rec.blob) throw new Error('Recording not found');

    const ext = rec.mimeType.includes('mp4') ? 'm4a'
      : rec.mimeType.includes('ogg') ? 'ogg' : 'webm';

    const form = new FormData();
    form.append('file', new File([rec.blob], `audio.${ext}`, { type: rec.mimeType }));
    form.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeys.openai}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error ${res.status}`);
    }

    const data = await res.json();
    const text = data.text?.trim();
    if (!text) throw new Error('Empty transcript');

    addToQueue(text, 'transcript', rec.name);
    switchTab('queue');

  } catch (e) {
    showToast(e.message || 'Transcription failed', 'error');
  } finally {
    if (btn) { btn.textContent = '📝'; btn.disabled = false; }
  }
}

// ─── API Keys ─────────────────────────────────────────────────
function loadApiKeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(APIKEYS_KEY));
    if (saved) apiKeys = { ...apiKeys, ...saved };
  } catch {}
  applyApiKeyUI();
}

function saveApiKey(name, value) {
  apiKeys[name] = value.trim();
  localStorage.setItem(APIKEYS_KEY, JSON.stringify(apiKeys));
  updateKeyStatus(name);
}

function applyApiKeyUI() {
  const input = document.getElementById('setting-openai-key');
  if (input && apiKeys.openai) {
    input.value = apiKeys.openai;
    updateKeyStatus('openai');
  }
}

function updateKeyStatus(name) {
  const el = document.getElementById(`${name}-key-status`);
  if (!el) return;
  const val = apiKeys[name];
  if (!val) {
    el.textContent = '';
    el.className = 'key-status';
  } else if (val.startsWith('sk-') && val.length > 20) {
    el.textContent = '✓ Key saved';
    el.className = 'key-status key-status--ok';
  } else {
    el.textContent = '⚠️ Looks wrong — should start with sk-';
    el.className = 'key-status key-status--warn';
  }
}

function toggleKeyVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? '🙈' : '👁️';
}

// ─── Share Target ──────────────────────────────────────────────
function checkShareTarget() {
  const params   = new URLSearchParams(window.location.search);
  const text     = params.get('text')   || '';
  const title    = params.get('title')  || '';
  const url      = params.get('url')    || '';
  const imported = params.get('import') || '';
  const content  = text || imported || url;
  if (!content.trim()) return;

  let label = title || '';
  if (!label && url) { try { label = new URL(url).hostname; } catch { label = 'shared'; } }
  if (!label) label = 'shared';

  queue.push({ id: Date.now(), content: content.trim(), label, source: 'share', added: new Date().toISOString() });
  saveQueue(); renderQueue(); updateBadge();
  window.history.replaceState({}, '', '/infinitypaste/');
  switchTab('queue');
  showToast('✓ Added from share');
}

// ─── Selection capture ──────────────────────────────────────
function initSelectionCapture() {
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    const txt = sel ? sel.toString().trim() : '';
    if (txt) _capturedSelection = txt;
  });
  const btn = document.getElementById('add-selection-btn');
  if (btn) {
    btn.addEventListener('touchstart', () => {
      const sel = window.getSelection();
      const txt = sel ? sel.toString().trim() : '';
      if (txt) _capturedSelection = txt;
    }, { passive: true });
  }
}

// ─── Storage ──────────────────────────────────────────────────────
function loadQueue() {
  try { queue = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { queue = []; }
}
function saveQueue() { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); }
function loadFiles() {
  try { files = JSON.parse(localStorage.getItem(FILES_KEY)) || []; } catch { files = []; }
}
function saveFiles() {
  try { localStorage.setItem(FILES_KEY, JSON.stringify(files)); }
  catch { showToast('Storage full — remove some files', 'error'); }
}
function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); if (s) settings = { ...settings, ...s }; } catch {}
}
function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (key === 'shownumbers') renderQueue();
  updateStats();
}
function applySettings() {
  document.getElementById('setting-autoclear').checked   = settings.autoclear;
  document.getElementById('setting-shownumbers').checked = settings.shownumbers;
  document.getElementById('setting-separator').value     = settings.separator;
  updateStats();
}

// ─── Toast ────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast--show' + (type === 'error' ? ' toast--error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2500);
}

// ─── Queue ────────────────────────────────────────────────────────
function addToQueue(contentOverride, labelOverride, sourceOverride) {
  const content = contentOverride !== undefined
    ? contentOverride
    : document.getElementById('collect-input').value.trim();
  const label = labelOverride !== undefined
    ? labelOverride
    : document.getElementById('collect-label').value.trim();
  const source = sourceOverride || null;
  if (!content) { showToast('Nothing to add', 'error'); return; }
  queue.push({ id: Date.now(), content, label: label || null, source, added: new Date().toISOString() });
  saveQueue(); renderQueue(); updateBadge(); updateStats();
  if (contentOverride === undefined) {
    document.getElementById('collect-input').value = '';
    document.getElementById('collect-label').value = '';
  }
  showToast(`✓ Added to queue (${queue.length} item${queue.length !== 1 ? 's' : ''})`);
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { showToast('Clipboard is empty', 'error'); return; }
    document.getElementById('collect-input').value = text;
    showToast('Pasted from clipboard');
  } catch { showToast('Long-press the textarea and choose Paste', 'error'); }
}

function removeItem(id) {
  queue = queue.filter(i => i.id !== id);
  saveQueue(); renderQueue(); updateBadge(); updateStats();
  showToast('Removed');
}

function copyItem(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  navigator.clipboard.writeText(item.content)
    .then(() => showToast('✓ Copied'))
    .catch(() => showToast('Copy failed', 'error'));
}

function copyAll() {
  if (!queue.length) { showToast('Queue is empty', 'error'); return; }
  const combined = queue.map((item, i) => {
    const header = settings.shownumbers
      ? `[${i + 1}${item.label ? ` — ${item.label}` : ''}${item.source ? ` · ${item.source}` : ''}]\n`
      : (item.label ? `[${item.label}]\n` : '');
    return header + item.content;
  }).join(settings.separator);
  navigator.clipboard.writeText(combined)
    .then(() => { showToast(`✓ Copied ${queue.length} items`); if (settings.autoclear) setTimeout(() => clearQueue(true), 1500); })
    .catch(() => showToast('Copy failed', 'error'));
}

function clearQueue(silent = false) {
  if (!silent && !queue.length) { showToast('Queue is already empty'); return; }
  queue = []; saveQueue(); renderQueue(); updateBadge(); updateStats();
  if (!silent) showToast('Queue cleared');
}

// ─── Upload Input ──────────────────────────────────────────────
function initUploadInput() {
  const old = document.getElementById('file-upload-input');
  if (old) old.remove();
  const input = document.createElement('input');
  input.type = 'file'; input.id = 'file-upload-input'; input.multiple = true; input.accept = '*/*';
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px;';
  input.addEventListener('change', handleFileUpload);
  document.body.appendChild(input);
}

function triggerUpload() {
  const input = document.getElementById('file-upload-input');
  if (input) { input.value = ''; input.click(); }
}

// ─── Files ────────────────────────────────────────────────────────
async function handleFileUpload(event) {
  const uploaded = Array.from(event.target.files || []);
  if (!uploaded.length) return;
  let added = 0;
  for (const file of uploaded) {
    try {
      const content = await readFileContent(file);
      files.push({ id: Date.now() + Math.random(), name: file.name, type: file.type || 'text/plain', size: file.size, content, added: new Date().toISOString() });
      added++;
    } catch { showToast(`Could not read ${file.name}`, 'error'); }
  }
  saveFiles(); renderFiles(); updateStats();
  showToast(`✓ Added ${added} file${added !== 1 ? 's' : ''}`);
}

function readFileContent(file) {
  return new Promise((resolve, reject) => {
    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
      resolve(`[PDF: ${file.name} — ${formatBytes(file.size)}]\n\nTo extract text from this PDF, open it in the file viewer.`);
      return;
    }
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsText(file, 'UTF-8');
  });
}

function renderFiles() {
  const list  = document.getElementById('files-list');
  const empty = document.getElementById('files-empty');
  if (!files.length) {
    empty.style.display = 'flex';
    [...list.querySelectorAll('.file-row')].forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = '';
  list.appendChild(empty);
  files.forEach(file => {
    const row = document.createElement('div');
    row.className = 'file-row';
    row.innerHTML = `
      <div class="file-row-info" onclick="openFileViewer(${JSON.stringify(file.id)})">
        <span class="file-icon">${fileIcon(file.name)}</span>
        <div class="file-meta">
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-size">${formatBytes(file.size || 0)} · ${formatTime(file.added)}</div>
        </div>
      </div>
      <button class="card-btn card-btn--delete" onclick="removeFile(${JSON.stringify(file.id)})">✕</button>
    `;
    list.appendChild(row);
  });
}

function openFileViewer(id) {
  const file = files.find(f => f.id == id);
  if (!file) return;
  _capturedSelection = '';
  document.getElementById('files-list-view').style.display = 'none';
  document.getElementById('file-viewer').style.display     = 'flex';
  document.getElementById('viewer-filename').textContent   = file.name;
  const content = document.getElementById('viewer-content');
  content.textContent = file.content;
  content.dataset.fileId   = id;
  content.dataset.fileName = file.name;
  const btn = document.getElementById('add-selection-btn');
  if (btn) {
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('touchstart', () => {
      const sel = window.getSelection();
      const txt = sel ? sel.toString().trim() : '';
      if (txt) _capturedSelection = txt;
    }, { passive: true });
  }
}

function closeFileViewer() {
  _capturedSelection = '';
  document.getElementById('file-viewer').style.display     = 'none';
  document.getElementById('files-list-view').style.display = 'block';
}

function addSelectionToQueue() {
  const sel     = window.getSelection();
  const liveTxt = sel ? sel.toString().trim() : '';
  const text    = liveTxt || _capturedSelection;
  if (!text) { showToast('Select some text first, then tap + Add Selection', 'error'); return; }
  const content  = document.getElementById('viewer-content');
  const fileName = content.dataset.fileName || 'file';
  addToQueue(text, null, fileName);
  _capturedSelection = '';
  if (sel) sel.removeAllRanges();
}

function removeFile(id) {
  files = files.filter(f => f.id != id);
  saveFiles(); renderFiles(); updateStats();
  showToast('File removed');
}

function clearAllFiles() {
  files = []; saveFiles(); renderFiles(); updateStats();
  closeFileViewer();
  showToast('All files cleared');
}

// ─── Compose ──────────────────────────────────────────────────────
function initCompose() {
  document.getElementById('compose-area').addEventListener('input', updateComposeStats);
}
function dumpToCompose() {
  if (!queue.length) { showToast('Queue is empty', 'error'); return; }
  const combined = queue.map((item, i) => {
    const header = settings.shownumbers
      ? `[${i + 1}${item.label ? ` — ${item.label}` : ''}${item.source ? ` · ${item.source}` : ''}]\n`
      : (item.label ? `[${item.label}]\n` : '');
    return header + item.content;
  }).join(settings.separator);
  const area = document.getElementById('compose-area');
  area.value = area.value ? area.value + '\n\n' + combined : combined;
  updateComposeStats();
  switchTab('compose');
  showToast(`✓ Dumped ${queue.length} items to Compose`);
}
function copyCompose() {
  const text = document.getElementById('compose-area').value;
  if (!text) { showToast('Compose is empty', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('✓ Copied compose doc')).catch(() => showToast('Copy failed', 'error'));
}
function shareCompose() {
  const text = document.getElementById('compose-area').value;
  if (!text) { showToast('Compose is empty', 'error'); return; }
  if (navigator.share) { navigator.share({ title: 'InfinityPaste Document', text }).catch(() => {}); }
  else { copyCompose(); showToast('Copied (Share not available in this browser)'); }
}
function clearCompose() {
  document.getElementById('compose-area').value = '';
  updateComposeStats();
  showToast('Compose cleared');
}
function updateComposeStats() {
  const text = document.getElementById('compose-area').value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById('compose-stats').textContent = `${text.length.toLocaleString()} chars · ${words.toLocaleString()} words`;
}

// ─── Tabs ─────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(v => v.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`view-${name}`).classList.add('active');
  if (name === 'settings') { updateStats(); applyApiKeyUI(); }
}

// ─── Badge + Stats ────────────────────────────────────────────────
function updateBadge() {
  const badge = document.getElementById('queue-badge');
  const count = document.getElementById('badge-count');
  count.textContent = queue.length;
  badge.style.display = queue.length > 0 ? 'flex' : 'none';
}
function updateStats() {
  document.getElementById('stat-count').textContent      = queue.length;
  document.getElementById('stat-files').textContent      = files.length;
  document.getElementById('stat-recordings').textContent = recordings.length;
  const qBytes = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
  const fBytes = new Blob([localStorage.getItem(FILES_KEY)   || '']).size;
  document.getElementById('stat-storage').textContent = formatBytes(qBytes + fBytes);
}

// ─── Render Queue ─────────────────────────────────────────────────
function renderQueue() {
  const list  = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  document.getElementById('queue-count-label').textContent = `${queue.length} item${queue.length !== 1 ? 's' : ''}`;
  if (!queue.length) {
    empty.style.display = 'flex';
    [...list.querySelectorAll('.queue-card')].forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = '';
  list.appendChild(empty);
  queue.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'queue-card';
    const preview   = item.content.length > 120 ? item.content.slice(0, 120) + '…' : item.content;
    const labelHtml  = item.label  ? `<span class="card-label">${escapeHtml(item.label)}</span>`   : '';
    const sourceHtml = item.source ? `<span class="card-source">${escapeHtml(item.source)}</span>` : '';
    const numHtml    = settings.shownumbers ? `<span class="card-num">${i + 1}</span>` : '';
    card.innerHTML = `
      <div class="card-header">
        <div class="card-meta">${numHtml}${labelHtml}${sourceHtml}</div>
        <div class="card-actions">
          <button class="card-btn card-btn--copy" onclick="copyItem(${item.id})">Copy</button>
          <button class="card-btn card-btn--delete" onclick="removeItem(${item.id})">✕</button>
        </div>
      </div>
      <div class="card-preview">${escapeHtml(preview)}</div>
      <div class="card-time">${formatTime(item.added)}</div>
    `;
    list.appendChild(card);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) + ' · ' + d.toLocaleDateString([], { month:'short', day:'numeric' });
}
function formatDate(d) {
  return d.toLocaleDateString([], { month:'short', day:'numeric' }) + ' ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}
function formatDuration(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { pdf:'📕', md:'📝', txt:'📄', js:'🟨', ts:'🔷', tsx:'⚛️', jsx:'⚛️', json:'📦', css:'🎨', html:'🌐', py:'🐍', swift:'🍎', csv:'📊', xml:'📋', sh:'⚡' };
  return map[ext] || '📄';
}

// ─── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
