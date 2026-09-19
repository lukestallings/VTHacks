document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const statusEl = document.getElementById('status');
  const scoreBox = document.getElementById('scoreBox');
  const riskBadge = document.getElementById('riskBadge');

  if (!analyzeBtn) return;

  analyzeBtn.addEventListener('click', async () => {
    // 1. Enter loading state
    analyzeBtn.disabled = true;
    analyzeBtn.innerText = "Analyzing page...";
    if (statusEl) statusEl.innerText = "Scanning headline, language, and citations...";
    if (scoreBox) {
      scoreBox.innerText = "--";
      scoreBox.style.color = "#64748b";
    }
    if (riskBadge) {
      riskBadge.innerText = "Scanning...";
      riskBadge.className = "status-pill pill-warn";
    }

    // 2. Query active tab
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id) {
      if (statusEl) statusEl.innerText = "Error: Cannot access tab.";
      resetButton();
      return;
    }

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      if (statusEl) statusEl.innerText = "Navigate to an actual article website first!";
      resetButton();
      return;
    }

    try {
      // 3. Short artificial delay (1.2 seconds) to display analysis in progress
      await new Promise(resolve => setTimeout(resolve, 1200));

      // 4. Inject DOM scraper
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePageDirectly
      });

      if (!results || !results[0] || !results[0].result || !results[0].result.bodyText) {
        if (statusEl) statusEl.innerText = "No readable article text detected.";
        resetButton();
        return;
      }

      // 5. Score and render results
      evaluateSignals(results[0].result);
      if (statusEl) statusEl.innerText = "Analysis complete.";
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.innerText = "Error scanning page. Reload tab and retry.";
    } finally {
      resetButton();
    }

    function resetButton() {
      analyzeBtn.disabled = false;
      analyzeBtn.innerText = "Analyze Current Page";
    }
  });
});

// Runs directly inside the target web page context
function scrapePageDirectly() {
  const headline = document.querySelector('h1')?.innerText?.trim() || document.title || "";
  const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 25);
  const bodyText = paragraphs.join(' ');

  const links = Array.from(document.querySelectorAll('article a, main a, p a'))
    .map(a => a.href)
    .filter(href => href.startsWith('http'));

  return {
    headline: headline,
    bodyText: bodyText,
    url: window.location.href,
    isHttps: window.location.protocol === 'https:',
    outboundLinks: links
  };
}

// Computes heuristic scores based on content signals
function evaluateSignals(data) {
  let score = 100;

  // 1. Sensational buzzwords check
  const sensationalWords = [
    "shocking", "unbelievable", "mind-blowing", "miracle", "secret",
    "they don't want you to know", "exposed", "horrifying", "you won't believe",
    "bombshell", "conspiracy", "mainstream media won't tell you"
  ];
  const lowerText = (data.headline + " " + data.bodyText).toLowerCase();
  let sensationalHits = 0;
  sensationalWords.forEach(word => {
    if (lowerText.includes(word)) sensationalHits++;
  });
  score -= Math.min(sensationalHits * 12, 36);

  // 2. ALL CAPS ratio check
  const lettersOnly = data.headline.replace(/[^a-zA-Z]/g, '');
  let capsPercent = 0;
  if (lettersOnly.length > 0) {
    const uppercaseLetters = data.headline.replace(/[^A-Z]/g, '').length;
    capsPercent = (uppercaseLetters / lettersOnly.length) * 100;
    if (capsPercent > 35) {
      score -= 20;
    }
  }

  // 3. Outbound citation link check
  const citations = data.outboundLinks.length;
  if (citations === 0) {
    score -= 15;
  } else if (citations >= 3) {
    score += 5;
  }

  // 4. Secure protocol check
  if (!data.isHttps) {
    score -= 25;
  }

  // Clamp score between 10 and 99
  score = Math.max(10, Math.min(99, score));

  // Render to popup UI elements
  const scoreBox = document.getElementById('scoreBox');
  const riskBadge = document.getElementById('riskBadge');

  if (scoreBox) scoreBox.innerText = `${score}/100`;

  if (riskBadge) {
    if (score >= 75) {
      if (scoreBox) scoreBox.style.color = "#15803d";
      riskBadge.innerText = "Low Risk";
      riskBadge.className = "status-pill pill-good";
    } else if (score >= 50) {
      if (scoreBox) scoreBox.style.color = "#a16207";
      riskBadge.innerText = "Moderate";
      riskBadge.className = "status-pill pill-warn";
    } else {
      if (scoreBox) scoreBox.style.color = "#dc2626";
      riskBadge.innerText = "High Risk";
      riskBadge.className = "status-pill pill-bad";
    }
  }

  const sensationalEl = document.getElementById('sensationalCount');
  if (sensationalEl) sensationalEl.innerText = `${sensationalHits} flagged`;

  const capsEl = document.getElementById('capsRatio');
  if (capsEl) capsEl.innerText = `${capsPercent.toFixed(1)}%`;

  const citationEl = document.getElementById('citationCount');
  if (citationEl) citationEl.innerText = `${citations} links`;

  const securityEl = document.getElementById('securityStatus');
  if (securityEl) securityEl.innerText = data.isHttps ? "HTTPS" : "Insecure (HTTP)";
}
