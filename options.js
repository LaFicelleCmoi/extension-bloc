import { DEFAULT_BLOCKLIST } from './lib/blocklist.js';

const $ = (id) => document.getElementById(id);

const STORAGE_KEYS = [
  'customBlocklist', 'customPatterns', 'whitelist',
  'enabled', 'blockCrossOriginPopups', 'blockCrossOriginRedirects',
  'blockAdOverlays', 'strictRedirectMode'
];

const DEFAULT_STATE = {
  customBlocklist: [],
  customPatterns: [],
  whitelist: [],
  enabled: true,
  blockCrossOriginPopups: true,
  blockCrossOriginRedirects: true,
  blockAdOverlays: true,
  strictRedirectMode: true
};

let state = { ...DEFAULT_STATE };
const flashTimers = new Map();

// =====================================================================
// Validation — permissive : accepte hostname, URL complète, port, www, etc.
// =====================================================================

function normalizeDomain(raw) {
  let v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;

  // Retire le scheme (http://, https://, ftp://, etc.)
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // Coupe au premier /, ?, # (chemin / query / fragment)
  v = v.split(/[\/?#]/, 1)[0];
  // Retire le port
  v = v.replace(/:\d+$/, '');
  // Retire www.
  v = v.replace(/^www\./, '');
  // Retire les points en début/fin
  v = v.replace(/^\.+|\.+$/g, '');

  if (!v) return null;
  if (v.length > 253) return null;
  // Doit contenir au moins un point et un TLD d'au moins 2 caractères.
  // On accepte les TLDs alphanumériques (xn--…) pour les IDN.
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)+$/.test(v)) {
    return null;
  }
  // Le dernier segment (TLD) doit faire ≥ 2 caractères.
  const tld = v.split('.').pop();
  if (!tld || tld.length < 2) return null;
  return v;
}

// Permet aussi l'entrée multi-domaines (espaces, virgules, retours ligne)
function normalizeDomainList(raw) {
  return String(raw ?? '')
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizeDomain);
}

function normalizePattern(raw) {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v.length < 2 || v.length > 200) return null;
  return v;
}

// =====================================================================
// Persistence
// =====================================================================

async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEYS);
  state = {
    customBlocklist: Array.isArray(data.customBlocklist) ? data.customBlocklist : [],
    customPatterns:  Array.isArray(data.customPatterns)  ? data.customPatterns  : [],
    whitelist:       Array.isArray(data.whitelist)       ? data.whitelist       : [],
    enabled:                   data.enabled                   ?? true,
    blockCrossOriginPopups:    data.blockCrossOriginPopups    ?? true,
    blockCrossOriginRedirects: data.blockCrossOriginRedirects ?? true,
    blockAdOverlays:           data.blockAdOverlays           ?? true,
    strictRedirectMode:        data.strictRedirectMode        ?? true
  };
}

async function persist(patch) {
  Object.assign(state, patch);
  await chrome.storage.local.set(patch);
}

// =====================================================================
// Feedback
// =====================================================================

function flash(id, message, kind = 'success') {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('visible');
  if (flashTimers.has(id)) clearTimeout(flashTimers.get(id));
  flashTimers.set(id, setTimeout(() => {
    el.classList.remove('visible');
  }, 2800));
}

function shake(input) {
  input.classList.remove('shake');
  // Force reflow to restart the animation
  void input.offsetWidth;
  input.classList.add('shake');
  input.focus();
  input.select?.();
}

// =====================================================================
// Rendering
// =====================================================================

function renderToggles() {
  $('enabled').checked                   = state.enabled;
  $('strictRedirectMode').checked        = state.strictRedirectMode;
  $('blockCrossOriginPopups').checked    = state.blockCrossOriginPopups;
  $('blockCrossOriginRedirects').checked = state.blockCrossOriginRedirects;
  $('blockAdOverlays').checked           = state.blockAdOverlays;
}

const REMOVE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
  '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' +
  '</svg>';

function renderList(ulId, items, onRemove) {
  const ul = $(ulId);
  ul.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aucune entrée';
    ul.appendChild(li);
    return;
  }
  for (const item of items.slice().sort()) {
    const li = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'list-item-label';
    label.textContent = item;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'list-item-remove';
    btn.setAttribute('aria-label', `Retirer ${item}`);
    btn.title = 'Retirer';
    btn.innerHTML = REMOVE_ICON_SVG;
    btn.addEventListener('click', () => onRemove(item));

    li.append(label, btn);
    ul.appendChild(li);
  }
}

function renderLists() {
  $('blocklistCount').textContent = state.customBlocklist.length;
  $('whitelistCount').textContent = state.whitelist.length;
  $('patternCount').textContent   = state.customPatterns.length;

  renderList('blocklistList', state.customBlocklist, async (d) => {
    await persist({ customBlocklist: state.customBlocklist.filter(x => x !== d) });
    renderLists();
    flash('blocklistFeedback', `${d} retiré`, 'info');
  });
  renderList('whitelistList', state.whitelist, async (d) => {
    await persist({ whitelist: state.whitelist.filter(x => x !== d) });
    renderLists();
    flash('whitelistFeedback', `${d} retiré`, 'info');
  });
  renderList('patternList', state.customPatterns, async (p) => {
    await persist({ customPatterns: state.customPatterns.filter(x => x !== p) });
    renderLists();
    flash('patternFeedback', `${p} retiré`, 'info');
  });
}

function renderDefaults() {
  $('defaultsCount').textContent = DEFAULT_BLOCKLIST.length;
  const ul = $('defaultsList');
  ul.innerHTML = '';
  for (const d of [...DEFAULT_BLOCKLIST].sort()) {
    const li = document.createElement('li');
    li.textContent = d;
    ul.appendChild(li);
  }
}

function renderAll() {
  renderToggles();
  renderLists();
}

// =====================================================================
// Form handlers
// =====================================================================

function bindToggle(id) {
  $(id).addEventListener('change', (e) => {
    persist({ [id]: e.target.checked });
  });
}

async function addToList(key, value, feedbackId, label) {
  const list = state[key] || [];
  if (list.includes(value)) {
    flash(feedbackId, `${value} est déjà dans la liste ${label}`, 'warn');
    return false;
  }
  await persist({ [key]: [...list, value] });
  return true;
}

function bindAddDomain(formId, inputId, feedbackId, key, label) {
  const form = $(formId);
  const input = $(inputId);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = input.value;
    if (!raw.trim()) {
      flash(feedbackId, 'Saisis un domaine', 'error');
      shake(input);
      return;
    }

    const candidates = normalizeDomainList(raw);
    const valid   = candidates.filter(Boolean);
    const invalid = candidates.length - valid.length;

    if (!valid.length) {
      flash(feedbackId, `"${raw.trim()}" n'est pas un domaine valide`, 'error');
      shake(input);
      return;
    }

    let added = 0;
    let duplicates = 0;
    for (const v of valid) {
      const existing = state[key] || [];
      if (existing.includes(v)) { duplicates++; continue; }
      await persist({ [key]: [...(state[key] || []), v] });
      added++;
    }

    renderLists();
    input.value = '';
    input.focus();

    if (added === 1 && !duplicates && !invalid) {
      flash(feedbackId, `✓ ${valid[0]} ajouté à la liste ${label}`, 'success');
    } else {
      const parts = [];
      if (added)      parts.push(`${added} ajouté${added > 1 ? 's' : ''}`);
      if (duplicates) parts.push(`${duplicates} déjà présent${duplicates > 1 ? 's' : ''}`);
      if (invalid)    parts.push(`${invalid} invalide${invalid > 1 ? 's' : ''}`);
      const kind = added > 0 ? 'success' : (invalid > 0 ? 'error' : 'warn');
      flash(feedbackId, parts.join(' · '), kind);
    }
  });
}

function bindAddPattern() {
  $('addPattern').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('patternInput');
    const value = normalizePattern(input.value);
    if (!value) {
      flash('patternFeedback', 'Le motif doit faire entre 2 et 200 caractères', 'error');
      shake(input);
      return;
    }
    const ok = await addToList('customPatterns', value, 'patternFeedback', 'des motifs');
    renderLists();
    if (ok) {
      flash('patternFeedback', `✓ "${value}" ajouté`, 'success');
      input.value = '';
      input.focus();
    }
  });
}

function bindReset() {
  $('resetAll').addEventListener('click', async () => {
    if (!confirm('Réinitialiser toutes les listes personnalisées et les statistiques ?')) return;
    await chrome.storage.local.set({
      customBlocklist: [],
      customPatterns: [],
      whitelist: [],
      stats: { blocked: 0, clicks: 0, redirects: 0, popups: 0, adsKilled: 0 }
    });
    flash('blocklistFeedback', 'Listes réinitialisées', 'info');
  });
}

// =====================================================================
// Init
// =====================================================================

async function init() {
  await loadState();
  renderDefaults();
  renderAll();

  bindToggle('enabled');
  bindToggle('strictRedirectMode');
  bindToggle('blockCrossOriginPopups');
  bindToggle('blockCrossOriginRedirects');
  bindToggle('blockAdOverlays');

  bindAddDomain('addBlocklist', 'blocklistInput', 'blocklistFeedback', 'customBlocklist', 'noire');
  bindAddDomain('addWhitelist', 'whitelistInput', 'whitelistFeedback', 'whitelist',       'blanche');
  bindAddPattern();
  bindReset();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (STORAGE_KEYS.some(k => k in changes)) {
      loadState().then(renderAll);
    }
  });
}

init().catch(err => {
  console.error('[options] init failed:', err);
  document.body.insertAdjacentHTML('afterbegin',
    `<div style="background:#fee;color:#b00;padding:10px;text-align:center;">
      Erreur d'initialisation : ${String(err?.message || err)}
    </div>`);
});
