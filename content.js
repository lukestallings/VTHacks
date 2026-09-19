// This function gets injected into the active webpage
function scrapeArticleData() {
  const headline = document.querySelector('h1')?.innerText || document.title || "";
  
  // Collect all paragraph text inside article containers or standard paragraphs
  const paragraphs = Array.from(document.querySelectorAll('article p, main p, p'))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 20);

  const fullText = paragraphs.join(" ");

  // Collect outbound links/citations
  const links = Array.from(document.querySelectorAll('article a, main a, p a'))
    .map(a => a.href)
    .filter(href => href.startsWith('http'));

  return {
    url: window.location.href,
    isHttps: window.location.protocol === 'https:',
    headline: headline,
    bodyText: fullText,
    linkCount: links.length
  };
}

// Listen for requests from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SCRAPE_PAGE") {
    const data = scrapeArticleData();
    sendResponse(data);
  }
});