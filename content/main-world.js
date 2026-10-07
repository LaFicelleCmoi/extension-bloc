(() => {
  const cs = document.currentScript;
  let cfg = {
    blocklist: [],
    patterns: [],
    whitelist: [],
    blockCrossOriginPopups: true,
    blockCrossOriginRedirects: true,
    strictRedirectMode: true,
    pageOrigin: location.origin
  };
  try {
    if (cs?.dataset?.blocker) {
      cfg = { ...cfg, ...JSON.parse(decodeURIComponent(cs.dataset.blocker)) };
    }
  } catch {}

  const host = (u) => {
    try { return new URL(u, location.href).hostname.toLowerCase(); } catch { return ''; }
  };

  const matchesDomain = (h, list) => {
    if (!h || !list?.length) return false;
    return list.some(d => {
      const dn = String(d).toLowerCase().replace(/^\*\./, '');
      return h === dn || h.endsWith('.' + dn);
    });
  };

  // En mode strict, la whitelist N'exempte PAS les redirections cross-origin :
  // l'utilisateur veut le blocage absolument partout.
  const isWhitelistedForRedirects = (h) =>
    cfg.strictRedirectMode ? false : matchesDomain(h, cfg.whitelist);

  const isBlocklisted = (url) => {
    if (!url) return false;
    const h = host(url);
    if (!cfg.strictRedirectMode && matchesDomain(h, cfg.whitelist)) return false;
    if (matchesDomain(h, cfg.blocklist)) return true;
    const lower = String(url).toLowerCase();
    return cfg.patterns.some(p => lower.includes(String(p).toLowerCase()));
  };

  const isCrossOrigin = (url) => {
    if (url == null || url === '' || url === 'about:blank') return true;
    try {
      const u = new URL(url, location.href);
      if (u.protocol === 'about:' || u.protocol === 'javascript:' || u.protocol === 'data:') return true;
      return u.origin !== cfg.pageOrigin;
    } catch { return true; }
  };

  const report = (kind, url) => {
    try { window.postMessage({ __blocker: kind, url: String(url ?? '') }, '*'); } catch {}
  };

  // En mode strict on ignore le toggle global / les toggles cross-origin :
  // le blocage est toujours actif, sur tous les sites.
  const shouldBlockPopup    = () => cfg.strictRedirectMode || cfg.blockCrossOriginPopups;
  const shouldBlockRedirect = () => cfg.strictRedirectMode || cfg.blockCrossOriginRedirects;

  // ---- window.open --------------------------------------------------------
  try {
    const origOpen = window.open.bind(window);
    window.open = function (url, ...rest) {
      const target = url ?? '';
      if (shouldBlockPopup() && isCrossOrigin(target) && !isWhitelistedForRedirects(host(target))) {
        report('reportPopupBlocked', target);
        return null;
      }
      if (target && isBlocklisted(target)) {
        report('reportPopupBlocked', target);
        return null;
      }
      return origOpen(url, ...rest);
    };
  } catch {}

  // ---- Location.assign / replace -----------------------------------------
  try {
    const proto = Location.prototype;
    const origAssign  = proto.assign;
    const origReplace = proto.replace;
    const guardLocation = (orig, kind) => function (url) {
      if (shouldBlockRedirect() && isCrossOrigin(url) && !isWhitelistedForRedirects(host(url))) {
        report('reportRedirectBlocked', url);
        return;
      }
      if (isBlocklisted(url)) {
        report('reportRedirectBlocked', url);
        return;
      }
      return orig.call(this, url);
    };
    proto.assign  = guardLocation(origAssign,  'assign');
    proto.replace = guardLocation(origReplace, 'replace');
  } catch {}

  // ---- Location.prototype.href setter ------------------------------------
  // Beaucoup de scripts redirigent via `location.href = '...'` ou `location = '...'`.
  // On capture le setter sur Location.prototype quand il est configurable.
  try {
    const desc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (desc && typeof desc.set === 'function' && desc.configurable) {
      const origSetter = desc.set;
      const origGetter = desc.get;
      Object.defineProperty(Location.prototype, 'href', {
        configurable: true,
        enumerable: desc.enumerable,
        get: origGetter,
        set(value) {
          const url = String(value);
          if (shouldBlockRedirect() && isCrossOrigin(url) && !isWhitelistedForRedirects(host(url))) {
            report('reportRedirectBlocked', url);
            return;
          }
          if (isBlocklisted(url)) {
            report('reportRedirectBlocked', url);
            return;
          }
          return origSetter.call(this, value);
        }
      });
    }
  } catch {}

  // ---- target=_blank anchor clicks (popup classique) ---------------------
  document.addEventListener('click', (e) => {
    if (!shouldBlockPopup()) return;
    const a = e.target?.closest?.('a[target="_blank"], a[target="_new"]');
    if (!a) return;
    const href = a.href;
    if (!href) return;
    if (isWhitelistedForRedirects(host(href))) return;
    if (isCrossOrigin(href) || isBlocklisted(href)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      report('reportPopupBlocked', href);
    }
  }, true);

  // ---- Mode strict : clics et submits SYNTHÉTIQUES (déclenchés par script)
  // Quand un script appelle `el.click()`, l'event a `isTrusted === false`.
  // On bloque ces clics vers une autre origine — les clics utilisateurs
  // (`isTrusted === true`) passent normalement.
  document.addEventListener('click', (e) => {
    if (!cfg.strictRedirectMode) return;
    if (e.isTrusted) return;
    const a = e.target?.closest?.('a[href]');
    if (!a) return;
    const href = a.href;
    if (!href) return;
    if (!isCrossOrigin(href) && !isBlocklisted(href)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    report('reportRedirectBlocked', href);
  }, true);

  document.addEventListener('submit', (e) => {
    if (!cfg.strictRedirectMode) return;
    if (e.isTrusted) return;
    const form = e.target;
    const action = form?.action || '';
    if (!action) return;
    if (!isCrossOrigin(action) && !isBlocklisted(action)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    report('reportRedirectBlocked', action);
  }, true);

  // ---- Notifications.requestPermission auto-deny -------------------------
  try {
    if (typeof Notification !== 'undefined' && Notification.requestPermission) {
      const noop = () => Promise.resolve('default');
      Notification.requestPermission = (cb) => {
        if (typeof cb === 'function') { try { cb('default'); } catch {} }
        return noop();
      };
    }
  } catch {}

  // ---- live config updates from the isolated world -----------------------
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.__blocker === 'updateLists' && e.data.lists) {
      cfg = { ...cfg, ...e.data.lists };
    }
  });
})();
