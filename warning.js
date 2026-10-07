const params = new URLSearchParams(location.search);
const blocked = params.get('blocked');

if (blocked) {
  document.getElementById('blockedUrl').textContent = blocked;
  document.getElementById('blockedUrlBox').hidden = false;
  document.getElementById('btnAllow').hidden = false;
}

document.getElementById('btnBack').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = 'about:blank';
});

document.getElementById('btnHome').addEventListener('click', () => {
  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url: 'chrome://newtab' });
    window.close?.();
  } else {
    location.href = 'https://duckduckgo.com';
  }
});

document.getElementById('btnAllow').addEventListener('click', async () => {
  if (!blocked) return;
  if (!confirm(`Autoriser ${blocked} ? Ce domaine sera ajouté à la liste blanche et ne sera plus bloqué.`)) return;
  try {
    await chrome.runtime.sendMessage({ action: 'addToWhitelist', domain: blocked });
    location.href = 'https://' + blocked;
  } catch {
    alert("Impossible d'ajouter le domaine à la liste blanche.");
  }
});
