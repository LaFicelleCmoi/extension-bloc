const $ = (id) => document.getElementById(id);

const state = { lists: { blocklist: [], whitelist: [], patterns: [], enabled: true }, currentDomain: '' };

const sendMsg = (msg) => new Promise((resolve) => {
  chrome.runtime.sendMessage(msg, (res) => resolve(res));
});

function getCurrentTabDomain() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url || '';
      try { resolve(new URL(url).hostname.toLowerCase()); }
      catch { resolve(''); }
    });
  });
}

function renderStats(stats) {
  $('blockedCount').textContent = stats.blocked || 0;
  $('clicksCount').textContent = stats.clicks || 0;
  $('redirectsCount').textContent = stats.redirects || 0;
  $('popupsCount').textContent = stats.popups || 0;
  $('adsKilledCount').textContent = stats.adsKilled || 0;
}

function renderEnabled(enabled) {
  $('enabled').checked = enabled;
  const box = $('statusBox');
  box.dataset.state = enabled ? 'on' : 'off';
  $('statusText').textContent = enabled ? 'Protection active' : 'Protection désactivée';
}

function renderDomainList(blocklist) {
  $('domainsTotal').textContent = blocklist.length;
  const ul = $('domainsList');
  ul.innerHTML = '';
  for (const d of blocklist.slice().sort()) {
    const li = document.createElement('li');
    li.textContent = d;
    ul.appendChild(li);
  }
}

function matchesDomain(host, list) {
  if (!host) return false;
  return list.some(d => host === d || host.endsWith('.' + d));
}

function renderCurrent(domain) {
  $('currentDomain').textContent = domain || '—';
  const badges = $('currentBadges');
  badges.innerHTML = '';
  if (!domain) return;
  const blocked = matchesDomain(domain, state.lists.blocklist);
  const white = matchesDomain(domain, state.lists.whitelist);
  const tag = (cls, text) => {
    const s = document.createElement('span');
    s.className = `badge ${cls}`;
    s.textContent = text;
    badges.appendChild(s);
  };
  if (white) tag('safe', 'Liste blanche');
  if (blocked) tag('danger', 'Bloqué');
  if (!white && !blocked) tag('', 'Non listé');
}

async function load() {
  const [{ stats, enabled }, lists, domain] = await Promise.all([
    chrome.storage.local.get(['stats', 'enabled']).then(d => ({
      stats: d.stats || {}, enabled: d.enabled ?? true
    })),
    sendMsg({ action: 'getLists' }),
    getCurrentTabDomain()
  ]);
  state.lists = lists || state.lists;
  state.currentDomain = domain;
  renderStats(stats);
  renderEnabled(enabled);
  renderDomainList(state.lists.blocklist);
  renderCurrent(domain);
}

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
  renderEnabled(e.target.checked);
});

$('analyseBtn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`analyse.html?tabId=${tab.id}`)
  });
  window.close();
});

$('settingsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('whitelistBtn').addEventListener('click', async () => {
  if (!state.currentDomain) return;
  const inWl = state.lists.whitelist.includes(state.currentDomain);
  await sendMsg({
    action: inWl ? 'removeFromWhitelist' : 'addToWhitelist',
    domain: state.currentDomain
  });
  await load();
});

$('resetBtn').addEventListener('click', async () => {
  const empty = { blocked: 0, clicks: 0, redirects: 0, popups: 0, adsKilled: 0 };
  await chrome.storage.local.set({ stats: empty });
  renderStats(empty);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.stats) renderStats(changes.stats.newValue || {});
  if (changes.enabled) renderEnabled(changes.enabled.newValue);
  if (changes.whitelist || changes.customBlocklist) load();
});

load();
