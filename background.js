// background.js - PhishTank API Integration
const PHISHTANK_API_URL = 'https://checkurl.phishtank.com/checkurl/';
const PHISHTANK_API_KEY = 'YOUR_API_KEY'; // Register at phishtank.com to get one

// Cache to avoid duplicate API calls
const urlCache = new Map();

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
    // Process the URL check asynchronously
    checkPhishTank(request.url)
      .then(isPhishing => sendResponse({ isPhishing }))
      .catch(error => {
        console.error('URL check error:', error);
        sendResponse({ isPhishing: false });
      });
    
    // Required for async response
    return true;
  }
});

// Optional: Clear cache when extension starts
chrome.runtime.onStartup.addListener(() => {
  urlCache.clear();
});
