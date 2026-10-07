export const DEFAULT_BLOCKLIST = [
  'streamcheap.com',
  'streamgratuit.net',
  'film-streaming.xyz',
  'series-stream.online',
  'wstream.to',
  'vumoo.com',
  'freeflix.online',
  'popcorn-flix.com',
  'torrentflix.top',
  'rapidvideo.com',
  'openload.cc',
  'streamango.com',
  'vidoza.net',
  'watchfree.to',
  'serie-streaming.org'
];

export const DEFAULT_PATTERNS = [
  'doubleclick.net',
  'malware',
  'phishing',
  'bit.ly/',
  'short.link/',
  'tinyurl.com/',
  'click.tracking'
];

// TLDs souvent associés à des sites éphémères, gratuits ou abusés.
export const SUSPICIOUS_TLDS = [
  'xyz', 'top', 'click', 'download', 'review', 'tk', 'ml', 'ga', 'cf',
  'gq', 'party', 'win', 'stream', 'site', 'best', 'rest', 'space',
  'loan', 'bid', 'trade', 'pw', 'online', 'icu', 'monster'
];

// Hôtes connus de réseaux publicitaires / popunders très utilisés sur les sites de streaming.
export const KNOWN_AD_NETWORKS = [
  'propellerads.com', 'popcash.net', 'popads.net', 'popunder.net',
  'adsterra.com', 'hilltopads.net', 'adcash.com', 'mgid.com',
  'taboola.com', 'outbrain.com', 'revcontent.com', 'clickadu.com',
  'exoclick.com', 'trafficstars.com', 'juicyads.com'
];
