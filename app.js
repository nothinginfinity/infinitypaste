// ─── InfinityPaste v2 — app.js ────────────────────────────────────
const STORAGE_KEY  = 'infinitypaste_queue';
const SETTINGS_KEY = 'infinitypaste_settings';
const FILES_KEY    = 'infinitypaste_files';

// ─── State ────────────────────────────────────────────────────────
let queue    = [];
let files    = []; // [{ id, name, type, content, added }]
let settings = {
  autoclear:   false,
  shownumbers: true,
  separator:   '\n\n---\n\n',
};

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  loadQueue();
  loadSettings();
  loadFiles();
  renderQueue();
  renderFiles();
  updateBadge();
  applySettings();
  initCompose();
}

// ─── Storage ──────────────────────────────────────────────────────
function loadQueue() {
  try { queue = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { queue = []; }
}
function saveQueue() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}
function loadFiles() {
  try { files = JSON.parse(localStorage.getItem(FILES_KEY)) || []; }
  catch { files = []; }
}
function saveFiles() {
  try { localStorage.setItem(FILES_KEY, JSON.stringify(files)); }
  catch { showToast('Storage full — remove some files', 'error'); }
}
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved) settings = { ...settings, ...saved };
  } catch {}
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
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
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
  saveQueue();
  renderQueue();
  updateBadge();
  updateStats();

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
  } catch {
    showToast('Long-press the textarea and choose Paste', 'error');
  }
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
    .then(() => {
      showToast(`✓ Copied ${queue.length} items`);
      if (settings.autoclear) setTimeout(() => clearQueue(true), 1500);
    })
    .catch(() => showToast('Copy failed', 'error'));
}

function clearQueue(silent = false) {
  if (!silent && !queue.length) { showToast('Queue is already empty'); return; }
  queue = []; saveQueue(); renderQueue(); updateBadge(); updateStats();
  if (!silent) showToast('Queue cleared');
}

// ─── Files ────────────────────────────────────────────────────────
async function handleFileUpload(event) {
  const uploaded = Array.from(event.target.files);
  if (!uploaded.length) return;

  let added = 0;
  for (const file of uploaded) {
    try {
      const content = await readFileContent(file);
      files.push({
        id:      Date.now() + Math.random(),
        name:    file.name,
        type:    file.type || 'text/plain',
        size:    file.size,
        content,
        added:   new Date().toISOString(),
      });
      added++;
    } catch (e) {
      showToast(`Could not read ${file.name}`, 'error');
    }
  }

  saveFiles();
  renderFiles();
  updateStats();
  event.target.value = '';
  showToast(`✓ Added ${added} file${added !== 1 ? 's' : ''}`);
}

function readFileContent(file) {
  return new Promise((resolve, reject) => {
    const isPDF = file.type === 'application/pdf' || file.name.endsWith('.pdf');

    if (isPDF) {
      resolve(`[PDF: ${file.name} — ${formatBytes(file.size)}]\n\nTo extract text from this PDF, open the file viewer and tap "Extract Text". Full PDF text extraction powered by PDF.js.`);
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

  document.getElementById('files-list-view').style.display  = 'none';
  document.getElementById('file-viewer').style.display      = 'flex';
  document.getElementById('viewer-filename').textContent    = file.name;

  const content = document.getElementById('viewer-content');
  content.textContent = file.content;
  content.dataset.fileId   = id;
  content.dataset.fileName = file.name;
}

function closeFileViewer() {
  document.getElementById('file-viewer').style.display     = 'none';
  document.getElementById('files-list-view').style.display = 'block';
}

function addSelectionToQueue() {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';

  if (!text) {
    showToast('Select some text first, then tap + Add Selection', 'error');
    return;
  }

  const content  = document.getElementById('viewer-content');
  const fileName = content.dataset.fileName || 'file';

  addToQueue(text, null, fileName);
  sel.removeAllRanges();
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
  const area = document.getElementById('compose-area');
  area.addEventListener('input', updateComposeStats);
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
  if (area.value) {
    area.value += '\n\n' + combined;
  } else {
    area.value = combined;
  }

  updateComposeStats();
  switchTab('compose');
  showToast(`✓ Dumped ${queue.length} items to Compose`);
}

function copyCompose() {
  const text = document.getElementById('compose-area').value;
  if (!text) { showToast('Compose is empty', 'error'); return; }
  navigator.clipboard.writeText(text)
    .then(() => showToast('✓ Copied compose doc'))
    .catch(() => showToast('Copy failed', 'error'));
}

function shareCompose() {
  const text = document.getElementById('compose-area').value;
  if (!text) { showToast('Compose is empty', 'error'); return; }

  if (navigator.share) {
    navigator.share({ title: 'InfinityPaste Document', text })
      .catch(() => {});
  } else {
    copyCompose();
    showToast('Copied (Share not available in this browser)');
  }
}

function clearCompose() {
  document.getElementById('compose-area').value = '';
  updateComposeStats();
  showToast('Compose cleared');
}

function updateComposeStats() {
  const text  = document.getElementById('compose-area').value;
  const chars = text.length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById('compose-stats').textContent = `${chars.toLocaleString()} chars · ${words.toLocaleString()} words`;
}

// ─── Tabs ─────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(v => v.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.getElementById(`view-${name}`).classList.add('active');
  if (name === 'settings') updateStats();
}

// ─── Badge + Stats ────────────────────────────────────────────────
function updateBadge() {
  const badge = document.getElementById('queue-badge');
  const count = document.getElementById('badge-count');
  count.textContent = queue.length;
  badge.style.display = queue.length > 0 ? 'flex' : 'none';
}

function updateStats() {
  document.getElementById('stat-count').textContent = queue.length;
  document.getElementById('stat-files').textContent = files.length;
  const qBytes = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
  const fBytes = new Blob([localStorage.getItem(FILES_KEY)   || '']).size;
  document.getElementById('stat-storage').textContent = formatBytes(qBytes + fBytes);
}

// ─── Render Queue ─────────────────────────────────────────────────
function renderQueue() {
  const list  = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  document.getElementById('queue-count-label').textContent =
    `${queue.length} item${queue.length !== 1 ? 's' : ''}`;

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
    const preview = item.content.length > 120
      ? item.content.slice(0, 120) + '…'
      : item.content;
    const labelHtml = item.label
      ? `<span class="card-label">${escapeHtml(item.label)}</span>` : '';
    const sourceHtml = item.source
      ? `<span class="card-source">${escapeHtml(item.source)}</span>` : '';
    const numHtml = settings.shownumbers
      ? `<span class="card-num">${i + 1}</span>` : '';

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
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) +
    ' · ' + d.toLocaleDateString([], { month:'short', day:'numeric' });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    pdf: '📕', md: '📝', txt: '📄', js: '🟨', ts: '🔷',
    tsx: '⚛️', jsx: '⚛️', json: '📦', css: '🎨', html: '🌐',
    py: '🐍', swift: '🍎', csv: '📊', xml: '📋', sh: '⚡',
  };
  return map[ext] || '📄';
}

// ─── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
