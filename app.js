// ─── InfinityPaste v3.6.0 — app.js ──────────────────────────────────────────────
// Phase 3: URL Fetch, Table Extractor, Bookmarklet, AutoTitle
const STORAGE_KEY  = 'infinitypaste_queue';
const SETTINGS_KEY = 'infinitypaste_settings';
const FILES_KEY    = 'infinitypaste_files';
const APIKEYS_KEY  = 'infinitypaste_apikeys';
const IDB_NAME     = 'infinitypaste_db';
const IDB_STORE    = 'recordings';
const IDB_FILES_STORE = 'files';
const IDB_VERSION  = 2;

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

const IMAGE_TYPES = ['image/png','image/jpeg','image/jpg','image/gif','image/webp','image/bmp','image/tiff'];
const IMAGE_EXTS  = ['png','jpg','jpeg','gif','webp','bmp','tiff','heic','heif'];

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let _tesseractWorker = null;
let _tesseractLoaded = false;

const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
let _pdfjsLib = null;
let _pdfjsLoaded = false;

// ─── State ────────────────────────────────────────────────────────────────────
let queue    = [];
let files    = [];
let apiKeys  = {};
let settings = { autoclear: false, shownumbers: true, separator: '\n\n---\n\n' };

// Phase 2: search/sort/expand state
let queueSearchTerm  = '';
let queueSortMode    = 'newest'; // newest | oldest | label | source | custom
let expandedCardIds  = new Set();
let dragSrcId        = null;

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
      if (!db.objectStoreNames.contains(IDB_FILES_STORE))
        db.createObjectStore(IDB_FILES_STORE, { keyPath: 'id' });
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

// ─── IDB Files Store ──────────────────────────────────────────────────────────
function idbFilePut(record) {
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction(IDB_FILES_STORE, 'readwrite');
    tx.objectStore(IDB_FILES_STORE).put(record).onsuccess = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function idbFileGet(id) {
  return new Promise((resolve, reject) => {
    const tx  = idbDb.transaction(IDB_FILES_STORE, 'readonly');
    const req = tx.objectStore(IDB_FILES_STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
function idbFileDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction(IDB_FILES_STORE, 'readwrite');
    tx.objectStore(IDB_FILES_STORE).delete(id).onsuccess = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function idbFileClear() {
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction(IDB_FILES_STORE, 'readwrite');
    tx.objectStore(IDB_FILES_STORE).clear().onsuccess = resolve;
    tx.onerror = () => reject(tx.error);
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

// ─── Delete / Clear recordings ────────────────────────────────────────────────
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

// ─── Transcribe (Whisper) ─────────────────────────────────────────────────────
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

// ─── PDF.js ───────────────────────────────────────────────────────────────────
async function _getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  if (!_pdfjsLoaded) {
    try {
      const mod = await import(PDFJS_CDN);
      _pdfjsLib = mod;
      _pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
      _pdfjsLoaded = true;
    } catch(e) {
      throw new Error('Failed to load PDF engine. Check your connection.');
    }
  }
  return _pdfjsLib;
}
async function extractPdfText(blob) {
  const pdfjsLib = await _getPdfJs();
  const arrayBuffer = await blob.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const str     = content.items.map(item => item.str).join(' ').trim();
    if (str) pageTexts.push(`--- Page ${i} ---\n${str}`);
  }
  return pageTexts.join('\n\n');
}

// ─── OCR ──────────────────────────────────────────────────────────────────────
function isImageFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  return IMAGE_TYPES.includes(file.type) || IMAGE_EXTS.includes(ext);
}
function isPdfFile(file) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
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
  _tesseractWorker = await Tesseract.createWorker('eng', 1, {
    workerPath:  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    langPath:    'https://tessdata.projectnaptha.com/4.0.0',
    corePath:    'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core-simd-lstm.wasm.js',
    logger:      () => {},
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
    const stored = await idbFileGet(fileId);
    if (!stored?.blob) throw new Error('Image data missing — please re-upload the file');
    const objectUrl = URL.createObjectURL(stored.blob);
    const worker = await _getTesseractWorker();
    const result = await worker.recognize(objectUrl);
    URL.revokeObjectURL(objectUrl);
    const text = result.data.text?.trim();
    if (!text) throw new Error('No text found in image');
    file.ocrText = text;
    saveFiles(); renderFiles();
    addToQueue(text, 'ocr', file.name);
    switchTab('queue');
    showToast('✓ OCR complete — text added to queue');
  } catch (e) {
    showToast(e.message || 'OCR failed', 'error');
  } finally {
    if (btn) { btn.textContent = '🔍'; btn.disabled = false; }
  }
}

// ─── LLM Analyze ─────────────────────────────────────────────────────────────
const ANALYZE_PROVIDERS = [
  { id: 'groq',      name: 'Groq',      url: 'https://api.groq.com/openai/v1/chat/completions',    model: 'llama-3.1-8b-instant', getKey: () => apiKeys.groq },
  { id: 'deepseek',  name: 'DeepSeek',  url: 'https://api.deepseek.com/chat/completions',           model: 'deepseek-chat',        getKey: () => apiKeys.deepseek },
  { id: 'mistral',   name: 'Mistral',   url: 'https://api.mistral.ai/v1/chat/completions',          model: 'mistral-small-latest', getKey: () => apiKeys.mistral },
  { id: 'cerebras',  name: 'Cerebras',  url: 'https://api.cerebras.ai/v1/chat/completions',         model: 'llama3.1-8b',          getKey: () => apiKeys.cerebras },
  { id: 'fireworks', name: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1/chat/completions', model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', getKey: () => apiKeys.fireworks },
  { id: 'sambanova', name: 'SambaNova', url: 'https://api.sambanova.ai/v1/chat/completions',        model: 'Meta-Llama-3.1-8B-Instruct', getKey: () => apiKeys.sambanova },
  { id: 'openai',    name: 'OpenAI',    url: 'https://api.openai.com/v1/chat/completions',          model: 'gpt-4o-mini',          getKey: () => apiKeys.openai },
  { id: 'anthropic', name: 'Anthropic', url: null, getKey: () => apiKeys.anthropic },
  { id: 'gemini',    name: 'Gemini',    url: null, getKey: () => apiKeys.gemini },
  { id: 'xai',       name: 'xAI',       url: 'https://api.x.ai/v1/chat/completions',               model: 'grok-3-mini',          getKey: () => apiKeys.xai },
];

function _getBestAnalyzeProvider() {
  return ANALYZE_PROVIDERS.find(p => p.url && p.getKey());
}

async function analyzeFile(fileId) {
  const provider = _getBestAnalyzeProvider();
  if (!provider) {
    showToast('Add an AI key in Settings → AI Keys', 'error');
    switchTab('settings'); return;
  }
  const file = files.find(f => f.id == fileId);
  if (!file) return;
  const btn = document.getElementById(`analyze-btn-${fileId}`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  showToast(`Analyzing with ${provider.name}…`);
  try {
    const stored = await idbFileGet(fileId);
    if (!stored?.blob) throw new Error('File data missing');
    let text = '';
    if (isPdfFile({ name: file.name, type: stored.blob.type })) {
      text = await extractPdfText(stored.blob);
    } else if (isImageFile({ name: file.name, type: stored.blob.type })) {
      const worker = await _getTesseractWorker();
      const url    = URL.createObjectURL(stored.blob);
      const result = await worker.recognize(url);
      URL.revokeObjectURL(url);
      text = result.data.text?.trim();
    } else {
      text = await stored.blob.text();
    }
    if (!text) throw new Error('No text content extracted from file');
    const prompt = `Analyze the following content and provide a concise summary with key insights:\n\n${text.slice(0, 8000)}`;
    const res = await fetch(provider.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.getKey()}` },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: prompt }], max_tokens: 500 }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || `API error ${res.status}`); }
    const data   = await res.json();
    const result2 = data.choices?.[0]?.message?.content?.trim();
    if (!result2) throw new Error('Empty response from AI');
    addToQueue(result2, `analysis · ${provider.name}`, file.name);
    switchTab('queue');
    showToast(`✓ Analysis added to queue`);
  } catch (e) {
    showToast(e.message || 'Analysis failed', 'error');
  } finally {
    if (btn) { btn.textContent = '🤖'; btn.disabled = false; }
  }
}

// ─── Share Target ─────────────────────────────────────────────────────────────
function checkShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const shared = params.get('share-target-text') || params.get('text') || params.get('url');
  if (shared) {
    document.getElementById('collect-input').value = shared;
    switchTab('collect');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ─── File Upload ──────────────────────────────────────────────────────────────
function initUploadInput() {
  const input = document.getElementById('file-upload-input');
  if (input) input.addEventListener('change', handleFileUpload);
}
function triggerUpload() { document.getElementById('file-upload-input').click(); }
async function handleFileUpload(e) {
  const uploads = [...e.target.files];
  e.target.value = '';
  if (!uploads.length) return;
  let added = 0;
  for (const file of uploads) {
    const id   = Date.now() + Math.random();
    const record = { id, name: file.name, type: file.type, size: file.size, added: new Date().toISOString() };
    files.push(record);
    await idbFilePut({ id, blob: file });
    added++;
  }
  saveFiles(); renderFiles(); updateStats();
  showToast(`✓ ${added} file${added !== 1 ? 's' : ''} uploaded`);
}

// ─── Files Storage ────────────────────────────────────────────────────────────
function loadFiles() {
  try { files = JSON.parse(localStorage.getItem(FILES_KEY)) || []; }
  catch { files = []; }
}
function saveFiles() { localStorage.setItem(FILES_KEY, JSON.stringify(files.map(f => { const {ocrText,...rest} = f; return rest; }))); }
async function clearAllFiles() {
  if (!files.length) { showToast('No files to clear'); return; }
  await idbFileClear(); files = [];
  saveFiles(); renderFiles(); updateStats(); showToast('All files cleared');
}
async function deleteFile(id) {
  await idbFileDelete(id);
  files = files.filter(f => f.id !== id);
  saveFiles(); renderFiles(); updateStats(); showToast('File deleted');
}

// ─── Render Files ─────────────────────────────────────────────────────────────
function renderFiles() {
  const list  = document.getElementById('files-list');
  const empty = document.getElementById('files-empty');
  if (!files.length) {
    empty.style.display = 'flex'; return;
  }
  empty.style.display = 'none';
  const existing = new Set([...list.querySelectorAll('[data-file-id]')].map(el => el.dataset.fileId));
  const current  = new Set(files.map(f => String(f.id)));
  existing.forEach(id => { if (!current.has(id)) list.querySelector(`[data-file-id="${id}"]`)?.remove(); });
  files.forEach(file => {
    if (existing.has(String(file.id))) return;
    const card = document.createElement('div');
    card.className = 'file-card'; card.dataset.fileId = file.id;
    const isImg = isImageFile({ name: file.name, type: file.type });
    const isPdf = isPdfFile({ name: file.name, type: file.type });
    const canOcr = isImg;
    const canAnalyze = true;
    card.innerHTML = `
      <div class="file-info" onclick="openFileViewer(${file.id})">
        <span class="file-icon">${fileIcon(file.name)}</span>
        <div class="file-details">
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-meta">${formatBytes(file.size)} · ${formatTime(file.added)}</div>
        </div>
      </div>
      <div class="file-actions">
        ${canOcr ? `<button class="card-btn" id="ocr-btn-${file.id}" onclick="ocrFile(${file.id})" title="OCR">🔍</button>` : ''}
        ${isPdf  ? `<button class="card-btn" id="pdf-btn-${file.id}" onclick="extractPdfToQueue(${file.id})" title="Extract PDF text">📄</button>` : ''}
        <button class="card-btn" id="analyze-btn-${file.id}" onclick="analyzeFile(${file.id})" title="AI Analyze">🤖</button>
        <button class="card-btn card-btn--delete" onclick="deleteFile(${file.id})">✕</button>
      </div>`;
    list.appendChild(card);
  });
}

// ─── File Viewer ──────────────────────────────────────────────────────────────
async function openFileViewer(id) {
  const file = files.find(f => f.id == id);
  if (!file) return;
  document.getElementById('files-list-view').style.display = 'none';
  document.getElementById('file-viewer').style.display    = 'flex';
  document.getElementById('viewer-filename').textContent  = file.name;
  const content = document.getElementById('viewer-content');
  content.dataset.fileName = file.name;
  content.innerHTML = '<div class="file-loading">Loading…</div>';
  try {
    const stored = await idbFileGet(id);
    if (!stored?.blob) throw new Error('File data not found');
    if (isImageFile({ name: file.name, type: file.type })) {
      const url = URL.createObjectURL(stored.blob);
      content.innerHTML = `<img src="${url}" style="max-width:100%;border-radius:8px" alt="${escapeHtml(file.name)}">`;
    } else if (isPdfFile({ name: file.name, type: file.type })) {
      const text = await extractPdfText(stored.blob);
      content.textContent = text;
    } else {
      const text = await stored.blob.text();
      content.textContent = text;
    }
  } catch (e) {
    content.innerHTML = `<div class="file-error">${escapeHtml(e.message)}</div>`;
  }
}
function closeFileViewer() {
  document.getElementById('files-list-view').style.display = '';
  document.getElementById('file-viewer').style.display    = 'none';
}

async function extractPdfToQueue(fileId) {
  const file = files.find(f => f.id == fileId);
  if (!file) return;
  const btn = document.getElementById(`pdf-btn-${fileId}`);
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  showToast('Extracting PDF text…');
  try {
    const stored = await idbFileGet(fileId);
    if (!stored?.blob) throw new Error('PDF data missing');
    const text = await extractPdfText(stored.blob);
    if (!text) throw new Error('No text found in PDF');
    addToQueue(text, 'pdf', file.name);
    switchTab('queue');
    showToast('✓ PDF text added to queue');
  } catch (e) {
    showToast(e.message || 'PDF extraction failed', 'error');
  } finally {
    if (btn) { btn.textContent = '📄'; btn.disabled = false; }
  }
}

// ─── Selection Capture ────────────────────────────────────────────────────────
function initSelectionCapture() {
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel) _capturedSelection = sel;
  });
}
function addSelectionToQueue() {
  const content = _capturedSelection ||
    window.getSelection()?.toString().trim() ||
    document.getElementById('viewer-content')?.textContent?.trim();
  if (!content) { showToast('Select some text first', 'error'); return; }
  addToQueue(content, null, document.getElementById('viewer-content')?.dataset.fileName || 'file');
}

// ─── API Keys ─────────────────────────────────────────────────────────────────
function loadApiKeys()  { try { apiKeys = JSON.parse(localStorage.getItem(APIKEYS_KEY)) || {}; } catch { apiKeys = {}; } }
function saveApiKey(id, value) { apiKeys[id] = value.trim(); localStorage.setItem(APIKEYS_KEY, JSON.stringify(apiKeys)); showToast('Key saved'); }
function deleteApiKey(id) { delete apiKeys[id]; localStorage.setItem(APIKEYS_KEY, JSON.stringify(apiKeys)); applyApiKeyUI(); showToast('Key removed'); }
function toggleKeyCard(id) {
  const card   = document.getElementById(`key-card-${id}`);
  const body   = document.getElementById(`key-body-${id}`);
  const arrow  = card.querySelector('.key-provider-arrow');
  const isOpen = card.classList.toggle('open');
  body.style.display  = isOpen ? 'block' : 'none';
  if (arrow) arrow.textContent = isOpen ? '▲' : '▼';
  if (isOpen) { const inp = document.getElementById(`key-input-${id}`); if (inp) inp.value = apiKeys[id] || ''; }
}
function applyApiKeyUI() {
  PROVIDERS.forEach(p => {
    const dot    = document.getElementById(`key-dot-${p.id}`);
    const status = document.getElementById(`key-status-${p.id}`);
    const hasKey = !!(apiKeys[p.id]);
    if (dot)    { dot.className = `key-status-dot ${hasKey ? 'key-status-dot--active' : ''}`; }
    if (status) status.textContent = hasKey ? '✓ Key saved' : '';
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved) settings = { ...settings, ...saved };
  } catch {}
}
function saveSetting(key, value) {
  settings[key] = value;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applySettings();
}
function applySettings() {
  const ac = document.getElementById('setting-autoclear');
  const sn = document.getElementById('setting-shownumbers');
  const sp = document.getElementById('setting-separator');
  if (ac) ac.checked  = settings.autoclear;
  if (sn) sn.checked  = settings.shownumbers;
  if (sp) sp.value    = settings.separator;
}

// ─── Queue Storage ────────────────────────────────────────────────────────────
function loadQueue()  { try { queue = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { queue = []; } }
function saveQueue()  { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); }

let toastTimer = null;
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
    const labelEl = document.getElementById('collect-label');
    if (labelEl) { labelEl.dataset.manualEdit = 'false'; labelEl.dataset.autoTitle = ''; }
    _showAutoTitleBadge(false);
    document.getElementById('fetch-bar').style.display = 'none';
  }
  showToast(`✓ Added to queue (${queue.length} item${queue.length !== 1 ? 's' : ''})`);
}
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { showToast('Clipboard is empty', 'error'); return; }
    document.getElementById('collect-input').value = text;
    onCollectInput();
    showToast('Pasted from clipboard');
  } catch { showToast('Long-press the textarea and choose Paste', 'error'); }
}
function removeItem(id) {
  queue = queue.filter(i => i.id !== id);
  expandedCardIds.delete(id);
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
  queue = []; expandedCardIds.clear();
  saveQueue(); renderQueue(); updateBadge(); updateStats();
  if (!silent) showToast('Queue cleared');
}

// ─── Phase 2: Search & Sort ───────────────────────────────────────────────────
function onQueueSearch() {
  queueSearchTerm = document.getElementById('queue-search').value.trim().toLowerCase();
  renderQueue();
}
function onQueueSort() {
  queueSortMode = document.getElementById('queue-sort').value;
  renderQueue();
}

// Returns filtered + sorted view of queue (does NOT mutate queue array)
function _getFilteredQueue() {
  let items = [...queue];

  // Filter
  if (queueSearchTerm) {
    items = items.filter(item =>
      item.content.toLowerCase().includes(queueSearchTerm) ||
      (item.label  || '').toLowerCase().includes(queueSearchTerm) ||
      (item.source || '').toLowerCase().includes(queueSearchTerm)
    );
  }

  // Sort
  switch (queueSortMode) {
    case 'oldest': items.sort((a, b) => a.id - b.id); break;
    case 'label':  items.sort((a, b) => (a.label || '').localeCompare(b.label || '')); break;
    case 'source': items.sort((a, b) => (a.source || '').localeCompare(b.source || '')); break;
    case 'custom': /* user-defined order, kept as-is */ break;
    case 'newest':
    default: items.sort((a, b) => b.id - a.id); break;
  }

  return items;
}

// ─── Phase 2: Expand / Collapse card preview ─────────────────────────────────
function toggleCardExpand(id) {
  if (expandedCardIds.has(id)) expandedCardIds.delete(id);
  else expandedCardIds.add(id);
  renderQueue();
}

// ─── Render Queue ─────────────────────────────────────────────────────────────
function renderQueue() {
  const list  = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  const items = _getFilteredQueue();

  if (!items.length) {
    empty.style.display = 'flex';
    list.querySelectorAll('.queue-card').forEach(el => el.remove());
    return;
  }
  empty.style.display = 'none';

  // Remove cards no longer in view
  const currentIds = new Set(items.map(i => String(i.id)));
  list.querySelectorAll('.queue-card').forEach(el => {
    if (!currentIds.has(el.dataset.id)) el.remove();
  });

  items.forEach((item, idx) => {
    const isExpanded = expandedCardIds.has(item.id);
    const preview    = item.content.length > 120 && !isExpanded
      ? item.content.slice(0, 120) + '…'
      : item.content;
    let existing = list.querySelector(`.queue-card[data-id="${item.id}"]`);
    if (!existing) {
      existing = document.createElement('div');
      existing.className = 'queue-card';
      existing.dataset.id = item.id;
      existing.draggable = true;
      existing.addEventListener('dragstart', onDragStart);
      existing.addEventListener('dragover',  onDragOver);
      existing.addEventListener('drop',      onDrop);
      existing.addEventListener('dragend',   onDragEnd);
      list.appendChild(existing);
    }
    existing.innerHTML = `
      <div class="card-header">
        <span class="card-index">${settings.shownumbers ? idx + 1 : ''}</span>
        <div class="card-meta">
          ${item.label  ? `<span class="card-label">${escapeHtml(item.label)}</span>` : ''}
          ${item.source ? `<span class="card-source">${escapeHtml(item.source)}</span>` : ''}
        </div>
        <span class="card-time">${formatTime(item.added)}</span>
      </div>
      <div class="card-preview" onclick="toggleCardExpand(${item.id})">${escapeHtml(preview)}</div>
      ${ item.content.length > 120 ? `<button class="card-expand-btn" onclick="toggleCardExpand(${item.id})">${isExpanded ? '▲ Collapse' : '▼ More'}</button>` : '' }
      <div class="card-actions">
        <button class="card-btn card-btn--copy" onclick="copyItem(${item.id})">📋</button>
        <button class="card-btn card-btn--delete" onclick="removeItem(${item.id})">✕</button>
      </div>`;
  });
}

// ─── Phase 2: Drag-to-reorder ─────────────────────────────────────────────────
function onDragStart(e) {
  dragSrcId = parseInt(e.currentTarget.dataset.id);
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function onDrop(e) {
  e.preventDefault();
  const targetId = parseInt(e.currentTarget.dataset.id);
  if (dragSrcId === null || dragSrcId === targetId) return;
  const srcIdx    = queue.findIndex(i => i.id === dragSrcId);
  const targetIdx = queue.findIndex(i => i.id === targetId);
  if (srcIdx < 0 || targetIdx < 0) return;
  const [moved] = queue.splice(srcIdx, 1);
  queue.splice(targetIdx, 0, moved);
  queueSortMode = 'custom';
  const sel = document.getElementById('queue-sort');
  if (sel) sel.value = 'custom';
  saveQueue(); renderQueue();
}
function onDragEnd(e) { e.currentTarget.classList.remove('dragging'); dragSrcId = null; }

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

// ─── Phase 3: URL Detection & Readability Fetch ───────────────────────────────
const READABILITY_CDN = 'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js';
let _readabilityLoaded = false;

function _loadReadability() {
  if (_readabilityLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = READABILITY_CDN;
    s.onload  = () => { _readabilityLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Failed to load Readability. Check your connection.'));
    document.head.appendChild(s);
  });
}

// Auto-detect URL in collect textarea and show/hide the fetch bar
let _autoTitleTimer = null;
function onCollectInput() {
  const val = document.getElementById('collect-input').value.trim();
  const isUrl = /^https?:\/\/\S+/i.test(val);
  document.getElementById('fetch-bar').style.display = isUrl ? 'flex' : 'none';
  if (isUrl) autoTitleFromUrl(val);
  // AutoTitle debounce
  clearTimeout(_autoTitleTimer);
  _autoTitleTimer = setTimeout(() => runAutoTitle(), 800);
}

async function fetchUrl() {
  const url = document.getElementById('collect-input').value.trim();
  if (!url) return;
  const btn = document.getElementById('fetch-btn');
  btn.disabled = true; btn.textContent = '⏳';
  showToast('Fetching page…');
  try {
    // Use allorigins proxy to bypass CORS
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const json = await res.json();
    const rawHtml = json.contents;
    if (!rawHtml) throw new Error('Empty response from server');

    await _loadReadability();

    // Extract tables BEFORE Readability strips them (Feature 5)
    const tables = _extractMarkdownTables(rawHtml);

    // Parse with Readability
    const parser  = new DOMParser();
    const doc     = parser.parseFromString(rawHtml, 'text/html');
    const base    = doc.createElement('base'); base.href = url;
    doc.head.appendChild(base);
    const article = new Readability(doc).parse();
    const title   = article?.title || _domainFromUrl(url);
    let   text    = article?.textContent?.trim() || '';

    if (!text) throw new Error('No readable content found on page');

    // Append extracted markdown tables if any found
    if (tables.length) {
      text += '\n\n## Extracted Tables\n\n' + tables.join('\n\n');
    }

    document.getElementById('collect-input').value = text;
    // Auto-fill label with page title
    const labelEl = document.getElementById('collect-label');
    if (!labelEl.value || labelEl.dataset.autoTitle === 'true') {
      labelEl.value = title;
      labelEl.dataset.autoTitle = 'true';
      _showAutoTitleBadge(true);
    }
    document.getElementById('fetch-bar').style.display = 'none';
    showToast(`✓ Fetched — ${text.length.toLocaleString()} chars${tables.length ? ` · ${tables.length} table${tables.length > 1 ? 's' : ''} extracted` : ''}`);
  } catch (e) {
    showToast(e.message || 'Fetch failed', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🌐 Fetch';
  }
}

// Feature 5: Extract HTML tables as Markdown before Readability strips them
function _extractMarkdownTables(html) {
  const parser = new DOMParser();
  const doc    = parser.parseFromString(html, 'text/html');
  const tables = doc.querySelectorAll('table');
  const results = [];
  tables.forEach(table => {
    const rows = [];
    const headers = [...table.querySelectorAll('th')].map(th => th.textContent.trim().replace(/\|/g, '\\|'));
    if (headers.length) {
      rows.push('| ' + headers.join(' | ') + ' |');
      rows.push('| ' + headers.map(() => '---').join(' | ') + ' |');
    }
    table.querySelectorAll('tr').forEach(tr => {
      const cells = [...tr.querySelectorAll('td')].map(td => td.textContent.trim().replace(/\|/g, '\\|').replace(/\n+/g, ' '));
      if (cells.length) rows.push('| ' + cells.join(' | ') + ' |');
    });
    if (rows.length > 1) results.push(rows.join('\n'));
  });
  return results;
}

function _domainFromUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Feature 7: Save current textarea content as a named File
async function saveCurrentAsFile() {
  const content = document.getElementById('collect-input').value.trim();
  if (!content) { showToast('Nothing to save — fetch a page first', 'error'); return; }
  const label = document.getElementById('collect-label').value.trim() || 'Fetched Page';
  const filename = label.replace(/[^a-z0-9 _\-]/gi, '').trim().replace(/\s+/g, '-') || 'page';
  const blob = new Blob([content], { type: 'text/plain' });
  const id   = Date.now();
  const fileRecord = {
    id, name: `${filename}.txt`,
    type: 'text/plain', size: blob.size,
    added: new Date().toISOString()
  };
  files.push(fileRecord);
  saveFiles();
  await idbFilePut({ id, blob });
  renderFiles(); updateStats();
  showToast(`✓ Saved as "${fileRecord.name}" in Files`);
}

// ─── Phase 3: AutoTitle ───────────────────────────────────────────────────────
let _autoTitleActive = false;

function autoTitleFromUrl(url) {
  const labelEl = document.getElementById('collect-label');
  if (!labelEl || labelEl.dataset.manualEdit === 'true') return;
  try {
    const u = new URL(url);
    const slug = u.pathname.replace(/\/$/, '').split('/').pop().replace(/[-_]/g, ' ').replace(/\.[^.]+$/, '').trim();
    const title = slug ? `${u.hostname.replace(/^www\./, '')} — ${slug}` : u.hostname.replace(/^www\./, '');
    if (title) {
      labelEl.value = title;
      labelEl.dataset.autoTitle = 'true';
      _showAutoTitleBadge(true);
    }
  } catch {}
}

function runAutoTitle() {
  const labelEl = document.getElementById('collect-label');
  if (!labelEl || labelEl.dataset.manualEdit === 'true') return;

  const content = document.getElementById('collect-input').value.trim();
  if (!content) { clearAutoTitle(); return; }

  const isUrl = /^https?:\/\/\S+/i.test(content);
  if (isUrl) return; // handled by autoTitleFromUrl

  let title = '';
  const firstLine = content.split('\n')[0].trim();
  if (firstLine.length > 0 && firstLine.length <= 80 && !/[.!?]$/.test(firstLine)) {
    title = firstLine;
  } else {
    title = _extractKeywords(content, 4).join(' · ');
  }

  if (title && !labelEl.value) {
    labelEl.value = title;
    labelEl.dataset.autoTitle = 'true';
    _showAutoTitleBadge(true);
  }
}

function _extractKeywords(text, count) {
  const stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','was','are','were','be','been','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','i','you','he','she','it','we','they','what','which','who','when','where','why','how','all','each','every','both','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','because','as','until','while','about','into','through','during','before','after','above','below','between','out','off','over','under','again','then','once','here','there','if','can','its','your','our','their','his','her','my']);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  const freq = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  return Object.entries(freq).sort((a,b) => b[1]-a[1]).slice(0, count).map(([w]) => w);
}

function _showAutoTitleBadge(show) {
  const badge = document.getElementById('autotitle-badge');
  if (badge) badge.style.display = show ? 'inline-flex' : 'none';
  _autoTitleActive = show;
}

function clearAutoTitle() {
  const labelEl = document.getElementById('collect-label');
  if (labelEl) { labelEl.dataset.autoTitle = ''; _showAutoTitleBadge(false); }
}

function onLabelInput() {
  const labelEl = document.getElementById('collect-label');
  if (labelEl) {
    labelEl.dataset.manualEdit = labelEl.value ? 'true' : 'false';
    if (!labelEl.value) { labelEl.dataset.manualEdit = 'false'; _showAutoTitleBadge(false); }
    else _showAutoTitleBadge(false);
  }
}

// ─── Phase 3: Safari Bookmarklet Generator ────────────────────────────────────
function generateBookmarklet() {
  const appUrl = window.location.href.split('#')[0].split('?')[0];
  const code = `(function(){var t=document.body.innerText||document.documentElement.innerText||'';var u=window.location.href;var ti=document.title||u;var target=window.open('${appUrl}','infinitypaste');if(target){var msg=JSON.stringify({type:'infinitypaste_inject',text:t,source:u,title:ti});var interval=setInterval(function(){target.postMessage(msg,'*');},300);setTimeout(function(){clearInterval(interval);},5000);}else{alert('Allow pop-ups for this site. Or visit InfinityPaste manually and paste.');}})()`;
  const bookmarkletUrl = 'javascript:' + encodeURIComponent(code);
  document.getElementById('bookmarklet-url').value = bookmarkletUrl;
  document.getElementById('bookmarklet-area').style.display = 'flex';
  showToast('✓ Bookmarklet ready — see Settings');
}

function copyBookmarklet() {
  const val = document.getElementById('bookmarklet-url').value;
  navigator.clipboard.writeText(val)
    .then(() => showToast('✓ Copied — paste as a Safari bookmark URL'))
    .catch(() => showToast('Long-press the field to copy', 'error'));
}

// Listen for postMessage from bookmarklet
window.addEventListener('message', function(e) {
  try {
    const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
    if (data?.type === 'infinitypaste_inject' && data.text) {
      document.getElementById('collect-input').value = data.text.trim();
      const labelEl = document.getElementById('collect-label');
      if (labelEl && !labelEl.value) {
        labelEl.value = data.title || _domainFromUrl(data.source || '');
        labelEl.dataset.autoTitle = 'true';
        _showAutoTitleBadge(true);
      }
      switchTab('collect');
      showToast('✓ Page text injected from bookmarklet');
    }
  } catch {}
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
