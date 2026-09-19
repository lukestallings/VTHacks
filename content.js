// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "HIGHLIGHT_WORDS" && Array.isArray(request.words)) {
    highlightTerms(request.words);
    sendResponse({ status: "done" });
  }
});

function highlightTerms(words) {
  if (!words || words.length === 0) return;

  // Create a regex matching any of the detected words (case-insensitive)
  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');

  // Find all text elements across the page
  const elements = document.querySelectorAll('h1, h2, h3, p, article');

  elements.forEach(el => {
    // Avoid re-highlighting or messing with input fields / scripts
    if (el.dataset.newsshieldScanned) return;
    el.dataset.newsshieldScanned = "true";

    if (regex.test(el.innerHTML)) {
      el.innerHTML = el.innerHTML.replace(regex, (match) => {
        return `<mark style="background-color: #fef08a; color: #854d0e; font-weight: bold; padding: 2px 4px; border-radius: 3px; border: 1px solid #facc15;" title="Flagged by NewsShield">${match}</mark>`;
      });
    }
  });
}
