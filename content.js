const linkCache = new Map();
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 2000;
let observer = null;
const linksWithListeners = new Set();
let contextInvalidated = false;
let messageListener = null;

function isContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id && !chrome.runtime.lastError && !contextInvalidated;
  } catch {
    return false;
  }
}

function showLinkTooltip(link, status, details) {
  console.log(`[content.js] Creating tooltip for link: ${link.href}, Status: ${status}, Details: ${details}`);
  let tooltip = link.querySelector('.quickphish-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'quickphish-tooltip';
    link.style.position = 'relative';
    link.appendChild(tooltip);
  }

  tooltip.classList.add('visible');
  tooltip.innerHTML = `
    <span class="quickphish-status" style="color:${status === 'Unsafe' ? 'var(--danger)' : status === 'Safe' ? 'var(--safe)' : 'var(--text-light)'}">
      ${status}
    </span>
    <small class="quickphish-details">${details}</small>
  `;
}

async function checkLinkProactively(link, isClick = false) {
  if (!isContextValid()) {
    showLinkTooltip(link, 'Safe', 'Extension unavailable');
    console.log(`[content.js] Extension context invalid for ${link.href}`);
    return { isPhishing: false, details: 'Extension unavailable' };
  }

  const url = link.href;
  // Skip Gmail internal navigation links
  if (url.includes('mail.google.com') && url.includes('#')) {
    showLinkTooltip(link, 'Safe', 'Internal Gmail link');
    console.log(`[content.js] Skipping Gmail internal link: ${url}`);
    return { isPhishing: false, details: 'Internal Gmail link' };
  }
  if (!url || !url.startsWith('http')) {
    console.log(`[content.js] Invalid URL: ${url}`);
    return { isPhishing: false, details: 'Invalid URL' };
  }

  if (linkCache.has(url) && !isClick) {
    const result = linkCache.get(url);
    showLinkTooltip(link, result.status, result.details);
    console.log(`[content.js] Using cached result for ${url}: ${result.status}`);
    return { isPhishing: result.status === 'Unsafe', details: result.details };
  }

  showLinkTooltip(link, 'Checking...', 'Checking link safety...');
  let attempts = 0;

  return new Promise((resolve) => {
    function attemptCheck() {
      if (!isContextValid()) {
        showLinkTooltip(link, 'Safe', 'Extension unavailable');
        console.log(`[content.js] Extension context invalid during check for ${url}`);
        resolve({ isPhishing: false, details: 'Extension unavailable' });
        return;
      }

      chrome.runtime.sendMessage({ type: 'checkURL', url }, (response) => {
        if (!response || chrome.runtime.lastError || response.error) {
          if (++attempts < RETRY_ATTEMPTS) {
            console.log(`[content.js] Retry ${attempts} for ${url}`);
            return setTimeout(attemptCheck, RETRY_DELAY);
          }
          showLinkTooltip(link, 'Safe', 'Unable to verify; assuming safe.');
          console.log(`[content.js] Failed to verify ${url} after ${RETRY_ATTEMPTS} attempts`);
          resolve({ isPhishing: false, details: 'Unable to verify; assuming safe.' });
          return;
        }

        const result = {
          status: response.isPhishing ? 'Unsafe' : 'Safe',
          details: response.details || 'Link checked.'
        };
        linkCache.set(url, result);
        showLinkTooltip(link, result.status, result.details);
        console.log(`[content.js] Check result for ${url}: ${result.status}, Details: ${result.details}`);

        if (isClick && isContextValid()) {
          chrome.runtime.sendMessage({
            type: 'updateStats',
            linksChecked: 1,
            threatsBlocked: result.status === 'Unsafe' ? 1 : 0,
          });
          if (result.status === 'Unsafe') {
            chrome.runtime.sendMessage({ type: 'showWarning', url, details: result.details });
          }
        }

        resolve({ isPhishing: result.status === 'Unsafe', details: result.details });
      });
    }

    attemptCheck();
  });
}

function attachLinkListeners(link) {
  if (linksWithListeners.has(link)) return;
  console.log(`[content.js] Attaching listeners to: ${link.href}`);
  linksWithListeners.add(link);
  link.classList.add('quickphish-link');

  let checkPromise = null;

  const handleMouseEnter = () => {
    if (!isContextValid()) return;
    console.log(`[content.js] Mouse entered link: ${link.href}`);
    checkPromise = checkLinkProactively(link);
  };

  const handleMouseLeave = () => {
    const tooltip = link.querySelector('.quickphish-tooltip');
    if (tooltip) {
      tooltip.classList.remove('visible');
      setTimeout(() => {
        if (tooltip && !tooltip.classList.contains('visible')) tooltip.remove();
      }, 300);
    }
  };

  const handleClick = async (e) => {
    if (!isContextValid()) {
      console.log(`[content.js] Extension context invalid for click on ${link.href}`);
      return;
    }
    console.log(`[content.js] Click detected on ${link.href}`);
    // Prevent default navigation immediately
    e.preventDefault();
    e.stopPropagation();
    // Temporarily disable href to block navigation
    const originalHref = link.href;
    link.removeAttribute('href');
    try {
      if (checkPromise) {
        await checkPromise;
      }
      const result = await checkLinkProactively(link, true);
      console.log(`[content.js] Click check result for ${link.href}: isPhishing=${result.isPhishing}, Details: ${result.details}`);
      if (result.isPhishing) {
        console.log(`[content.js] Blocked navigation to ${link.href}: ${result.details}`);
        if (isContextValid()) {
          chrome.runtime.sendMessage({ type: 'showWarning', url: originalHref, details: result.details });
        }
        // Fallback to stop navigation
        window.stop();
      } else {
        // Restore href and allow navigation if safe
        link.href = originalHref;
        console.log(`[content.js] Allowing navigation to ${link.href}: ${result.details}`);
        window.location.href = originalHref;
      }
    } catch (error) {
      console.error(`[content.js] Error checking link ${link.href} on click:`, error);
      link.href = originalHref; // Restore href on error
    }
  };

  link.addEventListener('mouseenter', handleMouseEnter);
  link.addEventListener('mouseleave', handleMouseLeave);
  link.addEventListener('click', handleClick);

  // Store listeners for cleanup
  link._quickphishListeners = { handleMouseEnter, handleMouseLeave, handleClick };
}

function setupLinkListeners() {
  if (!isContextValid()) return;
  document.querySelectorAll('a[href]').forEach(attachLinkListeners);
}

function cleanup() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  linksWithListeners.forEach((link) => {
    if (link._quickphishListeners) {
      const { handleMouseEnter, handleMouseLeave, handleClick } = link._quickphishListeners;
      link.removeEventListener('mouseenter', handleMouseEnter);
      link.removeEventListener('mouseleave', handleMouseLeave);
      link.removeEventListener('click', handleClick);
      delete link._quickphishListeners;
    }
  });
  linksWithListeners.clear();
  linkCache.clear();

  if (messageListener && isContextValid()) {
    chrome.runtime.onMessage.removeListener(messageListener);
    messageListener = null;
  }

  window.removeEventListener('quickphishRescan', handleRescan);
  window.removeEventListener('beforeunload', cleanup);
}

function handleRescan() {
  if (!isContextValid()) return;
  linkCache.clear();
  setupLinkListeners();
}

function initialize() {
  console.log(`[content.js] Initializing content script on: ${window.location.href}`);
  if (isContextValid()) {
    console.log(`[content.js] Extension context valid, setting up listeners`);
    setupLinkListeners();

    observer = new MutationObserver((mutations) => {
      console.log(`[content.js] DOM mutation detected:`, mutations);
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const anchors = node.matches?.('a[href]')
              ? [node]
              : Array.from(node.querySelectorAll?.('a[href]') || []);
            anchors.forEach(attachLinkListeners);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    messageListener = (message, sender, sendResponse) => {
      if (message.type === 'rescan') {
        console.log('[content.js] Rescan triggered');
        linkCache.clear();
        setupLinkListeners();
        sendResponse({ status: 'Rescan completed' });
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);

    window.addEventListener('quickphishRescan', handleRescan);
    window.addEventListener('beforeunload', cleanup);

    chrome.runtime.onConnect.addListener((port) => {
      port.onDisconnect.addListener(cleanup);
    });
  } else {
    console.warn(`[content.js] Extension context invalid, retrying in 1s`);
    setTimeout(initialize, 1000);
  }
}

initialize();