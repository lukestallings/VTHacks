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
    "you won't believe", "they don't want you to know", "furious",
    "meltdown", "destroys", "slams", "outrage", "panic", "disaster",
    "urgent warning", "breaking alert", "censored"
  ];

  if (!analyzeBtn) return;

  analyzeBtn.addEventListener('click', async () => {
    analyzeBtn.disabled = true;
    analyzeBtn.innerText = "Analyzing...";
    highlightBtn.disabled = true;
    if (statusEl) statusEl.innerText = "Scanning content, metadata, and domain signals...";

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
      const evaluation = computeEvaluation(pageData, SENSATIONAL_WORDS);
      detectedKeywords = evaluation.matchedWords;

      renderScore(evaluation);
      renderBreakdown(evaluation.breakdown);

      highlightBtn.disabled = detectedKeywords.length === 0;
      if (statusEl) {
        statusEl.innerText = detectedKeywords.length > 0 
          ? `Analysis complete. Found ${detectedKeywords.length} flagged terms.` 
          : "Analysis complete. Signals evaluated.";
      }

    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.innerText = "Error scanning tab. Refresh and retry.";
    } finally {
      resetButtons();
    }
  });

  highlightBtn.addEventListener('click', async () => {
    if (!currentTabId || detectedKeywords.length === 0) return;

    try {
      await chrome.tabs.sendMessage(currentTabId, {
        action: "HIGHLIGHT_WORDS",
        words: detectedKeywords
      });
      if (statusEl) statusEl.innerText = "Flagged words highlighted on page!";
    } catch (e) {
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

// Runs in the webpage context
function scrapePageDirectly() {
  const headline = document.querySelector('h1')?.innerText?.trim() || document.title || "";
  
  const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 30 && !text.includes("©") && !text.includes("cookie"));
  
  const bodyText = paragraphs.join(' ');
  const quotesCount = (bodyText.match(/"([^"]{10,})"/g) || []).length;

  const hasByline = !!(
    document.querySelector('[rel="author"]') ||
    document.querySelector('meta[name="author"]') ||
    document.querySelector('.byline, .author, [itemprop="author"]')
  );

  const currentHost = window.location.hostname;
  const externalLinks = Array.from(document.querySelectorAll('article p a, main p a'))
    .map(a => a.href)
    .filter(href => {
      try {
        const parsed = new URL(href);
        return parsed.protocol.startsWith('http') && parsed.hostname !== currentHost;
      } catch (e) {
        return false;
      }
    });

  return {
    hostname: window.location.hostname.toLowerCase(),
    headline: headline,
    bodyText: bodyText,
    isHttps: window.location.protocol === 'https:',
    externalLinksCount: externalLinks.length,
    quotesCount: quotesCount,
    hasByline: hasByline
  };
}

// Logic engine
function computeEvaluation(data, sensationalWords) {
  let score = 70;
  const breakdown = [{ label: "Baseline Score", delta: 70 }];

  // 1. Domain Check
  const TRUSTED_DOMAINS = [
    "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "npr.org", 
    "pbs.org", "wsj.com", "nature.com", "theguardian.com", "nytimes.com", "washingtonpost.com"
  ];
  const SUSPICIOUS_TLDS = [".xyz", ".top", ".info", ".buzz", ".click", ".news"];

  const isTrusted = TRUSTED_DOMAINS.some(domain => data.hostname.includes(domain));
  const hasSuspiciousTLD = SUSPICIOUS_TLDS.some(tld => data.hostname.endsWith(tld));

  if (isTrusted) {
    score += 15;
    breakdown.push({ label: "Recognized news organization", delta: 15 });
  } else if (hasSuspiciousTLD) {
    score -= 20;
    breakdown.push({ label: "High-risk domain extension", delta: -20 });
  }

  // 2. Sensational words with isolated word boundary matching
  const fullText = data.headline + " " + data.bodyText;
  const matchedWords = [];
  sensationalWords.forEach(word => {
    // Escapes special characters and requires boundaries on both ends (\b)
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(fullText)) {
      matchedWords.push(word);
    }
  });

  if (matchedWords.length > 0) {
    const penalty = Math.min(matchedWords.length * 8, 35);
    score -= penalty;
    breakdown.push({ label: `Sensational keywords (${matchedWords.length})`, delta: -penalty });
  } else {
    score += 5;
    breakdown.push({ label: "Objective tone & language", delta: 5 });
  }

  // 3. Headline Caps check
  const lettersOnly = data.headline.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length > 0) {
    const uppercaseLetters = data.headline.replace(/[^A-Z]/g, '').length;
    const capsPercent = (uppercaseLetters / lettersOnly.length) * 100;
    if (capsPercent > 35) {
      score -= 15;
      breakdown.push({ label: "Excessive headline capitalization", delta: -15 });
    }
  }

  // 4. Byline check
  if (data.hasByline) {
    score += 10;
    breakdown.push({ label: "Verified journalist/author byline", delta: 10 });
  } else {
    score -= 10;
    breakdown.push({ label: "Anonymous or missing author byline", delta: -10 });
  }

  // 5. Direct quotes check
  if (data.quotesCount >= 3) {
    score += 10;
    breakdown.push({ label: `Direct quotes found (${data.quotesCount})`, delta: 10 });
  } else if (data.quotesCount === 0) {
    score -= 10;
    breakdown.push({ label: "No direct quotes or primary sources", delta: -10 });
  }

  // 6. External citation links
  if (data.externalLinksCount >= 2) {
    score += 5;
    breakdown.push({ label: "Cites external sources/links", delta: 5 });
  } else if (data.externalLinksCount === 0) {
    score -= 10;
    breakdown.push({ label: "No outbound source references", delta: -10 });
  }

  // 7. HTTPS
  if (!data.isHttps) {
    score -= 25;
    breakdown.push({ label: "Insecure protocol (HTTP)", delta: -25 });
  }

  const finalScore = Math.max(5, Math.min(99, score));
  return { finalScore, breakdown, matchedWords };
}
