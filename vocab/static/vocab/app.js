const currentUsername = document.body.dataset.username || 'anonymous';
const storeKey = `gre-list-trainer-progress-v1:${currentUsername}`;
const listStoreKey = `gre-list-trainer-list-progress-v1:${currentUsername}`;
let words = [], queue = [], current = null, activeLists = [], isSubmitting = false, passNumber = 1;
let isCardFullscreen = false, touchStartX = 0, touchStartY = 0, touchStartAt = 0;
let progressCache = {}, listProgressCache = {}, masteredThisRound = new Set(), missedThisPass = new Map();
const $ = (id) => document.getElementById(id);
const studyTips = [
  '先说出中文核心意思，再说它和近义词的语气差别。',
  '把这个词放进一个 GRE 填空逻辑里：转折、因果，还是递进？',
  '如果它是熟词僻义，先忘掉日常意思，只记 GRE 考法。',
  '看英文考法，判断这个词偏褒义、贬义，还是中性。'
];

function csrfToken(){ return document.cookie.split('; ').find(row=>row.startsWith('csrftoken='))?.split('=')[1] || ''; }
async function api(path, options={}){
  const headers = {'Content-Type':'application/json', ...(options.headers || {})};
  if(options.method && options.method !== 'GET') headers['X-CSRFToken'] = csrfToken();
  const response = await fetch(path, {...options, headers});
  if(response.status === 401){
    window.location.href = `/login/?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error('AUTH_REQUIRED');
  }
  if(!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}
function loadProgress(){ return progressCache; }
function saveProgress(progress){ progressCache = progress; renderStats(); renderListProgress(); }
function saveListProgress(progress){ listProgressCache = progress; localStorage.setItem(listStoreKey, JSON.stringify(progress)); renderStats(); renderListProgress(); }
async function loadServerProgress(){
  try {
    progressCache = await api('/api/progress/');
    listProgressCache = await api('/api/lists/');
    localStorage.setItem(storeKey, JSON.stringify(progressCache));
    localStorage.setItem(listStoreKey, JSON.stringify(listProgressCache));
  } catch {
    progressCache = JSON.parse(localStorage.getItem(storeKey) || '{}');
    listProgressCache = JSON.parse(localStorage.getItem(listStoreKey) || '{}');
    $('queueInfo').textContent = '后台暂时不可用，已切换到浏览器本地进度。';
  }
}
function state(word){ return loadProgress()[word.id] || {seen:0, correct:0, wrong:0, ease:2.5, due:0, last:0}; }
async function updateWordState(word, grade){
  const p=loadProgress(); const s=state(word); s.seen++; s.last=Date.now();
  if(grade==='good') s.correct++; else s.wrong++;
  s.ease=Math.max(1.3, s.ease + ({again:-.35,hard:-.15,good:.08}[grade]));
  s.due=Date.now()+({again:20/1440,hard:1,good:3}[grade])*86400000;
  p[word.id]=s; saveProgress(p); localStorage.setItem(storeKey, JSON.stringify(p));
  try { await api(`/api/progress/${encodeURIComponent(word.id)}/`, {method:'PUT', body:JSON.stringify(s)}); } catch { $('queueInfo').textContent='本次词语进度已暂存在浏览器；后台恢复后可继续。'; }
}
async function completeActiveLists(){
  if(!activeLists.length) return;
  for(const listNo of activeLists){
    const nextCount = (listProgressCache[String(listNo)]?.completedCount || 0) + 1;
    listProgressCache[String(listNo)] = {completedCount: nextCount, updatedAt: Date.now()};
  }
  saveListProgress(listProgressCache);
  try {
    const results = await Promise.all(activeLists.map(listNo => api(`/api/lists/${listNo}/complete/`, {method:'POST', body:'{}'})));
    listProgressCache = Object.assign({}, listProgressCache, ...results);
    saveListProgress(listProgressCache);
  } catch { $('queueInfo').textContent='List 完成次数已暂存在浏览器；后台恢复后可继续。'; }
}
function normalizeMeaning(text){ return (text||'').replace(/^(adj|v|n|adv|prep|phr)\.\s*/,'').split(/[，,；;、]/)[0].trim(); }
function similarWords(word){ const key=normalizeMeaning(word.cn); if(!key) return []; return words.filter(w=>w.id!==word.id && (w.cn.includes(key) || key.includes(normalizeMeaning(w.cn)))).slice(0,8); }
function groupBySimilarity(listWords){
  const remaining = [...listWords], groups = [];
  while(remaining.length){
    const seed = remaining.shift();
    const key = normalizeMeaning(seed.cn);
    const group = [seed];
    for(let i=remaining.length-1; i>=0; i--){
      const otherKey = normalizeMeaning(remaining[i].cn);
      if(key && (remaining[i].cn.includes(key) || key.includes(otherKey))){ group.push(...remaining.splice(i,1)); }
    }
    groups.push(group.sort((a,b)=>a.index-b.index));
  }
  return groups.flat();
}
function shuffle(items){
  const copy = [...items];
  for(let i=copy.length-1; i>0; i--){ const j=Math.floor(Math.random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]]; }
  return copy;
}
function listWords(listNumbers, orderMode){
  const selected = new Set(listNumbers);
  const base = words.filter(w=>selected.has(w.list)).sort((a,b)=>a.list-b.list || a.index-b.index);
  if(orderMode==='random') return shuffle(base);
  if(orderMode==='similar') return groupBySimilarity(base);
  return base;
}
function selectedLists(){
  return [...$('listSelect').selectedOptions].map(option=>Number(option.value)).filter(Boolean).sort((a,b)=>a-b);
}
function activeListLabel(){
  if(!activeLists.length) return '未选择 List';
  if(activeLists.length===1) return `List ${activeLists[0]}`;
  return `Lists ${activeLists.join(', ')}`;
}
function makeSentence(word){ const meaning = word.en || normalizeMeaning(word.cn) || 'this idea'; return `The scholar's argument seemed ${word.word}: it suggested “${meaning}” rather than its everyday sense.`; }
function start(){
  document.activeElement?.blur();
  activeLists=selectedLists();
  if(!activeLists.length){
    $('queueInfo').textContent='请至少选择一个 List。按住 Cmd/Ctrl 可以多选。';
    return;
  }
  passNumber = 1;
  masteredThisRound = new Set();
  missedThisPass = new Map();
  queue = listWords(activeLists, $('orderMode').value);
  next();
}
async function next(){
  current=queue.shift(); $('answer').classList.add('hidden'); $('online').innerHTML='';
  if(!current){
    if(missedThisPass.size){
      queue = shuffle([...missedThisPass.values()]);
      missedThisPass = new Map();
      passNumber++;
      $('queueInfo').textContent=`第 ${passNumber} 轮：上一轮没记住的 ${queue.length} 个词会随机出现。`;
      current=queue.shift();
    }
  }
  if(!current){
    await completeActiveLists();
    $('badge').textContent=activeListLabel();
    $('word').textContent='完成';
    $('sentence').textContent=`${activeListLabel()} 全部记住，所选 List 背诵次数各 +1。`;
    $('queueInfo').textContent='本轮结束。漂亮，这一组已经被你按住了。';
    return;
  }
  $('badge').textContent=`List ${current.list} · #${current.index}`;
  $('word').textContent=current.word;
  $('sentence').textContent=makeSentence(current);
  $('cn').textContent=current.cn || '（PDF 未抽到中文释义）';
  $('en').textContent=current.en || '（PDF 未抽到英文考法）';
  $('studyTip').textContent=studyTips[(current.index + current.list) % studyTips.length];
  const sims=similarWords(current);
  $('similar').innerHTML=sims.length ? sims.map(w=>`<span class="chip">${w.word}：${normalizeMeaning(w.cn)}</span>`).join('') : '<span class="chip">暂无明显近义簇</span>';
  $('queueInfo').textContent=`${activeListLabel()} · 第 ${passNumber} 轮：已记住 ${masteredThisRound.size} 个，本轮剩余 ${queue.length + 1} 个，下一轮待复现 ${missedThisPass.size} 个。`;
}
function renderExamples(examples){
  // Text from the external dictionary API is inserted with textContent only (no innerHTML) to prevent XSS.
  const box=$('online'); box.replaceChildren();
  if(!examples.length){ box.textContent='在线词典没有返回例句；可用上面的 GRE 句子复习。'; return; }
  const title=document.createElement('strong'); title.textContent='在线例句：';
  const list=document.createElement('ul');
  for(const example of examples){ const item=document.createElement('li'); item.textContent=String(example); list.appendChild(item); }
  box.append(title, list);
}
async function fetchExample(){
  if(!current) return; $('online').textContent='正在搜索在线例句…';
  try { const res=await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(current.word)}`); const data=await res.json(); const defs=(Array.isArray(data)?data:[]).flatMap(x=>x.meanings||[]).flatMap(m=>m.definitions||[]); const examples=defs.map(d=>d.example).filter(Boolean).slice(0,3); renderExamples(examples); } catch { $('online').textContent='在线例句暂时拉取失败；离线复习不受影响。'; }
}
function renderStats(){
  const completedTodayTarget = 6;
  const totalCompletions = Object.values(listProgressCache).reduce((sum,item)=>sum+(item.completedCount||0),0);
  const touched = Object.values(progressCache).filter(s=>s.seen).length;
  $('stats').innerHTML=`<div>今日目标 ${completedTodayTarget} 个 List</div><div>累计 List 次数 ${totalCompletions}</div><div>已接触 ${touched}/${words.length} 词</div>`;
}
function renderListProgress(){
  const lists=[...new Set(words.map(w=>w.list))].sort((a,b)=>a-b);
  const html=lists.map(list=>{ const count=listProgressCache[String(list)]?.completedCount || 0; const total=words.filter(w=>w.list===list).length; return `<div class="list-pill"><b>List ${list}</b><span>${total} 词 · 已完整背 ${count} 次</span></div>`; }).join('');
  $('listReview').innerHTML=`<div class="list-grid">${html}</div>`;
}
function initLists(){
  const max=Math.max(...words.map(w=>w.list));
  $('listSelect').innerHTML=Array.from({length:max},(_,i)=>`<option value="${i+1}" ${i===0?'selected':''}>List ${i+1}</option>`).join('');
}
$('startBtn').addEventListener('click', start);
$('selectAllBtn').addEventListener('click', ()=>{
  [...$('listSelect').options].forEach(option=>{ option.selected = true; });
  document.activeElement?.blur();
});
$('clearListsBtn').addEventListener('click', ()=>{
  [...$('listSelect').options].forEach(option=>{ option.selected = false; });
  document.activeElement?.blur();
});
$('showBtn').addEventListener('click', showAnswer);
function showAnswer(){
  if(!current) return;
  $('answer').classList.remove('hidden');
  fetchExample();
}
async function enterCardFullscreen(){
  isCardFullscreen = true;
  document.body.classList.add('card-fullscreen');
  $('fullscreenBtn').textContent = '×';
  $('fullscreenBtn').setAttribute('aria-label', '退出全屏');
  try {
    if(!document.fullscreenElement && $('wordCard').requestFullscreen) await $('wordCard').requestFullscreen();
  } catch {}
}
async function exitCardFullscreen(){
  isCardFullscreen = false;
  document.body.classList.remove('card-fullscreen');
  $('fullscreenBtn').textContent = '⛶';
  $('fullscreenBtn').setAttribute('aria-label', '进入全屏');
  try {
    if(document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
  } catch {}
}
function toggleCardFullscreen(){
  if(isCardFullscreen) exitCardFullscreen();
  else enterCardFullscreen();
}
async function submitGrade(grade){
  if(isSubmitting) return;
  if(!current) return;
  isSubmitting = true;
  const answered=current;
  if(grade==='good') {
    masteredThisRound.add(answered.id);
    missedThisPass.delete(answered.id);
  } else {
    masteredThisRound.delete(answered.id);
    missedThisPass.set(answered.id, answered);
  }
  await updateWordState(answered, grade);
  next();
  isSubmitting = false;
}
document.querySelectorAll('[data-grade]').forEach(btn=>btn.addEventListener('click',()=>submitGrade(btn.dataset.grade)));
$('fullscreenBtn').addEventListener('click', (event)=>{ event.stopPropagation(); toggleCardFullscreen(); });
$('wordCard').addEventListener('click', (event)=>{
  if(!isCardFullscreen) return;
  if(event.target.closest('button')) return;
  if(event.target.closest('#answer')) return;
  showAnswer();
});
$('wordCard').addEventListener('touchstart', (event)=>{
  if(!isCardFullscreen || !event.changedTouches.length) return;
  touchStartX = event.changedTouches[0].clientX;
  touchStartY = event.changedTouches[0].clientY;
  touchStartAt = Date.now();
}, {passive:true});
$('wordCard').addEventListener('touchend', (event)=>{
  if(!isCardFullscreen || !event.changedTouches.length) return;
  const dx = event.changedTouches[0].clientX - touchStartX;
  const dy = event.changedTouches[0].clientY - touchStartY;
  const elapsed = Date.now() - touchStartAt;
  if(Math.abs(dx) > 90 && Math.abs(dx) > Math.abs(dy) * 1.8 && elapsed < 900){
    event.preventDefault();
    submitGrade(dx > 0 ? 'good' : 'again');
  }
}, {passive:false});
document.addEventListener('fullscreenchange', ()=>{
  if(!document.fullscreenElement && isCardFullscreen) exitCardFullscreen();
});
document.addEventListener('keydown', (event)=>{
  if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if(event.key==='Escape' && isCardFullscreen){ event.preventDefault(); exitCardFullscreen(); }
  if(event.key==='ArrowUp'){ event.preventDefault(); showAnswer(); }
  if(event.key==='ArrowLeft'){ event.preventDefault(); submitGrade('again'); }
  if(event.key==='ArrowRight'){ event.preventDefault(); submitGrade('good'); }
});
$('resetBtn').addEventListener('click',async()=>{ if(confirm('确定清空所有背诵进度和 List 次数？')){ localStorage.removeItem(storeKey); localStorage.removeItem(listStoreKey); saveProgress({}); saveListProgress({}); try { await api('/api/progress/', {method:'DELETE'}); await api('/api/lists/', {method:'DELETE'}); } catch {} }});
async function bootstrap(){ words = window.GRE_WORDS || await fetch('data/words.json').then(r=>r.json()); await loadServerProgress(); initLists(); renderStats(); renderListProgress(); $('queueInfo').textContent = '进度已载入。选择一个或多个 List 和出现方式开始。'; }
bootstrap();
