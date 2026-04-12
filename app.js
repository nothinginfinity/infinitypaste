// ─── InfinityPaste v3.3.0 — app.js ───────────────────────────────────────────
const STORAGE_KEY  = 'infinitypaste_queue';
const SETTINGS_KEY = 'infinitypaste_settings';
const FILES_KEY    = 'infinitypaste_files';
const APIKEYS_KEY  = 'infinitypaste_apikeys';
const IDB_NAME     = 'infinitypaste_db';
const IDB_STORE    = 'recordings';
const IDB_VERSION  = 1;

// All supported providers — id must match HTML input ids
const PROVIDERS = [
  { id: 'openai',    name: 'OpenAI',       prefix: 'sk-',      minLen: 20 },
  { id: 'groq',      name: 'Groq',         prefix: 'gsk_',     minLen: 10 },
  { id: 'gemini',    name: 'Gemini',       prefix: 'AIza',     minLen: 10 },
  { id: 'anthropic', name: 'Anthropic',    prefix: 'sk-ant-',  minLen: 15 },
  { id: 'xai',       name: 'xAI',          prefix: 'xai-',     minLen: 10 },
  { id: 'mistral',   name: 'Mistral',      prefix: '',         minLen: 10 },
  { id: 'deepseek',  name: 'DeepSeek',     prefix: 'sk-',      minLen: 10 },
  { id: 'cerebras',  name: 'Cerebras',     prefix: 'csk-',     minLen: 10 },
  { id: 'fireworks', name: 'Fireworks',    prefix: 'fw-',      minLen: 10 },
  { id: 'sambanova', name: 'SambaNova',    prefix: '',         minLen: 10 },
];

// Image MIME types that support OCR
const IMAGE_TYPES = ['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/bmp','image/tiff'];
const IMAGE_EXTS  = ['png','jpg','jpeg','gif','webp','bmp','tiff','heic','heif'];

// Tesseract CDN — loaded on demand, worker reused across calls
const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let _tesseractWorker = null;   // reused worker instance
let _tesseractLoaded = false;  // script tag injected flag

// ─── State ────────────────────────────────────────────────────────────────────
let queue    = [];
let files    = [];
let apiKeys  = {};
let settings = { autoclear: false, shownumbers: true, separator: '\n\n---\n\n' };

// Recording state
let mediaRecorder    = null;
let recordingChunks  = [];
let recordingTimer   = null;
let recordingSeconds = 0;
let isRecording      = false;
let idbDb            = null;
let recordings       = [];

let _capturedSelection = '';

// ─── Init ─────────────────────────────────────────────────────────────────────
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

// ─── IndexedDB ────────────────────────────────────────────────────────────────
function initIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE))
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
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

// ─── Recordings meta ──────────────────────────────────────────────────────────
async function loadRecordingsMeta() {
  try { recordings = await idbGetAllMeta(); }
  catch { recordings = []; }
}

// ─── MediaRecorder ────────────────────────────────────────────────────────────
async function toggleRecording() {
  if (isRecording) stopRecording(); else await startRecording();
}
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/mp4','audio/aac','audio/webm;codecs=opus','audio/webm','audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';
    mediaRecorder  = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    recordingChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) recordingChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const usedMime = mediaRecorder.mimeType || mime || 'audio/webm';
      await saveRecording(new Blob(recordingChunks, { type: usedMime }), usedMime);
    };
    mediaRecorder.start(500);
    isRecording = true; recordingSeconds = 0;
    setRecordingUI(true); startTimer();
  } catch { showToast('Microphone access denied', 'error'); }
}
function stopRecording() {
  if (mediaRecorder?.state !== 'inactive') mediaRecorder.stop();
  isRecording = false; stopTimer(); setRecordingUI(false);
}
async function saveRecording(blob, mimeType) {
  const id   = Date.now();
  const ext  = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const name = `Recording ${formatDate(new Date())}.${ext}`;
  const record = { id, name, mimeType, size: blob.size, duration: recordingSeconds, added: new Date().toISOString(), blob };
  await idbPut(record);
  recordings.push({ id, name, mimeType, size: blob.size, duration: recordingSeconds, added: record.added });
  renderRecordings(); updateStats();
  showToast(`✓ Saved — ${formatDuration(recordingSeconds)}`);
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  recordingTimer = setInterval(() => {
    recordingSeconds++;
    document.getElementById('record-timer').textContent = formatDuration(recordingSeconds);
  }, 1000);
}
function stopTimer() {
  clearInterval(recordingTimer); recordingTimer = null;
  document.getElementById('record-timer').textContent = '0:00';
}

// ─── Recording UI ─────────────────────────────────────────────────────────────
function setRecordingUI(active) {
  const btn    = document.getElementById('record-btn');
  const icon   = document.getElementById('record-btn-icon');
  const status = document.getElementById('record-status');
  const wave   = document.getElementById('record-waveform');
  if (active) {
    btn.classList.add('record-btn--active');
    icon.textContent = '⏹️'; status.textContent = 'Recording… tap to stop';
    wave.classList.add('record-waveform--active');
  } else {
    btn.classList.remove('record-btn--active');
    icon.textContent = '🎙️'; status.textContent = 'Tap to record';
    wave.classList.remove('record-waveform--active');
  }
}

// ─── Render Recordings ────────────────────────────────────────────────────────
function renderRecordings() {
  const list  = document.getElementById('recordings-list');
  const empty = document.getElementById('recordings-empty');
  if (!recordings.length) {
    empty.style.display = 'flex';
    list.querySelectorAll('.recording-card').forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = ''; list.appendChild(empty);
  [...recordings].reverse().forEach(rec => {
    const card = document.createElement('div');
    card.className = 'recording-card'; card.id = `rec-${rec.id}`;
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
      <audio id="audio-${rec.id}" style="display:none" controls></audio>`;
    list.appendChild(card);
  });
}

// ─── Play ─────────────────────────────────────────────────────────────────────
let currentAudioEl = null, currentPlayId = null;
async function playRecording(id) {
  if (currentAudioEl) {
    currentAudioEl.pause(); currentAudioEl.src = '';
    const prev = document.getElementById(`play-btn-${currentPlayId}`);
    if (prev) prev.textContent = '▶️';
    if (currentPlayId === id) { currentAudioEl = currentPlayId = null; return; }
  }
  const rec = await idbGet(id);
  if (!rec?.blob) { showToast('Recording not found', 'error'); return; }
  const url = URL.createObjectURL(rec.blob);
  const audioEl = document.getElementById(`audio-${id}`);
  audioEl.src = url; audioEl.style.display = 'block'; audioEl.play();
  const btn = document.getElementById(`play-btn-${id}`);
  if (btn) btn.textContent = '⏸️';
  audioEl.onended = () => {
    if (btn) btn.textContent = '▶️';
    audioEl.style.display = 'none';
    URL.revokeObjectURL(url);
    currentAudioEl = currentPlayId = null;
  };
  currentAudioEl = audioEl; currentPlayId = id;
}

// ─── Delete / Clear ───────────────────────────────────────────────────────────
async function deleteRecording(id) {
  await idbDelete(id);
  recordings = recordings.filter(r => r.id !== id);
  renderRecordings(); updateStats(); showToast('Recording deleted');
}
async function clearAllRecordings() {
  if (!recordings.length) { showToast('No recordings to clear'); return; }
  await idbClear(); recordings = [];
  renderRecordings(); updateStats(); showToast('All recordings cleared');
}

// ─── Transcribe (Whisper — OpenAI only, audio requires it) ───────────────────
async function transcribeRecording(id) {
  if (!apiKeys.openai) {
    showToast('Add your OpenAI key in Settings → AI Keys', 'error');
    switchTab('settings'); return;
  }
  const btn = document.getElementById(`transcribe-btn-${id}`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  try {
    const rec = await idbGet(id);
    if (!rec?.blob) throw new Error('Recording not found');
    const ext  = rec.mimeType.includes('mp4') ? 'm4a' : rec.mimeType.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new File([rec.blob], `audio.${ext}`, { type: rec.mimeType }));
    form.append('model', 'whisper-1');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKeys.openai}` },
      body: form,
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API error ${res.status}`); }
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

// ─── OCR Phase 1: Free local Tesseract.js ─────────────────────────────────────
// No API key needed. Runs entirely in the browser via WebAssembly.
// Loads the Tesseract script once on demand; reuses the same worker for speed.

function isImageFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return IMAGE_TYPES.includes(file.type) || IMAGE_EXTS.includes(ext);
}

function _loadTesseractScript() {
  if (_tesseractLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_CDN;
    s.onload  = () => { _tesseractLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load OCR engine. Check your connection.'));
    document.head.appendChild(s);
  });
}

async function _getTesseractWorker() {
  if (_tesseractWorker) return _tesseractWorker;
  await _loadTesseractScript();
  // Tesseract.js v5: createWorker(lang, oem, options)
  _tesseractWorker = await Tesseract.createWorker('eng', 1, {
    workerPath:  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    langPath:    'https://tessdata.projectnaptha.com/4.0.0',
    corePath:    'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    logger:      () => {},  // silence progress logs
  });
  return _tesseractWorker;
}

async function ocrFile(fileId) {
  const file = files.find(f => f.id == fileId);
  if (!file) return;

  const btn = document.getElementById(`ocr-btn-${fileId}`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  showToast('Running local OCR…');

  try {
    if (!file.content || !file.content.startsWith('data:')) {
      throw new Error('Image data missing — please re-upload the file');
    }

    const worker = await _getTesseractWorker();
    const result = await worker.recognize(file.content);
    const text   = result.data.text?.trim();

    if (!text) throw new Error('No text found in image');

    // Store OCR text on the file object so Analyze can reuse it
    file.ocrText = text;
    saveFiles();
    renderFiles(); // re-render so 🧠 Analyze button appears

    // Also drop raw text straight into the queue
    addToQueue(text, 'ocr', file.name);
    switchTab('queue');
    showToast('✓ OCR complete — text added to queue');
  } catch (e) {
    showToast(e.message || 'OCR failed', 'error');
  } finally {
    if (btn) { btn.textContent = '🔍'; btn.disabled = false; }
  }
}

// ─── OCR Phase 2: Analyze OCR text with cheap LLM (Groq or DeepSeek) ─────────
// Uses OpenAI-compatible chat completions — no vision needed, just text.
// Priority: Groq (fastest, free tier) → DeepSeek (cheap) → any other keyed provider.
// OpenAI is NOT used here — save that for Whisper transcription.

const ANALYZE_PROVIDERS = [
  {
    id:      'groq',
    name:    'Groq',
    url:     'https://api.groq.com/openai/v1/chat/completions',
    model:   'llama3-8b-8192',
    getKey:  () => apiKeys.groq,
  },
  {
    id:      'deepseek',
    name:    'DeepSeek',
    url:     'https://api.deepseek.com/chat/completions',
    model:   'deepseek-chat',
    getKey:  () => apiKeys.deepseek,
  },
  {
    id:      'mistral',
    name:    'Mistral',
    url:     'https://api.mistral.ai/v1/chat/completions',
    model:   'mistral-small-latest',
    getKey:  () => apiKeys.mistral,
  },
  {
    id:      'cerebras',
    name:    'Cerebras',
    url:     'https://api.cerebras.ai/v1/chat/completions',
    model:   'llama3.1-8b',
    getKey:  () => apiKeys.cerebras,
  },
];

function _getAnalyzeProvider() {
  return ANALYZE_PROVIDERS.find(p => p.getKey());
}

async function analyzeOcrText(fileId) {
  const file = files.find(f => f.id == fileId);
  if (!file) return;

  if (!file.ocrText) {
    showToast('Run 🔍 OCR first to extract text', 'error');
    return;
  }

  const provider = _getAnalyzeProvider();
  if (!provider) {
    showToast('Add a Groq, DeepSeek, Mistral, or Cerebras key in Settings → AI Keys', 'error');
    switchTab('settings');
    return;
  }

  const btn = document.getElementById(`analyze-btn-${fileId}`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  showToast(`Analyzing with ${provider.name}…`);

  try {
    const res = await fetch(provider.url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${provider.getKey()}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role:    'system',
            content: 'You are a helpful assistant. The user will give you raw OCR text extracted from a screenshot. Clean it up, fix any obvious OCR errors, and return the corrected, well-formatted text. Output only the cleaned text — no commentary, no preamble.',
          },
          {
            role:    'user',
            content: `Here is the raw OCR text from a screenshot called "${file.name}":\n\n${file.ocrText}`,
          },
        ],
        max_tokens:   2048,
        temperature:  0.2,
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `${provider.name} error ${res.status}`);
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty response from LLM');

    addToQueue(text, `ocr+${provider.name.toLowerCase()}`, file.name);
    switchTab('queue');
    showToast(`✓ Analyzed with ${provider.name} — added to queue`);
  } catch (e) {
    showToast(e.message || 'Analysis failed', 'error');
  } finally {
    if (btn) { btn.textContent = '🧠'; btn.disabled = false; }
  }
}

// ─── API Keys ─────────────────────────────────────────────────────────────────
function loadApiKeys() {
  try {
    const saved = JSON.parse(localStorage.getItem(APIKEYS_KEY));
    if (saved) apiKeys = { ...apiKeys, ...saved };
  } catch {}
}

function saveApiKey(name, value) {
  apiKeys[name] = value.trim();
  localStorage.setItem(APIKEYS_KEY, JSON.stringify(apiKeys));
  updateKeyStatus(name);
  updateKeyDot(name);
}

function applyApiKeyUI() {
  PROVIDERS.forEach(p => {
    const input = document.getElementById(`setting-${p.id}-key`);
    if (input && apiKeys[p.id]) {
      input.value = apiKeys[p.id];
    }
    updateKeyStatus(p.id);
    updateKeyDot(p.id);
  });
}

function updateKeyStatus(name) {
  const el  = document.getElementById(`${name}-key-status`);
  const p   = PROVIDERS.find(x => x.id === name);
  if (!el || !p) return;
  const val = apiKeys[name] || '';
  if (!val) { el.textContent = ''; el.className = 'key-status'; return; }
  const ok = val.length >= p.minLen && (!p.prefix || val.startsWith(p.prefix));
  if (ok) {
    el.textContent = '✓ Key saved';
    el.className = 'key-status key-status--ok';
  } else {
    el.textContent = p.prefix ? `⚠️ Should start with "${p.prefix}"` : '⚠️ Key looks too short';
    el.className = 'key-status key-status--warn';
  }
}

function updateKeyDot(name) {
  const dot = document.getElementById(`dot-${name}`);
  if (!dot) return;
  const val = apiKeys[name] || '';
  const p   = PROVIDERS.find(x => x.id === name);
  const ok  = val.length >= (p?.minLen || 10) && (!p?.prefix || val.startsWith(p.prefix));
  dot.className = val ? (ok ? 'key-dot key-dot--ok' : 'key-dot key-dot--warn') : 'key-dot';
}

function toggleKeyCard(id) {
  const body    = document.getElementById(`body-${id}`);
  const chevron = document.getElementById(`chevron-${id}`);
  const isOpen  = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
  if (!isOpen) {
    const input = document.getElementById(`setting-${id}-key`);
    if (input && apiKeys[id]) input.value = apiKeys[id];
    updateKeyStatus(id);
  }
}

function toggleKeyVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const hidden = input.type === 'password';
  input.type = hidden ? 'text' : 'password';
  btn.textContent = hidden ? '🙈' : '👁️';
}

// ─── Share Target ─────────────────────────────────────────────────────────────
function checkShareTarget() {
  const p = new URLSearchParams(window.location.search);
  const text = p.get('text') || p.get('import') || p.get('url') || '';
  if (!text.trim()) return;
  let label = p.get('title') || '';
  if (!label && p.get('url')) { try { label = new URL(p.get('url')).hostname; } catch { label = 'shared'; } }
  queue.push({ id: Date.now(), content: text.trim(), label: label || 'shared', source: 'share', added: new Date().toISOString() });
  saveQueue(); renderQueue(); updateBadge();
  window.history.replaceState({}, '', '/infinitypaste/');
  switchTab('queue'); showToast('✓ Added from share');
}

// ─── Selection capture ────────────────────────────────────────────────────────
function initSelectionCapture() {
  document.addEventListener('selectionchange', () => {
    const txt = window.getSelection()?.toString().trim();
    if (txt) _capturedSelection = txt;
  });
  const btn = document.getElementById('add-selection-btn');
  if (btn) btn.addEventListener('touchstart', () => {
    const txt = window.getSelection()?.toString().trim();
    if (txt) _capturedSelection = txt;
  }, { passive: true });
}

// ─── Storage ──────────────────────────────────────────────────────────────────
function loadQueue() { try { queue = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { queue = []; } }
function saveQueue() { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); }
function loadFiles() { try { files = JSON.parse(localStorage.getItem(FILES_KEY)) || []; } catch { files = []; } }
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

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast--show' + (type === 'error' ? ' toast--error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2500);
}

// ─── Queue ────────────────────────────────────────────────────────────────────
function addToQueue(contentOverride, labelOverride, sourceOverride) {
  const content = contentOverride !== undefined ? contentOverride : document.getElementById('collect-input').value.trim();
  const label   = labelOverride   !== undefined ? labelOverride   : document.getElementById('collect-label').value.trim();
  const source  = sourceOverride || null;
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
  saveQueue(); renderQueue(); updateBadge(); updateStats(); showToast('Removed');
}
function copyItem(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  navigator.clipboard.writeText(item.content).then(() => showToast('✓ Copied')).catch(() => showToast('Copy failed', 'error'));
}
function copyAll() {
  if (!queue.length) { showToast('Queue is empty', 'error'); return; }
  const combined = queue.map((item, i) => {
    const h = settings.shownumbers
      ? `[${i + 1}${item.label ? ` — ${item.label}` : ''}${item.source ? ` · ${item.source}` : ''}]\n` : (item.label ? `[${item.label}]\n` : '');
    return h + item.content;
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

// ─── Upload ───────────────────────────────────────────────────────────────────
function initUploadInput() {
  document.getElementById('file-upload-input')?.remove();
  const input = document.createElement('input');
  input.type = 'file'; input.id = 'file-upload-input'; input.multiple = true; input.accept = '*/*';
  input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px;';
  input.addEventListener('change', handleFileUpload);
  document.body.appendChild(input);
}
function triggerUpload() { const i = document.getElementById('file-upload-input'); if (i) { i.value = ''; i.click(); } }
async function handleFileUpload(event) {
  const uploaded = Array.from(event.target.files || []);
  if (!uploaded.length) return;
  let added = 0;
  for (const file of uploaded) {
    try {
      const content = await readFileContent(file);
      files.push({ id: Date.now() + Math.random(), name: file.name, type: file.type || 'text/plain', size: file.size, content, ocrText: null, added: new Date().toISOString() });
      added++;
    } catch { showToast(`Could not read ${file.name}`, 'error'); }
  }
  saveFiles(); renderFiles(); updateStats();
  showToast(`✓ Added ${added} file${added !== 1 ? 's' : ''}`);
}
function readFileContent(file) {
  return new Promise((resolve, reject) => {
    if (file.name.endsWith('.pdf')) { resolve(`[PDF: ${file.name} — ${formatBytes(file.size)}]`); return; }
    // Images: store as base64 data URI so local OCR can use them
    if (isImageFile(file)) {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);  // data:image/png;base64,...
      reader.onerror = () => reject(new Error('Read failed'));
      reader.readAsDataURL(file);
      return;
    }
    // Everything else: UTF-8 text
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsText(file, 'UTF-8');
  });
}

// ─── Files ────────────────────────────────────────────────────────────────────
function renderFiles() {
  const list  = document.getElementById('files-list');
  const empty = document.getElementById('files-empty');
  if (!files.length) { empty.style.display = 'flex'; list.querySelectorAll('.file-row').forEach(el => el.remove()); return; }
  empty.style.display = 'none'; list.innerHTML = ''; list.appendChild(empty);
  files.forEach(file => {
    const isImg = IMAGE_TYPES.includes(file.type) || IMAGE_EXTS.includes(file.name.split('.').pop().toLowerCase());
    const hasOcr = isImg && !!file.ocrText;
    const analyzeProvider = _getAnalyzeProvider();
    const row = document.createElement('div'); row.className = 'file-row';
    row.innerHTML = `
      <div class="file-row-info" onclick="openFileViewer(${JSON.stringify(file.id)})">
        <span class="file-icon">${fileIcon(file.name)}</span>
        <div class="file-meta">
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-size">${formatBytes(file.size || 0)} · ${formatTime(file.added)}${hasOcr ? ' · <span style="color:var(--color-success,#437a22)">OCR✓</span>' : ''}</div>
        </div>
      </div>
      <div class="file-row-actions">
        ${isImg ? `<button class="card-btn card-btn--transcribe" id="ocr-btn-${file.id}" onclick="ocrFile(${JSON.stringify(file.id)})" title="Extract text locally (free, no API key)">🔍</button>` : ''}
        ${hasOcr && analyzeProvider ? `<button class="card-btn card-btn--transcribe" id="analyze-btn-${file.id}" onclick="analyzeOcrText(${JSON.stringify(file.id)})" title="Analyze OCR text with ${analyzeProvider.name} (cheap LLM)">🧠</button>` : ''}
        ${hasOcr && !analyzeProvider ? `<button class="card-btn" style="opacity:0.4;cursor:default" title="Add a Groq, DeepSeek, Mistral, or Cerebras key to enable analysis">🧠</button>` : ''}
        <button class="card-btn card-btn--delete" onclick="removeFile(${JSON.stringify(file.id)})">✕</button>
      </div>`;
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
  const isImg = IMAGE_TYPES.includes(file.type) || IMAGE_EXTS.includes(file.name.split('.').pop().toLowerCase());
  if (isImg && file.content && file.content.startsWith('data:')) {
    // Show image preview; if OCR text is available show it below the image
    content.innerHTML = `<img src="${file.content}" alt="${escapeHtml(file.name)}" style="max-width:100%;border-radius:8px;" />`
      + (file.ocrText ? `<pre style="margin-top:1rem;white-space:pre-wrap;font-size:0.85rem;opacity:0.8">${escapeHtml(file.ocrText)}</pre>` : '');
  } else {
    content.textContent = file.content;
  }
  content.dataset.fileId = id; content.dataset.fileName = file.name;
  const btn = document.getElementById('add-selection-btn');
  if (btn) {
    const fresh = btn.cloneNode(true); btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('touchstart', () => {
      const txt = window.getSelection()?.toString().trim();
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
  const text = window.getSelection()?.toString().trim() || _capturedSelection;
  if (!text) { showToast('Select some text first, then tap + Add Selection', 'error'); return; }
  const content  = document.getElementById('viewer-content');
  addToQueue(text, null, content.dataset.fileName || 'file');
  _capturedSelection = ''; window.getSelection()?.removeAllRanges();
}
function removeFile(id) { files = files.filter(f => f.id != id); saveFiles(); renderFiles(); updateStats(); showToast('File removed'); }
function clearAllFiles() { files = []; saveFiles(); renderFiles(); updateStats(); closeFileViewer(); showToast('All files cleared'); }

// ─── Compose ──────────────────────────────────────────────────────────────────
function initCompose() { document.getElementById('compose-area').addEventListener('input', updateComposeStats); }
function dumpToCompose() {
  if (!queue.length) { showToast('Queue is empty', 'error'); return; }
  const combined = queue.map((item, i) => {
    const h = settings.shownumbers
      ? `[${i + 1}${item.label ? ` — ${item.label}` : ''}${item.source ? ` · ${item.source}` : ''}]\n` : (item.label ? `[${item.label}]\n` : '');
    return h + item.content;
  }).join(settings.separator);
  const area = document.getElementById('compose-area');
  area.value = area.value ? area.value + '\n\n' + combined : combined;
  updateComposeStats(); switchTab('compose');
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
  if (navigator.share) navigator.share({ title: 'InfinityPaste Document', text }).catch(() => {});
  else { copyCompose(); showToast('Copied (Share not available)'); }
}
function clearCompose() { document.getElementById('compose-area').value = ''; updateComposeStats(); showToast('Compose cleared'); }
function updateComposeStats() {
  const text = document.getElementById('compose-area').value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById('compose-stats').textContent = `${text.length.toLocaleString()} chars · ${words.toLocaleString()} words`;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(v => v.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`view-${name}`).classList.add('active');
  if (name === 'settings') { updateStats(); applyApiKeyUI(); }
}

// ─── Badge + Stats ────────────────────────────────────────────────────────────
function updateBadge() {
  document.getElementById('badge-count').textContent = queue.length;
  document.getElementById('queue-badge').style.display = queue.length > 0 ? 'flex' : 'none';
}
function updateStats() {
  document.getElementById('stat-count').textContent      = queue.length;
  document.getElementById('stat-files').textContent      = files.length;
  document.getElementById('stat-recordings').textContent = recordings.length;
  const bytes = new Blob([localStorage.getItem(STORAGE_KEY)||'']).size + new Blob([localStorage.getItem(FILES_KEY)||'']).size;
  document.getElementById('stat-storage').textContent = formatBytes(bytes);
}

// ─── Render Queue ─────────────────────────────────────────────────────────────
function renderQueue() {
  const list  = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  document.getElementById('queue-count-label').textContent = `${queue.length} item${queue.length !== 1 ? 's' : ''}`;
  if (!queue.length) { empty.style.display = 'flex'; list.querySelectorAll('.queue-card').forEach(el => el.remove()); return; }
  empty.style.display = 'none'; list.innerHTML = ''; list.appendChild(empty);
  queue.forEach((item, i) => {
    const card = document.createElement('div'); card.className = 'queue-card';
    const preview = item.content.length > 120 ? item.content.slice(0, 120) + '…' : item.content;
    card.innerHTML = `
      <div class="card-header">
        <div class="card-meta">
          ${settings.shownumbers ? `<span class="card-num">${i + 1}</span>` : ''}
          ${item.label  ? `<span class="card-label">${escapeHtml(item.label)}</span>` : ''}
          ${item.source ? `<span class="card-source">${escapeHtml(item.source)}</span>` : ''}
        </div>
        <div class="card-actions">
          <button class="card-btn card-btn--copy" onclick="copyItem(${item.id})">Copy</button>
          <button class="card-btn card-btn--delete" onclick="removeItem(${item.id})">✕</button>
        </div>
      </div>
      <div class="card-preview">${escapeHtml(preview)}</div>
      <div class="card-time">${formatTime(item.added)}</div>`;
    list.appendChild(card);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + ' · ' + d.toLocaleDateString([],{month:'short',day:'numeric'});
}
function formatDate(d) {
  return d.toLocaleDateString([],{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
}
function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(1)} MB`;
}
function formatDuration(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ({pdf:'📕',md:'📝',txt:'📄',js:'🟨',ts:'🔷',tsx:'⚛️',jsx:'⚛️',json:'📦',css:'🎨',html:'🌐',py:'🐍',swift:'🍎',csv:'📊',xml:'📋',sh:'⚡',png:'🖼️',jpg:'🖼️',jpeg:'🖼️',gif:'🖼️',webp:'🖼️',bmp:'🖼️',tiff:'🖼️',heic:'🖼️',heif:'🖼️'})[ext] || '📄';
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
