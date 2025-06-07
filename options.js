document.addEventListener('DOMContentLoaded', () => {
  const settingsForm = document.getElementById('settings-form');
  const reportForm = document.getElementById('report-form');
  const status = document.getElementById('status');
  const reportStatus = document.getElementById('report-status');

  // Check if critical elements exist
  if (!settingsForm || !reportForm || !status || !reportStatus) {
    console.error('[options.js] Missing DOM elements:', {
      settingsForm: !!settingsForm,
      reportForm: !!reportForm,
      status: !!status,
      reportStatus: !!reportStatus
    });
    return;
  }

  // Load saved settings
  chrome.storage.local.get(
    ['phishTankApiKey', 'openPhishApiKey', 'googleApiKey', 'virusTotalApiKey'],
    (data) => {
      const inputs = {
        'phishtank-key': data.phishTankApiKey || '',
        'openphish-key': data.openPhishApiKey || '',
        'google-key': data.googleApiKey || '',
        'virustotal-key': data.virusTotalApiKey || ''
      };
      for (const [id, value] of Object.entries(inputs)) {
        const input = document.getElementById(id);
        if (input) {
          input.value = value;
        } else {
          console.error(`[options.js] Input element #${id} not found`);
        }
      }
    }
  );

  // Save settings
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const phishTankApiKey = document.getElementById('phishtank-key')?.value || '';
    const openPhishApiKey = document.getElementById('openphish-key')?.value || '';
    const googleApiKey = document.getElementById('google-key')?.value || '';
    const virusTotalApiKey = document.getElementById('virustotal-key')?.value || '';

    chrome.storage.local.set(
      { phishTankApiKey, openPhishApiKey, googleApiKey, virusTotalApiKey },
      () => {
        status.textContent = 'Settings saved!';
        status.className = 'status success';
        setTimeout(() => {
          status.textContent = '';
          status.className = 'status';
        }, 2000);
      }
    );
  });

  // Report false negative
  reportForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const urlInput = document.getElementById('report-url');
    if (!urlInput) {
      console.error('[options.js] Report URL input not found');
      reportStatus.textContent = 'Error: Form is incomplete.';
      reportStatus.className = 'status error';
      return;
    }
    const url = urlInput.value.trim();

    if (!url) {
      reportStatus.textContent = 'Please enter a URL.';
      reportStatus.className = 'status error';
      return;
    }

    // Basic URL validation
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid protocol');
      }

      // Send message to add URL to blacklist and log the report
      chrome.runtime.sendMessage(
        { type: 'addToBlacklist', url },
        (response) => {
          if (response && response.status === 'Added to blacklist') {
            reportStatus.textContent = 'URL added to blacklist and will be blocked.';
            reportStatus.className = 'status success';
            urlInput.value = '';
            // Trigger rescan to update content script
            chrome.runtime.sendMessage({ type: 'rescan' }, (rescanResponse) => {
              console.log(`[options.js] Rescan triggered:`, rescanResponse);
            });
          } else {
            reportStatus.textContent = response?.error || 'Failed to add URL to blacklist.';
            reportStatus.className = 'status error';
          }
          setTimeout(() => {
            reportStatus.textContent = '';
            reportStatus.className = 'status';
          }, 3000);
        }
      );

      // Also log the false negative report for user tracking
      chrome.runtime.sendMessage(
        { type: 'reportFalseNegative', url },
        (response) => {
          if (response && response.status === 'Reported successfully') {
            console.log(`[options.js] False negative reported: ${url}`);
          }
        }
      );
    } catch (error) {
      console.error('[options.js] Invalid URL:', error);
      reportStatus.textContent = 'Invalid URL. Please enter a valid HTTP/HTTPS URL.';
      reportStatus.className = 'status error';
      setTimeout(() => {
        reportStatus.textContent = '';
        reportStatus.className = 'status';
      }, 3000);
    }
  });
});