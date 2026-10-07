# 🛡️ Bloqueur Streams Malveillants — Extension Chrome (v2)

Extension MV3 qui bloque au **niveau réseau** les sites de streaming malveillants
via `declarativeNetRequest`, et neutralise les iframes / `window.open` /
redirections au sein des pages.

## ✨ Fonctionnalités

- **Blocage réseau** via `declarativeNetRequest` (rules dynamiques régénérées à chaud)
- **Whitelist** réellement appliquée (filtre les rules + court-circuite le content script)
- **Page d'options** pour gérer blocklist / whitelist / motifs personnalisés
- **Toggle on/off** global, badge dynamique
- **Statistiques** persistantes (sites bloqués, clics interceptés, redirections)
- **Override `window.open` / `Location.assign|replace`** injecté en MAIN world
- **`MutationObserver`** qui scrub les iframes injectées dynamiquement
- **Page d'avertissement CSP-safe** affichant l'URL bloquée + bouton "autoriser ce domaine"

## 🗂️ Architecture

```
extention bloc/
├── manifest.json            MV3 + declarativeNetRequest + options_page
├── background.js            Service worker (module) — DNR dynamique, stats, messaging
├── lib/
│   ├── blocklist.js         Listes par défaut (source unique)
│   ├── match.js             Matching hostname (suffix-match) + patterns
│   └── storage.js           Wrappers chrome.storage avec valeurs par défaut
├── content/
│   ├── content.js           Isolated world — clicks, MutationObserver, toasts
│   └── main-world.js        Page world — override window.open / Location
├── popup.html / .css / .js  Popup avec toggle, stats, badges du site courant
├── options.html / .css / .js Page d'options complète
├── warning.html / .js       Page d'avertissement CSP-safe
└── README.md
```

## 🚀 Installation

1. Ouvrir `chrome://extensions/`
2. Activer le **Mode développeur**
3. Cliquer **Charger l'extension non empaquetée**
4. Sélectionner ce dossier
5. L'icône 🛡️ apparaît dans la barre d'outils

## 🎮 Utilisation

### Popup (clic sur l'icône)
- **Toggle** : active/désactive globalement le blocage
- **Site actuel** : indique si le domaine est bloqué, en liste blanche ou non listé
- **Stats** en direct : sites bloqués, clics, redirections
- **Liste blanche** : ajoute/retire le domaine actif d'un clic
- **Stats** : remet les compteurs à zéro
- **Options** : ouvre la page d'options

### Page d'options
- Ajouter/retirer des domaines personnalisés (validation d'entrée)
- Gérer la whitelist
- Ajouter des motifs suspects (sous-chaînes recherchées dans les URLs)
- Voir les domaines bloqués par défaut
- Tout réinitialiser

### Page d'avertissement
- Affiche l'URL ou le domaine bloqué
- Bouton **Retour** / **Page d'accueil**
- Bouton **Autoriser ce domaine** (ajoute en whitelist et continue)

## 🔧 Personnalisation

### Modifier la blocklist par défaut

Édite `lib/blocklist.js` :

```js
export const DEFAULT_BLOCKLIST = [
  'streamcheap.com',
  'nouveau-site.com',  // ← ajoute ici
];
```

Les utilisateurs finaux n'ont pas besoin de modifier ce fichier — la page
d'options permet d'étendre la blocklist sans toucher au code.

### Ajouter une icône

Dépose `icon-16.png`, `icon-48.png`, `icon-128.png` à la racine, puis ajoute
dans `manifest.json` :

```json
"icons": { "16": "icon-16.png", "48": "icon-48.png", "128": "icon-128.png" },
"action": { ..., "default_icon": "icon-48.png" }
```

## 🧠 Détails techniques

### Pourquoi `declarativeNetRequest` plutôt que `webRequest` ou `tabs.onUpdated`

- MV3 limite/déprécie `webRequest` blocking (sauf entreprise).
- `tabs.onUpdated` se déclenche **après** le début de la navigation — la
  requête réseau peut déjà avoir abouti.
- DNR bloque la requête au niveau du moteur réseau, avant tout exécution JS
  côté page. C'est plus rapide, plus fiable et survit aux service workers
  endormis.

### Pourquoi un script injecté en MAIN world

Les content scripts vivent dans un monde isolé : redéfinir `window.open` ou
`Location.prototype.assign` n'a aucun effet sur le code de la page. Le
fichier `content/main-world.js` est injecté via une balise `<script>` chargée
depuis le content script, ce qui place les overrides dans le contexte JS de
la page elle-même. Les listes sont passées via `dataset.blocker` et mises à
jour via `postMessage`.

### Suffix-match vs `String.includes`

L'ancienne version utilisait `url.includes('streamcheap.com')`, ce qui
matchait aussi `notstreamcheap.com.fake`. La nouvelle normalise le hostname
en lowercase et compare par suffix : `host === 'streamcheap.com' || host.endsWith('.streamcheap.com')`.

## 🔐 Sécurité & vie privée

- Aucune donnée n'est envoyée à un serveur — tout est local.
- Aucune connexion réseau initiée par l'extension.
- Pas de `eval`, pas d'`onclick` inline (CSP-safe).

## 🐛 Dépannage

| Symptôme | Solution |
|---|---|
| L'extension ne se charge pas | Vérifier la console sur `chrome://extensions/` — souvent un fichier manquant ou une erreur de syntaxe dans `manifest.json` |
| Aucun blocage | Vérifier que le toggle est ON ; recharger l'extension |
| Stats à 0 | Les stats DNR nécessitent `declarativeNetRequestFeedback` (déjà demandé) ; si elles restent à 0, le fallback `webNavigation` les incrémentera |
| Domaines de la whitelist toujours bloqués | Recharger l'extension : les rules DNR sont régénérées au changement de stockage |

## 📱 Compatibilité

- Chrome 102+
- Edge (Chromium)
- Brave / autres dérivés Chromium
- ⚠️ Firefox : `declarativeNetRequest` y est partiellement supporté — adaptation requise

## 📄 Licence

Libre d'usage personnel et commercial.

---

**Version 2.0.0** — refonte complète : MV3 idiomatique, DNR, whitelist active, options, MAIN-world overrides.
