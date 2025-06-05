# QuickPhish Extension

QuickPhish is a browser extension designed to detect phishing links in emails on Gmail and Outlook. It checks links in real-time, provides a popup with stats, and allows customization of API settings.

## Features
- Real-time link checking on Gmail and Outlook.
- Popup with protection status and stats (links checked, threats blocked, cache size, rate limit).
- Settings page to configure PhishTank and OpenPhish API keys.
- Warning popup for phishing links.
- Caching to reduce API calls.

## Installation
1. Clone or download this repository.
2. Open Chrome and go to chrome://extensions.
3. Enable "Developer mode" in the top right.
4. Click "Load unpacked" and select the extension folder.
5. The extension should now be loaded and active.

## Usage
- Open Gmail or Outlook in Chrome.
- Hover over links to see their safety status.
- Click the extension icon to view the popup with stats.
- Click "Refresh" to rescan the page.
- Click "Settings" to configure API keys and preferences.

## Files
- manifest.json: Extension manifest.
- background.js: Background service worker for API calls.
- content.js: Content script for link detection.
- content.css: Styles for tooltips.
- popup.html: Popup UI.
- popup.js: Popup logic.
- popup.css: Popup styles.
- options.html: Settings page UI.
- options.js: Settings page logic.
- options.css: Settings page styles.
- warning.html: Warning popup UI.
- icons/: Contains icon files (icon16.png, icon48.png, icon128.png).

## Notes
- Ensure you have valid PhishTank and OpenPhish API keys for better rate limits.
- The extension uses a local cache to minimize API calls.
- Rate limit is set to 20 requests per minute to avoid throttling.

## License
© 2025 QuickPhish. All rights reserved.