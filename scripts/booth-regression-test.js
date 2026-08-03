const { parseBoothSearchCandidates } = require('../booth-parser');

const cases = [
  ['mafuyu', '真冬 Mafuyu'],
  ['Lefkia レフキア', 'Lefkia'],
  ['AA FlintlockPistol', 'フリントロック'],
  ['Lavender Braid Hair', 'Lavender Braid Hair']
];

async function main() {
  for (const [query, expected] of cases) {
    const url = `https://booth.pm/ja/search/${encodeURIComponent(query)}?tags%5B%5D=VRChat`;
    const response = await fetch(url, { headers: { 'User-Agent': 'VRCAssetOrganizer/0.1 (+https://github.com/Neil100o/vrc-asset-organizer)' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`${query}: HTTP ${response.status}`);
    const candidates = parseBoothSearchCandidates(await response.text());
    const hit = candidates.find(candidate => candidate.title.includes(expected));
    if (!hit) throw new Error(`${query}: 未找到预期候选「${expected}」，解析到 ${candidates.length} 项`);
    if (!hit.image) throw new Error(`${query}: 预期候选缺少搜索页缩略图`);
    const itemResponse = await fetch(hit.url, { headers: { 'User-Agent': 'VRCAssetOrganizer/0.1 (+https://github.com/Neil100o/vrc-asset-organizer)' }, signal: AbortSignal.timeout(15000) });
    const itemHtml = await itemResponse.text();
    if (!itemResponse.ok || !/<meta[^>]+(?:property|name)="og:image"[^>]+content="[^"]+"/i.test(itemHtml)) throw new Error(`${query}: 商品页缺少 og:image`);
    console.log(`PASS ${query}: ${candidates.length} candidates · ${hit.url}`);
  }
}

main().catch(error => { console.error(`FAIL ${error.message}`); process.exitCode = 1; });
