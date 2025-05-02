// options.js - Handles settings management
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const saveBtn = document.getElementById('saveBtn');
  const statusMsg = document.getElementById('statusMsg');
  
  // Load saved settings
  chrome.storage.sync.get([
    'enableGmail',
    'enableOutlook',
    'apiKey',
    'whitelist'
  ], (settings) => {
    document.getElementById('enableGmail').checked = settings.enableGmail !== false;
    document.getElementById('enableOutlook').checked = settings.enableOutlook !== false;
    document.getElementById('apiKey').value = settings.apiKey || '';
    document.getElementById('whitelist').value = settings.whitelist || '';
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const newSettings = {
      enableGmail: document.getElementById('enableGmail').checked,
      enableOutlook: document.getElementById('enableOutlook').checked,
      apiKey: document.getElementById('apiKey').value.trim(),
      whitelist: document.getElementById('whitelist').value
        .split(',')
        .map(domain => domain.trim())
        .filter(domain => domain)
        .join(',')
    };

    chrome.storage.sync.set(newSettings, () => {
      statusMsg.textContent = 'Settings saved!';
      setTimeout(() => statusMsg.textContent = '', 2000);
      
      // Notify other parts of the extension
      chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
    });
  });
});