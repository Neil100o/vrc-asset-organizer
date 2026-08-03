function decodeHtmlText(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBoothSearchCandidates(page = '') {
  const thumbnails = new Map();
  const imagePattern = /(?:data-original|data-src|src)="([^"]+)"[^>]*href="https:\/\/booth\.pm\/(?:ja\/)?items\/(\d+)"/gi;
  for (const match of page.matchAll(imagePattern)) thumbnails.set(match[2], decodeHtmlText(match[1]));

  const candidates = new Map();
  // Current BOOTH cards expose a product ID and display name as attributes. This survives
  // presentation-only class changes better than relying solely on the card title markup.
  for (const match of page.matchAll(/<[^>]*\bdata-product-id="(\d+)"[^>]*>/gi)) {
    const tag = match[0];
    const productId = match[1];
    const rawName = tag.match(/\bdata-product-name="([^"]+)"/i)?.[1];
    if (!rawName) continue;
    candidates.set(productId, { url: `https://booth.pm/ja/items/${productId}`, title: decodeHtmlText(rawName), image: thumbnails.get(productId) || null });
  }
  // Legacy/fallback markup: keep supporting pages without the structured product attributes.
  for (const match of page.matchAll(/item-card__title[\s\S]{0,700}?href="(https:\/\/booth\.pm\/(?:ja\/)?items\/(\d+))">([^<]+)/gi)) {
    const [, url, productId, rawName] = match;
    if (!candidates.has(productId)) candidates.set(productId, { url, title: decodeHtmlText(rawName), image: thumbnails.get(productId) || null });
  }
  return [...candidates.values()].filter(candidate => candidate.title);
}

module.exports = { parseBoothSearchCandidates };
