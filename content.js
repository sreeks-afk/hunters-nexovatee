// content.js - Final Version
const TRUSTED_DOMAINS = [
  'google.com', 
  'microsoft.com',
  'outlook.com',
  'gmail.com'
];

// Check if element is in email body (Gmail/Outlook compatible)
function isInEmailBody(element) {
  if (!element) return false;
  
  // Gmail
  if (window.location.host.includes('mail.google')) {
    return !!element.closest('[role="article"]');
  }
  // Outlook
  if (window.location.host.includes('outlook')) {
    return !!element.closest('.allowTextSelection, .elementToProof');
  }
  return false;
}

// Show warning modal with enhanced UX
function showWarningModal(url) {
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div class="quickphish-modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:9999;display:flex;justify-content:center;align-items:center;">
      <div style="background:white;padding:20px;border-radius:8px;max-width:400px;width:90%;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
        <h2 style="color:#d33;margin-top:0;">⚠ Phishing Warning</h2>
        <p>This link may steal your credentials:</p>
        <div style="background:#f5f5f5;padding:8px;border-radius:4px;margin:10px 0;word-break:break-all;font-size:13px;">
          ${url}
        </div>
        <div style="display:flex;gap:10px;margin-top:20px;">
          <button id="quickphish-cancel" style="flex:1;padding:10px;background:#2b73b7;color:white;border:none;border-radius:4px;cursor:pointer;">
            Stay Safe
          </button>
          <button id="quickphish-proceed" style="flex:1;padding:10px;background:#d33;color:white;border:none;border-radius:4px;cursor:pointer;">
            Proceed Anyway
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.focus();

  // Handle button clicks
  modal.querySelector('#quickphish-proceed').addEventListener('click', () => {
    document.body.removeChild(modal);
    window.open(url, '_blank');
  });

  modal.querySelector('#quickphish-cancel').addEventListener('click', () => {
    document.body.removeChild(modal);
  });

  // Close on ESC key
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.body.removeChild(modal);
  });
}

// Main click handler
document.addEventListener('click', async (event) => {
  let target = event.target;
  
  // Find nearest anchor tag
  while (target && target.tagName !== 'A') {
    target = target.parentElement;
    if (!target) return;
  }

  const url = target?.href;
  if (!url || !isInEmailBody(target)) return;

  // Skip trusted domains
  if (TRUSTED_DOMAINS.some(domain => new URL(url).hostname.includes(domain))) {
    return;
  }

  // Prevent default and show loading state
  event.preventDefault();
  event.stopImmediatePropagation();
  const originalText = target.innerText;
  target.style.pointerEvents = 'none';
  target.innerText = 'Checking safety...';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CHECK_URL',
      url: url
    });

    if (response?.isPhishing) {
      showWarningModal(url);
    } else {
      window.open(url, '_blank');
    }
  } catch (error) {
    console.warn('QuickPhish: Safety check failed', error);
    window.open(url, '_blank'); // Fail open
  } finally {
    target.innerText = originalText;
    target.style.pointerEvents = 'auto';
  }
});
