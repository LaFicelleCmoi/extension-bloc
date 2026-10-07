import { DEFAULT_BLOCKLIST, DEFAULT_PATTERNS } from './lib/blocklist.js';
import { matchesDomain, shouldBlockUrl } from './lib/match.js';
import { getSettings, bumpStat } from './lib/storage.js';

const RULE_ID_BASE = 1000;
const MAX_DYNAMIC_RULES = 4500;

async function getEffectiveLists() {
  const s = await getSettings();
  const blocklist = [...new Set([...DEFAULT_BLOCKLIST, ...s.customBlocklist])]
    .filter(d => !matchesDomain(d.toLowerCase(), s.whitelist));
  const patterns = [...new Set([...DEFAULT_PATTERNS, ...s.customPatterns])];
  return {
    blocklist,
    patterns,
    whitelist: s.whitelist,
    enabled: s.enabled,
    blockCrossOriginPopups: s.blockCrossOriginPopups,
    blockCrossOriginRedirects: s.blockCrossOriginRedirects,
    strictRedirectMode: s.strictRedirectMode
  };
}

async function syncDynamicRules() {
  const { blocklist, enabled } = await getEffectiveLists();

  const rules = enabled
    ? blocklist.slice(0, MAX_DYNAMIC_RULES).map((d, i) => ({
        id: RULE_ID_BASE + i,
        priority: 1,
        action: { type: 'block' },
        condition: {
          requestDomains: [d],
          resourceTypes: [
            'main_frame', 'sub_frame', 'script', 'image',
            'media', 'xmlhttprequest', 'websocket', 'other'
          ]
        }
      }))
    : [];

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: rules
  });
}

async function updateBadge() {
  const { enabled } = await getSettings();
  await chrome.action.setBadgeBackgroundColor({
    color: enabled ? '#4CAF50' : '#9e9e9e'
  });
  await chrome.action.setBadgeText({ text: enabled ? 'ON' : 'OFF' });
}

async function broadcastListsUpdated() {
  const lists = await getEffectiveLists();
  try {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      if (!t.id) continue;
      chrome.tabs.sendMessage(t.id, { action: 'listsUpdated', lists }).catch(() => {});
    }
  } catch { /* ignore */ }
}

chrome.runtime.onInstalled.addListener(async () => {
  await updateBadge();
  await syncDynamicRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await updateBadge();
  await syncDynamicRules();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if (changes.customBlocklist || changes.whitelist || changes.enabled) {
    await syncDynamicRules();
    await broadcastListsUpdated();
  }
  if (changes.customPatterns
      || changes.blockCrossOriginPopups
      || changes.blockCrossOriginRedirects
      || changes.strictRedirectMode) {
    await broadcastListsUpdated();
  }
  if (changes.enabled) await updateBadge();
});

// Stat tracking via DNR feedback (only fires with declarativeNetRequestFeedback permission).
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener(() => {
  bumpStat('blocked').catch(() => {});
});

// Stats only — webNavigation cannot cancel a request, so we just count
// pattern-matched main-frame navigations (DNR handles the actual blocking by domain).
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const lists = await getEffectiveLists();
  if (!lists.enabled) return;
  if (shouldBlockUrl(details.url, lists)) await bumpStat('blocked');
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.action === 'getLists') {
        sendResponse(await getEffectiveLists());
      } else if (msg?.action === 'reportClick') {
        await bumpStat('clicks');
        sendResponse({ ok: true });
      } else if (msg?.action === 'reportRedirect') {
        await bumpStat('redirects');
        sendResponse({ ok: true });
      } else if (msg?.action === 'reportPopup') {
        await bumpStat('popups');
        sendResponse({ ok: true });
      } else if (msg?.action === 'reportAdKilled') {
        await bumpStat('adsKilled');
        sendResponse({ ok: true });
      } else if (msg?.action === 'addToWhitelist' && msg.domain) {
        const s = await getSettings();
        const wl = new Set(s.whitelist);
        wl.add(String(msg.domain).toLowerCase());
        await chrome.storage.local.set({ whitelist: [...wl] });
        sendResponse({ ok: true });
      } else if (msg?.action === 'removeFromWhitelist' && msg.domain) {
        const s = await getSettings();
        await chrome.storage.local.set({
          whitelist: s.whitelist.filter(d => d !== msg.domain)
        });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'unknown action' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true;
});
