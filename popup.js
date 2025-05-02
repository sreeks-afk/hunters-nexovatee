// popup.js - Controls the extension popup UI with proper stats tracking
let isActive = true;
let linksChecked = 0;
let threatsBlocked = 0;

// DOM Elements
const statusDiv = document.getElementById('status');
const toggleBtn = document.getElementById('toggleProtection');
const optionsBtn = document.getElementById('openOptions');
const linksSpan = document.getElementById('linksChecked');
const threatsSpan = document.getElementById('threatsBlocked');

// Load saved state
chrome.storage.sync.get(['isActive', 'stats'], (data) => {
  isActive = data.isActive !== undefined ? data.isActive : true;
  linksChecked = data.stats?.linksChecked || 0;
  threatsBlocked = data.stats?.threatsBlocked || 0;
  
  updateUI();
});

// Toggle protection
toggleBtn.addEventListener('click', () => {
  isActive = !isActive;
  chrome.storage.sync.set({ isActive }, () => {
    updateUI();
    // Send message to content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'TOGGLE_PROTECTION',
          isActive
        });
      }
    });
  });
});

// Open options
optionsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Listen for stats updates from background
chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'UPDATE_STATS') {
    linksChecked = request.linksChecked;
    threatsBlocked = request.threatsBlocked;
    updateUI();
  }
});

// Update popup UI
function updateUI() {
  statusDiv.className = isActive ? 'status active' : 'status inactive';
  statusDiv.textContent = `Protection: ${isActive ? 'ACTIVE' : 'INACTIVE'}`;
  toggleBtn.textContent = isActive ? 'Disable Protection' : 'Enable Protection';
  linksSpan.textContent = linksChecked;
  threatsSpan.textContent = threatsBlocked;
}

// Request current stats when popup opens
chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
  if (response) {
    linksChecked = response.linksChecked;
    threatsBlocked = response.threatsBlocked;
    updateUI();
  }
});