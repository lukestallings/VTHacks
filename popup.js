document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  if (!analyzeBtn) return;

  analyzeBtn.addEventListener('click', async () => {
    const statusEl = document.getElementById('status');
    statusEl.innerText = "Analyzing article content...";

    // 1. Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      statusEl.innerText = "Error: Cannot access tab.";
      return;
    }

    // Prevent running on internal browser pages
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) {
      statusEl.innerText = "Navigate to an actual article website first!";
      return;
    }

    try {
      // 2. Inject and execute the scraper function directly
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePageDirectly
      });

      if (!results || !results[0] || !results[0].result || !results[0].result.bodyText) {
        statusEl.innerText = "No article text detected on this page.";
        return;
      }

      evaluateSignals(results[0].result);
      statusEl.innerText = "Analysis complete.";
    } catch (err) {
      console.error(err);
      statusEl.innerText = "Error scanning page. Reload tab and retry.";
    }
  });
});

// Runs inside the webpage context
function scrapePageDirectly() {
  const headline = document.querySelector('h1')?.innerText || document.title || "";
  
  const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 20);

  const fullText = paragraphs.join(" ");

  const links = Array.from(document.querySelectorAll('article a, main a, p a'))
    .map(a => a.href)
    .filter(href => href && href.startsWith('http'));

  return {
    url: window.location.href,
    isHttps: window.location.protocol === 'https:',
    headline: headline,
    bodyText: fullText,
    linkCount: links.length
  };
}

function evaluateSignals(data) {
  const text = data.bodyText;
  const headline = data.headline;

  // 1. Sensational buzzwords check
  const sensationalWordList = [
    'shocking', 'unbelievable', 'you won\'t believe', 'secret they don\'t want',
    'mind-blowing', 'exposed', 'conspiracy', 'miracle cure', 'urgent alert',
    'banned', 'they don\'t want you to know'
  ];
  let sensationalHits = 0;
  sensationalWordList.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    const matches = (headline + " " + text).match(regex);
    if (matches) sensationalHits += matches.length;
  });

  // 2. ALL CAPS ratio
  const lettersOnly = text.replace(/[^a-zA-Z]/g, '');
  const upperCaseOnly = lettersOnly.replace(/[^A-Z]/g, '');
  const capsPercent = lettersOnly.length > 0 ? (upperCaseOnly.length / lettersOnly.length) * 100 : 0;

  // 3. Link/Citation count
  const citations = data.linkCount;

  // 4. Calculate starter score (0-100)
  let score = 85;
  score -= Math.min(sensationalHits * 8, 30);
  if (capsPercent > 12) score -= 15;
  if (!data.isHttps) score -= 20;
  if (citations >= 3) score += 10;
  if (citations === 0) score -= 15;

  score = Math.max(5, Math.min(100, Math.round(score)));

  // Update UI elements
  const scoreBox = document.getElementById('scoreBox');
  const riskBadge = document.getElementById('riskBadge');

  scoreBox.innerText = `${score}/100`;

  if (score >= 70) {
    scoreBox.style.color = "#15803d";
    riskBadge.innerText = "Low Risk";
    riskBadge.className = "status-pill pill-good";
  } else if (score >= 45) {
    scoreBox.style.color = "#a16207";
    riskBadge.innerText = "Moderate";
    riskBadge.className = "status-pill pill-warn";
  } else {
    scoreBox.style.color = "#dc2626";
    riskBadge.innerText = "High Risk";
    riskBadge.className = "status-pill pill-bad";
  }

  document.getElementById('sensationalCount').innerText = `${sensationalHits} flagged`;
  document.getElementById('capsRatio').innerText = `${capsPercent.toFixed(1)}%`;
  document.getElementById('citationCount').innerText = `${citations} links`;
  document.getElementById('securityStatus').innerText = data.isHttps ? "HTTPS" : "Insecure (HTTP)";
}
