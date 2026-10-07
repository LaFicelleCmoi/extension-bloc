export function getHostname(url) {
  try {
    return new URL(url, 'http://x').hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function matchesDomain(hostname, list) {
  if (!hostname || !list?.length) return false;
  return list.some(d => {
    const dn = String(d).toLowerCase().replace(/^\*\./, '');
    return hostname === dn || hostname.endsWith('.' + dn);
  });
}

export function matchesPattern(url, patterns) {
  if (!url || !patterns?.length) return false;
  const u = String(url).toLowerCase();
  return patterns.some(p => u.includes(String(p).toLowerCase()));
}

export function shouldBlockUrl(url, { blocklist, patterns, whitelist }) {
  const host = getHostname(url);
  if (matchesDomain(host, whitelist)) return false;
  if (matchesDomain(host, blocklist)) return true;
  if (matchesPattern(url, patterns)) return true;
  return false;
}
