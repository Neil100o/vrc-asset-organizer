const state = { root: 'G:\\vrc素材', assets: [], selected: null, selectedIds: new Set(), selectionAnchorId: null, filter: 'all', query: '', pendingCategory: null, pendingFamilySource: null, pendingFamilyAssets: [], importedPaths: new Set() };
let updateState = 'idle';
let updateResetTimer = null;
const $ = (selector) => document.querySelector(selector);
let progressHideTimer = null;
function setSearchProgress(done, total, label) { clearTimeout(progressHideTimer); $('#searchProgress').hidden=false; $('#searchProgressLabel').textContent=label; $('#searchProgressValue').textContent=`${done} / ${total}`; $('#searchProgressBar').style.width=`${total ? Math.round(done / total * 100) : 0}%`; }
function hideSearchProgress(delay=0) { clearTimeout(progressHideTimer); const hide=()=>{ $('#searchProgress').hidden=true; }; if(delay) progressHideTimer=setTimeout(hide,delay); else hide(); }
document.querySelector('.rail-btn[data-filter="all"]').textContent = '待整理';
document.querySelector('.rail-btn[data-filter="06_Avatar本体"]').textContent = '模型';
document.querySelector('.rail-btn[data-filter="91_非VRC内容"]').style.display = 'none';
document.querySelector('.rail-btn[data-filter="legacy"]').style.display = 'none';
document.querySelector('.rail-btn[data-filter="90_待确认"]').insertAdjacentHTML('beforebegin','<button class="rail-btn" data-filter="09_ERP内容">ERP</button>');
const categoryOptions = ['01_道具','02_衣服','03_头发','04_妆容','05_功能插件','06_Avatar本体','07_场景与地图','08_贴图与材质','09_ERP内容','90_待确认','91_非VRC内容'];

function esc(value='') { const div=document.createElement('div'); div.textContent=value; return div.innerHTML; }
function fileUrl(filePath, version='') { return `file:///${encodeURI(filePath.replaceAll('\\','/'))}${version ? `?v=${encodeURIComponent(version)}` : ''}`; }
function coverSource(asset, visited = new Set()) {
  if (!asset || visited.has(asset.fullPath)) return null;
  visited.add(asset.fullPath);
  if (asset.customPreviewPath) return asset.customPreviewPath;
  if (asset.useDefaultCover) return null;
  const ownCover = asset.previewPath || asset.booth?.cachedImagePath || null;
  if (ownCover) return ownCover;
  const parent = asset.parentPath ? state.assets.find(item => item.fullPath === asset.parentPath) : null;
  return parent ? coverSource(parent, visited) : null;
}
function icon(asset) { return asset.kind.replace('压缩包','ARCHIVE').replace('Unity 包','UNITY').replace('图片','IMAGE').slice(0,10).toUpperCase(); }
const DEFAULT_COVERS = {
  '01_道具':['PROP','道具'], '02_衣服':['OUTFIT','衣服'], '03_头发':['HAIR','头发'], '04_妆容':['MAKEUP','妆容'],
  '05_功能插件':['SYSTEM','功能插件'], '06_Avatar本体':['AVATAR','Avatar 本体'], '07_场景与地图':['WORLD','场景 / 地图'], '08_贴图与材质':['MATERIAL','贴图 / 材质'], '09_ERP内容':['ERP','ERP 内容'],
  '01_VRC地图素材':['WORLD','场景 / 地图'], '02_Avatar素材':['AVATAR','Avatar 素材'], '03_通用3D模型与武器':['PROP','3D 模型 / 武器'], '04_当前房屋工程':['WORLD','场景工程'], '05_创作工具与AI':['SYSTEM','创作工具'], '07_贴图PSD与参考':['MATERIAL','贴图 / 参考'], '99_重复文件候选':['ARCHIVE','待处理素材']
};
const VIEW_TITLES = {
  all:'待整理素材', '01_道具':'道具素材', '02_衣服':'衣服素材', '03_头发':'头发素材', '04_妆容':'妆容素材',
  '05_功能插件':'功能插件', '06_Avatar本体':'Avatar 本体', '07_场景与地图':'场景与地图', '08_贴图与材质':'贴图与材质', '09_ERP内容':'ERP 内容',
  '90_待确认':'待确认素材', '91_非VRC内容':'非 VRC 内容', legacy:'旧分类素材'
};
VIEW_TITLES['06_Avatar本体']='模型本体';
VIEW_TITLES['02_Avatar素材']='模型素材';
function coverMarkup(asset) { const cover=coverSource(asset); if(cover) return `<img src="${fileUrl(cover)}" alt="${esc(asset.name)} 预览">`; const fallback=DEFAULT_COVERS[asset.category]; return fallback ? `<div class="default-cover"><span>${fallback[0]}</span><small>${fallback[1]} / 未绑定 BOOTH 封面</small></div>` : `<span>${icon(asset)}</span>`; }
function visibleAssets() { return state.assets.filter(a => (state.filter === 'all' ? !a.confirmed && a.category !== '91_非VRC内容' : state.filter === 'legacy' ? a.isLegacy : a.category === state.filter) && `${a.name} ${a.kind} ${a.category}`.toLowerCase().includes(state.query.toLowerCase())); }
function isPendingView() { return state.filter === 'all' || state.filter === '90_待确认'; }
function nextVisibleAsset(current, list = visibleAssets()) { const index = list.findIndex(item => item.id === current?.id); return list[index + 1] || list[index - 1] || null; }
function familyTokens(name) { return [...new Set((name.normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9]{4,}/g) || []).filter(token => !['interactive','addon','avatar','unity','package','system','model'].includes(token)))]; }
function sameProductSignal(firstName,secondName){const first=familyTokens(firstName).filter(token=>token.length>=7);const secondTokens=familyTokens(secondName).filter(token=>token.length>=7);const second=new Set(secondTokens);const shared=first.filter(token=>second.has(token));const sameLeadingFamily=Boolean(first[0]&&first[0]===secondTokens[0]);return shared.some(token=>token.length>=10)||shared.length>=2||sameLeadingFamily;}
function sameFamilyAssets(asset){return state.assets.filter(item=>item.id!==asset.id&&sameProductSignal(asset.name,item.name));}
function relatedBoothCandidates(asset) { if(!familyTokens(asset.name).length) return []; return state.assets.filter(item=>item.id!==asset.id&&item.booth?.matched&&item.booth?.itemUrl&&sameProductSignal(asset.name,item.name)).slice(0,3).map(item=>({name:item.name,title:item.booth.title,itemUrl:item.booth.itemUrl})); }
function localReferenceCandidates(asset) { if(!familyTokens(asset.name).length) return []; return state.assets.filter(item=>item.id!==asset.id&&item.localReference&&item.booth?.matched&&item.booth?.itemUrl&&sameProductSignal(asset.name,item.name)).slice(0,3).map(item=>({name:item.name,title:item.booth.title,itemUrl:item.booth.itemUrl})); }
const nativeBoothSearch=window.assetApi.boothSearch.bind(window.assetApi);
window.assetApi.boothSearch=(name,options={})=>state.selected?nativeBoothSearch(name,{...options,rootPath:state.root,assetPath:state.selected.fullPath,relatedBooth:relatedBoothCandidates(state.selected),localReferences:localReferenceCandidates(state.selected)}):nativeBoothSearch(name,options);
function searchEvidenceMarkup(result) {
  const evidence=result.searchEvidence;
  if(!evidence) return '';
  const terms=(evidence.terms||[]).map(term=>`<code>${esc(term)}</code>`).join('') || '<em>无</em>';
  const packageHints=(evidence.packageHints||[]).map(term=>`<code>${esc(term)}</code>`).join('');
  const packageContentNames=(evidence.packageContentNames||[]).map(term=>`<code>${esc(term)}</code>`).join('');
  const packageCreators=(evidence.packageCreatorHints||[]).map(term=>`<code>${esc(term)}</code>`).join('');
  const analysis=evidence.filenameAnalysis;
  const llmStructure=analysis?`<p><b>LLM 文件名分析（仅作检索假设）</b>${analysis.productTerms?.length?`商品：${esc(analysis.productTerms.join(' / '))}`:'商品：未知'}${analysis.seriesTerms?.length?` · 系列：${esc(analysis.seriesTerms.join(' / '))}`:''}${analysis.modelReferences?.length?` · 关联模型：${esc(analysis.modelReferences.join(' / '))}`:''}${analysis.packageKind?` · 包形态：${esc(analysis.packageKind)}`:''}</p>`:'';
  const related=(evidence.relatedPackages||[]).map(name=>`<li>${esc(name)}</li>`).join('');
  const auditPrefix=evidence.normalCandidateAudited?'已复核普通检索首选；':'';
  const llm=evidence.localConsensus ? `<li><b>本地同族包共识：</b>${evidence.localConsensus.count} 份已确认包指向同一 BOOTH 商品，已优先采用，LLM 不参与覆盖。</li>` : evidence.trustedReference ? `<li><b>人工本地参考：</b>已采用「${esc(evidence.trustedReference.name)}」确认过的 BOOTH 商品，LLM 不参与覆盖。</li>` : evidence.llm ? `<li><b>LLM 判别：</b>${auditPrefix}${evidence.llm.index >= 0 ? `候选 #${evidence.llm.index+1}` : '未确认任何候选'}；置信度 ${Math.round((Number(evidence.llm.confidence)||0)*100)}%${evidence.llm.reason?`；${esc(evidence.llm.reason)}`:''}${evidence.deepVisionUsed?'；文字不足，已额外查看前 4 张候选封面':''}</li>` : '<li><b>LLM 判别：</b>本次未启用</li>';
  const candidateEvidence=(result.candidates||[]).map((item,index)=>`<li><b>#${index+1} ${esc(item.title)}</b><span>总分 ${Math.round(item.score||0)}${item.matchTerms?.length?` · 检索词：${esc(item.matchTerms.join(' / '))}`:''}${item.matchedTokens?.length?` · 标题命中：${esc(item.matchedTokens.join(', '))}`:''}${item.contentMatches?.length?` · 内容物：${esc(item.contentMatches.join(', '))}`:''}${item.packageContentMatches?.length?` · 包内 UnityPackage 精确命中：${esc(item.packageContentMatches.join(', '))}`:''}${item.creatorMatches?.length?` · 作者线索：${esc(item.creatorMatches.join(', '))}`:''}${item.localRelatedName?` · 同族包：${esc(item.localRelatedName)}`:''}</span></li>`).join('');
  return `<details class="search-evidence"><summary>查看检索证据与候选分数</summary><div class="evidence-body"><p><b>实际检索词</b>${terms}</p>${packageHints?`<p><b>包内路径线索</b>${packageHints}</p>`:''}${packageContentNames?`<p><b>待核验的包内 UnityPackage</b>${packageContentNames}</p>`:''}${packageCreators?`<p><b>包内作者 / 工作室线索（仅消歧，不直接搜索）</b>${packageCreators}</p>`:''}${llmStructure}${evidence.productId?`<p><b>BOOTH 编号</b><code>${esc(evidence.productId)}</code></p>`:''}${related?`<p><b>本地同族包</b></p><ul>${related}</ul>`:''}<ul>${llm}</ul>${candidateEvidence?`<p><b>候选证据</b></p><ol>${candidateEvidence}</ol>`:''}</div></details>`;
}
function renderGrid() {
  const assets = visibleAssets();
  state.selectedIds = new Set([...state.selectedIds].filter(id => state.assets.some(asset => asset.id === id)));
  $('#count').textContent = assets.length;
  document.querySelector('.archive-head h2').textContent = VIEW_TITLES[state.filter] || '素材浏览';
  const selectedCount = state.selectedIds.size;
  $('#batchToolbar').hidden = !selectedCount;
  $('#batchToolbar').innerHTML = selectedCount ? `<span><b>${selectedCount}</b> 项已选 <small>Ctrl/⌘ 切换 · Shift 连续选择</small></span><label>批量分类<select id="batchCategory">${categoryOptions.filter(category => category !== '91_非VRC内容').map(category => `<option>${category}</option>`).join('')}</select></label><button id="clearBatch">取消选择</button><button class="primary" id="applyBatchCategory">保存 ${selectedCount} 项标签</button>` : '';
  $('#assetGrid').innerHTML = assets.length ? assets.map(a => `<article class="asset ${state.selected?.id===a.id?'selected':''} ${state.selectedIds.has(a.id)?'batch-selected':''}" data-id="${a.id}"><label class="asset-select" title="加入批量分类"><input type="checkbox" data-select-id="${a.id}" ${state.selectedIds.has(a.id)?'checked':''} aria-label="选择 ${esc(a.name)} 进行批量分类"><span>选择</span></label><button class="asset-open" data-open-id="${a.id}" aria-label="查看 ${esc(a.name)}"><div class="cover">${coverMarkup(a)}<small class="type">${esc(a.kind)}</small></div><div class="asset-info"><div class="asset-name">${esc(a.name)}</div><div class="asset-meta"><span>${esc(a.size)}</span><span>${esc(a.modified)}</span></div><span class="tag">${esc(a.category)}</span></div></button></article>`).join('') : '<p>没有符合条件的素材。</p>';
  document.querySelectorAll('.asset-open').forEach(el=>{el.addEventListener('click',event=>{ const asset=state.assets.find(a=>a.id===el.dataset.openId); const additive=event.ctrlKey||event.metaKey; if(event.shiftKey||additive){ const anchorIndex=assets.findIndex(item=>item.id===state.selectionAnchorId); const targetIndex=assets.findIndex(item=>item.id===asset.id); if(event.shiftKey&&anchorIndex>=0&&targetIndex>=0){ if(!additive) state.selectedIds.clear(); const [start,end]=[anchorIndex,targetIndex].sort((a,b)=>a-b); assets.slice(start,end+1).forEach(item=>state.selectedIds.add(item.id)); } else if(state.selectedIds.has(asset.id)) state.selectedIds.delete(asset.id); else state.selectedIds.add(asset.id); state.selectionAnchorId=asset.id; renderGrid(); return; } state.selected=asset; renderGrid(); renderDossier(); });el.addEventListener('dblclick',()=>window.assetApi.showInFolder(state.assets.find(a=>a.id===el.dataset.openId).fullPath));});
  document.querySelectorAll('[data-select-id]').forEach(input=>input.addEventListener('change',()=>{ if(input.checked){ state.selectedIds.add(input.dataset.selectId); state.selectionAnchorId=input.dataset.selectId; } else state.selectedIds.delete(input.dataset.selectId); renderGrid(); }));
  if($('#clearBatch')) $('#clearBatch').addEventListener('click',()=>{ state.selectedIds.clear(); state.selectionAnchorId=null; renderGrid(); });
  if($('#applyBatchCategory')) $('#applyBatchCategory').addEventListener('click',async()=>{ const ids = new Set(state.selectedIds); const category = $('#batchCategory').value; const before = visibleAssets(); state.assets.filter(asset=>ids.has(asset.id)).forEach(asset=>{ asset.category=category; asset.confirmed=true; }); state.selectedIds.clear(); state.selectionAnchorId=null; if(isPendingView()) state.selected=before.find(asset=>!ids.has(asset.id)) || null; await window.assetApi.saveClassifications(state.root,state.assets); $('#scanStatus').textContent=`BATCH TAG SAVED / ${ids.size} 项 → ${category} · 文件位置未改变`; renderGrid(); if(state.selected) renderDossier(); });
}
function renderDossier() {
  const asset = state.selected;
  if (!asset) return;
  const detailCover = coverSource(asset); const storedBooth=asset.booth?.itemUrl||''; $('#dossier').innerHTML = `<p class="detail-label">DOSSIER / ${esc(asset.kind)}</p><h2 class="detail-title">${esc(asset.name)}</h2><div class="detail-preview">${detailCover ? `<img src="${fileUrl(detailCover)}" alt="${esc(asset.name)} 预览">` : `<span>${icon(asset)}</span>`}</div><div class="facts"><div class="fact"><b>原始文件</b><span>${esc(asset.rawName)}</span></div><div class="fact"><b>大小</b><span>${esc(asset.size)}</span></div><div class="fact"><b>当前标签</b><span>${esc(asset.category)}</span></div>${asset.customPreviewPath?`<div class="fact"><b>封面</b><span>手动预览图</span></div>`:''}${storedBooth?`<div class="fact"><b>BOOTH</b><button id="openStoredBooth">查看商品页</button></div>`:''}</div><section class="candidate" id="boothCandidate"><span class="detail-label">BOOTH / NOT CHECKED</span><p>尚未检索。会以素材名作为关键词访问 BOOTH；低置信度匹配仍需人工确认。</p><label class="detail-label">手动 BOOTH 链接<input id="boothLinkInput" placeholder="https://booth.pm/ja/items/…"></label><button id="applyBoothLink">抓取链接中的商品与预览图</button></section><div class="actions"><button id="boothSearch">在 BOOTH 查找候选</button><button id="chooseCustomPreview">选择本地预览图</button>${asset.customPreviewPath?'<button id="clearCustomPreview">清除手动预览图</button>':''}<button id="openPath">打开原文件位置</button><label class="detail-label">分类标签<select class="move-select" id="categorySelect">${categoryOptions.map(c=>`<option ${c===asset.category?'selected':''}>${c}</option>`).join('')}</select></label><label class="detail-label">其它链接<input id="externalLink" placeholder="粘贴链接"></label><button id="saveLink">保存链接</button><button class="primary" id="saveCategory">确认并保存标签</button><button id="requestMove">可选：移动原文件到分类目录</button></div>`;
  if(!detailCover && DEFAULT_COVERS[asset.category]) $('#dossier .detail-preview').innerHTML=coverMarkup(asset);
  const isAvatarModel=asset.category==='06_Avatar本体'||asset.category==='02_Avatar素材';
  $('#dossier .actions').insertAdjacentHTML('afterbegin',`<div class="manual-search-links"><button id="openBoothManual">在 BOOTH 手动搜索</button><button id="openBoothplorerManual">${isAvatarModel?'打开 Boothplorer 模型浏览':'打开 Boothplorer 素材浏览'}</button></div>`);
  const familyAssets=sameFamilyAssets(asset);
  if(asset.booth?.matched) $('#boothCandidate').innerHTML=`<span class="detail-label">BOOTH / CONFIRMED</span><p>已绑定：${esc(asset.booth.title || 'BOOTH 商品')}。可使用下方按钮重新检索或手动替换链接。</p><button id="toggleLocalReference" class="reference-action">${asset.localReference?'移出本地参考库':'加入本地参考库'}</button>${familyAssets.length?`<button id="applyFamilyBinding" class="reference-action">将当前作为主素材：绑定并关联 ${familyAssets.length} 个同族包</button><p class="mode-hint">仅识别同一英文主名前缀：${familyAssets.map(item=>esc(item.rawName)).join('、')}</p>`:''}<label class="detail-label">手动 BOOTH 链接<input id="boothLinkInput" placeholder="https://booth.pm/ja/items/…"></label><button id="applyBoothLink">抓取链接中的商品与预览图</button>`;
  $('#boothCandidate').insertAdjacentHTML('beforeend','<button id="useDefaultCover" class="default-cover-action">↺ 切回分类默认封面</button>');
  const currentSearchMode=asset.llmHints?.searchMode||(asset.llmHints?.useLlm?'smart':'normal'); $('#boothCandidate').insertAdjacentHTML('beforeend',`<label class="detail-label">已知标签<select id="llmTag" class="move-select"><option value="">不指定</option>${['道具','衣服','头发','妆容','功能插件','Avatar本体','场景地图','贴图材质','ERP内容'].map(t=>`<option ${asset.llmHints?.tag===t?'selected':''}>${t}</option>`).join('')}</select></label><label class="detail-label">检索模式<select id="searchMode" class="move-select"><option value="normal" ${currentSearchMode==='normal'?'selected':''}>普通检索（不使用 LLM）</option><option value="smart" ${currentSearchMode==='smart'?'selected':''}>智能检索（文本 LLM，复核首选）</option><option value="deep" ${currentSearchMode==='deep'?'selected':''}>深度检索（复核首选，必要时看封面）</option></select></label><p class="mode-hint">智能与深度模式都会审核普通检索的首选结果；LLM 不确定时不会自动绑定，仍会保留候选供确认。深度模式仅在文字无法区分时额外发送前 4 张候选封面。</p>`);
  if($('#useDefaultCover')) $('#useDefaultCover').addEventListener('click',async()=>{asset.booth=null;asset.customPreviewPath=null;asset.useDefaultCover=true;await window.assetApi.saveClassifications(state.root,state.assets);$('#scanStatus').textContent='BOOTH BINDING CLEARED / USING CATEGORY COVER';renderGrid();renderDossier();});
  if($('#toggleLocalReference')) $('#toggleLocalReference').addEventListener('click',async()=>{asset.localReference=!asset.localReference;await window.assetApi.saveClassifications(state.root,state.assets);$('#scanStatus').textContent=asset.localReference?'LOCAL REFERENCE SAVED / 仅保存在本机':'LOCAL REFERENCE REMOVED';renderDossier();});
  if($('#applyFamilyBinding')) $('#applyFamilyBinding').addEventListener('click',()=>{state.pendingFamilySource=asset;state.pendingFamilyAssets=familyAssets;$('#familyBindingText').textContent=`“${asset.rawName}”将作为主素材。勾选的文件会同步同一 BOOTH 链接与封面，并被关联为它的附属包；不会移动原文件。`;$('#familyBindingList').innerHTML=familyAssets.map(item=>`<label><input type="checkbox" value="${esc(item.id)}" checked><span>${esc(item.rawName)}</span></label>`).join('');$('#familyBindingDialog').showModal();});
  const parentAsset=state.assets.find(item=>item.fullPath===asset.parentPath); const children=state.assets.filter(item=>item.parentPath===asset.fullPath); $('#dossier').insertAdjacentHTML('beforeend',`<section class="candidate relation"><span class="detail-label">RELATION / 附属关联</span>${parentAsset?`<p>所属主素材：<button id="openParent">${esc(parentAsset.name)}</button></p>`:''}${children.length?`<p>关联附属：${children.map(item=>esc(item.name)).join('、')}</p>`:''}<label class="detail-label">关联到主素材<select id="parentSelect" class="move-select"><option value="">未关联</option>${state.assets.filter(item=>item.id!==asset.id).map(item=>`<option value="${esc(item.fullPath)}" ${item.fullPath===asset.parentPath?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label><button id="saveRelation">保存关联</button></section>`);
  const parentSelect=$('#parentSelect'); const emptyParentOption=parentSelect.options[0].cloneNode(true); const parentOptions=[...parentSelect.options].slice(1).sort((a,b)=>a.textContent.localeCompare(b.textContent,'zh-Hans-CN-u-co-pinyin',{numeric:true,sensitivity:'base'})); let parentSelection=parentSelect.value; const refreshParentOptions=(query='')=>{const normalized=query.trim().toLowerCase();parentSelect.replaceChildren(emptyParentOption.cloneNode(true),...parentOptions.filter(option=>option.textContent.toLowerCase().includes(normalized)));if([...parentSelect.options].some(option=>option.value===parentSelection))parentSelect.value=parentSelection;}; document.querySelector('.relation').insertAdjacentHTML('afterbegin','<label class="detail-label parent-search">搜索主素材<input id="parentFilter" type="search" placeholder="按名称或首字母筛选"></label>'); refreshParentOptions(); parentSelect.addEventListener('change',()=>{parentSelection=parentSelect.value;}); $('#parentFilter').addEventListener('input',event=>refreshParentOptions(event.target.value));
  if(children.length){document.querySelector('.relation').insertAdjacentHTML('beforeend',`<div class="related-items">${children.map(item=>`<button class="related-child" data-child-id="${item.id}">${esc(item.name)}</button>`).join('')}</div>`);document.querySelectorAll('.related-child').forEach(button=>button.addEventListener('click',()=>{state.selected=state.assets.find(item=>item.id===button.dataset.childId);renderGrid();renderDossier();}));}
  $('#boothSearch').addEventListener('click', async () => { const searchMode=$('#searchMode').value; asset.llmHints={searchMode,useLlm:searchMode!=='normal',deepSearch:searchMode==='deep',tag:$('#llmTag').value}; $('#boothCandidate').innerHTML='<span class="detail-label">BOOTH / SEARCHING</span><p>正在查找商品与缩略图…</p>'; const result=await nativeBoothSearch(asset.name,{...asset.llmHints,rootPath:state.root,assetPath:asset.fullPath,relatedBooth:relatedBoothCandidates(asset),localReferences:localReferenceCandidates(asset)}); asset.booth=result; await window.assetApi.saveClassifications(state.root,state.assets); renderGrid(); const preview = result.cachedImagePath ? fileUrl(result.cachedImagePath) : result.image; const picks=(result.candidates||[]).map((c,i)=>`<button class="candidate-pick" data-url="${esc(c.url)}">${c.image?`<img src="${esc(c.image)}" alt="">`:''}<span>${i+1}. ${esc(c.title)} <small>评分 ${Math.round(c.score||0)}</small></span></button>`).join(''); $('#boothCandidate').innerHTML=`<span class="detail-label">BOOTH / RESULT</span><p>${esc(result.status)}</p>${preview?`<img src="${esc(preview)}" alt="BOOTH 搜索预览">`:''}${picks?`<p>点选候选封面确认：</p><div class="candidate-options">${picks}</div>`:''}${searchEvidenceMarkup(result)}<button id="openBooth">打开 BOOTH 搜索结果</button>`; $('#openBooth').addEventListener('click',()=>window.assetApi.openExternal(result.searchUrl)); document.querySelectorAll('.candidate-pick').forEach(button=>button.addEventListener('click',async()=>{const selected=await window.assetApi.boothSearch(button.dataset.url,{useLlm:false});asset.booth=selected;asset.useDefaultCover=false;asset.coverRevision=Date.now();asset.localReference=true;await window.assetApi.saveClassifications(state.root,state.assets);$('#scanStatus').textContent='BOOTH CONFIRMED / LOCAL REFERENCE SAVED';renderGrid();renderDossier();})); });
  $('#openBoothManual').addEventListener('click',()=>window.assetApi.openExternal(`https://booth.pm/ja/search/${encodeURIComponent(asset.name)}?tags%5B%5D=VRChat`));
  if($('#openBoothplorerManual')) $('#openBoothplorerManual').addEventListener('click',()=>window.assetApi.openExternal(`${isAvatarModel?'https://boothplorer.com/avatars':'https://boothplorer.com/items'}?search=${encodeURIComponent(asset.name)}`));
  $('#chooseCustomPreview').addEventListener('click',async()=>{const previewPath=await window.assetApi.chooseCustomPreview(asset.fullPath);if(!previewPath)return;asset.customPreviewPath=previewPath;asset.useDefaultCover=false;asset.coverRevision=Date.now();await window.assetApi.saveClassifications(state.root,state.assets);$('#scanStatus').textContent='CUSTOM PREVIEW SAVED / 已复制到本地数据目录';renderGrid();renderDossier();});
  if($('#clearCustomPreview')) $('#clearCustomPreview').addEventListener('click',async()=>{asset.customPreviewPath=null;asset.coverRevision=Date.now();await window.assetApi.saveClassifications(state.root,state.assets);$('#scanStatus').textContent='CUSTOM PREVIEW CLEARED';renderGrid();renderDossier();});
  $('#openPath').addEventListener('click',()=>window.assetApi.openExternal(fileUrl(asset.fullPath)));
  if(storedBooth)$('#openStoredBooth').addEventListener('click',()=>window.assetApi.openExternal(storedBooth));
  $('#applyBoothLink').addEventListener('click',async()=>{const link=$('#boothLinkInput').value.trim();if(!/^https:\/\/[^/]*booth\.pm\/.*items\/\d+/i.test(link)){ $('#scanStatus').textContent='请输入有效的 BOOTH 商品链接'; return;} $('#boothCandidate').innerHTML='<span class="detail-label">BOOTH / FETCHING</span><p>正在下载商品信息和预览图…</p>';const result=await window.assetApi.boothSearch(link);asset.booth=result;asset.localReference=true;await window.assetApi.saveClassifications(state.root,state.assets);renderGrid();renderDossier();});
  $('#saveCategory').addEventListener('click',async()=>{ const next = isPendingView() ? nextVisibleAsset(asset) : asset; asset.category=$('#categorySelect').value; asset.confirmed=true; state.selected=next; await window.assetApi.saveClassifications(state.root,state.assets); $('#scanStatus').textContent=`TAG SAVED / ${asset.category} · 文件位置未改变`; renderGrid(); if(state.selected) renderDossier(); else $('#dossier').innerHTML='<div class="empty"><span>DONE / 已完成</span><p>当前待处理列表已经没有素材。</p></div>'; });
  $('#saveLink').addEventListener('click',async()=>{const link=$('#externalLink').value.trim();if(!/^https?:\/\//i.test(link))return;asset.links=[...new Set([...(asset.links||[]),link])];await window.assetApi.saveClassifications(state.root,state.assets);$('#scanStatus').textContent='LINK SAVED';});
  $('#saveRelation').addEventListener('click',async()=>{asset.parentPath=$('#parentSelect').value||null;await window.assetApi.saveClassifications(state.root,state.assets);$('#scanStatus').textContent=asset.parentPath?'RELATION SAVED':'RELATION CLEARED';renderDossier();});
  if(parentAsset)$('#openParent').addEventListener('click',()=>{state.selected=parentAsset;renderGrid();renderDossier();});
  $('#requestMove').addEventListener('click',()=>{ state.pendingCategory=$('#categorySelect').value; $('#moveText').textContent=`“${asset.rawName}” 将从当前目录移动到 “${state.pendingCategory}”。此操作会改变原文件位置。`; $('#moveDialog').showModal(); });
}
async function scan() { $('#scanStatus').textContent='SCANNING…'; state.assets=await window.assetApi.scan(state.root); state.selected=null; renderGrid(); $('#dossier').innerHTML='<div class="empty"><span>SELECT / 选择素材</span><p>从左侧档案中选取一项，检查 BOOTH 候选和分类标签。</p></div>'; $('#scanStatus').textContent=`READY / ${state.assets.length} ITEMS`; }
$('#scan').addEventListener('click',scan); $('#chooseRoot').addEventListener('click',async()=>{ const folder=await window.assetApi.chooseRoot(); if(folder){state.root=folder;$('#rootName').textContent=folder;scan();} });
function setUpdateUi(status = {}) {
  const button = $('#checkUpdates');
  if (!button) return;
  updateState = status.state || 'idle';
  clearTimeout(updateResetTimer);
  const reset = () => { updateResetTimer = setTimeout(() => { if (updateState !== 'downloading' && updateState !== 'downloaded') { updateState='idle'; button.disabled=false; button.textContent='检查更新'; } }, 2800); };
  if (updateState === 'checking') { button.disabled=true; button.textContent='正在检查…'; $('#scanStatus').textContent='UPDATE / 正在检查新版本'; return; }
  if (updateState === 'available') { button.disabled=false; button.textContent=`下载 v${status.version || '新版'}`; $('#scanStatus').textContent=`UPDATE AVAILABLE / v${status.version || '新版'}，点击下载`; return; }
  if (updateState === 'downloading') { button.disabled=true; button.textContent=`正在下载 ${status.percent || 0}%`; $('#scanStatus').textContent=`UPDATE / 正在下载 v${status.version || '新版'}：${status.percent || 0}%`; return; }
  if (updateState === 'downloaded') { button.disabled=false; button.textContent='重启并安装'; $('#scanStatus').textContent=`UPDATE READY / v${status.version || '新版'} 已下载`; return; }
  if (updateState === 'not-available') { button.disabled=false; button.textContent='已是最新版'; $('#scanStatus').textContent=`UPDATE / 已是最新版${status.version ? ` v${status.version}` : ''}`; reset(); return; }
  if (updateState === 'unsupported') { button.disabled=false; button.textContent='检查更新'; $('#scanStatus').textContent=`UPDATE / ${status.message || '此版本请手动下载更新'}`; return; }
  if (updateState === 'error') { button.disabled=false; button.textContent='检查更新'; $('#scanStatus').textContent=`UPDATE FAILED / ${status.message || '检查失败，请稍后重试'}`; return; }
  button.disabled=false; button.textContent='检查更新';
}
$('#checkUpdates').addEventListener('click', async () => {
  let result;
  if (updateState === 'available') result = await window.assetApi.downloadUpdate();
  else if (updateState === 'downloaded') { await window.assetApi.installUpdate(); return; }
  else result = await window.assetApi.checkForUpdates();
  if (result?.state && result.state !== 'checking') setUpdateUi(result);
});
window.assetApi.onUpdateStatus(setUpdateUi);
function suggestedCategory(title=''){const text=title.toLowerCase();return text.includes('hair')||text.includes('髪')||text.includes('ヘア')?'03_头发':text.includes('makeup')||text.includes('メイク')||text.includes('化粧')?'04_妆容':text.includes('outfit')||text.includes('衣装')||text.includes('服装')?'02_衣服':text.includes('plugin')||text.includes('system')||text.includes('tool')||text.includes('ツール')||text.includes('ギミック')||text.includes('shader')?'05_功能插件':text.includes('avatar')||text.includes('アバター')?'06_Avatar本体':text.includes('world')||text.includes('ワールド')?'07_场景与地图':text.includes('texture')||text.includes('material')||text.includes('テクスチャ')?'08_贴图与材质':'01_道具';}
async function mapWithConcurrency(items, limit, worker){const results=[];let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const index=cursor++;results[index]=await worker(items[index],index);}}));return results;}
$('#classifyAll').addEventListener('click', async () => {
  const targets = state.assets.filter(asset => !asset.booth?.matched && asset.category !== '91_非VRC内容');
  if (!targets.length) { $('#scanStatus').textContent='没有需要基础检索的 VRC 素材'; return; }
  const button=$('#classifyAll'); button.disabled=true;
  let confirmed=0; let pending=0; let failed=0; let completed=0;
  setSearchProgress(0,targets.length,'正在准备基础检索…');
  try {
    await mapWithConcurrency(targets,2,async(asset)=>{
      $('#scanStatus').textContent=`基础检索 ${completed + 1}/${targets.length} / ${asset.rawName}`;
      setSearchProgress(completed,targets.length,`正在检索：${asset.rawName}`);
      try {
        asset.llmHints={...(asset.llmHints||{}),searchMode:'normal',useLlm:false,deepSearch:false};
        const result=await nativeBoothSearch(asset.name,{rootPath:state.root,assetPath:asset.fullPath,tag:asset.llmHints.tag||''});
        asset.booth=result;
        if(result.matched){ asset.category=suggestedCategory(result.title); asset.confirmed=true; confirmed++; }
        else pending++;
      } catch(error) {
        asset.booth={matched:false,status:`检索失败，等待手动确认：${error.message}`}; failed++;
      } finally {
        completed++;
        setSearchProgress(completed,targets.length,completed===targets.length?'基础检索完成':`已完成：${asset.rawName}`);
      }
      renderGrid();
    });
    await window.assetApi.saveClassifications(state.root,state.assets);
    state.selected=null;
    await scan();
    $('#scanStatus').textContent=`基础检索完成 / 已确认标签 ${confirmed} · 待确认 ${pending} · 失败 ${failed} · 未移动文件`;
  } finally {
    button.disabled=false;
    if (completed === targets.length) {
      setSearchProgress(completed,targets.length,'基础检索完成');
      hideSearchProgress(2600);
    } else {
      hideSearchProgress(800);
    }
  }
});
document.querySelectorAll('.rail-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelector('.rail-btn.active').classList.remove('active');btn.classList.add('active');state.filter=btn.dataset.filter;renderGrid();}));
$('#filter').addEventListener('input',e=>{state.query=e.target.value;renderGrid();});
let droppedPaths=[];let dragDepth=0;
const dropOverlay=$('#dropOverlay');
document.addEventListener('dragenter',event=>{event.preventDefault();dragDepth++;if(event.dataTransfer?.types.includes('Files'))dropOverlay.classList.add('active');});
document.addEventListener('dragover',event=>event.preventDefault());
document.addEventListener('dragleave',event=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)dropOverlay.classList.remove('active');});
document.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;dropOverlay.classList.remove('active');droppedPaths=[...event.dataTransfer.files].map(file=>window.assetApi.getDroppedPath(file)).filter(path=>/\.(zip|rar|7z|unitypackage)$/i.test(path));if(!droppedPaths.length){$('#scanStatus').textContent='仅支持 ZIP、RAR、7Z、Unity Package';return;}const target=categoryOptions.includes(state.filter)?`“${state.filter}”分类页`:'“待整理”页';$('#importText').textContent=`将 ${droppedPaths.length} 个文件导入到${target}。选择“移动”会移动原文件；选择“复制”会保留原文件。`;$('#importDialog').showModal();});
$('#cancelImport').addEventListener('click',()=>$('#importDialog').close());
$('#cancelFamilyBinding').addEventListener('click',()=>$('#familyBindingDialog').close());
$('#confirmFamilyBinding').addEventListener('click',async()=>{const source=state.pendingFamilySource;const selectedIds=new Set([...document.querySelectorAll('#familyBindingList input:checked')].map(input=>input.value));const siblings=state.pendingFamilyAssets.filter(item=>selectedIds.has(item.id));if(!source||!siblings.length){$('#familyBindingDialog').close();return;}const button=$('#confirmFamilyBinding');button.disabled=true;try{source.localReference=true;for(const sibling of siblings){sibling.booth={...source.booth,candidates:source.booth.candidates||[]};sibling.parentPath=source.fullPath;sibling.useDefaultCover=false;sibling.coverRevision=Date.now();}await window.assetApi.saveClassifications(state.root,state.assets);$('#familyBindingDialog').close();$('#scanStatus').textContent=`FAMILY LINKED / ${siblings.length} ATTACHMENTS`;renderGrid();renderDossier();}finally{button.disabled=false;state.pendingFamilySource=null;state.pendingFamilyAssets=[];}});
async function importDropped(mode){const button=mode==='move'?$('#moveImport'):$('#copyImport');button.disabled=true;try{const target=categoryOptions.includes(state.filter)?state.filter:'';const imported=await window.assetApi.importAssets(droppedPaths,state.root,mode,target);$('#importDialog').close();await scan();if(target){state.assets.filter(asset=>imported.includes(asset.fullPath)).forEach(asset=>{asset.category=target;asset.confirmed=true;});await window.assetApi.saveClassifications(state.root,state.assets);}$('#scanStatus').textContent=`IMPORTED / ${imported.length} FILES`;}catch(error){window.alert(`导入失败：${error.message}`);}finally{button.disabled=false;droppedPaths=[];}}
$('#moveImport').addEventListener('click',()=>importDropped('move'));$('#copyImport').addEventListener('click',()=>importDropped('copy'));
document.addEventListener('click',event=>{const pick=event.target.closest('.candidate-pick');if(pick&&!window.confirm('确认使用这个 BOOTH 候选封面吗？')){event.preventDefault();event.stopImmediatePropagation();return;}if(event.target.closest('.candidate-pick,#boothSearch,#applyBoothLink')&&state.selected)state.selected.useDefaultCover=false;},true);
$('#llmSettings').addEventListener('click',async()=>{ const data=await window.assetApi.getLlmSettings(); const s=data.settings; $('#llmEnabled').checked=s.enabled; $('#llmEndpoint').value=s.endpoint; $('#llmModel').value=s.model; $('#llmApiKey').value=s.apiKey; $('#deepEndpoint').value=s.deepEndpoint||''; $('#deepModel').value=s.deepModel||''; $('#deepApiKey').value=s.deepApiKey||''; $('#llmVision').checked=s.useVision; $('#debugPaths').textContent=`配置：${data.configPath}\n日志：${data.logsPath}`; $('#llmTestResult').textContent=''; $('#settingsDialog').showModal(); });
function readLlmForm(){return {enabled:$('#llmEnabled').checked,endpoint:$('#llmEndpoint').value.trim(),model:$('#llmModel').value.trim(),apiKey:$('#llmApiKey').value.trim(),deepEndpoint:$('#deepEndpoint').value.trim(),deepModel:$('#deepModel').value.trim(),deepApiKey:$('#deepApiKey').value.trim(),useVision:$('#llmVision').checked};}
$('#saveLlm').addEventListener('click',async()=>{await window.assetApi.saveLlmSettings(readLlmForm());$('#llmTestResult').textContent='设置已保存。';});
$('#testLlm').addEventListener('click',async()=>{await window.assetApi.saveLlmSettings(readLlmForm());$('#llmTestResult').textContent='正在测试…';const result=await window.assetApi.testLlm();$('#llmTestResult').textContent=result ? `测试结果：${JSON.stringify(result)}` : '测试未运行：请确认已启用并填写 API 密钥。';});
$('#openLogs').addEventListener('click',async()=>{const data=await window.assetApi.getLlmSettings();await window.assetApi.openLocalPath(data.logsPath);});
  $('#cancelMove').addEventListener('click',()=>$('#moveDialog').close());
  $('#confirmMove').addEventListener('click',async(e)=>{e.preventDefault(); const asset=state.selected; if(!asset)return; const button=$('#confirmMove'); button.disabled=true; button.textContent='正在移动…'; try { const previousPath=asset.fullPath; const result=await window.assetApi.moveAsset(asset,state.pendingCategory); asset.fullPath=result.target; asset.category=state.pendingCategory; asset.isOrganized=true; asset.confirmed=true; state.assets.forEach(item=>{if(item.parentPath===previousPath)item.parentPath=result.target;}); await window.assetApi.saveClassifications(state.root,state.assets); $('#moveDialog').close(); $('#scanStatus').textContent=`MOVED / ${result.target}`; await scan(); } catch(error){$('#scanStatus').textContent=`MOVE FAILED / ${error.message}`; $('#moveDialog').close(); window.alert(`移动失败：${error.message}\n\n文件：${asset.fullPath}\n目标分类：${state.pendingCategory}`);} finally { button.disabled=false; button.textContent='确认并移动'; } });
async function initialize(){
  state.root=await window.assetApi.getSavedRoot();
  $('#rootName').textContent=state.root;
  await scan();
}
initialize();
