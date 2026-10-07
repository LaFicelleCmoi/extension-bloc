(() => {
  let lists = {
    blocklist: [], patterns: [], whitelist: [], enabled: true,
    blockCrossOriginPopups: true, blockCrossOriginRedirects: true,
    strictRedirectMode: true
  };
  let mainWorldInjected = false;
  const recent = new Map();
  const TOAST_TTL = 4000;

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

  const isBlocked = (url) => {
    if (!url) return false;
    const h = host(url);
    if (matchesDomain(h, lists.whitelist)) return false;
    if (matchesDomain(h, lists.blocklist)) return true;
    const lower = String(url).toLowerCase();
    return lists.patterns.some(p => lower.includes(String(p).toLowerCase()));
  };

  const showWarning = (message) => {
    const now = Date.now();
    const last = recent.get(message);
    if (last && now - last < TOAST_TTL) return;
    recent.set(message, now);

    const el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.style.cssText = `
      position: fixed; top: 20px; right: 20px;
      background: #d32f2f; color: #fff; padding: 12px 18px;
      border-radius: 6px; z-index: 2147483647;
      font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.35); max-width: 360px;
      word-break: break-word; pointer-events: none;
    `;
    el.textContent = '⚠️ ' + message;
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => el.remove(), TOAST_TTL);
  };

  const buildPayload = () => encodeURIComponent(JSON.stringify({
    blocklist: lists.blocklist,
    patterns: lists.patterns,
    whitelist: lists.whitelist,
    blockCrossOriginPopups: lists.blockCrossOriginPopups,
    blockCrossOriginRedirects: lists.blockCrossOriginRedirects,
    strictRedirectMode: lists.strictRedirectMode,
    pageOrigin: location.origin
  }));

  const injectMainWorld = () => {
    if (mainWorldInjected) return;
    mainWorldInjected = true;
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('content/main-world.js');
    s.dataset.blocker = buildPayload();
    s.async = false;
    (document.documentElement || document.head).prepend(s);
    s.addEventListener('load', () => s.remove());
  };

  const refreshLists = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'getLists' });
      if (res) lists = res;
    } catch { /* SW idle */ }
    if (mainWorldInjected) {
      window.postMessage({
        __blocker: 'updateLists',
        lists: {
          blocklist: lists.blocklist,
          patterns: lists.patterns,
          whitelist: lists.whitelist,
          blockCrossOriginPopups: lists.blockCrossOriginPopups,
          blockCrossOriginRedirects: lists.blockCrossOriginRedirects,
          strictRedirectMode: lists.strictRedirectMode
        }
      }, '*');
    } else {
      injectMainWorld();
    }
  };

  document.addEventListener('click', (e) => {
    if (!lists.enabled) return;
    const t = e.target?.closest?.('a[href], iframe, [data-video], [data-src], video, source');
    if (!t) return;
    const url = t.href || t.src || t.getAttribute?.('data-src');
    if (url && isBlocked(url)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      showWarning('Lien bloqué : ' + url);
      chrome.runtime.sendMessage({ action: 'reportClick' }).catch(() => {});
    }
  }, true);

  // <meta http-equiv="refresh" content="0; url=https://other-origin.tld/">
  // Vecteur de redirection automatique côté HTML — invisible aux overrides JS.
  const nukeMetaRefresh = (root) => {
    if (!lists.enabled && !lists.strictRedirectMode) return;
    if (!lists.blockCrossOriginRedirects && !lists.strictRedirectMode) return;
    const metas = (root instanceof Element)
      ? (root.matches?.('meta[http-equiv]')
          ? [root, ...root.querySelectorAll('meta[http-equiv]')]
          : root.querySelectorAll('meta[http-equiv]'))
      : document.querySelectorAll('meta[http-equiv]');
    for (const m of metas) {
      const equiv = (m.getAttribute('http-equiv') || '').toLowerCase();
      if (equiv !== 'refresh') continue;
      const content = m.getAttribute('content') || '';
      const match = content.match(/^\s*\d+\s*;\s*url\s*=\s*(.+?)\s*$/i);
      if (!match) continue;
      const url = match[1].replace(/^['"]|['"]$/g, '');
      let target;
      try { target = new URL(url, location.href); } catch { continue; }
      if (target.origin === location.origin) continue;
      const targetHost = target.hostname.toLowerCase();
      // En mode strict, on ignore la whitelist pour les redirections.
      if (!lists.strictRedirectMode && matchesDomain(targetHost, lists.whitelist)) continue;
      m.remove();
      showWarning('Meta-refresh inter-domaine bloqué : ' + url);
      chrome.runtime.sendMessage({ action: 'reportRedirect' }).catch(() => {});
    }
  };

  const scrubFrames = (root) => {
    if (!root || !lists.enabled) return;
    const nodes = root.matches?.('iframe, frame')
      ? [root]
      : Array.from(root.querySelectorAll?.('iframe, frame') || []);
    for (const f of nodes) {
      const src = f.src || f.getAttribute('src');
      if (src && isBlocked(src)) {
        f.removeAttribute('src');
        try { f.src = 'about:blank'; } catch {}
        f.style.display = 'none';
        showWarning('Iframe bloquée : ' + (host(src) || src));
        chrome.runtime.sendMessage({ action: 'reportRedirect' }).catch(() => {});
      }
    }
  };

  new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (lists.enabled) scrubFrames(n);
        nukeMetaRefresh(n);
      });
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  // Echo MAIN-world block reports as stats / toasts.
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (d?.__blocker === 'reportPopupBlocked') {
      showWarning('Popup bloqué : ' + (d.url || '(vide)'));
      chrome.runtime.sendMessage({ action: 'reportPopup' }).catch(() => {});
    } else if (d?.__blocker === 'reportRedirectBlocked') {
      showWarning('Redirection bloquée : ' + (d.url || ''));
      chrome.runtime.sendMessage({ action: 'reportRedirect' }).catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'listsUpdated' && msg.lists) {
      lists = msg.lists;
      refreshLists();
    }
  });

  refreshLists().then(() => {
    scrubFrames(document.documentElement);
    nukeMetaRefresh(document.documentElement);
  });
})();
