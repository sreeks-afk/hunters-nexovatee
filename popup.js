document.addEventListener('DOMContentLoaded', () => {
  const refreshBtn = document.getElementById('refresh');
  const settingsBtn = document.getElementById('settings');
  const lastCheckedEl = document.getElementById('last-checked');
  const linksCheckedEl = document.getElementById('links-checked');
  const threatsBlockedEl = document.getElementById('threats-blocked');
  const cacheSizeEl = document.getElementById('cache-size');
  const rateLimitEl = document.getElementById('rate-limit');

  function updateStatsDisplay() {
    chrome.storage.local.get(['stats', 'lastChecked'], (data) => {
      const stats = data.stats || { linksChecked: 0, threatsBlocked: 0, cacheSize: 0 };
      const lastChecked = data.lastChecked || 'Never';

      lastCheckedEl.textContent = `Last checked: ${lastChecked}`;
      linksCheckedEl.textContent = stats.linksChecked || 0;
      threatsBlockedEl.textContent = stats.threatsBlocked || 0;
      cacheSizeEl.textContent = stats.cacheSize || 0;
      rateLimitEl.textContent = '20/min';
    });
  }

  updateStatsDisplay();

  refreshBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) {
        lastCheckedEl.textContent = 'Error: No active tab found';
        return;
      }

      const tab = tabs[0];
      const tabUrl = tab.url || '';

      const urlPatterns = [
        '*://mail.google.com/*',
        '*://outlook.live.com/*'
      ];
      const matchesPattern = urlPatterns.some(pattern => {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(tabUrl);
      });

      if (!matchesPattern) {
        lastCheckedEl.textContent = 'Rescan only supported on Gmail or Outlook';
        return;
      }

      const tabId = tab.id;
      chrome.tabs.sendMessage(tabId, { type: 'rescan' }, (response) => {
        if (chrome.runtime.lastError) {
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
          }, () => {
            if (chrome.runtime.lastError) {
              lastCheckedEl.textContent = 'Error: Unable to rescan';
              console.warn('Failed to inject content.js:', chrome.runtime.lastError.message);
              return;
            }
            chrome.tabs.sendMessage(tabId, { type: 'rescan' }, (retryResponse) => {
              if (chrome.runtime.lastError) {
                lastCheckedEl.textContent = 'Error: Unable to rescan';
                console.warn('Rescan message failed:', chrome.runtime.lastError.message);
                return;
              }
              if (retryResponse && retryResponse.status === 'Rescan completed') {
                lastCheckedEl.textContent = `Last checked: ${new Date().toLocaleTimeString()}`;
                chrome.storage.local.set({ lastChecked: new Date().toLocaleTimeString() });
                updateStatsDisplay();
              } else {
                lastCheckedEl.textContent = 'Error: Rescan failed';
              }
            });
          });
          return;
        }

        if (response && response.status === 'Rescan completed') {
          lastCheckedEl.textContent = `Last checked: ${new Date().toLocaleTimeString()}`;
          chrome.storage.local.set({ lastChecked: new Date().toLocaleTimeString() });
          updateStatsDisplay();
        } else {
          lastCheckedEl.textContent = 'Error: Rescan failed';
        }
      });
    });
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'updateStats') {
      chrome.storage.local.get(['stats'], (data) => {
        const stats = data.stats || { linksChecked: 0, threatsBlocked: 0, cacheSize: 0 };
        stats.linksChecked += message.linksChecked || 0;
        stats.threatsBlocked += message.threatsBlocked || 0;
        stats.cacheSize = message.cacheSize || stats.cacheSize;
        chrome.storage.local.set({ stats }, () => {
          updateStatsDisplay();
        });
      });
    }
  });
});