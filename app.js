// ─── InfinityPaste app.js — fully wired to index.html ────────────────────────
// Matches: collect-input, collect-label, view-*, tab-*, record-btn, etc.

// ─── IndexedDB ────────────────────────────────────────────────────────────────
const DB_NAME = 'infinitypaste-db';
const DB_VERSION = 3;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('recordings')) d.createObjectStore('recordings', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
    };
    req.onsuccess = e => { db = e.target.result; resolve(db); };
    req.onerror = e => reject(e.target.error);
  });
}

function idbGet(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readonly');
    const req = tx.objectStore('recordings').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbPut(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const req = tx.objectStore('recordings').put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const req = tx.objectStore('recordings').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function idbGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readonly');
    const req = tx.objectStore('recordings').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbFilePut(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const req = tx.objectStore('files').put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbFileGet(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbFileDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const req = tx.objectStore('files').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function idbFileGetAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── State ────────────────────────────────────────────────────────────────────
let queue = [];
let recordings = [];
let files = [];
let activeTab = 'collect';
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingTimer = null;
let recordingSeconds = 0;
let currentlyPlaying = null;
let _searchTerm = '';
let _sortOrder = 'newest';
let _labelManual = false;
let _autoTitleTimer = null;

const SETTINGS_KEY = 'infinitypaste-settings';
const QUEUE_KEY = 'infinitypaste-queue';

let settings = {
  autoclear: false,
  shownumbers: true,
  separator: '\n\n---\n\n',
  apiKeys: {}
};

function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) settings = { ...settings, ...JSON.parse(s) };
    if (!settings.apiKeys) settings.apiKeys = {};
  } catch {}
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
function saveSetting(key, value) {
  settings[key] = value;
  saveSettings();
}
function saveApiKey(provider, value) {
  value = (value || '').trim();
  if (!value) { showToast('Key is empty', 'error'); return; }
  settings.apiKeys[provider] = value;
  saveSettings();
  refreshKeyStatus(provider);
  showToast(`${provider} key saved`);
}
function deleteApiKey(provider) {
  delete settings.apiKeys[provider];
  saveSettings();
  refreshKeyStatus(provider);
  document.getElementById(`key-input-${provider}`).value = '';
  showToast(`${provider} key removed`);
}
function refreshKeyStatus(provider) {
  const dot = document.getElementById(`key-dot-${provider}`);
  const txt = document.getElementById(`key-status-${provider}`);
  const has = !!(settings.apiKeys && settings.apiKeys[provider]);
  if (dot) { dot.style.background = has ? 'var(--color-success,#437a22)' : 'var(--color-border,#ccc)'; }
  if (txt) txt.textContent = has ? 'Saved' : '';
}
function toggleKeyCard(provider) {
  const body = document.getElementById(`key-body-${provider}`);
  const input = document.getElementById(`key-input-${provider}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (!open && input && settings.apiKeys[provider]) input.value = settings.apiKeys[provider];
}

function loadQueue() {
  try {
    const q = localStorage.getItem(QUEUE_KEY);
    if (q) queue = JSON.parse(q);
  } catch { queue = []; }
}
function saveQueue() {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = `toast toast--${type} toast--visible`;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.id === `tab-${tab}`);
  });
  document.querySelectorAll('.tab-content').forEach(panel => {
    panel.classList.toggle('active', panel.id === `view-${tab}`);
  });
  if (tab === 'settings') refreshSettingsStats();
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Queue ────────────────────────────────────────────────────────────────────
function addToQueue(content, label, source) {
  // Called either from button onclick (no args) or programmatically (with args)
  if (content === undefined || typeof content === 'object') {
    // Called from button — read from inputs
    const inputEl = document.getElementById('collect-input');
    const labelEl = document.getElementById('collect-label');
    content = inputEl ? inputEl.value.trim() : '';
    label = labelEl ? labelEl.value.trim() : '';
    source = 'manual';
    if (!content) { showToast('Nothing to add', 'error'); return; }
    inputEl.value = '';
    labelEl.value = '';
    _labelManual = false;
    document.getElementById('fetch-bar').style.display = 'none';
    document.getElementById('autotitle-badge').style.display = 'none';
  }
  const item = {
    id: Date.now() + Math.random(),
    content: content || '',
    label: label || '',
    source: source || '',
    timestamp: new Date().toISOString()
  };
  queue.unshift(item);
  saveQueue();
  renderQueue();
  updateBadge();
  switchTab('queue');
  showToast('Added to queue');
  return item;
}

function removeItem(id) {
  queue = queue.filter(i => i.id !== id);
  saveQueue();
  renderQueue();
  updateBadge();
}

function clearQueue(skipConfirm) {
  if (!queue.length) return;
  if (!skipConfirm && !confirm('Clear all queue items?')) return;
  queue = [];
  saveQueue();
  renderQueue();
  updateBadge();
  showToast('Queue cleared');
}

function copyItem(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  navigator.clipboard.writeText(item.content)
    .then(() => showToast('Copied!'))
    .catch(() => showToast('Copy failed', 'error'));
}

function copyAll() {
  if (!queue.length) { showToast('Queue is empty', 'error'); return; }
  const text = queue.map(i => i.content).join(settings.separator || '\n\n---\n\n');
  navigator.clipboard.writeText(text)
    .then(() => {
      showToast('All copied!');
      if (settings.autoclear) { queue = []; saveQueue(); renderQueue(); updateBadge(); }
    })
    .catch(() => showToast('Copy failed', 'error'));
}

function dumpToCompose() {
  if (!queue.length) { showToast('Queue is empty', 'error'); return; }
  const text = queue.map(i => i.content).join(settings.separator || '\n\n---\n\n');
  const area = document.getElementById('compose-area');
  if (!area) return;
  area.value = (area.value ? area.value + '\n\n' : '') + text;
  updateComposeStats();
  switchTab('compose');
}

function updateBadge() {
  const badge = document.getElementById('queue-badge');
  const count = document.getElementById('badge-count');
  if (!badge || !count) return;
  if (queue.length > 0) {
    badge.style.display = 'inline-flex';
    count.textContent = queue.length;
  } else {
    badge.style.display = 'none';
  }
}

function onQueueSearch() {
  _searchTerm = (document.getElementById('queue-search')?.value || '').toLowerCase();
  renderQueue();
}

function onQueueSort() {
  _sortOrder = document.getElementById('queue-sort')?.value || 'newest';
  renderQueue();
}

function renderQueue() {
  const el = document.getElementById('queue-list');
  const emptyEl = document.getElementById('queue-empty');
  if (!el) return;

  let items = [...queue];
  if (_searchTerm) items = items.filter(i =>
    i.content.toLowerCase().includes(_searchTerm) ||
    i.label.toLowerCase().includes(_searchTerm) ||
    i.source.toLowerCase().includes(_searchTerm)
  );
  if (_sortOrder === 'oldest') items.reverse();
  else if (_sortOrder === 'label') items.sort((a,b) => a.label.localeCompare(b.label));
  else if (_sortOrder === 'source') items.sort((a,b) => a.source.localeCompare(b.source));

  if (emptyEl) emptyEl.style.display = items.length ? 'none' : 'flex';

  const cards = items.map((item, idx) => {
    const preview = item.content.length > 140 ? item.content.slice(0, 140) + '…' : item.content;
    const wordCount = item.content.trim().split(/\s+/).filter(Boolean).length;
    const num = settings.shownumbers ? `<span class="card-num">${queue.indexOf(item) + 1}</span>` : '';
    return `<div class="queue-card" id="qcard-${item.id}">
      <div class="card-header">
        ${num}
        <span class="card-label">${escapeHtml(item.label || item.source || 'item')}</span>
        <span class="card-meta">${wordCount}w · ${new Date(item.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="card-preview">${escapeHtml(preview)}</div>
      <div class="card-actions">
        <button class="card-btn" onclick="copyItem(${item.id})" title="Copy">📋</button>
        <button class="card-btn" onclick="extractKeywords(${item.id})" title="Keywords">🔑</button>
        <button class="card-btn" onclick="cleanupItem(${item.id})" title="Clean up">✨</button>
        <button class="card-btn" onclick="detectLang(${item.id})" title="Detect language">🌐</button>
        <button class="card-btn btn-danger" onclick="removeItem(${item.id})" title="Delete">✕</button>
      </div>
    </div>`;
  });
  // Keep the empty state element, replace everything else
  const existing = el.querySelectorAll('.queue-card');
  existing.forEach(n => n.remove());
  el.insertAdjacentHTML('beforeend', cards.join(''));
}

// ─── Collect Tab ──────────────────────────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s"'<>)]{4,}/i;

function _extractUrl(text) {
  const m = text.match(URL_RE);
  return m ? m[0] : null;
}

function onCollectInput() {
  const el = document.getElementById('collect-input');
  const fetchBar = document.getElementById('fetch-bar');
  if (!el || !fetchBar) return;
  const url = _extractUrl(el.value);
  fetchBar.style.display = url ? 'flex' : 'none';
  if (!_labelManual) _scheduleAutoTitle(el.value, url);
}

function onLabelInput() {
  _labelManual = true;
  clearTimeout(_autoTitleTimer);
  document.getElementById('autotitle-badge').style.display = 'none';
}

function _scheduleAutoTitle(text, url) {
  clearTimeout(_autoTitleTimer);
  _autoTitleTimer = setTimeout(() => {
    let suggested = '';
    if (url) {
      try { suggested = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    } else if (text.trim()) {
      const firstLine = text.split('\n')[0].trim();
      suggested = firstLine.length <= 60 ? firstLine : _tfidfKeywords(text, 3).map(k => k.word).join(', ');
    }
    if (suggested) {
      const labelEl = document.getElementById('collect-label');
      const badge = document.getElementById('autotitle-badge');
      if (labelEl && !_labelManual) {
        labelEl.value = suggested;
        if (badge) badge.style.display = 'inline-block';
      }
    }
  }, 800);
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) { showToast('Clipboard is empty', 'error'); return; }
    const inputEl = document.getElementById('collect-input');
    if (inputEl) { inputEl.value = text; onCollectInput(); }
    showToast('Pasted!');
  } catch {
    showToast('Clipboard access denied — paste manually', 'error');
  }
}

// Global paste shortcut
document.addEventListener('paste', e => {
  const focused = document.activeElement;
  if (focused && (focused.tagName === 'TEXTAREA' || focused.tagName === 'INPUT')) return;
  const text = e.clipboardData?.getData('text');
  if (text?.trim()) {
    addToQueue(text, '', 'paste');
    showToast('Pasted to queue!');
  }
});

async function fetchUrl() {
  const el = document.getElementById('collect-input');
  const labelEl = document.getElementById('collect-label');
  if (!el) return;
  const url = _extractUrl(el.value);
  if (!url) { showToast('No URL detected', 'error'); return; }
  showToast('Fetching…');
  document.getElementById('fetch-btn').disabled = true;
  try {
    const proxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const resp = await fetch(proxy);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    const raw = json.contents || '';
    const tmp = document.createElement('div');
    tmp.innerHTML = raw;
    tmp.querySelectorAll('script,style,noscript,nav,footer,header').forEach(n => n.remove());
    const text = (tmp.innerText || tmp.textContent || '').replace(/\s{3,}/g, '\n\n').trim();
    if (!text) throw new Error('No readable text found');
    const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
    // Use page title if available
    const titleMatch = raw.match(/<title[^>]*>([^<]+)<\/title>/i);
    const label = (titleMatch ? titleMatch[1].trim() : hostname);
    if (labelEl && !_labelManual) labelEl.value = label;
    el.value = text;
    onCollectInput();
    showToast('✓ URL fetched — review then Add to Queue');
  } catch (e) {
    showToast(e.message || 'Fetch failed', 'error');
  } finally {
    const btn = document.getElementById('fetch-btn');
    if (btn) btn.disabled = false;
  }
}

async function saveCurrentAsFile() {
  const el = document.getElementById('collect-input');
  const labelEl = document.getElementById('collect-label');
  if (!el) return;
  const content = el.value.trim();
  if (!content) { showToast('Nothing to save', 'error'); return; }
  const name = (labelEl?.value?.trim() || 'saved-' + Date.now()) + '.txt';
  const blob = new Blob([content], { type: 'text/plain' });
  const id = Date.now() + Math.random();
  await idbFilePut({ id, name, type: blob.type, size: blob.size, timestamp: new Date().toISOString(), blob });
  files.push({ id, name, type: blob.type, size: blob.size, timestamp: new Date().toISOString() });
  renderFiles();
  switchTab('files');
  showToast(`✓ Saved as ${name}`);
}

// ─── Recording ────────────────────────────────────────────────────────────────
function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

async function startRecording() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = saveRecording;
    mediaRecorder.start(100);
    isRecording = true;
    recordingSeconds = 0;
    _tickTimer();
    recordingTimer = setInterval(_tickTimer, 1000);
    const btn = document.getElementById('record-btn');
    const icon = document.getElementById('record-btn-icon');
    const status = document.getElementById('record-status');
    if (btn) btn.classList.add('recording');
    if (icon) icon.textContent = '⏹️';
    if (status) status.textContent = 'Recording…';
    document.getElementById('record-waveform')?.classList.add('active');
    showToast('Recording started');
  } catch {
    showToast('Microphone access denied', 'error');
  }
}

function _tickTimer() {
  recordingSeconds++;
  const m = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
  const s = String(recordingSeconds % 60).padStart(2, '0');
  const el = document.getElementById('record-timer');
  if (el) el.textContent = `${m}:${s}`;
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach(t => t.stop());
  isRecording = false;
  clearInterval(recordingTimer);
  const btn = document.getElementById('record-btn');
  const icon = document.getElementById('record-btn-icon');
  const status = document.getElementById('record-status');
  if (btn) btn.classList.remove('recording');
  if (icon) icon.textContent = '🎙️';
  if (status) status.textContent = 'Tap to record';
  document.getElementById('record-waveform')?.classList.remove('active');
}

async function saveRecording() {
  const blob = new Blob(audioChunks, { type: 'audio/webm' });
  const name = `Recording ${new Date().toLocaleString()}`;
  const id = Date.now();
  await idbPut({ id, name, blob, timestamp: new Date().toISOString(), duration: recordingSeconds });
  recordings = await idbGetAll();
  renderRecordings();
  showToast('Recording saved');
}

async function deleteRecording(id) {
  await idbDelete(id);
  recordings = await idbGetAll();
  renderRecordings();
  showToast('Recording deleted');
}

async function clearAllRecordings() {
  if (!recordings.length) return;
  if (!confirm('Delete all recordings?')) return;
  for (const r of recordings) await idbDelete(r.id);
  recordings = [];
  renderRecordings();
  showToast('All recordings deleted');
}

function playRecording(id) {
  const rec = recordings.find(r => r.id === id);
  if (!rec?.blob) return;
  if (currentlyPlaying) { currentlyPlaying.pause(); currentlyPlaying = null; }
  const url = URL.createObjectURL(rec.blob);
  const audio = document.getElementById(`audio-${id}`);
  if (audio) {
    audio.src = url;
    audio.style.display = 'block';
    audio.play();
    currentlyPlaying = audio;
  }
}

async function transcribeRecording(id) {
  const key = settings.apiKeys?.openai;
  if (!key) { showToast('OpenAI key required in Settings → AI Keys', 'error'); return; }
  const btn = document.getElementById(`transcribe-btn-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  showToast('Transcribing via Whisper…');
  try {
    const rec = await idbGet(id);
    if (!rec?.blob) throw new Error('Recording not found');
    const form = new FormData();
    form.append('file', rec.blob, 'audio.webm');
    form.append('model', 'whisper-1');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form
    });
    if (!resp.ok) throw new Error(`API error: ${resp.status}`);
    const data = await resp.json();
    const text = data.text?.trim();
    if (!text) throw new Error('Empty transcript');
    addToQueue(text, 'transcript', rec.name);
    showToast('✓ Transcription complete');
  } catch (e) {
    showToast(e.message || 'Transcription failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📝'; }
  }
}

function renderRecordings() {
  const el = document.getElementById('recordings-list');
  const emptyEl = document.getElementById('recordings-empty');
  if (!el) return;
  if (emptyEl) emptyEl.style.display = recordings.length ? 'none' : 'flex';
  const cards = recordings.slice().reverse().map(rec => {
    const dur = rec.duration ? `${Math.floor(rec.duration/60)}:${String(rec.duration%60).padStart(2,'0')}` : '--:--';
    return `<div class="queue-card">
      <div class="card-header">
        <span class="card-label">${escapeHtml(rec.name)}</span>
        <span class="card-meta">${dur}</span>
      </div>
      <div class="card-actions">
        <button class="card-btn" onclick="playRecording(${rec.id})" title="Play">▶️</button>
        <button class="card-btn" onclick="transcribeRecording(${rec.id})" id="transcribe-btn-${rec.id}" title="Transcribe (OpenAI)">📝</button>
        <button class="card-btn" onclick="localTranscribeRecording(${rec.id})" id="local-transcribe-btn-${rec.id}" title="Transcribe locally">🧠</button>
        <button class="card-btn btn-danger" onclick="deleteRecording(${rec.id})">✕</button>
      </div>
      <div id="local-progress-${rec.id}" style="display:none;font-size:0.75rem;color:var(--color-text-muted);padding:4px 0"></div>
      <audio id="audio-${rec.id}" style="display:none;width:100%;margin-top:8px" controls></audio>
    </div>`;
  });
  el.querySelectorAll('.queue-card').forEach(n => n.remove());
  el.insertAdjacentHTML('beforeend', cards.join(''));
}

// ─── Files ────────────────────────────────────────────────────────────────────
function triggerUpload() {
  document.getElementById('file-upload-input')?.click();
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('file-upload-input');
  if (input) input.addEventListener('change', () => handleFileUpload(input));
});

function isImageFile(f) {
  return /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(f.name) || (f.type && f.type.startsWith('image/'));
}
function isPdfFile(f) {
  return /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
}

async function handleFileUpload(input) {
  const fileList = input.files;
  if (!fileList?.length) return;
  for (const f of fileList) {
    const id = Date.now() + Math.random();
    const record = { id, name: f.name, type: f.type, size: f.size, timestamp: new Date().toISOString(), blob: f };
    await idbFilePut(record);
    files.push({ id, name: f.name, type: f.type, size: f.size, timestamp: record.timestamp });
  }
  renderFiles();
  showToast(`${fileList.length} file${fileList.length > 1 ? 's' : ''} uploaded`);
  input.value = '';
}

async function deleteFile(id) {
  await idbFileDelete(id);
  files = files.filter(f => f.id !== id);
  renderFiles();
  showToast('File deleted');
}

async function clearAllFiles() {
  if (!files.length) return;
  if (!confirm('Delete all files?')) return;
  for (const f of files) await idbFileDelete(f.id);
  files = [];
  renderFiles();
  showToast('All files deleted');
}

function renderFiles() {
  const el = document.getElementById('files-list');
  const emptyEl = document.getElementById('files-empty');
  if (!el) return;
  if (emptyEl) emptyEl.style.display = files.length ? 'none' : 'flex';
  const cards = files.map(file => {
    const canOcr = isImageFile(file);
    const isPdf = isPdfFile(file);
    const sizeKb = (file.size / 1024).toFixed(1);
    return `<div class="queue-card" id="fcard-${file.id}">
      <div class="card-header">
        <span class="card-label">${escapeHtml(file.name)}</span>
        <span class="card-meta">${sizeKb} KB · ${new Date(file.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="card-actions">
        <button class="card-btn" onclick="viewFile(${file.id})" title="View">👁</button>
        ${canOcr ? `<button class="card-btn" id="ocr-btn-${file.id}" onclick="ocrFile(${file.id})" title="OCR to text">🔍</button>` : ''}
        ${canOcr ? `<button class="card-btn" id="qr-btn-${file.id}" onclick="readQRFromFile(${file.id})" title="Read QR code">📷</button>` : ''}
        ${isPdf  ? `<button class="card-btn" id="pdf-btn-${file.id}" onclick="extractPdfToQueue(${file.id})" title="Extract PDF text">📄</button>` : ''}
        <button class="card-btn" id="code-btn-${file.id}" onclick="extractCodeFromFile(${file.id})" title="Extract code blocks">⌨️</button>
        <button class="card-btn" id="analyze-btn-${file.id}" onclick="analyzeFile(${file.id})" title="AI Analyze">🤖</button>
        <button class="card-btn btn-danger" onclick="deleteFile(${file.id})" title="Delete">✕</button>
      </div>
    </div>`;
  });
  el.querySelectorAll('.queue-card').forEach(n => n.remove());
  el.insertAdjacentHTML('beforeend', cards.join(''));
}

// ─── File Viewer ──────────────────────────────────────────────────────────────
async function viewFile(id) {
  const file = files.find(f => f.id == id);
  if (!file) return;
  const stored = await idbFileGet(id);
  if (!stored?.blob) return;
  const viewer = document.getElementById('file-viewer');
  const content = document.getElementById('viewer-content');
  const filename = document.getElementById('viewer-filename');
  const listView = document.getElementById('files-list-view');
  if (!viewer || !content) return;
  if (filename) filename.textContent = file.name;
  if (isImageFile(file)) {
    const url = URL.createObjectURL(stored.blob);
    content.innerHTML = `<img src="${url}" alt="${escapeHtml(file.name)}" style="max-width:100%;border-radius:8px">`;
  } else {
    const text = await stored.blob.text();
    content.textContent = text.slice(0, 20000);
  }
  if (listView) listView.style.display = 'none';
  viewer.style.display = 'block';
}

function closeFileViewer() {
  const viewer = document.getElementById('file-viewer');
  const listView = document.getElementById('files-list-view');
  if (viewer) viewer.style.display = 'none';
  if (listView) listView.style.display = 'block';
}

function addSelectionToQueue() {
  const content = document.getElementById('viewer-content');
  if (!content) return;
  const sel = window.getSelection()?.toString().trim();
  if (!sel) { showToast('Select some text first', 'error'); return; }
  addToQueue(sel, 'selection', 'file viewer');
}

// ─── Compose ──────────────────────────────────────────────────────────────────
function updateComposeStats() {
  const area = document.getElementById('compose-area');
  const stats = document.getElementById('compose-stats');
  if (!area || !stats) return;
  const chars = area.value.length;
  const words = area.value.trim().split(/\s+/).filter(Boolean).length;
  stats.textContent = `${chars.toLocaleString()} chars · ${words.toLocaleString()} words`;
}

function copyCompose() {
  const area = document.getElementById('compose-area');
  if (!area?.value) { showToast('Compose is empty', 'error'); return; }
  navigator.clipboard.writeText(area.value)
    .then(() => showToast('Copied!'))
    .catch(() => showToast('Copy failed', 'error'));
}

function shareCompose() {
  const area = document.getElementById('compose-area');
  if (!area?.value) { showToast('Compose is empty', 'error'); return; }
  if (navigator.share) {
    navigator.share({ text: area.value }).catch(() => {});
  } else {
    copyCompose();
    showToast('Share not supported — copied instead');
  }
}

function clearCompose() {
  const area = document.getElementById('compose-area');
  if (!area?.value) return;
  if (!confirm('Clear compose?')) return;
  area.value = '';
  updateComposeStats();
}

// ─── Settings Stats ───────────────────────────────────────────────────────────
function refreshSettingsStats() {
  const c = document.getElementById('stat-count');
  const f = document.getElementById('stat-files');
  const r = document.getElementById('stat-recordings');
  const s = document.getElementById('stat-storage');
  if (c) c.textContent = queue.length;
  if (f) f.textContent = files.length;
  if (r) r.textContent = recordings.length;
  if (s) {
    try {
      let bytes = new Blob([localStorage.getItem(QUEUE_KEY) || '']).size;
      s.textContent = bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`;
    } catch { s.textContent = '—'; }
  }
  // Refresh key status dots
  ['openai','groq','gemini','anthropic','xai','mistral','deepseek','cerebras','fireworks','sambanova'].forEach(p => refreshKeyStatus(p));
}

// ─── Bookmarklet ──────────────────────────────────────────────────────────────
function generateBookmarklet() {
  const area = document.getElementById('bookmarklet-area');
  const urlEl = document.getElementById('bookmarklet-url');
  if (!area || !urlEl) return;
  const appUrl = window.location.origin + window.location.pathname;
  const code = `javascript:(function(){var t=document.title;var u=location.href;var body=document.body.innerText||'';var text='['+t+']\\n'+u+'\\n\\n'+body.slice(0,8000);if(navigator.clipboard){navigator.clipboard.writeText(text).then(function(){alert('Page text copied! Open InfinityPaste and paste (Ctrl+V or the Paste button).')});}else{prompt('Copy this:',text);}})();`;
  urlEl.value = code;
  area.style.display = 'flex';
  showToast('Bookmarklet generated');
}

function copyBookmarklet() {
  const urlEl = document.getElementById('bookmarklet-url');
  if (!urlEl?.value) return;
  navigator.clipboard.writeText(urlEl.value)
    .then(() => showToast('Bookmarklet URL copied!'))
    .catch(() => showToast('Copy failed', 'error'));
}

// ─── OCR ──────────────────────────────────────────────────────────────────────
let _tesseractWorker = null;

async function _getTesseractWorker() {
  if (_tesseractWorker) return _tesseractWorker;
  if (typeof Tesseract === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  _tesseractWorker = await Tesseract.createWorker('eng');
  return _tesseractWorker;
}

async function ocrFile(id) {
  const file = files.find(f => f.id == id);
  if (!file) return;
  const btn = document.getElementById(`ocr-btn-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  showToast('Running OCR…');
  try {
    const stored = await idbFileGet(id);
    if (!stored?.blob) throw new Error('File data missing');
    const url = URL.createObjectURL(stored.blob);
    const worker = await _getTesseractWorker();
    const result = await worker.recognize(url);
    URL.revokeObjectURL(url);
    const text = result.data.text?.trim();
    if (!text) throw new Error('No text found');
    addToQueue(text, `ocr · ${file.name}`, 'Tesseract');
    showToast('✓ OCR complete');
  } catch (e) {
    showToast(e.message || 'OCR failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍'; }
  }
}

// ─── PDF ──────────────────────────────────────────────────────────────────────
async function extractPdfText(blob) {
  if (typeof pdfjsLib === 'undefined') {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3/build/pdf.min.js';
      s.onload = () => {
        if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3/build/pdf.worker.min.js';
        resolve();
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text.trim();
}

async function extractPdfToQueue(id) {
  const file = files.find(f => f.id == id);
  if (!file) return;
  const btn = document.getElementById(`pdf-btn-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  showToast('Extracting PDF…');
  try {
    const stored = await idbFileGet(id);
    if (!stored?.blob) throw new Error('File missing');
    const text = await extractPdfText(stored.blob);
    if (!text) throw new Error('No text found in PDF');
    addToQueue(text, `pdf · ${file.name}`, 'pdfjs');
    showToast('✓ PDF text extracted');
  } catch (e) {
    showToast(e.message || 'PDF extraction failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄'; }
  }
}

// ─── QR Code ──────────────────────────────────────────────────────────────────
let _jsqrLoaded = false;

function _loadJsQR() {
  if (_jsqrLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = () => { _jsqrLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load jsQR'));
    document.head.appendChild(s);
  });
}

async function readQRFromFile(fileId) {
  const file = files.find(f => f.id == fileId);
  if (!file) return;
  const btn = document.getElementById(`qr-btn-${fileId}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  showToast('Scanning for QR code…');
  try {
    await _loadJsQR();
    const stored = await idbFileGet(fileId);
    if (!stored?.blob) throw new Error('Image data missing');
    const url = URL.createObjectURL(stored.blob);
    const img = await _loadImageEl(url);
    URL.revokeObjectURL(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(imageData.data, imageData.width, imageData.height);
    if (!code) throw new Error('No QR code found in image');
    addToQueue(code.data, `QR · ${file.name}`, 'jsQR');
    showToast(`✓ QR decoded`);
  } catch (e) {
    showToast(e.message || 'QR scan failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📷'; }
  }
}

function _loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

// ─── AI Analyze ───────────────────────────────────────────────────────────────
async function analyzeFile(id) {
  const file = files.find(f => f.id == id);
  if (!file) return;
  const key = settings.apiKeys?.openai;
  if (!key) { showToast('OpenAI key required in Settings → AI Keys', 'error'); return; }
  const btn = document.getElementById(`analyze-btn-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  showToast('Analyzing…');
  try {
    const stored = await idbFileGet(id);
    if (!stored?.blob) throw new Error('File missing');
    let content = '';
    if (isImageFile(file)) {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(stored.blob);
      });
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${stored.blob.type};base64,${base64}` } },
          { type: 'text', text: 'Describe this image in detail.' }
        ]}]})
      });
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const data = await resp.json();
      content = data.choices?.[0]?.message?.content?.trim();
    } else {
      const text = await stored.blob.text();
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: `Analyze this:\n\n${text.slice(0,4000)}` }]})
      });
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const data = await resp.json();
      content = data.choices?.[0]?.message?.content?.trim();
    }
    if (!content) throw new Error('Empty response');
    addToQueue(content, `analysis · ${file.name}`, 'GPT');
    showToast('✓ Analysis complete');
  } catch (e) {
    showToast(e.message || 'Analysis failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖'; }
  }
}

// ─── Code Extractor ───────────────────────────────────────────────────────────
async function extractCodeFromFile(fileId) {
  const file = files.find(f => f.id == fileId);
  if (!file) return;
  const btn = document.getElementById(`code-btn-${fileId}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  showToast('Extracting code blocks…');
  try {
    const stored = await idbFileGet(fileId);
    if (!stored?.blob) throw new Error('File data missing');
    let text = '';
    if (isImageFile(file)) {
      const worker = await _getTesseractWorker();
      const url = URL.createObjectURL(stored.blob);
      const result = await worker.recognize(url);
      URL.revokeObjectURL(url);
      text = result.data.text?.trim();
    } else {
      text = await stored.blob.text();
    }
    if (!text) throw new Error('No text content found');
    const blocks = _extractCodeBlocks(text);
    if (!blocks.length) throw new Error('No code blocks detected');
    const output = blocks.map(b => '```' + b.lang + '\n' + b.code + '\n```').join('\n\n');
    addToQueue(output, `code · ${file.name}`, 'code-extractor');
    showToast(`✓ ${blocks.length} code block${blocks.length !== 1 ? 's' : ''} extracted`);
  } catch (e) {
    showToast(e.message || 'Code extraction failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⌨️'; }
  }
}

function _extractCodeBlocks(text) {
  const blocks = [];
  const fenced = [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)];
  if (fenced.length) { fenced.forEach(m => blocks.push({ lang: m[1] || _detectCodeLang(m[2]), code: m[2].trim() })); return blocks; }
  const lines = text.split('\n');
  let cur = [], inBlock = false;
  lines.forEach(line => {
    const isCode = /^(\t| {4,})/.test(line) || /^\s*(function|const|let|var|if|for|while|return|import|export|def |class |public |private )/.test(line);
    if (isCode) { inBlock = true; cur.push(line); }
    else if (inBlock && line.trim() === '') { cur.push(''); }
    else if (inBlock) {
      if (cur.filter(l => l.trim()).length >= 3) blocks.push({ lang: _detectCodeLang(cur.join('\n').trim()), code: cur.join('\n').trim() });
      cur = []; inBlock = false;
    }
  });
  if (inBlock && cur.filter(l => l.trim()).length >= 3) blocks.push({ lang: _detectCodeLang(cur.join('\n').trim()), code: cur.join('\n').trim() });
  return blocks;
}

function _detectCodeLang(code) {
  if (/import\s+\w|from\s+['"]|def\s+\w+\(|print\(/.test(code)) return 'python';
  if (/function\s+\w+\(|const\s+\w+\s*=|let\s+\w+|=>\s*{|require\(/.test(code)) return 'javascript';
  if (/<\?php|\$[A-Z]/.test(code)) return 'php';
  if (/<[a-z]+[\s>]|<\/[a-z]+>/.test(code)) return 'html';
  if (/SELECT|INSERT|UPDATE|DELETE|FROM|WHERE/i.test(code)) return 'sql';
  return '';
}

// ─── Local AI (Transformers.js) ───────────────────────────────────────────────
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';
let _transformersLoaded = false, _whisperPipeline = null, _whisperLoading = false;

function _loadTransformers() {
  if (_transformersLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TRANSFORMERS_CDN;
    s.onload = () => { _transformersLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load Transformers.js'));
    document.head.appendChild(s);
  });
}

async function _getWhisperPipeline(progressCb) {
  if (_whisperPipeline) return _whisperPipeline;
  if (_whisperLoading) throw new Error('Whisper is already loading — please wait…');
  _whisperLoading = true;
  await _loadTransformers();
  const { pipeline, env } = window.transformers || {};
  if (env) env.allowLocalModels = false;
  _whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', { progress_callback: progressCb || null });
  _whisperLoading = false;
  return _whisperPipeline;
}

async function localTranscribeRecording(id) {
  const btn = document.getElementById(`local-transcribe-btn-${id}`);
  const progressEl = document.getElementById(`local-progress-${id}`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  if (progressEl) { progressEl.style.display = 'block'; progressEl.textContent = 'Loading Whisper model (~75MB)…'; }
  showToast('Loading local Whisper…');
  try {
    const rec = await idbGet(id);
    if (!rec?.blob) throw new Error('Recording not found');
    const progressCb = (p) => {
      if (!progressEl) return;
      if (p.status === 'downloading') progressEl.textContent = `Downloading: ${Math.round(p.progress || 0)}%`;
      else if (p.status === 'loading') progressEl.textContent = 'Loading model…';
    };
    const whisper = await _getWhisperPipeline(progressCb);
    if (progressEl) progressEl.textContent = 'Transcribing…';
    const arrayBuffer = await rec.blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const float32 = decoded.getChannelData(0);
    audioCtx.close();
    const result = await whisper(float32, { language: 'english', task: 'transcribe' });
    const text = (result?.text || '').trim();
    if (!text) throw new Error('Empty transcript');
    addToQueue(text, 'local-transcript', rec.name);
    showToast('✓ Local transcription complete');
  } catch (e) {
    showToast(e.message || 'Local transcription failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧠'; }
    if (progressEl) progressEl.style.display = 'none';
  }
}

// ─── TF-IDF Keywords ──────────────────────────────────────────────────────────
function _tfidfKeywords(text, count = 10) {
  const sw = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','was','are','were','be','been','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','i','you','he','she','it','we','they','what','which','who','when','where','why','how','all','each','every','both','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','because','as','until','while','about','into','through','during','before','after','above','below','between','out','off','over','under','again','then','once','here','there','if','can','its','your','our','their','his','her','my','one','two','three','also','get','use','used','using','said','says','like','well','back','even','want','see','know','think','make','made','time','way','new','good','first','last','long','great','little','right','big','high','different','small','large','next','early','young','important','public','private','real','best','free','able']);
  const words = text.toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length > 3 && !sw.has(w) && !/^\d+$/.test(w));
  const freq = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  const total = words.length || 1, unique = Object.keys(freq).length || 1;
  return Object.entries(freq).map(([word,c]) => ({ word, score: (c/total) * Math.log(1 + unique/c) })).sort((a,b) => b.score - a.score).slice(0, count);
}

function extractKeywords(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  const keywords = _tfidfKeywords(item.content, 10);
  if (!keywords.length) { showToast('No keywords found', 'error'); return; }
  const result = `Keywords from: ${item.label || 'item'}\n\n` + keywords.map((k,i) => `${i+1}. ${k.word} (${k.score.toFixed(3)})`).join('\n');
  addToQueue(result, `keywords · ${item.label || 'item'}`, 'tfidf');
  showToast(`✓ ${keywords.length} keywords extracted`);
}

// ─── Language Detection ───────────────────────────────────────────────────────
const FRANC_CDN = 'https://cdn.jsdelivr.net/npm/franc-min@6.2.0/index.js';
let _francLoaded = false, _francDetect = null;

function _loadFranc() {
  if (_francLoaded) return Promise.resolve();
  return import(FRANC_CDN).then(mod => { _francDetect = mod.franc || mod.default; _francLoaded = true; }).catch(() => { throw new Error('Failed to load franc'); });
}

const ISO_LANG = { eng:'English',spa:'Spanish',fra:'French',deu:'German',ita:'Italian',por:'Portuguese',rus:'Russian',zho:'Chinese',jpn:'Japanese',kor:'Korean',ara:'Arabic',hin:'Hindi' };

async function detectLang(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  showToast('Detecting language…');
  try {
    await _loadFranc();
    const lang = _francDetect(item.content, { minLength: 5 });
    if (lang === 'und') { showToast('Language undetermined'); return; }
    const name = ISO_LANG[lang] || lang;
    const idx = queue.findIndex(i => i.id === id);
    if (idx >= 0 && !queue[idx].label?.includes(name)) {
      queue[idx].label = queue[idx].label ? `${queue[idx].label} · ${name}` : name;
      saveQueue(); renderQueue();
    }
    showToast(`✓ Detected: ${name}`);
  } catch (e) {
    showToast(e.message || 'Detection failed', 'error');
  }
}

// ─── Text Cleanup ─────────────────────────────────────────────────────────────
const COMPROMISE_CDN = 'https://cdn.jsdelivr.net/npm/compromise@14.14.4/builds/compromise.min.js';
let _compromiseLoaded = false;

function _loadCompromise() {
  if (_compromiseLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = COMPROMISE_CDN;
    s.onload = () => { _compromiseLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load compromise.js'));
    document.head.appendChild(s);
  });
}

async function cleanupItem(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  showToast('Cleaning up text…');
  try {
    await _loadCompromise();
    const nlp = window.nlp;
    if (!nlp) throw new Error('compromise.js not available');
    let text = item.content.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
    const doc = nlp(text);
    doc.contractions().expand();
    let cleaned = doc.text();
    cleaned = cleaned.replace(/\s+([.,!?;:])/g,'$1').replace(/([.,!?;:])(?=[a-zA-Z])/g,'$1 ').trim();
    addToQueue(cleaned, `cleaned · ${item.label || 'item'}`, 'compromise');
    showToast('✓ Cleaned text added');
  } catch (e) {
    showToast(e.message || 'Cleanup failed', 'error');
  }
}

// ─── Compose textarea live stats ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const area = document.getElementById('compose-area');
  if (area) area.addEventListener('input', updateComposeStats);
});

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadSettings();
  loadQueue();
  await openDB();
  recordings = await idbGetAll();
  const storedFiles = await idbFileGetAll();
  files = storedFiles.map(r => ({ id: r.id, name: r.name, type: r.type, size: r.size, timestamp: r.timestamp }));
  renderQueue();
  renderRecordings();
  renderFiles();
  updateBadge();
  updateComposeStats();
  refreshSettingsStats();
}
