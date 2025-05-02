// background.js - PhishTank API Integration with Stats Tracking
const PHISHTANK_API_URL = 'https://checkurl.phishtank.com/checkurl/';
const PHISHTANK_API_KEY = 'YOUR_API_KEY'; // Register at phishtank.com to get one

// Cache to avoid duplicate API calls
const urlCache = new Map();

// Stats tracking
let stats = {
  linksChecked: 0,
  threatsBlocked: 0
};

// Load saved stats on startup
chrome.storage.sync.get(['stats'], (data) => {
  if (data.stats) {
    stats = data.stats;
  }
});

// Save stats periodically
setInterval(() => {
  chrome.storage.sync.set({ stats });
}, 10000);

async function checkPhishTank(url) {
  // Check cache first
  if (urlCache.has(url)) {
    return urlCache.get(url);
  }

  // Prepare API request
  const formData = new FormData();
  formData.append('url', url);
  formData.append('format', 'json');
  formData.append('app_key', PHISHTANK_API_KEY);

  try {
    const response = await fetch(PHISHTANK_API_URL, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const isPhishing = data.results?.in_database || false;
    
    // Cache result for 5 minutes
    urlCache.set(url, isPhishing);
    setTimeout(() => urlCache.delete(url), 300000);

    return isPhishing;
  } catch (error) {
    console.error('PhishTank check failed:', error);
    return false; // Fail safe
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'CHECK_URL') {
    stats.linksChecked++;
    
    // Process the URL check asynchronously
    checkPhishTank(request.url)
      .then(isPhishing => {
        if (isPhishing) {
          stats.threatsBlocked++;
          // Notify popup of update
          chrome.runtime.sendMessage({
            type: 'UPDATE_STATS',
            linksChecked: stats.linksChecked,
            threatsBlocked: stats.threatsBlocked
          });
        }
        sendResponse({ isPhishing });
      })
      .catch(error => {
        console.error('URL check error:', error);
        sendResponse({ isPhishing: false });
      });
    
    return true;
  }

  if (request.type === 'GET_STATS') {
    sendResponse(stats);
    return true;
  }
});

// Clear cache when extension starts
chrome.runtime.onStartup.addListener(() => {
  urlCache.clear();
});