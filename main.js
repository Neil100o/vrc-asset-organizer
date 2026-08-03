const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const wanakana = require('wanakana');

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
const defaultLlmSettings = { enabled: false, endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', apiKey: '', useVision: true, deepEndpoint: '', deepModel: '', deepApiKey: '', rootPath: DEFAULT_ROOT };
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
async function saveSettings(settings) { const existing = await fs.readFile(settingsPath(), 'utf8').then(JSON.parse).catch(() => ({})); const safe = { ...defaultLlmSettings, ...existing, ...settings }; await fs.mkdir(path.dirname(settingsPath()), { recursive: true }); await fs.writeFile(settingsPath(), JSON.stringify(safe, null, 2), 'utf8'); return safe; }
function deepModelSettings(settings) {
  const endpoint = String(settings.deepEndpoint || settings.endpoint || '').trim();
  const model = String(settings.deepModel || '').trim();
  const apiKey = String(settings.deepApiKey || settings.apiKey || '').trim();
  if (!settings.enabled || !settings.useVision || !endpoint || !model || !apiKey) return null;
  return { ...settings, endpoint, model, apiKey, enabled: true };
}
async function llmRerank(filename, candidates, settingsOverride = null, analysis = null, options = {}) {
  const settings = settingsOverride || await loadSettings();
  if (!settings.enabled || !settings.apiKey || !candidates.length) return null;
  const endpoint = `${settings.endpoint.replace(/\/$/, '')}/chat/completions`;
  const verificationInstruction = options.verifyNormalCandidate
    ? '普通规则暂定候选 [0] 为首选；现在必须独立审核它。标题相似、同为某模型适配、同作者或同类别都不足以通过。若没有文件主体、标题、内容物或封面标题的直接对应证据，返回 -1；只有另一个候选存在更直接证据时，才可改选它。'
    : '普通检索已经给出候选，你只能在候选中选择，或返回 -1 表示不确定。';
  const text = `你是谨慎的 VRChat BOOTH 素材匹配审核员。${verificationInstruction} 作者/店铺、兼容模型、同一大类都只能用于消歧，绝不能单独当作同商品证据；“兼容某模型”不代表素材就是该模型本体或同系列。只有文件商品主体与候选标题、商品内容物或封面可见标题存在直接证据时才可选择。若候选带“本地同族包”，仍须验证标题或内容物，不能盲从。\n文件名：${filename}\n文件名结构（仅作假设，可能错误）：${analysis ? JSON.stringify(analysis) : '未提供'}\n候选：${candidates.map((c, i) => `[${i}] ${c.title}${c.localRelatedName ? `；本地同族包：${c.localRelatedName}` : ''}${c.contentMatches?.length ? `；内容物命中：${c.contentMatches.join(', ')}` : ''}${c.creatorMatches?.length ? `；作者线索命中：${c.creatorMatches.join(', ')}` : ''}`).join('\n')}\n只返回 JSON：{"index":数字或-1,"confidence":0到1,"reason":"简短理由"}。`;
  const content = [{ type: 'text', text }];
  if (settings.useVision && options.useVision) candidates.slice(0, 4).forEach((candidate, index) => { if (candidate.image) content.push({ type: 'text', text: `候选图 ${index}（仅作为标题/物体的辅助证据）` }, { type: 'image_url', image_url: { url: candidate.image, detail: 'low' } }); });
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
async function llmAnalyzeFilename(filename, tag, settings, packageClues = {}) {
  if (!settings.enabled || !settings.apiKey) return { terms: [], creatorHints: [], analysis: null };
  const endpoint = `${settings.endpoint.replace(/\/$/, '')}/chat/completions`;
  const prompt = `Analyze one local VRChat asset filename only after ordinary BOOTH search was inconclusive. Separate likely product/series names, possible creator/shop context, possible supported-model names, version markers, and package form. A model name is only a neutral related entity: do not infer “compatibility” or “same product” without explicit words such as for, 対応, addon, extension, patch. An Addon may be an extra package of the same product, not a model-compatible item. Generate at most 3 concise BOOTH search terms centered on the product/series, never a creator alone and never invented IDs, shops or URLs. Infer Japanese/English/Romaji alternatives only when plausible. Return JSON only: {"productTerms":["..."],"seriesTerms":["..."],"creatorHints":["..."],"modelReferences":["..."],"packageKind":"base|addon|compatibility|unknown","relation":"base|same_product_addon|compatibility|unknown","terms":["..."]}.\nFilename: ${filename}\nDeterministic tokens: ${contentTokens(filename).join(', ') || 'none'}\nKnown tag: ${tag || 'none'}\nPackage creator context: ${(packageClues.creatorHints || []).join(', ') || 'none'}\nPackage product-path clues: ${(packageClues.terms || []).join(', ') || 'none'}`;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: settings.model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }) });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
    const content = JSON.parse(body).choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const cleanList = (value, limit = 3) => [...new Set((Array.isArray(value) ? value : []).map(item => String(item).replace(/[\r\n]+/g, ' ').trim()).filter(item => item.length >= 2 && item.length <= 80))].slice(0, limit);
    const analysis = { productTerms: cleanList(parsed.productTerms), seriesTerms: cleanList(parsed.seriesTerms), creatorHints: cleanList(parsed.creatorHints), modelReferences: cleanList(parsed.modelReferences), packageKind: ['base', 'addon', 'compatibility', 'unknown'].includes(parsed.packageKind) ? parsed.packageKind : 'unknown', relation: ['base', 'same_product_addon', 'compatibility', 'unknown'].includes(parsed.relation) ? parsed.relation : 'unknown' };
    const terms = cleanList(parsed.terms).filter(term => !analysis.creatorHints.some(hint => hint.normalize('NFKC').toLowerCase() === term.normalize('NFKC').toLowerCase()));
    const creatorHints = analysis.creatorHints;
    await writeDebug('llm-filename-analysis', { filename, tag: tag || null, terms, analysis });
    return { terms, creatorHints, analysis };
  } catch (error) { await writeDebug('llm-filename-analysis-error', { filename, message: error.message }); return { terms: [], creatorHints: [], analysis: null }; }
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
  const baseTerms = [withoutVersion, joined, camelJoined, ...camelParts, core, latin].filter(term => term && term.length >= 2);
  return [...new Set(baseTerms.flatMap(term => [term, ...kanaSearchVariants(term), ...romajiSearchVariants(term)]))];
}
const ROMAJI_SEARCH_NOISE = new Set(['avatar', 'asset', 'beta', 'dress', 'hair', 'item', 'model', 'package', 'plugin', 'system', 'tool', 'unity', 'vrc', 'vrchat', 'version']);
function kanaSearchVariants(value) {
  return [...new Set((String(value).match(/[A-Za-z]{3,}/g) || []).flatMap(token => {
    const normalized = token.toLowerCase();
    if (ROMAJI_SEARCH_NOISE.has(normalized)) return [];
    const kana = wanakana.toKana(normalized, { passRomaji: true });
    return wanakana.isKana(kana) && kana.length >= 2 ? [kana] : [];
  }))];
}
function romajiSearchVariants(value) {
  return [...new Set((String(value).match(/[ぁ-ゖァ-ヺー]{2,}/g) || []).map(token => wanakana.toRomaji(token).toLowerCase()).filter(token => token.length >= 3))];
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
  const referenceTokens = stableFamilyTokens(referenceName);
  const reference = new Set(referenceTokens);
  const shared = source.filter(token => reference.has(token));
  // A shared leading product token such as “Mofumofu_OMAKE” / “Mofumofu_Makeup”
  // is a useful local-only relation after the user explicitly confirms one package.
  const sameLeadingFamily = Boolean(source[0] && source[0] === referenceTokens[0] && source[0].length >= 7);
  return shared.some(token => token.length >= 10) || shared.length >= 2 || sameLeadingFamily;
}
async function storedLocalReferences(root, query) {
  if (!stableFamilyTokens(query).length) return [];
  const records = await fs.readFile(path.join(root || DEFAULT_ROOT, '.vrc-asset-organizer.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return Object.entries(records).filter(([fullPath, record]) => record.localReference && record.booth?.matched && record.booth?.itemUrl && matchesLocalReference(query, fullPath)).slice(0, 6).map(([fullPath, record]) => ({ name: displayName(path.basename(fullPath)), title: record.booth.title, itemUrl: record.booth.itemUrl }));
}
function hasDirectCandidateEvidence(filename, candidate) {
  const title = String(candidate.title || '').normalize('NFKC').toLowerCase();
  const directToken = contentTokens(filename).some(token => token.length >= 5 && title.includes(token));
  return directToken || Boolean(candidate.exactTitle) || Boolean(candidate.directTitleMatch) || Number(candidate.contentScore || 0) >= 120 || Boolean(candidate.localRelatedName) || Boolean(candidate.localReferenceName);
}
const TAG_KEYWORDS = {
  '道具': ['weapon', 'gun', 'pistol', 'sword', 'prop', '武器', '銃', '剣', 'ピストル', '道具', 'アクセサリー'],
  '衣服': ['outfit', 'dress', 'clothes', '衣装', '服装', '衣服', 'コーデ'],
  '头发': ['hair', '髪', 'ヘア'],
  '妆容': ['makeup', 'メイク', '化粧', '妆'],
  '功能插件': ['plugin', 'system', 'tool', 'shader', 'ギミック', 'ツール'],
  // 本体商品经常只写“オリジナル3Dモデル / 3Dキャラクター”，不会在标题中出现 avatar。
  'Avatar本体': ['avatar', 'アバター', '素体', 'オリジナル3dモデル', '3dキャラクター', '3dモデル'],
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
// 不强制按“最新”排序：长期存在的模型本体会被大量新上架的适配素材挤出首屏。
function boothSearchUrl(term) { return `https://booth.pm/ja/search/${encodeURIComponent(term)}?tags%5B%5D=VRChat`; }
const itemTextCache = new Map();
function contentTokens(filename) {
  const normalized = displayName(filename).normalize('NFKC').toLowerCase();
  const latin = [...normalized.matchAll(/[a-z][a-z0-9_-]{2,}/g)].map(match => match[0]);
  const cjk = [...normalized.matchAll(/[一-龥ぁ-んァ-ヶー]{2,}/g)].map(match => match[0]);
  return [...new Set([...latin, ...cjk].filter(token => !/^(?:ver(?:sion)?|version|beta|alpha|unity|vrc|vrchat|zip|rar|7z)$/i.test(token) && !/^v?\d+(?:[._-]\d+)*$/i.test(token)))].slice(0, 12);
}
function visibleItemText(html) { return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(?:amp|#38);/g, '&').replace(/&(?:quot|#34);/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').normalize('NFKC').toLowerCase(); }
const PACKAGE_PATH_NOISE = new Set(['assets', 'packages', 'projectsettings', 'library', 'editor', 'runtime', 'resources', 'textures', 'texture', 'materials', 'material', 'prefabs', 'prefab', 'scripts', 'script', 'shaders', 'shader', 'animations', 'animation', 'readme', 'license', 'changelog', 'documentation', 'docs', 'samples', 'sample', 'images', 'image', 'tool', 'tools']);
function decodeArchiveName(buffer) { return buffer.toString('utf8').replace(/\0.*$/, '').trim(); }
async function listZipPaths(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const tailSize = Math.min(stat.size, 65557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, stat.size - tailSize);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
    if (eocd < 0) return [];
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (!directorySize || directorySize > 8 * 1024 * 1024) return [];
    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);
    const paths = [];
    for (let offset = 0, count = 0; offset + 46 <= directory.length && count < Math.min(entries, 600); count++) {
      if (directory.readUInt32LE(offset) !== 0x02014b50) break;
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const end = offset + 46 + nameLength;
      if (end > directory.length) break;
      const entryName = decodeArchiveName(directory.subarray(offset + 46, end));
      if (entryName && !entryName.endsWith('/')) paths.push(entryName);
      offset = end + extraLength + commentLength;
    }
    return paths;
  } finally { await handle.close(); }
}
async function readZipReadmeTexts(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const tailSize = Math.min(stat.size, 65557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, stat.size - tailSize);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index--) if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
    if (eocd < 0) return [];
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (!directorySize || directorySize > 8 * 1024 * 1024) return [];
    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);
    const texts = [];
    for (let offset = 0; offset + 46 <= directory.length && texts.length < 3;) {
      if (directory.readUInt32LE(offset) !== 0x02014b50) break;
      const compression = directory.readUInt16LE(offset + 10);
      const compressedSize = directory.readUInt32LE(offset + 20);
      const uncompressedSize = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28);
      const extraLength = directory.readUInt16LE(offset + 30);
      const commentLength = directory.readUInt16LE(offset + 32);
      const localOffset = directory.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength;
      if (end > directory.length) break;
      const entryName = decodeArchiveName(directory.subarray(offset + 46, end));
      offset = end + extraLength + commentLength;
      if (!/(?:^|\/)(?:readme|info|description|説明)[^/]*\.(?:txt|md)$/i.test(entryName) || !compressedSize || uncompressedSize > 256 * 1024 || ![0, 8].includes(compression)) continue;
      const localHeader = Buffer.alloc(30);
      await handle.read(localHeader, 0, 30, localOffset);
      if (localHeader.readUInt32LE(0) !== 0x04034b50) continue;
      const localNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      const payload = Buffer.alloc(compressedSize);
      await handle.read(payload, 0, compressedSize, localOffset + 30 + localNameLength + localExtraLength);
      const content = compression === 8 ? zlib.inflateRawSync(payload) : payload;
      texts.push(content.toString('utf8'));
    }
    return texts;
  } catch { return []; }
  finally { await handle.close(); }
}
function readmeSearchTerms(texts) {
  const terms = [];
  for (const text of texts) for (const line of String(text).split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
    if (!/(?:商品|product|作品)/i.test(line) || line.length > 180) continue;
    const title = line.match(/】\s*([^【]{3,90})/)?.[1]
      ?.replace(/(?:です|である|になります|となります|。).*$/u, '')
      .trim();
    if (title && /[\p{L}]/u.test(title)) terms.push(title);
  }
  return [...new Set(terms)].slice(0, 3);
}
function tarSize(header) { return parseInt(header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim(), 8) || 0; }
async function listUnityPackagePaths(filePath) {
  const paths = [];
  let pending = Buffer.alloc(0);
  const stream = fsSync.createReadStream(filePath).pipe(zlib.createGunzip());
  try {
    for await (const chunk of stream) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= 512) {
        const header = pending.subarray(0, 512);
        if (header.every(byte => byte === 0)) return paths;
        const size = tarSize(header);
        const blockSize = 512 + Math.ceil(size / 512) * 512;
        if (pending.length < blockSize) break;
        const prefix = decodeArchiveName(header.subarray(345, 500));
        const name = decodeArchiveName(header.subarray(0, 100));
        const entryName = prefix ? `${prefix}/${name}` : name;
        if (entryName.endsWith('/pathname') && paths.length < 600) {
          const pathname = decodeArchiveName(pending.subarray(512, 512 + size));
          if (pathname) paths.push(pathname);
        }
        pending = pending.subarray(blockSize);
      }
    }
  } catch { return paths; }
  return paths;
}
function packageSearchClues(paths) {
  const counts = new Map();
  const creatorCounts = new Map();
  for (const pathname of paths) {
    const parts = pathname.replace(/\\/g, '/').split('/').filter(Boolean);
    const assetsIndex = parts.findIndex(part => normalizeSearchText(part) === 'assets');
    const meaningfulParts = parts.slice(assetsIndex >= 0 ? assetsIndex + 1 : 0);
    for (const [partIndex, rawPart] of meaningfulParts.entries()) {
      const part = rawPart.replace(/\.[^.]+$/, '').replace(/^\d+[_ -]*/, '').trim();
      const normalized = normalizeSearchText(part);
      if (part.length < 4 || !normalized || PACKAGE_PATH_NOISE.has(normalized) || /^[-_\d]+$/.test(part) || /^[0-9a-f]{12,}$/i.test(part)) continue;
      // ZIP 根目录里常直接放置一个 UnityPackage，例如
      // IRREGULARS_Knife003_Stingray_V1.0.unitypackage；它是商品线索而不是作者目录。
      const embeddedPackage = /\.(?:unitypackage|zip|rar|7z)$/i.test(rawPart);
      // Unity 资源通常是 Assets/<作者或工作室>/<商品目录>/…；首层只作消歧上下文，不能直接当商品名搜索。
      if (partIndex === 0 && !embeddedPackage) { creatorCounts.set(part, (creatorCounts.get(part) || 0) + 1); continue; }
      counts.set(part, (counts.get(part) || 0) + 1);
    }
  }
  const rank = map => [...map.entries()]
    .map(([term, count]) => ({ term, score: count * 100 + Math.min(term.length, 32) + (/[a-z].*[a-z]/i.test(term) ? 35 : 0) }))
    .sort((left, right) => right.score - left.score || right.term.length - left.term.length)
    .slice(0, 4)
    .map(item => item.term);
  const contentNames = [...new Set(paths.map(pathname => pathname.split(/[\\/]/).pop() || '')
    .filter(name => /\.(?:unitypackage|zip)$/i.test(name))
    .map(name => name.replace(/\.(?:unitypackage|zip)$/i, '').trim())
    .filter(name => name.length >= 5))].slice(0, 8);
  return { terms: rank(counts), creatorHints: rank(creatorCounts).slice(0, 3), contentNames };
}
async function inspectPackageHints(filePath) {
  if (!filePath || !EXTENSIONS.has(path.extname(filePath).toLowerCase())) return { terms: [], creatorHints: [], contentNames: [], readmeTerms: [] };
  try {
    const extension = path.extname(filePath).toLowerCase();
    const paths = extension === '.zip' ? await listZipPaths(filePath) : extension === '.unitypackage' ? await listUnityPackagePaths(filePath) : [];
    const pathClues = packageSearchClues(paths);
    const readmeTerms = extension === '.zip' ? readmeSearchTerms(await readZipReadmeTexts(filePath)) : [];
    return { ...pathClues, readmeTerms, terms: [...new Set([...readmeTerms, ...pathClues.terms])].slice(0, 8) };
  } catch { return { terms: [], creatorHints: [], contentNames: [], readmeTerms: [] }; }
}
async function scoreCandidateContents(filename, candidates, headers, creatorHints = [], packageContentNames = []) {
  const tokens = contentTokens(filename);
  if ((!tokens.length && !creatorHints.length && !packageContentNames.length) || !candidates.length) return candidates;
  const enriched = await Promise.all(candidates.slice(0, 8).map(async candidate => {
    try {
      let text = itemTextCache.get(candidate.url);
      if (!text) { const response = await fetch(candidate.url, { headers }); if (!response.ok) return candidate; text = visibleItemText(await response.text()); itemTextCache.set(candidate.url, text); }
      const normalizedText = normalizeSearchText(text);
      const matches = tokens.filter(token => text.includes(token));
      const creatorMatches = creatorHints.filter(hint => text.includes(hint.normalize('NFKC').toLowerCase()));
      const packageContentMatches = packageContentNames.filter(name => normalizedText.includes(normalizeSearchText(name)));
      const contentScore = matches.reduce((score, token) => score + (/[0-9]/.test(token) || token.length >= 7 ? 130 : token.length >= 4 ? 70 : 25), 0) + packageContentMatches.length * 1600;
      return { ...candidate, contentMatches: matches, creatorMatches, packageContentMatches, contentScore, score: candidate.score + contentScore };
    } catch { return candidate; }
  }));
  const evidence = new Map(enriched.map(candidate => [candidate.url, candidate]));
  return candidates.map(candidate => evidence.get(candidate.url) || candidate);
}
async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}
async function preloadBoothSearchPages(terms, headers) {
  const entries = await mapWithConcurrency(terms, 3, async term => {
    const searchUrl = boothSearchUrl(term);
    try {
      const response = await fetch(searchUrl, { headers });
      return [term, response.ok ? await response.text() : null];
    } catch { return [term, null]; }
  });
  return new Map(entries);
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
  const categoryNames = new Set(CATEGORY_DIRS);
  const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'runtime', 'cache', 'Booth素材整理器']);
  const assets = [];
  const addAsset = async (fullPath, entryName, containerCategory = null) => {
    const ext = path.extname(entryName).toLowerCase();
    if (!EXTENSIONS.has(ext)) return;
    const stat = await fs.stat(fullPath);
    const record = saved[fullPath] || {};
    assets.push({
      id: idFor(fullPath), name: displayName(entryName), rawName: entryName, fullPath, ext,
      kind: typeOf(entryName, ext), category: record.category || containerCategory || classify(entryName), size: formatSize(stat.size),
      modified: stat.mtime.toISOString().slice(0, 10), previewPath: IMAGE_EXTENSIONS.has(ext) ? fullPath : null,
      isDirectory: false, booth: record.booth || null, links: record.links || [], llmHints: record.llmHints || {}, parentPath: record.parentPath || null, confirmed: Boolean(record.confirmed), useDefaultCover: Boolean(record.useDefaultCover), customPreviewPath: record.customPreviewPath || null, localReference: Boolean(record.localReference), rootPath: root, isOrganized: Boolean(containerCategory), isLegacy: LEGACY_CATEGORY_DIRS.includes(containerCategory)
    });
  };
  const walk = async (directory, inheritedCategory = null) => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.vrc-asset-organizer.json') continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue;
        const nextCategory = inheritedCategory || (categoryNames.has(entry.name) ? entry.name : null);
        await walk(fullPath, nextCategory);
      } else if (entry.isFile()) {
        await addAsset(fullPath, entry.name, inheritedCategory);
      }
    }
  };
  await walk(root);
  return assets.sort((a, b) => b.modified.localeCompare(a.modified));
}

async function boothSearch(query, options = {}) {
  const originalTerms = searchTerms(query);
  const packageClues = await inspectPackageHints(options.assetPath);
  const packageHints = packageClues.terms;
  // Readme-derived titles are strongest, then other package paths, then the outer filename.
  let terms = [...new Set([...(packageClues.readmeTerms || []).flatMap(searchTerms), ...packageHints.flatMap(searchTerms), ...originalTerms])].slice(0, 10);
  let lastSearchUrl = boothSearchUrl(query);
  try {
    const headers = { 'User-Agent': 'VRCAssetOrganizer/0.1 (+https://github.com/Neil100o/vrc-asset-organizer)' };
    const llmSettings = await loadSettings();
    llmSettings.enabled = Boolean(options.useLlm && llmSettings.enabled && llmSettings.apiKey);
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
    let creatorHints = [...packageClues.creatorHints];
    let filenameAnalysis = null;
    const initialSearchTerms = itemUrl ? [] : terms;
    const initialPages = await preloadBoothSearchPages(initialSearchTerms, headers);
    for (const [termIndex, term] of initialSearchTerms.entries()) {
      const searchUrl = boothSearchUrl(term);
      lastSearchUrl = searchUrl;
      const page = initialPages.get(term);
      if (!page) continue;
      const thumbnails = new Map([...page.matchAll(/data-original="([^"]+)"[^>]*href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)"/gi)].map(match => [match[2], match[1]]));
      let candidates = [...page.matchAll(/item-card__title[\s\S]{0,500}?href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)">([^<]+)</gi)]
        .map(match => ({ url: match[1], title: match[2].replace(/&amp;/g, '&'), image: thumbnails.get(match[1]) || null }));
      const allowed = TAG_KEYWORDS[options.tag];
      if (allowed) candidates = candidates.filter(candidate => { const title = candidate.title.toLowerCase(); return allowed.some(keyword => title.includes(keyword.toLowerCase())); });
      const ranked = candidates.map(candidate => rankSearchCandidate(candidate, term, termIndex, terms.length)).sort((a, b) => b.score - a.score);
      for (const candidate of ranked) mergeSearchCandidate(candidatePool, candidate);
    }
    candidatePool.sort((left, right) => right.score - left.score);
    const strongBeforeLlm = hasStrongNormalMatch(candidatePool[0], candidatePool[1]);
    // 标题已有明确强匹配时不浪费一次 LLM 扩词调用；普通检索结果直接进入内容物校验。
    if (!itemUrl && !productId && !strongBeforeLlm) {
      const llmAliases = llmSettings.enabled ? await llmAnalyzeFilename(query, options.tag, llmSettings, packageClues) : { terms: [], creatorHints: [], analysis: null };
      filenameAnalysis = llmAliases.analysis;
      creatorHints = [...new Set([...creatorHints, ...llmAliases.creatorHints])];
      const aliases = [...knownNameAliases(query), ...llmAliases.terms];
      const extraTerms = aliases.filter(alias => !terms.some(term => term.normalize('NFKC').toLowerCase() === alias.normalize('NFKC').toLowerCase()));
      terms.push(...extraTerms);
      const aliasPages = await preloadBoothSearchPages(extraTerms, headers);
      for (const term of extraTerms) {
        const searchUrl = boothSearchUrl(term);
        lastSearchUrl = searchUrl;
        const page = aliasPages.get(term);
        if (!page) continue;
        const thumbnails = new Map([...page.matchAll(/data-original="([^"]+)"[^>]*href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)"/gi)].map(match => [match[2], match[1]]));
        let candidates = [...page.matchAll(/item-card__title[\s\S]{0,500}?href="(https:\/\/booth\.pm\/(?:ja\/)?items\/\d+)">([^<]+)</gi)]
          .map(match => ({ url: match[1], title: match[2].replace(/&amp;/g, '&'), image: thumbnails.get(match[1]) || null }));
        const allowed = TAG_KEYWORDS[options.tag];
        if (allowed) candidates = candidates.filter(candidate => { const title = candidate.title.toLowerCase(); return allowed.some(keyword => title.includes(keyword.toLowerCase())); });
        const ranked = candidates.map(candidate => rankSearchCandidate(candidate, term, terms.indexOf(term), terms.length)).sort((a, b) => b.score - a.score);
        for (const candidate of ranked) mergeSearchCandidate(candidatePool, candidate);
      }
    }
    candidatePool.splice(0, candidatePool.length, ...await scoreCandidateContents(query, candidatePool, headers, creatorHints, packageClues.contentNames));
    candidatePool.sort((a, b) => b.score - a.score);
    const evidenceBest = candidatePool[0];
    const evidenceRunnerUp = candidatePool[1];
    const normalStrong = hasStrongNormalMatch(evidenceBest, evidenceRunnerUp);
    const hardPackageMatch = Boolean(evidenceBest?.packageContentMatches?.length);
    const llmCanAudit = Boolean(llmSettings.enabled && !productId && !localConsensus && !trustedReference && !hardPackageMatch);
    // Smart/deep mode treats deterministic first place as provisional until audited.
    if (!productId && hardPackageMatch) {
      itemUrl = evidenceBest.url;
      matchedTerm = `包内 UnityPackage 内容物精确匹配：${evidenceBest.packageContentMatches.join(', ')}`;
    } else if (!productId && normalStrong && !llmCanAudit) {
      itemUrl = evidenceBest.url;
      matchedTerm = evidenceBest.contentScore >= 120 ? `内容物匹配: ${evidenceBest.contentMatches.join(', ')}` : evidenceBest.matchTerms?.[0] || query;
    }
    const llmQuery = options.tag ? `${query}（已知标签：${options.tag}）` : query;
    let llmVerdict = llmCanAudit ? await llmRerank(
      llmQuery,
      candidatePool.slice(0, 8),
      llmSettings,
      filenameAnalysis,
      { verifyNormalCandidate: normalStrong }
    ) : null;
    let deepVisionUsed = false;
    const deepSettings = deepModelSettings(llmSettings);
    const needsVision = Boolean(options.deepSearch && deepSettings && llmVerdict && (llmVerdict.index < 0 || llmVerdict.confidence < 0.7) && candidatePool.slice(0, 4).some(candidate => candidate.image));
    if (needsVision) {
      deepVisionUsed = true;
      llmVerdict = await llmRerank(llmQuery, candidatePool.slice(0, 4), deepSettings, filenameAnalysis, { useVision: true, verifyNormalCandidate: normalStrong });
    }
    if (llmCanAudit) {
      if (llmVerdict?.confidence >= 0.7 && candidatePool[llmVerdict.index] && hasDirectCandidateEvidence(query, candidatePool[llmVerdict.index])) { itemUrl = candidatePool[llmVerdict.index].url; matchedTerm = `LLM：${llmVerdict.reason || candidatePool[llmVerdict.index].title}`; }
      else { uncertaintyReason = llmVerdict?.reason || 'LLM 未找到足够的直接匹配证据'; }
    }
    const searchEvidence = { originalTerms, terms, packageHints, packageContentNames: packageClues.contentNames, packageCreatorHints: packageClues.creatorHints, relatedPackages: relatedBooth.map(item => item.name), localReferences: localReferences.map(item => item.name), localConsensus: localConsensus ? { count: localConsensus.items.length, itemUrl: localConsensus.url } : null, trustedReference: trustedReference ? { name: trustedReference.name, itemUrl: trustedReference.itemUrl } : null, creatorHints, filenameAnalysis, productId: productId || null, searchMode: options.deepSearch ? 'deep' : llmSettings.enabled ? 'smart' : 'normal', normalCandidateAudited: Boolean(llmCanAudit && normalStrong), deepVisionUsed, llm: localConsensus || trustedReference ? null : (llmSettings.enabled ? (llmVerdict || { index: -1, confidence: 0, reason: '没有给出可确认选择' }) : null) };
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
  const window = new BrowserWindow({ width: 1280, height: 820, minWidth: 960, minHeight: 680, icon: path.join(__dirname, 'build', 'icon.ico'), backgroundColor: '#f4f6f8', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  window.loadFile('index.html');
}

app.whenReady().then(async () => {
  await fs.mkdir(appDataDirectory(), { recursive: true });
  ipcMain.handle('choose-root', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const settings = await loadSettings();
    await saveSettings({ ...settings, rootPath: result.filePaths[0] });
    return result.filePaths[0];
  });
  ipcMain.handle('get-saved-root', async () => {
    const rootPath = (await loadSettings()).rootPath || DEFAULT_ROOT;
    const stat = await fs.stat(rootPath).catch(() => null);
    return stat?.isDirectory() ? rootPath : DEFAULT_ROOT;
  });
  ipcMain.handle('scan', (_, root) => scanFolder(root || DEFAULT_ROOT));
  ipcMain.handle('booth-search', (_, name, options) => boothSearch(name, options || {}));
  ipcMain.handle('get-llm-settings', async () => ({ settings: await loadSettings(), configPath: settingsPath(), logsPath: logsPath() }));
  ipcMain.handle('save-llm-settings', async (_, settings) => saveSettings(settings));
  ipcMain.handle('test-llm', async () => llmRerank('AA_FlintlockPistol', [{ title: 'フリントロック式ピストル', image: null }, { title: 'Audio Trace', image: null }]));
  ipcMain.handle('open-local-path', async (_, localPath) => { await fs.mkdir(localPath, { recursive: true }); return shell.openPath(localPath); });
  ipcMain.handle('choose-custom-preview', async (_, assetPath) => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const source = result.filePaths[0];
    const extension = path.extname(source).toLowerCase() || '.png';
    const targetDir = path.join(coverCachePath(), 'manual');
    const target = path.join(targetDir, `${idFor(assetPath)}${extension}`);
    await fs.mkdir(targetDir, { recursive: true });
    if (path.resolve(source) !== path.resolve(target)) await fs.copyFile(source, target);
    return target;
  });
  ipcMain.handle('save-classifications', async (_, root, assets) => {
    const indexPath = path.join(root, '.vrc-asset-organizer.json');
    const records = Object.fromEntries(assets.map(asset => [asset.fullPath, { category: asset.category, booth: asset.booth || null, links: asset.links || [], llmHints: asset.llmHints || {}, parentPath: asset.parentPath || null, confirmed: Boolean(asset.confirmed), useDefaultCover: Boolean(asset.useDefaultCover), customPreviewPath: asset.customPreviewPath || null, localReference: Boolean(asset.localReference) }]));
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
