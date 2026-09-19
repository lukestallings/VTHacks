document.getElementById('analyzeBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('status');
  statusEl.innerText = "Analyzing article content...";

  // 1. Get current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.id) {
    statusEl.innerText = "Error: Cannot access tab.";
    return;
  }

  // 2. Inject content script if not already injected
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });

  // 3. Ask content script for page data
  chrome.tabs.sendMessage(tab.id, { action: "SCRAPE_PAGE" }, (response) => {
    if (!response || !response.bodyText) {
      statusEl.innerText = "No article text detected on this page.";
      return;
    }

    evaluateSignals(response);
    statusEl.innerText = "Analysis complete.";
  });
});

function evaluateSignals(data) {
  const text = data.bodyText;
  const headline = data.headline;

  // 1. Sensational buzzwords check
  const sensationalWordList = [
    'shocking', 'unbelievable', 'you won\'t believe', 'secret they don\'t want',
    'mind-blowing', 'exposed', 'conspiracy', 'miracle cure', 'urgent alert'
  ];
  let sensationalHits = 0;
  sensationalWordList.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = (headline + " " + text).match(regex);
    if (matches) sensationalHits += matches.length;
  });

  // 2. ALL CAPS ratio check
  const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
  const upperCaseOnly = lettersOnly.replace(/[^A-Z]/g, '');
  const capsPercent = lettersOnly.length > 0 ? (upperCaseOnly.length / lettersOnly.length) * 100 : 0;

  // 3. Link/Citation count
  const citations = data.linkCount;

  // 4. Calculate a starter Credibility Score (0 to 100)
  let score = 85; // Base default

  // Deductions
  score -= Math.min(sensationalHits * 8, 30);
  if (capsPercent > 12) score -= 15;
  if (!data.isHttps) score -= 20;

  // Boost for citations
  if (citations >= 3) score += 10;
  if (citations === 0) score -= 15;

  score = Math.max(5, Math.min(100, Math.round(score)));

  // Update UI elements
  const scoreBox = document.getElementById('scoreBox');
  scoreBox.innerText = `${score}/100`;
  scoreBox.className = "score-badge " + (score >= 70 ? 'score-good' : score >= 45 ? 'score-warn' : 'score-bad');

  document.getElementById('sensationalCount').innerText = `${sensationalHits} flagged`;
  document.getElementById('capsRatio').innerText = `${capsPercent.toFixed(1)}%`;
  document.getElementById('citationCount').innerText = `${citations} links`;
  document.getElementById('securityStatus').innerText = data.isHttps ? "HTTPS (Secure)" : "HTTP (Insecure)";
}