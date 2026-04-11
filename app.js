// ─── InfinityPaste — app.js ───────────────────────────────────────
const STORAGE_KEY = 'infinitypaste_queue';
const SETTINGS_KEY = 'infinitypaste_settings';

// ─── State ────────────────────────────────────────────────────────
let queue = [];
let settings = {
  autoclear: false,
  shownumbers: true,
  separator: '\n\n---\n\n',
};

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  loadQueue();
  loadSettings();
  renderQueue();
  updateBadge();
  applySettings();
}

// ─── Storage ──────────────────────────────────────────────────────
function loadQueue() {
  try { queue = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { queue = []; }
}

function saveQueue() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
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
  document.getElementById('setting-autoclear').checked = settings.autoclear;
  document.getElementById('setting-shownumbers').checked = settings.shownumbers;
  document.getElementById('setting-separator').value = settings.separator;
  updateStats();
}

// ─── Queue Operations ─────────────────────────────────────────────
function addToQueue() {
  const content = document.getElementById('collect-input').value.trim();
  const label = document.getElementById('collect-label').value.trim();
  if (!content) { showToast('Nothing to add — paste or type something first.', 'error'); return; }

  const item = {
    id: Date.now(),
    content,
    label: label || null,
    added: new Date().toISOString(),
  };

  queue.push(item);
  saveQueue();
  renderQueue();
  updateBadge();
  updateStats();

  // Clear inputs
  document.getElementById('collect-input').value = '';
  document.getElementById('collect-label').value = '';

  showToast(`✓ Added to queue (${queue.length} item${queue.length !== 1 ? 's' : ''})`);
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { showToast('Clipboard is empty', 'error'); return; }
    document.getElementById('collect-input').value = text;
    showToast('Pasted from clipboard');
  } catch {
    showToast('Tap the textarea and paste manually (Cmd+V / long-press)', 'error');
  }
}

function removeItem(id) {
  queue = queue.filter(item => item.id !== id);
  saveQueue();
  renderQueue();
  updateBadge();
  updateStats();
  showToast('Removed');
}

function copyItem(id) {
  const item = queue.find(i => i.id === id);
  if (!item) return;
  navigator.clipboard.writeText(item.content)
    .then(() => showToast('✓ Copied to clipboard'))
    .catch(() => showToast('Copy failed — try long-pressing the text', 'error'));
}

function copyAll() {
  if (!queue.length) { showToast('Queue is empty', 'error'); return; }

  const combined = queue.map((item, i) => {
    const header = settings.shownumbers
      ? `[${i + 1}${item.label ? ` — ${item.label}` : ''}]\n`
      : item.label ? `[${item.label}]\n` : '';
    return header + item.content;
  }).join(settings.separator);

  navigator.clipboard.writeText(combined)
    .then(() => {
      showToast(`✓ Copied ${queue.length} items to clipboard`);
      if (settings.autoclear) {
        setTimeout(() => { clearQueue(true); }, 1500);
      }
    })
    .catch(() => showToast('Copy failed', 'error'));
}

function clearQueue(silent = false) {
  if (!silent && queue.length === 0) { showToast('Queue is already empty'); return; }
  queue = [];
  saveQueue();
  renderQueue();
  updateBadge();
  updateStats();
  if (!silent) showToast('Queue cleared');
}

// ─── Render ───────────────────────────────────────────────────────
function renderQueue() {
  const list = document.getElementById('queue-list');
  const empty = document.getElementById('queue-empty');
  const countLabel = document.getElementById('queue-count-label');

  countLabel.textContent = `${queue.length} item${queue.length !== 1 ? 's' : ''}`;

  if (!queue.length) {
    empty.style.display = 'flex';
    [...list.querySelectorAll('.queue-card')].forEach(el => el.remove());
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = '';
  list.appendChild(empty); // keep in DOM

  queue.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'queue-card';
    card.dataset.id = item.id;

    const preview = item.content.length > 120
      ? item.content.slice(0, 120) + '…'
      : item.content;

    const labelHtml = item.label
      ? `<span class="card-label">${escapeHtml(item.label)}</span>`
      : '';

    const numHtml = settings.shownumbers
      ? `<span class="card-num">${i + 1}</span>`
      : '';

    card.innerHTML = `
      <div class="card-header">
        <div class="card-meta">${numHtml}${labelHtml}</div>
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
  const bytes = new Blob([localStorage.getItem(STORAGE_KEY) || '']).size;
  document.getElementById('stat-storage').textContent =
    bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

// ─── Toast ────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast--show toast--${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2500);
}

// ─── Helpers ──────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' · ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── Boot ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);