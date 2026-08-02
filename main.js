const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_ROOT = 'G:\\vrc素材';
const EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.unitypackage']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const CATEGORIES = [
  ['erp', '09_ERP内容'], ['r18', '09_ERP内容'], ['nsfw', '09_ERP内容'],
  ['hair', '03_头发'], ['髪', '03_头发'], ['ヘア', '03_头发'], ['发型', '03_头发'], ['头发', '03_头发'],
  ['makeup', '04_妆容'], ['メイク', '04_妆容'], ['化粧', '04_妆容'], ['妆容', '04_妆容'], ['脸部彩绘', '04_妆容'],
  ['outfit', '02_衣服'], ['dress', '02_衣服'], ['衣装', '02_衣服'], ['服装', '02_衣服'], ['着せ替え', '02_衣服'], ['衣服', '02_衣服'],
  ['plugin', '05_功能插件'], ['system', '05_功能插件'], ['tool', '05_功能插件'], ['ツール', '05_功能插件'], ['ギミック', '05_功能插件'], ['shader', '05_功能插件'], ['udon', '05_功能插件'], ['vrcfury', '05_功能插件'], ['工具', '05_功能插件'], ['插件', '05_功能插件'],
  ['avatar', '06_Avatar本体'], ['アバター', '06_Avatar本体'], ['素体', '06_Avatar本体'],
  ['world', '07_场景与地图'], ['map', '07_场景与地图'], ['ワールド', '07_场景与地图'], ['地图', '07_场景与地图'], ['场景', '07_场景与地图'],
  ['texture', '08_贴图与材质'], ['material', '08_贴图与材质'], ['テクスチャ', '08_贴图与材质'], ['贴图', '08_贴图与材质'], ['材质', '08_贴图与材质'], ['psd', '08_贴图与材质'],
  ['weapon', '01_道具'], ['sword', '01_道具'], ['prop', '01_道具'], ['武器', '01_道具'], ['道具', '01_道具'], ['剣', '01_道具']
];
const CATEGORY_DIRS = ['01_道具', '02_衣服', '03_头发', '04_妆容', '05_功能插件', '06_Avatar本体', '07_场景与地图', '08_贴图与材质', '09_ERP内容', '90_待确认', '91_非VRC内容'];
const LEGACY_CATEGORY_DIRS = ['01_VRC地图素材', '02_Avatar素材', '03_通用3D模型与武器', '04_当前房屋工程', '05_创作工具与AI', '06_非VRC内容', '07_贴图PSD与参考', '99_重复文件候选'];

function typeOf(name, ext) {
  const text = name.toLowerCase();
  if (['.zip', '.rar', '.7z'].includes(ext)) return '压缩包';
  if (ext === '.unitypackage') return 'Unity 包';
  if (ext === '.blend') return 'Blender';
  if (IMAGE_EXTENSIONS.has(ext)) return '图片';
  if (ext === '.apk') return 'Android 应用';
  if (text.includes('shader')) return 'Shader';
  return ext ? ext.slice(1).toUpperCase() : '文件夹';
}

function classify(name) {
  const source = name.toLowerCase();
  const hit = CATEGORIES.find(([term]) => source.includes(term));
  return hit ? hit[1] : '90_待确认';
}

function idFor(fullPath) { return crypto.createHash('sha1').update(fullPath).digest('hex').slice(0, 12); }
function formatSize(bytes) { if (!bytes) return '—'; const units = ['B', 'KB', 'MB', 'GB']; let i = 0; while (bytes >= 1024 && i < 3) { bytes /= 1024; i++; } return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`; }
function displayName(name) { return name.replace(/\.(zip|rar|7z|unitypackage|blend|fbx|obj|vrm|apk|psd|png|jpe?g|webp)$/i, ''); }
const defaultLlmSettings = { enabled: false, endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '', useVision: true };
function appDataDirectory() {
  // electron-builder 的 portable 启动器会提供此变量；安装版和开发环境则继续使用 Windows AppData。
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  return portableDirectory ? path.join(portableDirectory, 'VRC素材整理器数据') : app.getPath('userData');
}
function settingsPath() { return path.join(appDataDirectory(), 'settings.json'); }
function logsPath() { return path.join(appDataDirectory(), 'logs'); }
function coverCachePath() { return path.join(appDataDirectory(), 'cache'); }
async function loadSettings() { return { ...defaultLlmSettings, ...await fs.readFile(settingsPath(), 'utf8').then(JSON.parse).catch(() => ({})) }; }
async function writeDebug(event, data = {}) { const dir = logsPath(); await fs.mkdir(dir, { recursive: true }); await fs.appendFile(path.join(dir, 'activity.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event, ...data })}\n`, 'utf8'); }
async function saveSettings(settings) { const safe = { ...defaultLlmSettings, ...settings }; await fs.mkdir(path.dirname(settingsPath()), { recursive: true }); await fs.writeFile(settingsPath(), JSON.stringify(safe, null, 2), 'utf8'); return safe; }
async function llmRerank(filename, candidates, settingsOverride = null) {
  const settings = settingsOverride || await loadSettings();
  if (!settings.enabled || !settings.apiKey || !candidates.length) return null;
  const endpoint = `${settings.endpoint.replace(/\/$/, '')}/chat/completions`;
  const text = `你是谨慎的 VRChat BOOTH 素材匹配审核员。先拆分本地文件名中的商品名、版本号、可能的作者/店铺名与类型线索；作者名只能作为消歧上下文，不能单独当作商品匹配证据。比较候选标题、文件名的跨语言/罗马音重合，以及已验证的商品说明内容物命中词；若提供封面图，也检查图中可见标题/物体是否支持判断。若候选带有“本地同族包”线索，它表示另一份共享强标识的本地包已确认该 BOOTH 商品，仍须以标题或内容物证据验证，不能盲从。不要因为候选属于同一大类、或仅出现常见 Avatar 支持名单就选择。标题、内容物命中与文件名均缺少直接证据时，必须拒绝。只返回 JSON：{"tags":["..."],"index":数字或-1,"confidence":0到1,"reason":"简短理由"}。\n文件名：${filename}\n候选：${candidates.map((c, i) => `[${i}] ${c.title}${c.localRelatedName ? `；本地同族包：${c.localRelatedName}` : ''}${c.contentMatches?.length ? `；内容物命中：${c.contentMatches.join(', ')}` : ''}${c.creatorMatches?.length ? `；作者线索命中：${c.creatorMatches.join(', ')}` : ''}`).join('\n')}`;
  const content = [{ type: 'text', text }];
  if (settings.useVision) candidates.slice(0, 6).forEach((candidate, index) => { if (candidate.image) content.push({ type: 'text', text: `候选图 ${index}` }, { type: 'image_url', image_url: { url: candidate.image, detail: 'low' } }); });
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings.model, temperature: 0, messages: [{ role: 'user', content }] }) });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
    const contentText = JSON.parse(body).choices?.[0]?.message?.content || '';
    const verdict = JSON.parse(contentText.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const valid = Number.isInteger(verdict.index) && verdict.index >= 0 && verdict.index < candidates.length ? verdict : { ...verdict, index: -1, confidence: 0 };
    await writeDebug('llm-rerank', { filename, candidateCount: candidates.length, verdict: valid });
    return valid;
  } catch (error) { await writeDebug('llm-error', { filename, message: error.message }); return { index: -1, confidence: 0, reason: `LLM 调用失败：${error.message}` }; }
}
async function llmSuggestSearchTerms(filename, tag, settings) {
  if (!settings.enabled || !settings.apiKey) return { terms: [], creatorHints: [] };
  const endpoint = `${settings.endpoint.replace(/\/$/, '')}/chat/completions`;
  const prompt = `Generate up to 3 concise BOOTH search terms for this local VRChat asset filename. The ordinary filename search produced no reliable match. First identify likely product-name tokens, version tokens, and any possible creator/shop/author token in the filename. Treat an author token as context for disambiguation only: do not return it alone as a search term, and focus terms on the product. Infer likely Japanese terms from English names, likely English/Romaji terms from Japanese names, and likely Japanese or English/Romaji terms from Chinese names. For avatar and character names, include plausible Kanji/Kana ↔ Romaji ↔ product-title combinations when useful: for example, Mafuyu may appear as 真冬, 真冬 Mafuyu, or オリジナル Mafuyu. Prefer distinctive identifiers that could also occur in a BOOTH product's contents list; avoid generic Avatar support names. Preserve proper nouns, use the known tag only as a hint, and do not invent product IDs, shop names, URLs, or generic filler. Return JSON only: {"terms":["..."],"creatorHints":["..."]}.\nFilename: ${filename}\nStructural filename tokens: ${contentTokens(filename).join(', ') || 'none'}\nKnown tag: ${tag || 'none'}`;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings.model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }) });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
    const content = JSON.parse(body).choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const terms = [...new Set((Array.isArray(parsed.terms) ? parsed.terms : []).map(term => String(term).replace(/[\r\n]+/g, ' ').trim()).filter(term => term.length >= 2 && term.length <= 80))].slice(0, 3);
    const creatorHints = [...new Set((Array.isArray(parsed.creatorHints) ? parsed.creatorHints : []).map(hint => String(hint).replace(/[\r\n]+/g, ' ').trim()).filter(hint => hint.length >= 2 && hint.length <= 80))].slice(0, 3);
    await writeDebug('llm-search-aliases', { filename, tag: tag || null, terms, creatorHints });
    return { terms, creatorHints };
  } catch (error) { await writeDebug('llm-search-aliases-error', { filename, message: error.message }); return { terms: [], creatorHints: [] }; }
}
function searchTerms(name) {
  const original = name.trim();
  const expanded = original.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutTags = expanded.replace(/[【\[][^】\]]*[】\]]/g, ' ').replace(/[（(][^）)]*[）)]/g, ' ').trim();
  const withoutVersion = withoutTags
    .replace(/(?:\s|_|-)*(?:(?:ver(?:sion)?|version|v|beta|alpha|rc)\s*)\d+(?:[._ -]\d+)*/ig, ' ')
    .replace(/(?:\s|_|-)+(?:beta|alpha|rc)(?:\s*\d+(?:[._ -]\d+)*)?$/i, ' ')
    .replace(/(?:\s|_|-)+(?:ver(?:sion)?|version|v)?\s*\d+(?:[._ -]\d+)+(?:\s*\(\d+\))?$/i, ' ')
    .replace(/\s+/g, ' ').trim();
  const parts = withoutVersion.split(/[\s_-]+/).filter(part => part.length >= 3 && !/^(?:ver(?:sion)?|version|v)?\d+$/i.test(part));
  const joined = parts.join(' ');
  const camelJoined = joined.replace(/([a-z])([A-Z])/g, '$1 $2');
  const camelParts = parts.map(part => part.replace(/([a-z])([A-Z])/g, '$1 $2')).filter(part => part.length >= 4);
  const core = withoutVersion.match(/[A-Za-z][A-Za-z0-9 _-]*[-ー][ァ-ヶー][ァ-ヶーA-Za-z0-9 _-]*/)?.[0]?.trim();
  const latin = core?.match(/[A-Za-z][A-Za-z0-9]*/)?.[0];
  return [...new Set([withoutVersion, joined, camelJoined, ...camelParts, core, latin].filter(term => term && term.length >= 2))];
}
const SEARCH_NOISE_TOKENS = new Set(['vrc', 'vrchat', 'unity', 'package', 'asset', '対応', 'model', 'avatar', 'addon', 'beta', 'alpha', 'version', 'ver']);
function normalizeSearchText(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function searchTokens(value) {
  return [...new Set(String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])]
    .filter(token => !SEARCH_NOISE_TOKENS.has(token) && !/^v?\d+(?:[._-]\d+)*$/i.test(token));
}
function rankSearchCandidate(candidate, term, termIndex, termCount) {
  const normalizedTerm = normalizeSearchText(term);
  const normalizedTitle = normalizeSearchText(candidate.title);
  const tokens = searchTokens(term);
  const matchedTokens = tokens.filter(token => candidate.title.normalize('NFKC').toLowerCase().includes(token));
  const tokenScore = matchedTokens.reduce((score, token) => score + (token.length >= 10 ? 180 : token.length >= 7 ? 110 : token.length >= 4 ? 55 : 20), 0);
  const exact = normalizedTerm.length >= 4 && normalizedTitle === normalizedTerm;
  const phraseMatch = normalizedTerm.length >= 5 && normalizedTitle.includes(normalizedTerm);
  const reversePhraseMatch = normalizedTitle.length >= 5 && normalizedTerm.includes(normalizedTitle);
  const allTokensMatch = tokens.length >= 2 && matchedTokens.length === tokens.length;
  const seriesTokens = stableFamilyTokens(term);
  const seriesMatches = seriesTokens.filter(token => normalizedTitle.includes(token));
  const score = (exact ? 1400 : 0)
    + (phraseMatch ? 720 : 0)
    + (reversePhraseMatch ? 440 : 0)
    + tokenScore
    + (allTokensMatch ? 260 : 0)
    + seriesMatches.reduce((sum, token) => sum + (token.length >= 10 ? 220 : 90), 0)
    + Math.max(0, termCount - termIndex);
  return { ...candidate, score, matchTerms: [term], matchedTokens, exactTitle: exact, directTitleMatch: exact || phraseMatch || (allTokensMatch && matchedTokens.some(token => token.length >= 5)) };
}
function mergeSearchCandidate(pool, candidate) {
  const existing = pool.findIndex(item => item.url === candidate.url);
  if (existing < 0) { pool.push(candidate); return; }
  const previous = pool[existing];
  const preferred = candidate.score > previous.score ? candidate : previous;
  pool[existing] = {
    ...preferred,
    localRelatedName: previous.localRelatedName || candidate.localRelatedName,
    localReferenceName: previous.localReferenceName || candidate.localReferenceName,
    matchTerms: [...new Set([...(previous.matchTerms || []), ...(candidate.matchTerms || [])])],
    matchedTokens: [...new Set([...(previous.matchedTokens || []), ...(candidate.matchedTokens || [])])]
  };
}
function hasStrongNormalMatch(candidate, runnerUp = null) {
  if (!candidate) return false;
  if (Number(candidate.contentScore || 0) >= 120 || candidate.exactTitle) return true;
  const margin = Number(candidate.score || 0) - Number(runnerUp?.score || 0);
  return Boolean(candidate.directTitleMatch && candidate.score >= 720 && (margin >= 90 || !runnerUp));
}
function stableFamilyTokens(name) {
  return [...new Set((displayName(name).normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9]{4,}/g) || []).filter(token => token.length >= 7 && !['interactive', 'avatar', 'package', 'system'].includes(token)))];
}
function matchesLocalReference(sourceName, referenceName) {
  const source = stableFamilyTokens(sourceName);
  const reference = new Set(stableFamilyTokens(referenceName));
  const shared = source.filter(token => reference.has(token));
  return shared.some(token => token.length >= 10) || shared.length >= 2;
}
async function storedLocalReferences(root, query) {
  if (!stableFamilyTokens(query).length) return [];
  const records = await fs.readFile(path.join(root || DEFAULT_ROOT, '.vrc-asset-organizer.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return Object.entries(records).filter(([fullPath, record]) => record.localReference && record.booth?.matched && record.booth?.itemUrl && matchesLocalReference(query, fullPath)).slice(0, 6).map(([fullPath, record]) => ({ name: displayName(path.basename(fullPath)), title: record.booth.title, itemUrl: record.booth.itemUrl }));
}
function hasDirectCandidateEvidence(filename, candidate) {
  const title = String(candidate.title || '').normalize('NFKC').toLowerCase();
  const directToken = contentTokens(filename).some(token => token.length >= 5 && title.includes(token));
  return directToken || Number(candidate.contentScore || 0) >= 120 || Boolean(candidate.localRelatedName) || Boolean(candidate.localReferenceName);
}
const TAG_KEYWORDS = {
  '道具': ['weapon', 'gun', 'pistol', 'sword', 'prop', '武器', '銃', '剣', 'ピストル', '道具', 'アクセサリー'],
  '衣服': ['outfit', 'dress', 'clothes', '衣装', '服装', '衣服', 'コーデ'],
  '头发': ['hair', '髪', 'ヘア'],
  '妆容': ['makeup', 'メイク', '化粧', '妆'],
  '功能插件': ['plugin', 'system', 'tool', 'shader', 'ギミック', 'ツール'],
  'Avatar本体': ['avatar', 'アバター', '素体'],
  '场景地图': ['world', 'map', 'scene', 'ワールド', 'マップ', 'シーン', '场景', '地图'],
  '贴图材质': ['texture', 'material', 'テクスチャ', 'マテリアル', '材質', '贴图'],
  'ERP内容': ['erp', 'r18', 'nsfw', 'adult']
};
const KNOWN_NAME_ALIASES = {
  mafuyu: ['真冬 Mafuyu', '真冬', 'オリジナル Mafuyu']
};
function knownNameAliases(query) {
  const normalized = query.normalize('NFKC').toLowerCase();
  return Object.entries(KNOWN_NAME_ALIASES).flatMap(([name, aliases]) => normalized.includes(name) ? aliases : []);
}
function boothSearchUrl(term) { return `https://booth.pm/ja/search/${encodeURIComponent(term)}?sort=new&tags%5B%5D=VRChat`; }
const itemTextCache = new Map();
function contentTokens(filename) {
  const normalized = displayName(filename).normalize('NFKC').toLowerCase();
  const latin = [...normalized.matchAll(/[a-z][a-z0-9_-]{2,}/g)].map(match => match[0]);
  const cjk = [...normalized.matchAll(/[一-龥ぁ-んァ-ヶー]{2,}/g)].map(match => match[0]);
  return [...new Set([...latin, ...cjk].filter(token => !/^(?:ver(?:sion)?|version|beta|alpha|unity|vrc|vrchat|zip|rar|7z)$/i.test(token) && !/^v?\d+(?:[._-]\d+)*$/i.test(token)))].slice(0, 12);
}
function visibleItemText(html) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(?:amp|#38);/g, '&').replace(/&(?:quot|#34);/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').normalize('NFKC').toLowerCase(); }
async function scoreCandidateContents(filename, candidates, headers, creatorHints = []) {
  const tokens = contentTokens(filename);
  if ((!tokens.length && !creatorHints.length) || !candidates.length) return candidates;
  const enriched = await Promise.all(candidates.slice(0, 8).map(async candidate => {
    try {
      let text = itemTextCache.get(candidate.url);
      if (!text) { const response = await fetch(candidate.url, { headers }); if (!response.ok) return candidate; text = visibleItemText(await response.text()); itemTextCache.set(candidate.url, text); }
      const matches = tokens.filter(token => text.includes(token));
      const creatorMatches = creatorHints.filter(hint => text.includes(hint.normalize('NFKC').toLowerCase()));
      const contentScore = matches.reduce((score, token) => score + (/[0-9]/.test(token) || token.length >= 7 ? 130 : token.length >= 4 ? 70 : 25), 0);
      return { ...candidate, contentMatches: matches, creatorMatches, contentScore, score: candidate.score + contentScore };
    } catch { return candidate; }
  }));
  const evidence = new Map(enriched.map(candidate => [candidate.url, candidate]));
  return candidates.map(candidate => evidence.get(candidate.url) || candidate);
}

async function scanFolder(root) {
  const indexPath = path.join(root, '.vrc-asset-organizer.json');
  const saved = await fs.readFile(indexPath, 'utf8').then(JSON.parse).catch(() => ({}));
  let clearedOverbroadReference = false;
  for (const record of Object.values(saved)) {
    if (!record.localReference && record.booth?.queryUsed?.startsWith('本地参考')) {
      record.booth = null;
      record.useDefaultCover = true;
      clearedOverbroadReference = true;
    }
  }
  if (clearedOverbroadReference) await fs.writeFile(indexPath, JSON.stringify(saved, null, 2), 'utf8');
  const entries = await fs.readdir(root, { withFileTypes: true });
  const categoryNames = new Set(CATEGORY_DIRS);
  const assets = [];
  const addAsset = async (entry, containerCategory = null) => {
    if (entry.name === '.vrc-asset-organizer.json') return;
    if (entry.isDirectory()) return;
    const fullPath = path.join(root, containerCategory || '', entry.name);
    const ext = entry.isFile() ? path.extname(entry.name).toLowerCase() : '';
    if (entry.isFile() && !EXTENSIONS.has(ext)) return;
    const stat = await fs.stat(fullPath);
    const record = saved[fullPath] || {};
    assets.push({
      id: idFor(fullPath), name: displayName(entry.name), rawName: entry.name, fullPath, ext,
      kind: typeOf(entry.name, ext), category: containerCategory || record.category || classify(entry.name), size: formatSize(stat.size),
      modified: stat.mtime.toISOString().slice(0, 10), previewPath: IMAGE_EXTENSIONS.has(ext) ? fullPath : null,
      isDirectory: entry.isDirectory(), booth: record.booth || null, links: record.links || [], llmHints: record.llmHints || {}, parentPath: record.parentPath || null, confirmed: Boolean(record.confirmed), useDefaultCover: Boolean(record.useDefaultCover), localReference: Boolean(record.localReference), rootPath: root, isOrganized: Boolean(containerCategory), isLegacy: LEGACY_CATEGORY_DIRS.includes(containerCategory)
    });
  };
  for (const entry of entries) {
    if (entry.name === 'Booth素材整理器' || categoryNames.has(entry.name)) continue;
    await addAsset(entry);
  }
  for (const category of CATEGORY_DIRS) {
    const categoryPath = path.join(root, category);
    const categoryEntries = await fs.readdir(categoryPath, { withFileTypes: true }).catch(() => []);
    for (const entry of categoryEntries) await addAsset(entry, category);
  }
  return assets.sort((a, b) => b.modified.localeCompare(a.modified));
}

async function boothSearch(query, options = {}) {
  let terms = searchTerms(query);
  const originalTerms = [...terms];
  let lastSearchUrl = boothSearchUrl(query);
  try {
    const headers = { 'User-Agent': 'VRCAssetOrganizer/0.1 (+https://github.com/Neil100o/vrc-asset-organizer)' };
    const llmSettings = await loadSettings();
    llmSettings.enabled = Boolean(options.useLlm && llmSettings.apiKey);
    const relatedBooth = llmSettings.enabled && Array.isArray(options.relatedBooth) ? options.relatedBooth.filter(item => item?.itemUrl && item?.name).slice(0, 3) : [];
    const passedReferences = llmSettings.enabled && Array.isArray(options.localReferences) ? options.localReferences.filter(item => item?.itemUrl && item?.name).slice(0, 3) : [];
    const localReferences = llmSettings.enabled ? [...new Map([...(await storedLocalReferences(options.rootPath, query)), ...passedReferences].map(item => [item.itemUrl, item])).values()].slice(0, 6) : [];
    if (relatedBooth.length) terms = [...new Set([...terms, ...relatedBooth.flatMap(item => searchTerms(item.name).slice(0, 2))])];
    const relatedGroups = new Map();
    for (const item of relatedBooth) relatedGroups.set(item.itemUrl, [...(relatedGroups.get(item.itemUrl) || []), item]);
    const localConsensus = [...relatedGroups.entries()].map(([url, items]) => ({ url, items })).find(group => group.items.length >= 2) || null;
    const referenceUrls = [...new Set(localReferences.map(item => item.itemUrl))];
    const trustedReference = referenceUrls.length === 1 ? localReferences[0] : null;
    const productId = query.match(/\d{6,9}/)?.[0];
    let itemUrl = productId ? `https://booth.pm/ja/items/${productId}` : localConsensus?.url || trustedReference?.itemUrl || null;
    let matchedTerm = productId ? `BOOTH #${productId}` : localConsensus ? `本地同族包共识（${localConsensus.items.length} 份）` : trustedReference ? `本地参考：${trustedReference.name}` : null;
    let uncertaintyReason = null;
    const candidatePool = [...relatedBooth.map(item => ({ url: item.itemUrl, title: item.title || item.name, image: null, score: 60, localRelatedName: item.name, matchTerms: ['本地同族包'] })), ...localReferences.map(item => ({ url: item.itemUrl, title: item.title || item.name, image: null, score: 400, localReferenceName: item.name, matchTerms: ['人工本地参考'] }))];
    let creatorHints = [];
    for (const [termIndex, term] of (itemUrl ? [] : terms).entries()) {
      const searchUrl = boothSearchUrl(term);
      lastSearchUrl = searchUrl;
      const response = await fetch(searchUrl, { headers });
      if (!response.ok) continue;
      const page = await response.text();
      const thumbnails = new Map([...page.matchAll(/data-original="([^"]+)"[^>]*href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)"/gi)].map(match => [match[2], match[1]]));
      let candidates = [...page.matchAll(/item-card__title[\s\S]{0,500}?href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)">([^<]+)</gi)]
        .map(match => ({ url: match[1], title: match[2].replace(/&amp;/g, '&'), image: thumbnails.get(match[1]) || null }));
      const allowed = TAG_KEYWORDS[options.tag];
      if (allowed) candidates = candidates.filter(candidate => { const title = candidate.title.toLowerCase(); return allowed.some(keyword => title.includes(keyword.toLowerCase())); });
      const ranked = candidates.map(candidate => rankSearchCandidate(candidate, term, termIndex, terms.length)).sort((a, b) => b.score - a.score);
      for (const candidate of ranked) mergeSearchCandidate(candidatePool, candidate);
    }
    if (!itemUrl && !productId) {
      const llmAliases = llmSettings.enabled ? await llmSuggestSearchTerms(query, options.tag, llmSettings) : { terms: [], creatorHints: [] };
      creatorHints = llmAliases.creatorHints;
      const aliases = [...knownNameAliases(query), ...llmAliases.terms];
      const extraTerms = aliases.filter(alias => !terms.some(term => term.normalize('NFKC').toLowerCase() === alias.normalize('NFKC').toLowerCase()));
      terms.push(...extraTerms);
      for (const term of extraTerms) {
        const searchUrl = boothSearchUrl(term);
        lastSearchUrl = searchUrl;
        const response = await fetch(searchUrl, { headers });
        if (!response.ok) continue;
        const page = await response.text();
        const thumbnails = new Map([...page.matchAll(/data-original="([^"]+)"[^>]*href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)"/gi)].map(match => [match[2], match[1]]));
        let candidates = [...page.matchAll(/item-card__title[\s\S]{0,500}?href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)">([^<]+)</gi)]
          .map(match => ({ url: match[1], title: match[2].replace(/&amp;/g, '&'), image: thumbnails.get(match[1]) || null }));
        const allowed = TAG_KEYWORDS[options.tag];
        if (allowed) candidates = candidates.filter(candidate => { const title = candidate.title.toLowerCase(); return allowed.some(keyword => title.includes(keyword.toLowerCase())); });
        const ranked = candidates.map(candidate => rankSearchCandidate(candidate, term, terms.indexOf(term), terms.length)).sort((a, b) => b.score - a.score);
        for (const candidate of ranked) mergeSearchCandidate(candidatePool, candidate);
      }
    }
    candidatePool.splice(0, candidatePool.length, ...await scoreCandidateContents(query, candidatePool, headers, creatorHints));
    candidatePool.sort((a, b) => b.score - a.score);
    const evidenceBest = candidatePool[0];
    const evidenceRunnerUp = candidatePool[1];
    if (!productId && hasStrongNormalMatch(evidenceBest, evidenceRunnerUp)) {
      itemUrl = evidenceBest.url;
      matchedTerm = evidenceBest.contentScore >= 120 ? `内容物匹配: ${evidenceBest.contentMatches.join(', ')}` : evidenceBest.matchTerms?.[0] || query;
    }
    const llmQuery = options.tag ? `${query}（已知标签：${options.tag}）` : query;
    const llmVerdict = !productId && !localConsensus && !trustedReference ? await llmRerank(llmQuery, candidatePool.slice(0, 12), llmSettings) : null;
    if (llmSettings.enabled && !productId && !localConsensus && !trustedReference) {
      if (llmVerdict?.confidence >= 0.7 && candidatePool[llmVerdict.index] && hasDirectCandidateEvidence(query, candidatePool[llmVerdict.index])) { itemUrl = candidatePool[llmVerdict.index].url; matchedTerm = `LLM：${llmVerdict.reason || candidatePool[llmVerdict.index].title}`; }
      else { itemUrl = null; matchedTerm = null; uncertaintyReason = llmVerdict?.reason || 'LLM 未找到足够的直接匹配证据'; }
    }
    const searchEvidence = { originalTerms, terms, relatedPackages: relatedBooth.map(item => item.name), localReferences: localReferences.map(item => item.name), localConsensus: localConsensus ? { count: localConsensus.items.length, itemUrl: localConsensus.url } : null, trustedReference: trustedReference ? { name: trustedReference.name, itemUrl: trustedReference.itemUrl } : null, creatorHints, productId: productId || null, llm: localConsensus || trustedReference ? null : (llmSettings.enabled ? (llmVerdict || { index: -1, confidence: 0, reason: '没有给出可确认选择' }) : null) };
    if (!itemUrl) { const result = { searchUrl: lastSearchUrl, candidates: candidatePool.slice(0, 12), matched: false, status: uncertaintyReason ? `LLM 不确定，已保留 ${candidatePool.length} 个候选供你确认：${uncertaintyReason}` : candidatePool.length ? `已找到 ${candidatePool.length} 个候选，但没有足够直接证据自动绑定；请从候选中确认。` : `没有找到 BOOTH 商品（已尝试 ${terms.length} 个检索词）`, searchEvidence }; await writeDebug('booth-search', { query, options: { useLlm: Boolean(options.useLlm), tag: options.tag || null }, result: { matched: false, candidateCount: result.candidates.length, evidence: searchEvidence } }); return result; }
    const itemResponse = await fetch(itemUrl, { headers });
    if (!itemResponse.ok) return { searchUrl: itemUrl, matched: false, status: `BOOTH 商品页无法访问（HTTP ${itemResponse.status}）`, searchEvidence };
    const itemHtml = await itemResponse.text();
    const meta = (key) => itemHtml.match(new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]+)"`, 'i'))?.[1] || itemHtml.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+(?:property|name)="${key}"`, 'i'))?.[1] || null;
    const image = meta('og:image');
    const title = meta('og:title')?.replace(/\s*\|\s*BOOTH.*$/i, '') || matchedTerm;
    let cachedImagePath = null;
    if (image) {
      try {
        const preview = await fetch(image, { headers });
        if (preview.ok) {
          const mime = preview.headers.get('content-type') || '';
          const extension = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' : '.jpg';
          const cacheDir = coverCachePath();
          await fs.mkdir(cacheDir, { recursive: true });
          cachedImagePath = path.join(cacheDir, `${idFor(`${matchedTerm}-${image}`)}${extension}`);
          await fs.writeFile(cachedImagePath, Buffer.from(await preview.arrayBuffer()));
        }
      } catch { /* Search result remains usable even when its preview cannot be cached. */ }
    }
    const result = { searchUrl: lastSearchUrl, queryUsed: matchedTerm, itemUrl, title, image, cachedImagePath, candidates: candidatePool.slice(0, 12), matched: true, searchEvidence, status: cachedImagePath ? `已用“${matchedTerm}”匹配 BOOTH 商品并下载缩略图` : `已用“${matchedTerm}”匹配 BOOTH 商品（缩略图未能缓存）` };
    await writeDebug('booth-search', { query, options: { useLlm: Boolean(options.useLlm), tag: options.tag || null }, result: { matched: true, title, queryUsed: matchedTerm, candidateCount: result.candidates.length, evidence: searchEvidence } });
    return result;
  } catch (error) {
    return { searchUrl: lastSearchUrl, image: null, matched: false, status: `搜索页暂不可读取：${error.message}` };
  }
}

function createWindow() {
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 960, minHeight: 680, backgroundColor: '#f4f6f8', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  window.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('choose-root', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('scan', (_, root) => scanFolder(root || DEFAULT_ROOT));
  ipcMain.handle('booth-search', (_, name, options) => boothSearch(name, options || {}));
  ipcMain.handle('get-llm-settings', async () => ({ settings: await loadSettings(), configPath: settingsPath(), logsPath: logsPath() }));
  ipcMain.handle('save-llm-settings', async (_, settings) => saveSettings(settings));
  ipcMain.handle('test-llm', async () => llmRerank('AA_FlintlockPistol', [{ title: 'フリントロック式ピストル', image: null }, { title: 'Audio Trace', image: null }]));
  ipcMain.handle('open-local-path', async (_, localPath) => { await fs.mkdir(localPath, { recursive: true }); return shell.openPath(localPath); });
  ipcMain.handle('save-classifications', async (_, root, assets) => {
    const indexPath = path.join(root, '.vrc-asset-organizer.json');
    const records = Object.fromEntries(assets.map(asset => [asset.fullPath, { category: asset.category, booth: asset.booth || null, links: asset.links || [], llmHints: asset.llmHints || {}, parentPath: asset.parentPath || null, confirmed: Boolean(asset.confirmed), useDefaultCover: Boolean(asset.useDefaultCover), localReference: Boolean(asset.localReference) }]));
    await fs.writeFile(indexPath, JSON.stringify(records, null, 2), 'utf8');
    return true;
  });
  ipcMain.handle('move-asset', async (_, asset, destinationName) => {
    const rootPath = asset.rootPath || path.dirname(asset.fullPath);
    const targetDir = destinationName === '91_非VRC内容' ? path.join(path.dirname(rootPath), '非VRC内容') : path.join(rootPath, destinationName);
    await fs.mkdir(targetDir, { recursive: true });
    let target = path.join(targetDir, asset.rawName);
    if (target.toLowerCase() === asset.fullPath.toLowerCase()) return { ok: true, target };
    if (await fs.access(target).then(() => true).catch(() => false)) {
      const parsed = path.parse(asset.rawName);
      target = path.join(targetDir, `${parsed.name} (${new Date().toISOString().replace(/[:.]/g, '-')})${parsed.ext}`);
    }
    await fs.rename(asset.fullPath, target);
    return { ok: true, target };
  });
  ipcMain.handle('import-assets', async (_, sourcePaths, root, mode = 'move', destination = '') => {
    const targetRoot = destination ? path.join(root || DEFAULT_ROOT, destination) : (root || DEFAULT_ROOT);
    const results = [];
    for (const source of sourcePaths || []) {
      const ext = path.extname(source).toLowerCase();
      if (!EXTENSIONS.has(ext)) continue;
      const sourceStat = await fs.stat(source).catch(() => null);
      if (!sourceStat?.isFile()) continue;
      let target = path.join(targetRoot, path.basename(source));
      if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) { results.push(target); continue; }
      if (await fs.access(target).then(() => true).catch(() => false)) { const parsed=path.parse(source); target=path.join(targetRoot, `${parsed.name} (${new Date().toISOString().replace(/[:.]/g,'-')})${parsed.ext}`); }
      await fs.mkdir(targetRoot, { recursive: true });
      if (mode === 'copy') await fs.copyFile(source, target);
      else { try { await fs.rename(source, target); } catch (error) { if (error.code !== 'EXDEV') throw error; await fs.copyFile(source, target); await fs.unlink(source); } }
      results.push(target);
    }
    return results;
  });
  ipcMain.handle('open-external', (_, url) => shell.openExternal(url));
  ipcMain.handle('show-in-folder', (_, filePath) => shell.showItemInFolder(filePath));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
