(() => {
  // Anti-modaux racoleurs.
  // Stratégie : on cherche du texte racoleur dans les éléments "titre/paragraphe"
  // (pas dans les conteneurs), puis on remonte vers le modal — qui peut être
  // un parent fixed/absolute (overlay) OU une carte avec box-shadow.
  // On gère aussi shadow DOM, apostrophes typographiques, et backdrops.

  const SPAMMY_RE = [
    // EN
    /don'?t miss/i,
    /try your luck/i,
    /\braffle\b/i,
    /\blottery\b/i,
    /you (have )?won/i,
    /\bwinner\b/i,
    /you'?ve been selected/i,
    /congratulations/i,
    /claim (your )?prize/i,
    /free gift/i,
    /spin to win/i,
    /click here to win/i,
    /\b\d{1,3}\s*%\s*off\b/i,
    /up to \d{1,3}\s*%/i,
    /limited (time|offer)/i,
    /act now/i,
    /offer expires/i,
    /\bsale\b/i,
    /\bdeal\b/i,
    /allow notifications/i,
    /enable notifications/i,
    /subscribe (to|now)/i,
    /\bnewsletter\b/i,
    /push notifications/i,
    // FR
    /vous avez gagné/i,
    /félicitations/i,
    /tentez votre chance/i,
    /ne ratez pas/i,
    /\bsoldes?\b/i,
    /jusqu'à\s*-?\s*\d{1,3}\s*%/i,
    /offre limitée/i,
    /autoriser les notifications/i,
    /réclamer/i,
    /abonnez[- ]vous/i,
    /tirage au sort/i
  ];

  const CTA_RE = /^\s*(ok|allow|claim|continue|yes|subscribe|enable|got it|i agree|i accept|next|let me in|autoriser|oui|continuer|réclamer|d'accord|j'accepte|s'abonner)\.?\s*$/i;

  const SAFE_RE = /\b(cookie|cookies|privacy policy|gdpr|rgpd|consent|consentement|captcha|sign in|sign up|log in|login|password|mot de passe|connexion|inscription)\b/i;

  let enabled = true;
  const killed = new WeakSet();

  // Normalise les apostrophes typographiques ('Don’t') en ASCII
  // et compresse les espaces. C'est indispensable : sinon `don'?t` ne matche pas.
  const normalize = (s) =>
    String(s || '')
      .replace(/[‘’‚‛ʼ]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();

  const matchesSpammy = (text) => {
    const n = normalize(text);
    if (n.length < 3) return false;
    return SPAMMY_RE.some(re => re.test(n));
  };

  const isSafeContext = (text) => SAFE_RE.test(normalize(text));

  // Texte direct de l'élément (pas des descendants), pour cibler les titres
  // sans s'embourber dans le textContent énorme d'un conteneur de page.
  const ownText = (el) => {
    let t = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) t += node.textContent;
    }
    return t.trim();
  };

  const containsLoginForm = (el) =>
    !!el.querySelector('input[type="password"], input[type="email"], input[autocomplete*="password"]');

  const hasCTAInside = (el) => {
    const buttons = el.querySelectorAll(
      'button, [role="button"], a.btn, a.button, .btn, .button, input[type="button"], input[type="submit"]'
    );
    for (const b of buttons) {
      const t = (b.value || b.innerText || b.textContent || '').trim();
      if (CTA_RE.test(t)) return true;
    }
    return false;
  };

  const isPageLevel = (r) =>
    r.width >= window.innerWidth * 0.97 && r.height >= window.innerHeight * 0.97;

  // Remonte depuis un texte racoleur jusqu'au conteneur modal :
  // 1) Premier ancêtre fixed/absolute non-page-level → c'est l'overlay
  // 2) Sinon, premier ancêtre avec box-shadow + taille raisonnable → la carte
  const findModalContainer = (el) => {
    let cardFallback = null;
    let cur = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      let cs, r;
      try { cs = getComputedStyle(cur); r = cur.getBoundingClientRect(); }
      catch { cur = cur.parentElement; continue; }

      if (!isPageLevel(r)) {
        if (cs.position === 'fixed') return cur;
        if (cs.position === 'absolute') {
          const z = parseInt(cs.zIndex, 10) || 0;
          if (z >= 50) return cur;
        }
        if (!cardFallback && cs.boxShadow && cs.boxShadow !== 'none'
            && r.width >= 200 && r.height >= 80
            && r.width <= window.innerWidth * 0.92) {
          cardFallback = cur;
        }
      }
      cur = cur.parentElement;
    }
    return cardFallback;
  };

  // Tue aussi les frères "backdrop" (overlay sombre derrière le modal)
  const killSiblingBackdrops = (el) => {
    const parent = el.parentElement;
    if (!parent) return;
    for (const sib of [...parent.children]) {
      if (sib === el || killed.has(sib)) continue;
      let cs, r;
      try { cs = getComputedStyle(sib); r = sib.getBoundingClientRect(); }
      catch { continue; }
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if (r.width < window.innerWidth * 0.85 || r.height < window.innerHeight * 0.85) continue;
      const bg = cs.backgroundColor;
      const hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      if (!hasBg && parseFloat(cs.opacity) >= 1) continue;
      killed.add(sib);
      try { sib.remove(); } catch { sib.style.setProperty('display', 'none', 'important'); }
    }
  };

  const restoreScroll = () => {
    for (const target of [document.body, document.documentElement]) {
      if (!target) continue;
      try {
        const cs = getComputedStyle(target);
        if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
          target.style.setProperty('overflow', 'auto', 'important');
          target.style.setProperty('overflow-y', 'auto', 'important');
        }
        if (cs.position === 'fixed') {
          target.style.removeProperty('position');
        }
      } catch {}
    }
  };

  const kill = (container) => {
    if (killed.has(container)) return;
    killed.add(container);
    killSiblingBackdrops(container);
    try { container.remove(); }
    catch {
      container.style.setProperty('display', 'none', 'important');
      container.style.setProperty('visibility', 'hidden', 'important');
    }
    restoreScroll();
    chrome.runtime.sendMessage({ action: 'reportAdKilled' }).catch(() => {});
  };

  // Sélecteur des "porteurs de texte courts" : titres et paragraphes
  // typiques d'un modal racoleur. On évite les `div`/`section` parce qu'ils
  // contiennent souvent du texte de page entière (faux positifs).
  const TEXT_SELECTORS = 'h1, h2, h3, h4, h5, h6, p, strong, b, li, dt, dd';

  const scanRoot = (root) => {
    if (!enabled) return;
    if (!root || !root.querySelectorAll) return;

    const elements = root.querySelectorAll(TEXT_SELECTORS);
    for (const el of elements) {
      const txt = ownText(el);
      if (txt.length < 3 || txt.length > 200) continue;
      if (isSafeContext(txt)) continue;
      if (!matchesSpammy(txt)) continue;

      const container = findModalContainer(el);
      if (!container) continue;
      if (killed.has(container)) continue;
      if (container === document.body || container === document.documentElement) continue;
      if (containsLoginForm(container)) continue;
      if (isSafeContext(container.textContent || '')) continue;

      let r;
      try { r = container.getBoundingClientRect(); } catch { continue; }
      if (r.width < 100 || r.height < 50) continue;
      if (isPageLevel(r)) continue;

      if (!hasCTAInside(container)) continue;

      kill(container);
    }

    // Pénètre les shadow roots ouverts (Web Components, players vidéo…)
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (el.shadowRoot) scanRoot(el.shadowRoot);
    }
  };

  // ---- Sync config ---------------------------------------------------
  const sync = async () => {
    try {
      const data = await chrome.storage.local.get(['enabled', 'blockAdOverlays']);
      enabled = (data.enabled ?? true) && (data.blockAdOverlays ?? true);
    } catch {}
  };

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.enabled || changes.blockAdOverlays) sync();
  });

  // ---- Start ---------------------------------------------------------
  const start = async () => {
    await sync();
    scanRoot(document);

    // Les pubs sont parfois injectées avec délai (jusqu'à ~45 s sur certains sites).
    let scans = 0;
    const interval = setInterval(() => {
      if (!enabled) return;
      scanRoot(document);
      if (++scans > 30) clearInterval(interval); // 30 × 1500 ms = 45 s
    }, 1500);

    new MutationObserver((muts) => {
      if (!enabled) return;
      for (const m of muts) {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          // On scanne depuis le parent pour permettre à findModalContainer de remonter.
          scanRoot(n.parentElement || n);
        });
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: false });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
