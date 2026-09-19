JavaScript
/**
 * NewsShield - In-Page Content Highlighter (DOM Injection)
 * Finds sensationalist terms and vague attributions within the article
 * body and highlights them visually using HTML5 <mark> elements.
 */

(() => {
  // 1. Dictionaries & Regex Patterns
  const SENSATIONAL_WORDS = [
    "shocking",
    "you won't believe",
    "they don't want you to know",
    "what happens next will blow your mind",
    "miracle cure",
    "secret trick",
    "exposed",
    "bombshell",
    "unbelievable",
    "wake up",
    "mind-blowing",
    "jaw-dropping",
    "hidden truth"
  ];

  const UNVERIFIED_ATTRIBUTION_PATTERNS = [
    /\b(?:sources\s+say|sources\s+claim)\b/gi,
    /\b(?:experts\s+say|experts\s+claim)\b/gi,
    /\b(?:an\s+unnamed\s+official|unnamed\s+officials)\b/gi,
    /\b(?:insiders\s+reveal|insider\s+reports)\b/gi,
    /\b(?:critics\s+claim|critics\s+argue)\b/gi,
    /\b(?:people\s+are\s+saying|many\s+are\s+saying)\b/gi
  ];

  // 2. Inject Required Styles for Highlights & Tooltips
  function injectStyles() {
    if (document.getElementById("newsshield-highlight-styles")) return;

    const style = document.createElement("style");
    style.id = "newsshield-highlight-styles";
    style.textContent = `
      mark.ns-highlight-yellow {
        background-color: #fef08a !important;
        color: #854d0e !important;
        padding: 2px 4px !important;
        border-radius: 3px !important;
        border-bottom: 2px solid #eab308 !important;
        cursor: help !important;
      }
      mark.ns-highlight-red {
        background-color: #fecaca !important;
        color: #991b1b !important;
        padding: 2px 4px !important;
        border-radius: 3px !important;
        border-bottom: 2px solid #ef4444 !important;
        cursor: help !important;
      }
    `;
    document.head.appendChild(style);
  }

  // 3. Locate Main Article Content Container
  function getArticleRoot() {
    const candidates = [
      "article",
      '[itemprop="articleBody"]',
      ".article-body",
      ".story-body",
      ".entry-content",
      ".post-content",
      "main"
    ];

    for (const selector of candidates) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return document.body;
  }

  // 4. Safe Text Node Tree Walker & Highlighter
  function highlightTextNodes(rootElement) {
    // Compile regex for sensational words
    const sensationalRegex = new RegExp(
      `\\b(${SENSATIONAL_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
      "gi"
    );

    // Filter to avoid injecting into code, inputs, or already highlighted tags
    const walker = document.createTreeWalker(
      rootElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;

          const parentTag = node.parentElement ? node.parentElement.tagName.toUpperCase() : "";
          const ignoreTags = ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "MARK", "BUTTON"];

          if (ignoreTags.includes(parentTag)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodesToReplace = [];
    let currentNode;

    while ((currentNode = walker.nextNode())) {
      const text = currentNode.nodeValue;
      const hasSensational = sensationalRegex.test(text);
      sensationalRegex.lastIndex = 0; // reset index

      const hasUnverified = UNVERIFIED_ATTRIBUTION_PATTERNS.some((rx) => {
        const match = rx.test(text);
        rx.lastIndex = 0; // reset index
        return match;
      });

      if (hasSensational || hasUnverified) {
        nodesToReplace.push(currentNode);
      }
    }

    // Replace matched text nodes with formatted mark elements
    nodesToReplace.forEach((node) => {
      let content = node.nodeValue;

      // Wrap unverified attributions (Red)
      UNVERIFIED_ATTRIBUTION_PATTERNS.forEach((regex) => {
        content = content.replace(
          regex,
          (match) => `<mark class="ns-highlight-red" title="Unverified attribution flag">${match}</mark>`
        );
      });

      // Wrap sensational / clickbait keywords (Yellow)
      content = content.replace(
        sensationalRegex,
        (match) => `<mark class="ns-highlight-yellow" title="Sensationalist / Clickbait tone">${match}</mark>`
      );

      // Create a transient wrapper to parse HTML and insert nodes
      const tempWrapper = document.createElement("span");
      tempWrapper.innerHTML = content;

      const parent = node.parentNode;
      if (parent) {
        while (tempWrapper.firstChild) {
          parent.insertBefore(tempWrapper.firstChild, node);
        }
        parent.removeChild(node);
      }
    });
  }

  // 5. Execution Runner
  function runHighlighting() {
    injectStyles();
    const articleRoot = getArticleRoot();
    if (articleRoot) {
      highlightTextNodes(articleRoot);
    }
  }

  // Run automatically when the DOM is ready or listen for trigger message
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runHighlighting);
  } else {
    runHighlighting();
  }

  // Optional: Listen for trigger from popup.js
  chrome.runtime.onMessage?.addListener((request, sender, sendResponse) => {
    if (request.action === "HIGHLIGHT_FLAGS") {
      runHighlighting();
      sendResponse({ status: "Highlights applied" });
    }
  });
})();
