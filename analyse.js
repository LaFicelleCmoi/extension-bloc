import { DEFAULT_BLOCKLIST, KNOWN_AD_NETWORKS, SUSPICIOUS_TLDS } from './lib/blocklist.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  tabId: parseInt(params.get('tabId'), 10) || null,
  metrics: null,
  result: null,
  effectiveBlocklist: []
};

// ---------- DOM scanner injected into the target tab ----------------------
function pageScanner() {
  const here = location.hostname.toLowerCase();
  const sameOrigin = (url) => {
    try { return new URL(url, location.href).origin === location.origin; }
    catch { return true; }
  };
  const hostOf = (url) => {
    try { return new URL(url, location.href).hostname.toLowerCase(); }
    catch { return ''; }
  };

  const iframes = [...document.querySelectorAll('iframe')];
  const scripts = [...document.querySelectorAll('script[src]')];
  const links   = [...document.querySelectorAll('a[href]')];
  const forms   = [...document.querySelectorAll('form[action]')];
  const inlineHandlers = [...document.querySelectorAll(
    '[onclick],[onerror],[onload],[onmouseover],[onfocus],[onmousedown]'
  )];

  const iframeOrigins = new Set();
  let iframesXO = 0;
  for (const f of iframes) {
    const src = f.src || f.getAttribute('src');
    if (!src) continue;
    if (!sameOrigin(src)) {
      iframesXO++;
      const h = hostOf(src);
      if (h) iframeOrigins.add(h);
    }
  }

  const scriptOrigins = new Set();
  let scriptsXO = 0;
  for (const s of scripts) {
    const src = s.src || s.getAttribute('src');
    if (!src) continue;
    if (!sameOrigin(src)) {
      scriptsXO++;
      const h = hostOf(src);
      if (h) scriptOrigins.add(h);
    }
  }

  let formsXO = 0;
  for (const fm of forms) {
    if (!sameOrigin(fm.action)) formsXO++;
  }

  // Heuristique d'obfuscation : eval/atob/fromCharCode/document.write
  // sur des scripts inline assez longs.
  let obfuscated = 0;
  for (const s of document.querySelectorAll('script:not([src])')) {
    const t = s.textContent || '';
    if (t.length < 200) continue;
    const indicators = [
      /\beval\s*\(/, /\batob\s*\(/, /String\.fromCharCode/,
      /\bunescape\s*\(/, /document\.write/,
      /\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}/i
    ];
    let hits = 0;
    for (const re of indicators) if (re.test(t)) hits++;
    if (hits >= 2) obfuscated++;
  }

  let mixed = false;
  if (location.protocol === 'https:') {
    for (const el of document.querySelectorAll(
      'script[src],img[src],iframe[src],source[src],link[href]'
    )) {
      const v = el.getAttribute('src') || el.getAttribute('href') || '';
      if (/^http:\/\//i.test(v)) { mixed = true; break; }
    }
  }

  // Anchors target=_blank vers du cross-origin (vecteur popup classique).
  let blankXO = 0;
  for (const a of document.querySelectorAll('a[target="_blank"], a[target="_new"]')) {
    if (a.href && !sameOrigin(a.href)) blankXO++;
  }

  return {
    url: location.href,
    hostname: here,
    title: document.title || '',
    isHttps: location.protocol === 'https:',
    iframesTotal: iframes.length,
    iframesCrossOrigin: iframesXO,
    iframeOrigins: [...iframeOrigins],
    scriptsTotal: scripts.length,
    scriptsCrossOrigin: scriptsXO,
    scriptOrigins: [...scriptOrigins],
    formsTotal: forms.length,
    formsCrossOrigin: formsXO,
    inlineHandlers: inlineHandlers.length,
    obfuscatedScripts: obfuscated,
    mixedContent: mixed,
    linksTotal: links.length,
    targetBlankCrossOrigin: blankXO
  };
}

// ---------- Scoring -------------------------------------------------------
function tldOf(host) {
  const parts = host.split('.');
  return parts[parts.length - 1].toLowerCase();
}

function matchesAny(host, list) {
  if (!host) return false;
  return list.some(d => host === d || host.endsWith('.' + d));
}

function score(m, blocklist) {
  let s = 0;
  const reasons = [];
  const add = (pts, severity, text) => { s += pts; reasons.push({ severity, text }); };

  if (matchesAny(m.hostname, blocklist)) {
    add(50, 'high', 'Le domaine figure dans la liste noire');
  }

  if (!m.isHttps) {
    add(20, 'high', 'Connexion non chiffrée (HTTP)');
  }

  const tld = tldOf(m.hostname);
  if (SUSPICIOUS_TLDS.includes(tld)) {
    add(15, 'medium', `TLD souvent associé à des sites éphémères (.${tld})`);
  }

  // Iframes externes
  if (m.iframesCrossOrigin >= 5)      add(20, 'high',   `${m.iframesCrossOrigin} iframes vers d'autres domaines`);
  else if (m.iframesCrossOrigin >= 3) add(12, 'medium', `${m.iframesCrossOrigin} iframes inter-domaines`);
  else if (m.iframesCrossOrigin >= 1) add(4,  'low',    `${m.iframesCrossOrigin} iframe(s) inter-domaine(s)`);

  // Scripts externes
  if (m.scriptsCrossOrigin >= 15)      add(15, 'medium', `${m.scriptsCrossOrigin} scripts externes (très élevé)`);
  else if (m.scriptsCrossOrigin >= 8)  add(8,  'medium', `${m.scriptsCrossOrigin} scripts externes`);
  else if (m.scriptsCrossOrigin >= 4)  add(3,  'low',    `${m.scriptsCrossOrigin} scripts externes`);

  if (m.obfuscatedScripts > 0) {
    add(20, 'high', `${m.obfuscatedScripts} script(s) inline potentiellement obfusqué(s)`);
  }
  if (m.mixedContent) {
    add(12, 'medium', 'Contenu mixte HTTP chargé en HTTPS');
  }
  if (m.formsCrossOrigin > 0) {
    add(15, 'high', `${m.formsCrossOrigin} formulaire(s) envoyé(s) vers un autre domaine`);
  }
  if (m.targetBlankCrossOrigin >= 5) {
    add(8, 'medium', `${m.targetBlankCrossOrigin} liens "_blank" vers d'autres domaines (vecteur popup)`);
  } else if (m.targetBlankCrossOrigin >= 1) {
    add(3, 'low', `${m.targetBlankCrossOrigin} lien(s) "_blank" inter-domaine(s)`);
  }
  if (m.inlineHandlers > 30) {
    add(4, 'low', `Beaucoup de gestionnaires inline (${m.inlineHandlers})`);
  }

  // Origines tierces matchant blocklist / réseaux pub
  const allOrigins = [...new Set([...m.iframeOrigins, ...m.scriptOrigins])];
  const blocked = allOrigins.filter(h => matchesAny(h, blocklist));
  if (blocked.length) {
    add(25, 'high', `Référence à des domaines bloqués : ${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? '…' : ''}`);
  }
  const adNets = allOrigins.filter(h => matchesAny(h, KNOWN_AD_NETWORKS));
  if (adNets.length >= 3) {
    add(12, 'medium', `${adNets.length} réseaux publicitaires détectés`);
  } else if (adNets.length >= 1) {
    add(5, 'low', `Réseau publicitaire détecté : ${adNets[0]}`);
  }

  s = Math.min(100, s);
  let level = 'low', label = 'Faible', sub = 'Le site présente peu d\'indicateurs à risque.';
  if (s >= 60) { level = 'high';   label = 'Élevé';  sub = 'Plusieurs signaux de danger détectés. Soyez très prudent.'; }
  else if (s >= 30) { level = 'medium'; label = 'Moyen';  sub = 'Quelques signaux suspects. Naviguez avec précaution.'; }

  return { score: s, level, label, sub, reasons, flaggedOrigins: new Set([...blocked, ...adNets]) };
}

// ---------- Rendering ----------------------------------------------------
function renderError(msg) {
  $('targetUrl').textContent = '—';
  $('targetHost').textContent = '';
  const card = $('scoreCard');
  card.dataset.level = '';
  card.innerHTML = `<div class="error-state"><strong>Analyse impossible</strong>${msg}</div>`;
}

function renderTarget(tab) {
  $('targetUrl').textContent = tab.url || '';
  try { $('targetHost').textContent = new URL(tab.url).hostname; }
  catch { $('targetHost').textContent = ''; }
}

function renderScore(result) {
  const card = $('scoreCard');
  card.dataset.level = result.level;
  $('scoreValue').textContent = result.score;
  $('scoreLabel').textContent = `Risque : ${result.label}`;
  $('scoreSub').textContent = result.sub;

  const circ = 2 * Math.PI * 52;
  const offset = circ - (result.score / 100) * circ;
  $('gaugeFill').style.strokeDashoffset = String(offset);
}

function renderReasons(reasons) {
  const ul = $('reasonsList');
  ul.innerHTML = '';
  if (!reasons.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aucun facteur à risque détecté.';
    ul.appendChild(li);
    return;
  }
  const order = { high: 0, medium: 1, low: 2 };
  reasons.sort((a, b) => order[a.severity] - order[b.severity]);
  for (const r of reasons) {
    const li = document.createElement('li');
    li.className = r.severity;
    li.textContent = r.text;
    ul.appendChild(li);
  }
}

function renderMetrics(m) {
  const set = (id, value, cls) => {
    const el = $(id);
    el.textContent = value;
    el.className = 'metric-value' + (cls ? ' ' + cls : '');
  };
  set('metricHttps',   m.isHttps ? 'Oui' : 'Non',         m.isHttps ? 'good' : 'bad');
  set('metricIframes', String(m.iframesCrossOrigin),       m.iframesCrossOrigin >= 3 ? 'warn' : '');
  set('metricScripts', String(m.scriptsCrossOrigin),       m.scriptsCrossOrigin >= 8 ? 'warn' : '');
  set('metricForms',   String(m.formsCrossOrigin),         m.formsCrossOrigin > 0 ? 'bad' : 'good');
  set('metricObf',     String(m.obfuscatedScripts),        m.obfuscatedScripts > 0 ? 'bad' : 'good');
  set('metricMixed',   m.mixedContent ? 'Oui' : 'Non',     m.mixedContent ? 'bad' : 'good');
}

function renderOrigins(metrics, flagged) {
  const fillList = (ulId, countId, items) => {
    const ul = $(ulId);
    ul.innerHTML = '';
    $(countId).textContent = items.length;
    if (!items.length) {
      const li = document.createElement('li');
      li.textContent = '(aucune)';
      ul.appendChild(li);
      return;
    }
    for (const h of items.slice().sort()) {
      const li = document.createElement('li');
      li.textContent = h;
      if (flagged.has(h)) li.className = 'flagged';
      ul.appendChild(li);
    }
  };
  fillList('iframeOrigins', 'iframeOriginsCount', metrics.iframeOrigins);
  fillList('scriptOrigins', 'scriptOriginsCount', metrics.scriptOrigins);
}

// ---------- Orchestration ------------------------------------------------
async function getEffectiveBlocklist() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getLists' });
    return res?.blocklist || DEFAULT_BLOCKLIST;
  } catch {
    return DEFAULT_BLOCKLIST;
  }
}

async function getTargetTab() {
  if (state.tabId) {
    try { return await chrome.tabs.get(state.tabId); } catch {}
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function runAnalysis() {
  const tab = await getTargetTab();
  if (!tab) return renderError('<p>Impossible de retrouver l\'onglet cible.</p>');
  state.tabId = tab.id;
  renderTarget(tab);

  const blockedSchemes = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:'];
  if (blockedSchemes.some(s => (tab.url || '').startsWith(s))) {
    return renderError('<p>Cet onglet est une page interne du navigateur — l\'analyse ne peut pas y accéder.</p>');
  }

  let injection;
  try {
    injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: pageScanner,
      world: 'ISOLATED'
    });
  } catch (e) {
    return renderError(`<p>Injection impossible : ${String(e.message || e)}</p>`);
  }

  const metrics = injection?.[0]?.result;
  if (!metrics) return renderError('<p>Le scanner n\'a renvoyé aucun résultat.</p>');

  state.metrics = metrics;
  state.effectiveBlocklist = await getEffectiveBlocklist();
  state.result = score(metrics, state.effectiveBlocklist);

  renderScore(state.result);
  renderReasons(state.result.reasons);
  renderMetrics(metrics);
  renderOrigins(metrics, state.result.flaggedOrigins);
}

// ---------- Buttons -------------------------------------------------------
$('rescanBtn').addEventListener('click', () => runAnalysis());

$('addBlockBtn').addEventListener('click', async () => {
  const host = state.metrics?.hostname;
  if (!host) return;
  if (!confirm(`Ajouter ${host} à la liste noire ?`)) return;
  const data = await chrome.storage.local.get('customBlocklist');
  const list = new Set(data.customBlocklist || []);
  list.add(host);
  await chrome.storage.local.set({ customBlocklist: [...list] });
  alert(`✅ ${host} ajouté à la liste noire.`);
});

$('addWhiteBtn').addEventListener('click', async () => {
  const host = state.metrics?.hostname;
  if (!host) return;
  if (!confirm(`Ajouter ${host} à la liste blanche ?`)) return;
  await chrome.runtime.sendMessage({ action: 'addToWhitelist', domain: host });
  alert(`✅ ${host} ajouté à la liste blanche.`);
});

runAnalysis();
