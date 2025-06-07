const API_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW = 60 * 1000;
const requestTimestamps = [];
const cache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000;
const FEED_CACHE_DURATION = 60 * 60 * 1000; // 1 hour
const TLD_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day
const MAX_BLACKLIST_SIZE = 1000; // Limit blacklist size to prevent performance issues

let VIRUSTOTAL_API_KEY = '';
let PHISHTANK_API_KEY = '';
const feedCache = {};
let suspiciousTlds = [
  'tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'top', 'xyz', 'online', 'site', 'club',
  'icu', 'cam', 'buzz', 'work', 'info', 'bid', 'date', 'download', 'stream',
  'trade', 'win', 'review', 'party', 'science', 'webcam', 'cricket', 'accountant',
  'faith', 'racing', 'men', 'live', 'shop', 'store', 'tech', 'space', 'fun',
  'website', 'loan', 'click', 'host', 'cloud', 'cheap', 'monster', 'guru', 'world',
  'today', 'life', 'email', 'solutions', 'company', 'center', 'link', 'digital',
  'services', 'network', 'systems', 'group', 'pro', 'run', 'co', 'me'
];
let tldCache = {};

// Local blacklist of known phishing domains, loaded from storage on init
let localBlacklist = ['brt-it.cam'];

// Helper function to normalize URLs
function normalizeUrl(url, domainOnly = false) {
  try {
    if (!url || typeof url !== 'string') {
      return null; // Return null for invalid inputs
    }
    const urlObj = new URL(url);
    if (domainOnly) {
      return `${urlObj.protocol}//${urlObj.hostname}`;
    }
    return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
  } catch (error) {
    console.error(`[background.js] Error normalizing URL ${url}:`, error);
    return null; // Return null instead of the original URL
  }
}

// Helper function to check if hostname is an IP address
function isIpAddress(hostname) {
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  return ipRegex.test(hostname);
}

// Helper function to count subdomains
function countSubdomains(hostname) {
  const parts = hostname.split('.');
  // Subtract 2 for the domain and TLD (e.g., example.com has 0 subdomains)
  return Math.max(0, parts.length - 2);
}

function enforceRateLimit() {
  const now = Date.now();
  requestTimestamps.push(now);
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > RATE_LIMIT_WINDOW) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length > API_RATE_LIMIT) {
    throw new Error('Rate limit exceeded');
  }
}

// Fetch and update suspicious TLDs from Spamhaus
async function updateSuspiciousTlds() {
  const now = Date.now();
  if (tldCache.lastUpdated && now - tldCache.lastUpdated < TLD_CACHE_DURATION) {
    suspiciousTlds = tldCache.tlds;
    console.log(`[background.js] Using cached TLDs: ${suspiciousTlds.join(', ')}`);
    return;
  }

  try {
    const response = await fetch('https://www.spamhaus.org/statistics/tlds/', {
      method: 'GET',
      headers: {
        'User-Agent': 'QuickPhish/2.0 (Anti-Phishing Extension)'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }
    const text = await response.text();
    // Parse TLDs from table rows like <tr><td>.tk</td>...</tr>
    const tldRegex = /<td>\.([a-zA-Z]+)<\/td>/g;
    const matches = text.match(tldRegex) || [];
    const newTlds = matches
      .map(match => match.replace(/<\/?td>/g, '').replace('.', '').toLowerCase())
      .filter(tld => tld && /^[a-zA-Z]+$/.test(tld)); // Ensure valid TLDs
    if (newTlds.length > 0) {
      const addedTlds = newTlds.filter(tld => !suspiciousTlds.includes(tld));
      suspiciousTlds = [...new Set([...suspiciousTlds, ...newTlds])];
      tldCache = { tlds: suspiciousTlds, lastUpdated: now };
      console.log(`[background.js] Updated suspicious TLDs: ${suspiciousTlds.join(', ')}`);
      if (addedTlds.length > 0) {
        console.log(`[background.js] Added new TLDs from Spamhaus: ${addedTlds.join(', ')}`);
      } else {
        console.log(`[background.js] No new TLDs added from Spamhaus`);
      }
    } else {
      console.warn(`[background.js] No TLDs found in Spamhaus response`);
    }
  } catch (error) {
    console.warn('[background.js] Failed to update suspicious TLDs; using default list:', error);
    tldCache = { tlds: suspiciousTlds, lastUpdated: now };
  }
}

function getFeedUrl(provider) {
  switch (provider) {
    case 'OpenPhish':
      return 'https://openphish.com/feed.txt';
    case 'URLhaus':
      return 'https://urlhaus.abuse.ch/downloads/text/';
    case 'PhishStats':
      return 'https://phishstats.info/phish_score.txt';
    case 'PhishReport':
      return 'https://phish.report/feed.txt';
    case 'PhishTank':
      return 'https://data.phishtank.com/data/online-valid.json';
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function checkWithProvider(url, provider) {
  try {
    if (provider === 'LocalBlacklist') {
      const normalizedDomain = normalizeUrl(url, true);
      const domain = normalizedDomain ? normalizedDomain.replace(/^https?:\/\//, '') : '';
      const isPhishing = localBlacklist.includes(domain);
      console.log(`[background.js] [LocalBlacklist] Checking ${domain} in blacklist: ${isPhishing}`);
      return {
        isPhishing,
        isSuspicious: false,
        details: isPhishing ? 'Found in local blacklist' : 'Not found in local blacklist'
      };
    } else if (provider === 'Heuristic') {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const path = urlObj.pathname.toLowerCase();
      const tld = hostname.split('.').pop().toLowerCase();
      const isIp = isIpAddress(hostname);
      const isSuspiciousTld = suspiciousTlds.includes(tld);
      const hasLoginKeyword = path.includes('login') || path.includes('signin');
      const subdomainCount = countSubdomains(hostname);
      const excessiveSubdomains = subdomainCount > 2;
      if (isIp || isSuspiciousTld || hasLoginKeyword || excessiveSubdomains) {
        const reasons = [];
        if (isIp) reasons.push('IP address in URL');
        if (isSuspiciousTld) reasons.push('Suspicious TLD');
        if (hasLoginKeyword) reasons.push('Login keyword in path');
        if (excessiveSubdomains) reasons.push('Excessive subdomains');
        return {
          isPhishing: false,
          isSuspicious: true,
          details: `Heuristic: ${reasons.join(', ')}`
        };
      }
      return {
        isPhishing: false,
        isSuspicious: false,
        details: 'Heuristic: No issues found'
      };
    } else if (['OpenPhish', 'URLhaus', 'PhishStats', 'PhishReport', 'PhishTank'].includes(provider)) {
      if (provider === 'PhishTank' && !PHISHTANK_API_KEY) {
        console.warn('[background.js] PhishTank API key missing; skipping provider');
        return { isPhishing: false, isSuspicious: true, details: 'Provider skipped', skipped: true };
      }
      let feedData;
      const now = Date.now();
      if (feedCache[provider] && now - feedCache[provider].timestamp < FEED_CACHE_DURATION) {
        feedData = feedCache[provider].data;
      } else {
        const apiUrl = getFeedUrl(provider);
        const response = await fetch(apiUrl, { method: 'GET' });
        console.log(`[background.js] [${provider}] Response for ${url}: Status ${response.status}`);
        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[background.js] [${provider}] HTTP error ${response.status}: ${errorText}`);
          throw new Error(`HTTP error ${response.status}: ${errorText}`);
        }
        const contentType = response.headers.get('Content-Type') || '';
        if (provider === 'PhishTank') {
          if (!contentType.includes('application/json')) {
            throw new Error(`Unexpected content type from PhishTank: ${contentType}`);
          }
          const json = await response.json();
          feedData = json.map(entry => entry.url).filter(url => url);
        } else {
          // Accept any text-based content type for other feeds
          if (!contentType.includes('text/') && !contentType.includes('application/octet-stream')) {
            throw new Error(`Unexpected content type from ${provider}: ${contentType}`);
          }
          const text = await response.text();
          // Filter out empty lines, comments, and non-URL-like strings
          feedData = text.split('\n').filter(line => {
            const trimmed = line.trim();
            return trimmed && trimmed.startsWith('http') && !trimmed.startsWith('#');
          });
        }
        // Log invalid entries for debugging
        if (feedData.some(u => !u || typeof u !== 'string')) {
          console.warn(`[background.js] [${provider}] Invalid entries in feedData:`, feedData.filter(u => !u || typeof u !== 'string'));
        }
        feedCache[provider] = { data: feedData, timestamp: now };
      }
      const normalizedUrl = normalizeUrl(url);
      const normalizedDomain = normalizeUrl(url, true);
      const normalizedFeedUrls = feedData
        .filter(u => typeof u === 'string' && u.trim()) // Ensure u is a non-empty string
        .map(u => normalizeUrl(u))
        .filter(u => u); // Remove any failed normalizations
      const normalizedFeedDomains = feedData
        .filter(u => typeof u === 'string' && u.trim())
        .map(u => normalizeUrl(u, true))
        .filter(u => u);
      const isPhishing = normalizedFeedDomains.some(d => d === normalizedDomain) ||
                         normalizedFeedUrls.some(u => u === normalizedUrl);
      console.log(`[background.js] [${provider}] Checking domain ${normalizedDomain} and path ${normalizedUrl} against ${feedData.length} entries. Match found: ${isPhishing}`);
      return {
        isPhishing,
        isSuspicious: false,
        details: isPhishing ? `Found in ${provider} feed` : `Not found in ${provider} feed`
      };
    } else if (provider === 'VirusTotal') {
      if (!VIRUSTOTAL_API_KEY) {
        console.warn('[background.js] VirusTotal API key missing; skipping provider');
        return { isPhishing: false, isSuspicious: true, details: 'Provider skipped', skipped: true };
      }
      const urlId = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const apiUrl = `https://www.virustotal.com/api/v3/urls/${urlId}`;
      const options = {
        method: 'GET',
        headers: {
          'x-apikey': VIRUSTOTAL_API_KEY,
          'Accept': 'application/json'
        }
      };
      const response = await fetch(apiUrl, options);
      console.log(`[background.js] [VirusTotal] Response for ${url}: Status ${response.status}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[background.js] [VirusTotal] HTTP error ${response.status}: ${errorText}`);
        if (response.status === 404) {
          console.log(`[background.js] [VirusTotal] URL ${url} not found in database`);
          return {
            isPhishing: false,
            isSuspicious: true,
            details: 'Not found in VirusTotal database'
          };
        }
        throw new Error(`HTTP error ${response.status}: ${errorText}`);
      }
      const contentType = response.headers.get('Content-Type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Unexpected content type from VirusTotal: ${contentType}`);
      }
      const data = await response.json();
      const positives = data.data?.attributes?.last_analysis_stats?.malicious || 0;
      const isPhishing = positives > 0;
      console.log(`[background.js] [VirusTotal] Result for ${url}: Positives = ${positives}`);
      return {
        isPhishing,
        isSuspicious: false,
        details: isPhishing ? `Flagged by VirusTotal: ${positives} scanners detected issues` : 'Cleared by VirusTotal'
      };
    }
    throw new Error(`Unknown provider: ${provider}`);
  } catch (error) {
    console.error(`[background.js] [${provider}] Error checking ${url}:`, error);
    return {
      isPhishing: false,
      isSuspicious: true,
      details: `Failed to check with ${provider}: ${error.message}`,
      error: true
    };
  }
}

async function loadApiKeys() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['phishTankApiKey', 'openPhishApiKey', 'googleApiKey', 'virusTotalApiKey'],
      (data) => {
        PHISHTANK_API_KEY = data.phishTankApiKey || '';
        VIRUSTOTAL_API_KEY = data.virusTotalApiKey || '';
        resolve();
      }
    );
  });
}

// Load persisted blacklist on startup
async function loadBlacklist() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['localBlacklist'], (data) => {
      if (data.localBlacklist && Array.isArray(data.localBlacklist)) {
        localBlacklist = [...new Set([...localBlacklist, ...data.localBlacklist])];
        console.log('[background.js] Loaded blacklist from storage:', localBlacklist);
      }
      resolve();
    });
  });
}

async function checkURL(url) {
  await loadApiKeys();
  await updateSuspiciousTlds();

  if (cache.has(url)) {
    const cached = cache.get(url);
    if (Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`[background.js] [checkURL] Using cached result for ${url}:`, cached.result);
      return cached.result;
    }
    cache.delete(url);
  }

  try {
    enforceRateLimit();

    const providers = ['LocalBlacklist', 'Heuristic', 'OpenPhish', 'URLhaus', 'PhishStats', 'PhishReport', 'PhishTank', 'VirusTotal'];
    let finalResult = {
      isPhishing: false,
      isSuspicious: false,
      details: 'Cleared by all providers'
    };
    let hasError = false;
    let successfulChecks = 0;

    for (const provider of providers) {
      const result = await checkWithProvider(url, provider);
      console.log(`[background.js] [checkURL] Result from ${provider} for ${url}:`, result);
      if (result.isPhishing) {
        finalResult.isPhishing = true;
        finalResult.isSuspicious = false;
        finalResult.details = result.details;
        break;
      }
      if (result.isSuspicious) {
        finalResult.isSuspicious = true;
      }
      if (result.error) {
        hasError = true;
      }
      if (!result.error && !result.skipped && !result.isPhishing) {
        successfulChecks++;
      }
    }

    if (!finalResult.isPhishing) {
      if (hasError || finalResult.isSuspicious) {
        finalResult.isSuspicious = true;
        finalResult.details = 'Suspicious: Limited verification due to errors or heuristic flags';
      } else if (successfulChecks === providers.length) {
        finalResult.isSuspicious = false;
        finalResult.details = 'Cleared by all providers';
      } else {
        finalResult.isSuspicious = true;
        finalResult.details = 'Suspicious: Incomplete verification';
      }
    }

    cache.set(url, { result: finalResult, timestamp: Date.now() });
    console.log(`[background.js] [checkURL] Cached result for ${url}:`, finalResult);

    chrome.storage.local.set({
      stats: {
        linksChecked: (await chrome.storage.local.get('stats')).stats?.linksChecked + 1 || 1,
        threatsBlocked: (await chrome.storage.local.get('stats')).stats?.threatsBlocked + (finalResult.isPhishing ? 1 : 0) || (finalResult.isPhishing ? 1 : 0),
        cacheSize: cache.size
      }
    });

    return finalResult;
  } catch (error) {
    console.error(`[background.js] Error checking URL ${url}:`, error);
    return {
      isPhishing: false,
      isSuspicious: true,
      details: 'Suspicious: Unable to verify due to rate limit or network error'
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'checkURL') {
    checkURL(message.url).then(result => sendResponse(result));
    return true;
  } else if (message.type === 'updateStats') {
    chrome.storage.local.get(['stats'], data => {
      const stats = data.stats || { linksChecked: 0, threatsBlocked: 0, cacheSize: 0 };
      stats.linksChecked += message.linksChecked || 0;
      stats.threatsBlocked += message.threatsBlocked || 0;
      stats.cacheSize = cache.size;
      chrome.storage.local.set({ stats }, () => {
        chrome.runtime.sendMessage({ type: 'updateStats', ...message, cacheSize: stats.cacheSize });
      });
    });
  } else if (message.type === 'showWarning') {
    chrome.storage.local.get(['enableNotifications'], (data) => {
      if (data.enableNotifications !== false) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Phishing Warning',
          message: `The URL ${message.url} is a known phishing link.\nDetails: ${message.details}`,
          priority: 2
        });
      }
    });
  } else if (message.type === 'reportFalseNegative') {
    chrome.storage.local.get(['userReports'], (data) => {
      const reports = data.userReports || [];
      reports.push({ url: message.url, timestamp: Date.now() });
      chrome.storage.local.set({ userReports: reports }, () => {
        sendResponse({ status: 'Reported successfully' });
      });
    });
    return true;
  } else if (message.type === 'addToBlacklist') {
    try {
      const url = message.url;
      const normalizedDomain = normalizeUrl(url, true);
      if (!normalizedDomain) {
        sendResponse({ error: 'Invalid URL' });
        return true;
      }
      const domain = normalizedDomain.replace(/^https?:\/\//, '');
      if (localBlacklist.includes(domain)) {
        sendResponse({ error: 'URL already in blacklist' });
        return true;
      }
      if (localBlacklist.length >= MAX_BLACKLIST_SIZE) {
        sendResponse({ error: 'Blacklist is full' });
        return true;
      }
      localBlacklist.push(domain);
      // Clear cache for the URL and any related entries
      for (const [cachedUrl] of cache) {
        if (cachedUrl.includes(domain)) {
          cache.delete(cachedUrl);
        }
      }
      console.log(`[background.js] Cleared cache entries for domain ${domain}`);
      chrome.storage.local.set({ localBlacklist }, () => {
        console.log(`[background.js] Added ${domain} to blacklist. Current blacklist:`, localBlacklist);
        sendResponse({ status: 'Added to blacklist' });
      });
      return true;
    } catch (error) {
      console.error('[background.js] Error adding to blacklist:', error);
      sendResponse({ error: 'Failed to add to blacklist' });
      return true;
    }
  } else if (message.type === 'rescan') {
    console.log('[background.js] Rescan requested');
    cache.clear();
    sendResponse({ status: 'Rescan completed' });
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    stats: { linksChecked: 0, threatsBlocked: 0, cacheSize: 0 },
    enableNotifications: true,
    checkFrequency: 60,
    userReports: [],
    localBlacklist: ['brt-it.cam'] // Initialize with default blacklist
  });
  await loadBlacklist();
});

// Load blacklist on startup
loadBlacklist();