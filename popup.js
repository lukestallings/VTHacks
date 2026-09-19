document.addEventListener('DOMContentLoaded', () => {
  const headlineEl = document.getElementById('headline');
  const riskBadge = document.getElementById('riskBadge');
  const scoreVal = document.getElementById('scoreVal');
  const scoreBar = document.getElementById('scoreBar');
  const domainList = document.getElementById('domainSignals');
  const contentList = document.getElementById('contentSignals');
  const highlightBtn = document.getElementById('highlightBtn');
  const reanalyzeBtn = document.getElementById('reanalyzeBtn');

  let activeTabId = null;
  let flaggedWords = [];

  const SENSATIONAL_WORDS = [
    "shocking", "unbelievable", "mind-blowing", "miracle", "secret",
    "exposed", "horrifying", "bombshell", "conspiracy", "scandal",
    "you won't believe", "they don't want you to know", "furious",
    "meltdown", "destroys", "slams", "outrage", "panic", "disaster",
    "urgent warning", "breaking alert", "censored"
  ];

  async function runScan() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id) {
      if (headlineEl) headlineEl.innerText = "No active tab found";
      return;
    }
    activeTabId = tab.id;

    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
      headlineEl.innerText = "System Page";
      riskBadge.innerText = "N/A";
      riskBadge.className = "status-badge badge-warn";
      scoreVal.innerText = "--/100";
      domainList.innerHTML = `<li class="signal-item"><span class="signal-icon">ℹ️</span><span>Cannot evaluate browser internal tabs.</span></li>`;
      contentList.innerHTML = `<li class="signal-item"><span class="signal-icon">ℹ️</span><span>Open a live website or article.</span></li>`;
      return;
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePageData
      });

      if (!results || !results[0] || !results[0].result) {
        headlineEl.innerText = "Cannot Read Content";
        return;
      }

      const data = results[0].result;
      const evaluation = evaluateContent(data, SENSATIONAL_WORDS);
      flaggedWords = evaluation.matchedWords;

      // Update Headline
      if (data.headline && data.headline.length > 0) {
        headlineEl.innerText = data.headline.length > 32 
          ? data.headline.substring(0, 32) + "..." 
          : data.headline;
      } else {
        headlineEl.innerText = "Page Analyzed";
      }

      // Update Score & Bar
      scoreVal.innerText = `${evaluation.finalScore}/100`;
      scoreBar.style.width = `${evaluation.finalScore}%`;

      // Update Badge and colors
      if (evaluation.finalScore >= 75) {
        riskBadge.innerText = "LOW RISK";
        riskBadge.className = "status-badge badge-good";
        scoreBar.style.backgroundColor = "#16a34a";
      } else if (evaluation.finalScore >= 50) {
        riskBadge.innerText = "MODERATE";
        riskBadge.className = "status-badge badge-warn";
        scoreBar.style.backgroundColor = "#d97706";
      } else {
        riskBadge.innerText = "HIGH RISK";
        riskBadge.className = "status-badge badge-bad";
        scoreBar.style.backgroundColor = "#dc2626";
      }

      // Render Dynamic Domain Signals
      domainList.innerHTML = evaluation.domainSignals.map(s => `
        <li class="signal-item">
          <span class="signal-icon">${s.icon}</span>
          <span>${s.text}</span>
        </li>
      `).join('');

      // Render Dynamic Content Signals
      contentList.innerHTML = evaluation.contentSignals.map(s => `
        <li class="signal-item">
          <span class="signal-icon">${s.icon}</span>
          <span>${s.text}</span>
        </li>
      `).join('');

    } catch (err) {
      console.error(err);
      headlineEl.innerText = "Scan Failed";
    }
  }

  // Highlight Button Event
  highlightBtn.addEventListener('click', async () => {
    if (!activeTabId || flaggedWords.length === 0) return;
    try {
      await chrome.tabs.sendMessage(activeTabId, {
        action: "HIGHLIGHT_WORDS",
        words: flaggedWords
      });
    } catch (e) {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ['content.js']
      });
      chrome.tabs.sendMessage(activeTabId, {
        action: "HIGHLIGHT_WORDS",
        words: flaggedWords
      });
    }
  });

  reanalyzeBtn.addEventListener('click', runScan);

  // Run automatically when popup opens
  runScan();
});

function scrapePageData() {
  const headline = document.querySelector('h1')?.innerText?.trim() || document.title || "";
  const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 25 && !text.includes("cookie") && !text.includes("©"));
  const bodyText = paragraphs.join(' ');

  const currentHost = window.location.hostname.toLowerCase();
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

  const quotesCount = (bodyText.match(/"([^"]{10,})"/g) || []).length;
  const hasByline = !!(
    document.querySelector('[rel="author"]') ||
    document.querySelector('meta[name="author"]') ||
    document.querySelector('.byline, .author, [itemprop="author"]')
  );

  return {
    hostname: currentHost,
    headline: headline,
    bodyText: bodyText,
    isHttps: window.location.protocol === 'https:',
    externalLinksCount: externalLinks.length,
    quotesCount: quotesCount,
    hasByline: hasByline
  };
}

function evaluateContent(data, sensationalWords) {
  let score = 70;
  const domainSignals = [];
  const contentSignals = [];

  // 1. Domain Check
  const TRUSTED_DOMAINS = [
    "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "npr.org", 
    "wsj.com", "nytimes.com", "theguardian.com", "wikipedia.org", "nature.com"
  ];
  const SUSPICIOUS_TLDS = [".xyz", ".top", ".info", ".buzz", ".click", ".news"];

  const isTrusted = TRUSTED_DOMAINS.some(domain => data.hostname.includes(domain));
  const hasSuspiciousTLD = SUSPICIOUS_TLDS.some(tld => data.hostname.endsWith(tld));

  if (isTrusted) {
    score += 15;
    domainSignals.push({ icon: "✅", text: "Recognized legitimate news outlet" });
  } else if (hasSuspiciousTLD) {
    score -= 20;
    domainSignals.push({ icon: "⚠️", text: "Domain uses high-risk suspicious TLD" });
  } else {
    domainSignals.push({ icon: "ℹ️", text: `Unverified domain: ${data.hostname}` });
  }

  if (data.isHttps) {
    domainSignals.push({ icon: "🔒", text: "Secure encrypted protocol (HTTPS)" });
  } else {
    score -= 25;
    domainSignals.push({ icon: "⚠️", text: "Insecure protocol connection (HTTP)" });
  }

  // 2. Sensational Words
  const fullText = (data.headline + " " + data.bodyText);
  const matchedWords = [];
  sensationalWords.forEach(word => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(fullText)) {
      matchedWords.push(word);
    }
  });

  if (matchedWords.length > 0) {
    const penalty = Math.min(matchedWords.length * 8, 35);
    score -= penalty;
    contentSignals.push({ icon: "⚠️", text: `Loaded language detected (${matchedWords.length} terms, e.g. "${matchedWords[0]}")` });
  } else {
    score += 5;
    contentSignals.push({ icon: "✅", text: "No sensationalist buzzwords found" });
  }

  // 3. Headline Caps
  const lettersOnly = data.headline.replace(/[^a-zA-Z]/g, '');
  if (lettersOnly.length > 0) {
    const caps = (data.headline.replace(/[^A-Z]/g, '').length / lettersOnly.length) * 100;
    if (caps > 35) {
      score -= 15;
      contentSignals.push({ icon: "⚠️", text: "Excessive capitalization in headline" });
    }
  }

  // 4. Bylines & Quotes
  if (data.hasByline) {
    score += 10;
    contentSignals.push({ icon: "✅", text: "Verified author/reporter byline present" });
  } else {
    score -= 10;
    contentSignals.push({ icon: "⚠️", text: "Anonymous or missing reporter byline" });
  }

  if (data.quotesCount >= 2) {
    score += 10;
    contentSignals.push({ icon: "✅", text: `Direct quotes and statements found (${data.quotesCount})` });
  } else if (data.quotesCount === 0) {
    score -= 10;
    contentSignals.push({ icon: "⚠️", text: "No direct quotes or primary witnesses" });
  }

  const finalScore = Math.max(5, Math.min(99, score));
  return { finalScore, domainSignals, contentSignals, matchedWords };
}
