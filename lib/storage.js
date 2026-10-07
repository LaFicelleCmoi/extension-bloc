const DEFAULTS = Object.freeze({
  customBlocklist: [],
  customPatterns: [],
  whitelist: [],
  stats: { blocked: 0, clicks: 0, redirects: 0, popups: 0, adsKilled: 0 },
  enabled: true,
  blockCrossOriginPopups: true,
  blockCrossOriginRedirects: true,
  blockAdOverlays: true,
  strictRedirectMode: true
});

export async function getSettings() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    customBlocklist: data.customBlocklist ?? DEFAULTS.customBlocklist,
    customPatterns: data.customPatterns ?? DEFAULTS.customPatterns,
    whitelist: data.whitelist ?? DEFAULTS.whitelist,
    stats: { ...DEFAULTS.stats, ...(data.stats || {}) },
    enabled: data.enabled ?? DEFAULTS.enabled,
    blockCrossOriginPopups: data.blockCrossOriginPopups ?? DEFAULTS.blockCrossOriginPopups,
    blockCrossOriginRedirects: data.blockCrossOriginRedirects ?? DEFAULTS.blockCrossOriginRedirects,
    blockAdOverlays: data.blockAdOverlays ?? DEFAULTS.blockAdOverlays,
    strictRedirectMode: data.strictRedirectMode ?? DEFAULTS.strictRedirectMode
  };
}

export async function setSettings(patch) {
  await chrome.storage.local.set(patch);
}

export async function bumpStat(key, by = 1) {
  const { stats } = await getSettings();
  stats[key] = (stats[key] || 0) + by;
  await chrome.storage.local.set({ stats });
}

export async function resetStats() {
  await chrome.storage.local.set({ stats: { blocked: 0, clicks: 0, redirects: 0, popups: 0, adsKilled: 0 } });
}
