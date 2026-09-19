document.addEventListener('DOMContentLoaded', () => {
  const analyzeBtn = document.getElementById('analyzeBtn');
  const highlightBtn = document.getElementById('highlightBtn');
  const statusEl = document.getElementById('status');
  const scoreBox = document.getElementById('scoreBox');
  const riskBadge = document.getElementById('riskBadge');
  const breakdownList = document.getElementById('breakdownList');

  let currentTabId = null;
  let detectedKeywords = [];

  const SENSATIONAL_WORDS = [
    "shocking", "unbelievable", "mind-blowing", "miracle", "secret",
    "exposed", "horrifying", "bombshell", "conspiracy", "scandal",
    "you won't believe", "they don't want you to know"
  ];

  if (!analyzeBtn) return;

  analyzeBtn.addEventListener('click', async () => {
    // 1. Loading UI state
    analyzeBtn.disabled = true;
    analyzeBtn.innerText = "Analyzing...";
    highlightBtn.disabled = true;
    if (statusEl) statusEl.innerText = "Scanning page text and structure...";

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id) {
      if (statusEl) statusEl.innerText = "Cannot find active tab.";
      resetButtons();
      return;
    }
    currentTabId = tab.id;

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://'))) {
      if (statusEl) statusEl.innerText = "Open a live web article first!";
      resetButtons();
      return;
    }

    try {
      // 2. Scrape page
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePageDirectly
      });

      if (!results || !results[0] || !results[0].result || !results[0].result.bodyText) {
        if (statusEl) statusEl.innerText = "No readable article content found.";
        resetButtons();
        return;
      }

      const pageData = results[0].result;

      // 3. Compute score and breakdown
      const evaluation = computeEvaluation(pageData, SENSATIONAL_WORDS);
      detectedKeywords = evaluation.matchedWords;

      // 4. Render UI
      renderScore(evaluation);
      renderBreakdown(evaluation.breakdown);

      highlightBtn.disabled = detectedKeywords.length === 0;
      if (statusEl) {
        statusEl.innerText = detectedKeywords.length > 0 
          ? `Analysis complete. Found ${detectedKeywords.length} flagged terms.` 
          : "Analysis complete. No sensational buzzwords found.";
      }

    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.innerText = "Error scanning tab. Refresh and retry.";
    } finally {
      resetButtons();
    }
  });

  // Highlight button click
  highlightBtn.addEventListener('click', async () => {
    if (!currentTabId || detectedKeywords.length === 0) return;

    try {
      await chrome.tabs.sendMessage(currentTabId, {
        action: "HIGHLIGHT_WORDS",
        words: detectedKeywords
      });
      if (statusEl) statusEl.innerText = "Flagged words highlighted on page!";
    } catch (e) {
      // If content script wasn't injected yet, execute directly
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['content.js']
      });
      chrome.tabs.sendMessage(currentTabId, {
        action: "HIGHLIGHT_WORDS",
        words: detectedKeywords
      });
      if (statusEl) statusEl.innerText = "Flagged words highlighted on page!";
    }
  });

  function resetButtons() {
    analyzeBtn.disabled = false;
    analyzeBtn.innerText = "Analyze Page";
  }

  function renderScore(evaluation) {
    if (scoreBox) {
      scoreBox.innerText = `${evaluation.finalScore}/100`;
      if (evaluation.finalScore >= 75) scoreBox.style.color = "#15803d";
      else if (evaluation.finalScore >= 50) scoreBox.style.color = "#a16207";
      else scoreBox.style.color = "#dc2626";
    }

    if (riskBadge) {
      if (evaluation.finalScore >= 75) {
        riskBadge.innerText = "Low Risk";
        riskBadge.className = "status-pill pill-good";
      } else if (evaluation.finalScore >= 50) {
        riskBadge.innerText = "Moderate";
        riskBadge.className = "status-pill pill-warn";
      } else {
        riskBadge.innerText = "High Risk";
        riskBadge.className = "status-pill pill-bad";
      }
    }
  }

  function renderBreakdown(breakdown) {
    if (!breakdownList) return;
    breakdownList.innerHTML = breakdown.map(item => `
      <li class="breakdown-item">
        <span>${item.label}</span>
        <span class="deduction ${item.delta > 0 ? 'pos' : (item.delta < 0 ? 'neg' : '')}">
          ${item.delta > 0 ? '+' : ''}${item.delta !== 0 ? item.delta : '0'}
        </span>
      </li>
    `).join('');
  }
});

// Scraping logic
function scrapePageDirectly() {
  const headline = document.querySelector('h1')?.innerText?.trim() || document.title || "";
  const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 25);
  const bodyText = paragraphs.join(' ');

  const links = Array.from(document.querySelectorAll('article a, main a, p a'))
    .map(a => a.href)
    .filter(href => href && href.startsWith('http'));

  return {
    headline: headline,
    bodyText: bodyText,
    isHttps: window.location.protocol === 'https:',
    outboundLinks: links
  };
}

// Logic engine
function computeEvaluation(data, sensationalWords) {
  let score = 100;
  const breakdown = [{ label: "Baseline Score", delta: 0 }];

  // 1. Sensational buzzwords
  const fullText = (data.headline + " " + data.bodyText).toLowerCase();
  const matchedWords = [];
  sensationalWords.forEach(word => {
    if (fullText.includes(word)) {
      matchedWords.push(word);
    }
  });

  if (matchedWords.length > 0) {
    const penalty = Math.min(matchedWords.length * 10, 40);
    score -= penalty;
    breakdown.push({ label: `Sensational keywords (${matchedWords.length})`, delta: -penalty });
  } else {
    breakdown.push({ label: "Language objectivity", delta: 0 });
  }

  // 2. Headline Caps check
  const lettersOnly = data.headline.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length > 0) {
    const uppercaseLetters = data.headline.replace(/[^A-Z]/g, '').length;
    const capsPercent = (uppercaseLetters / lettersOnly.length) * 100;
    if (capsPercent > 35) {
      score -= 15;
      breakdown.push({ label: `Aggressive headline capitalization`, delta: -15 });
    }
  }

  // 3. Citations & References
  const linkCount = data.outboundLinks.length;
  if (linkCount === 0) {
    score -= 15;
    breakdown.push({ label: "Zero source citations or links", delta: -15 });
  } else if (linkCount >= 3) {
    score += 5;
    breakdown.push({ label: "Multiple outbound source citations", delta: 5 });
  }

  // 4. HTTPS Security
  if (!data.isHttps) {
    score -= 25;
    breakdown.push({ label: "Insecure protocol (HTTP)", delta: -25 });
  }

  const finalScore = Math.max(5, Math.min(99, score));
  return { finalScore, breakdown, matchedWords };
}
