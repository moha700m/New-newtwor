const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const toast = (message) => { const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>el.classList.remove('show'),2200); };

const ACTIONS = {
  text: {label:'نص', icon:'T', desc:'إنشاء نص', fields:[['text','النص','مرحبًا من Shortcut Forge']]},
  url: {label:'رابط URL', icon:'↗', desc:'إنشاء رابط', fields:[['url','الرابط','https://example.com']]},
  openurl: {label:'فتح الرابط', icon:'◉', desc:'يفتح الرابط السابق', fields:[]},
  location: {label:'الموقع الحالي', icon:'⌖', desc:'يجلب موقع الجهاز', fields:[]},
  mapslink: {label:'رابط خرائط', icon:'⌁', desc:'يحوّل الموقع السابق لرابط خرائط', fields:[]},
  date: {label:'التاريخ الحالي', icon:'◷', desc:'يمرر التاريخ والوقت الحالي', fields:[]},
  clipboard: {label:'نسخ للحافظة', icon:'▣', desc:'ينسخ الناتج السابق', fields:[]},
  showresult: {label:'عرض نتيجة', icon:'◎', desc:'يعرض نصًا للمستخدم', fields:[['text','الرسالة','تم التنفيذ']]},
  email: {label:'إرسال بريد', icon:'✉', desc:'يفتح شاشة إنشاء البريد', fields:[['to','إلى','name@example.com'],['subject','الموضوع','من الاختصار']]}
};

const COLORS = ['#ff9d42','#a887ff','#6ab5ff','#65d69a','#ff748c','#ffd166'];
const SEED = [
  {id:'starter-1',title:'روابط سريعة',description:'قالب بسيط يفتح رابطًا تختاره. أضف رابط iCloud عندما تنشره من Shortcuts.',category:'ويب',icon:'↗',color:'#6ab5ff',icloudUrl:''},
  {id:'starter-2',title:'موقعي على الخريطة',description:'قالب للموقع الحالي ثم رابط الخرائط. يحتاج إذن الموقع من Shortcuts.',category:'موقع',icon:'⌖',color:'#65d69a',icloudUrl:''},
  {id:'starter-3',title:'نص إلى الحافظة',description:'يبني نصًا ثم ينسخه مباشرة إلى الحافظة.',category:'إنتاجية',icon:'▣',color:'#a887ff',icloudUrl:''}
];

let flow=[];
let health={signingAvailable:false};
let currentCategory='الكل';
let catalog=loadCatalog();

function loadCatalog(){ try { const x=JSON.parse(localStorage.getItem('sf_catalog')||'null'); return Array.isArray(x)?x:SEED; } catch { return SEED; } }
function saveCatalog(){ localStorage.setItem('sf_catalog',JSON.stringify(catalog)); }
function saveFlow(){ localStorage.setItem('sf_flow',JSON.stringify({name:$('#shortcutName')?.value||'اختصاري الجديد',flow})); }
function restoreFlow(){ try { const x=JSON.parse(localStorage.getItem('sf_flow')||'null'); if(x&&Array.isArray(x.flow)){flow=x.flow;if(x.name)$('#shortcutName').value=x.name;} } catch {} }

function switchView(id){ $$('.view').forEach(v=>v.classList.toggle('active',v.id===id)); $$('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===id)); location.hash=id; scrollTo({top:0,behavior:'smooth'}); }
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.tab)));
$$('[data-go]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.go)));

function renderCatalog(){
  const cats=['الكل',...new Set(catalog.map(x=>x.category))];
  $('#categoryFilters').innerHTML=cats.map(c=>`<button class="${c===currentCategory?'active':''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
  $$('[data-cat]').forEach(b=>b.onclick=()=>{currentCategory=b.dataset.cat;renderCatalog();});
  const list=currentCategory==='الكل'?catalog:catalog.filter(x=>x.category===currentCategory);
  $('#catalogGrid').innerHTML=list.map((x,i)=>`<article class="shortcut-card" style="--card:${x.color||COLORS[i%COLORS.length]}"><div class="shortcut-icon">${escapeHtml(x.icon||'⌁')}</div><h3>${escapeHtml(x.title)}</h3><p>${escapeHtml(x.description)}</p><div class="shortcut-meta"><span class="pill">${escapeHtml(x.category)}</span>${x.icloudUrl?`<a class="install-link" href="${escapeAttr(x.icloudUrl)}" target="_blank" rel="noopener">إضافة الاختصار</a>`:`<button class="install-link disabled" data-edit-id="${escapeAttr(x.id)}">أضف رابط iCloud</button>`}</div></article>`).join('') || '<div class="empty-state"><b>لا توجد اختصارات</b></div>';
  $$('[data-edit-id]').forEach(b=>b.onclick=()=>editCatalogLink(b.dataset.editId));
}

function editCatalogLink(id){
  const item=catalog.find(x=>x.id===id); if(!item)return;
  const value=prompt('ألصق رابط iCloud للاختصار:',item.icloudUrl||'');
  if(value===null)return;
  if(value && !/^https:\/\/(www\.)?icloud\.com\/shortcuts\/[A-Za-z0-9]+/i.test(value)){toast('الرابط لا يبدو كرابط iCloud Shortcuts');return;}
  item.icloudUrl=value.trim();saveCatalog();renderCatalog();toast('تم تحديث رابط الاختصار');
}

function initPalette(){
  $('#actionPalette').innerHTML=Object.entries(ACTIONS).map(([id,a])=>`<button class="action-tile" data-action="${id}"><i>${a.icon}</i><span><b>${a.label}</b><small>${a.desc}</small></span></button>`).join('');
  $$('[data-action]').forEach(b=>b.onclick=()=>addAction(b.dataset.action));
}
function addAction(type,values={}){ const def=ACTIONS[type]; if(!def)return; const data={type,id:crypto.randomUUID(),...Object.fromEntries(def.fields.map(([k,,d])=>[k,values[k]??d]))}; flow.push(data);renderFlow(); }
function removeAction(id){flow=flow.filter(x=>x.id!==id);renderFlow();}
function moveAction(id,delta){const i=flow.findIndex(x=>x.id===id),j=i+delta;if(i<0||j<0||j>=flow.length)return;[flow[i],flow[j]]=[flow[j],flow[i]];renderFlow();}
function updateAction(id,key,value){const a=flow.find(x=>x.id===id);if(a){a[key]=value;updatePlist();saveFlow();}}

function renderFlow(){
  $('#flowCount').textContent=`${flow.length} إجراء`;
  $('#flowEmpty').style.display=flow.length?'none':'grid';
  $('#flowList').innerHTML=flow.map((a,i)=>{const d=ACTIONS[a.type];return `<article class="flow-card"><div class="num">${String(i+1).padStart(2,'0')}</div><div><h4>${d.icon} ${d.label}</h4><p>${d.desc}</p></div><div class="flow-tools"><button class="icon-btn" data-up="${a.id}" title="أعلى">↑</button><button class="icon-btn" data-down="${a.id}" title="أسفل">↓</button><button class="icon-btn" data-remove="${a.id}" title="حذف">×</button></div>${d.fields.length?`<div class="action-config">${d.fields.map(([k,l])=>`<input data-field-id="${a.id}" data-field-key="${k}" aria-label="${l}" placeholder="${l}" value="${escapeAttr(a[k]||'')}" />`).join('')}</div>`:''}</article>`}).join('');
  $$('[data-remove]').forEach(b=>b.onclick=()=>removeAction(b.dataset.remove));
  $$('[data-up]').forEach(b=>b.onclick=()=>moveAction(b.dataset.up,-1));
  $$('[data-down]').forEach(b=>b.onclick=()=>moveAction(b.dataset.down,1));
  $$('[data-field-id]').forEach(i=>i.oninput=()=>updateAction(i.dataset.fieldId,i.dataset.fieldKey,i.value));
  updatePlist();saveFlow();
}

function escapeXml(s=''){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');}
function xmlValue(v){ if(typeof v==='boolean') return v?'<true/>':'<false/>'; if(Number.isInteger(v)) return `<integer>${v}</integer>`; return `<string>${escapeXml(v)}</string>`; }
function dictXml(obj){return `<dict>${Object.entries(obj).map(([k,v])=>`<key>${escapeXml(k)}</key>${xmlValue(v)}`).join('')}</dict>`;}
function actionXml(a){
  const uuid=a.id.toUpperCase(); let identifier='',p={UUID:uuid};
  if(a.type==='text'){identifier='is.workflow.actions.gettext';p.WFTextActionText=a.text||'';}
  if(a.type==='url'){identifier='is.workflow.actions.url';p.WFURLActionURL=a.url||'';}
  if(a.type==='openurl'){identifier='is.workflow.actions.openurl';}
  if(a.type==='location'){identifier='is.workflow.actions.getcurrentlocation';p.Accuracy='Best';}
  if(a.type==='mapslink'){identifier='is.workflow.actions.getmapslink';}
  if(a.type==='date'){identifier='is.workflow.actions.date';p.WFDateActionMode='Current Date';}
  if(a.type==='clipboard'){identifier='is.workflow.actions.setclipboard';}
  if(a.type==='showresult'){identifier='is.workflow.actions.showresult';p.Text=a.text||'';}
  if(a.type==='email'){identifier='is.workflow.actions.sendemail';p.WFSendEmailActionShowComposeSheet=true;p.WFSendEmailActionToRecipients=a.to||'';p.WFSendEmailActionSubject=a.subject||'';}
  return `<dict><key>WFWorkflowActionIdentifier</key><string>${identifier}</string><key>WFWorkflowActionParameters</key>${dictXml(p)}</dict>`;
}
function generatePlist(){
  const name=$('#shortcutName').value.trim()||'اختصاري الجديد';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>WFWorkflowName</key><string>${escapeXml(name)}</string><key>WFWorkflowClientVersion</key><string>4033.0.4.3</string><key>WFWorkflowMinimumClientVersion</key><integer>1300</integer><key>WFWorkflowMinimumClientVersionString</key><string>1300</string><key>WFWorkflowIcon</key><dict><key>WFWorkflowIconGlyphNumber</key><integer>61440</integer><key>WFWorkflowIconStartColor</key><integer>4271458815</integer></dict><key>WFWorkflowInputContentItemClasses</key><array><string>WFTextContentItem</string><string>WFURLContentItem</string></array><key>WFWorkflowOutputContentItemClasses</key><array/><key>WFWorkflowHasOutputFallback</key><false/><key>WFWorkflowHasShortcutInputVariables</key><false/><key>WFWorkflowTypes</key><array><string>NCWidget</string></array><key>WFWorkflowImportQuestions</key><array/><key>WFWorkflowActions</key><array>${flow.map(actionXml).join('')}</array></dict></plist>`;
}
function updatePlist(){ const x=generatePlist(); $('#plistPreview').textContent=x; $('#structureState').textContent=flow.length?'جاهزة':'أضف إجراءات'; $('#structureState').style.color=flow.length?'var(--green)':'var(--muted)'; }

function downloadBlob(data,name,type='application/octet-stream'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([data],{type}));a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},800);}
$('#downloadBtn').onclick=()=>{if(!flow.length)return toast('أضف إجراء واحد على الأقل');downloadBlob(generatePlist(),`${safeFileName($('#shortcutName').value)}-unsigned.shortcut`);toast('تم تنزيل النسخة غير الموقعة');};
$('#copyPlistBtn').onclick=async()=>{await navigator.clipboard.writeText(generatePlist());toast('تم نسخ plist');};
$('#shortcutName').oninput=()=>{updatePlist();saveFlow();};

$('#signBtn').onclick=async()=>{
  if(!flow.length)return toast('أضف إجراء واحد على الأقل');
  if(!health.signingAvailable)return toast('التوقيع يحتاج تشغيل الخادم على macOS');
  const btn=$('#signBtn');const old=btn.textContent;btn.disabled=true;btn.textContent='جاري التوقيع…';
  try{
    const r=await fetch('/api/sign',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:$('#shortcutName').value,plist:generatePlist()})});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||'sign_failed');}
    const blob=await r.blob();downloadBlob(blob,`${safeFileName($('#shortcutName').value)}.shortcut`);toast('تم إنشاء ملف Shortcut موقّع');
  }catch(e){toast(`فشل التوقيع: ${e.message}`);}finally{btn.disabled=false;btn.textContent=old;}
};

$('#smartBuildBtn').onclick=()=>{
  const q=$('#smartPrompt').value.trim();if(!q)return toast('اكتب وصفًا أولًا');
  const next=[];const url=q.match(/https?:\/\/[^\s،]+/i)?.[0];
  if(/موقع|location|gps/i.test(q)) next.push({type:'location'},...( /خريط|map/i.test(q)?[{type:'mapslink'}]:[]));
  if(/وقت|تاريخ|date|time/i.test(q)) next.push({type:'date'});
  if(url){next.push({type:'url',url});if(/افتح|open/i.test(q))next.push({type:'openurl'});}
  const quoted=q.match(/["“](.*?)["”]/)?.[1];
  if(/اعرض|اظهر|أظهر|show/i.test(q)) next.push({type:'showresult',text:quoted||'تم التنفيذ'});
  if(/انسخ|clipboard|copy/i.test(q)) next.push({type:'clipboard'});
  if(!next.length) next.push({type:'text',text:q},{type:'showresult',text:q});
  flow=[];next.forEach(x=>addAction(x.type,x));toast('تم تحويل الوصف إلى تدفق مبدئي');
};

async function checkHealth(){
  try{health=await fetch('/api/health').then(r=>r.json());}catch{health={signingAvailable:false};}
  const s=$('#signerStatus');const sign=$('#signState');
  if(health.signingAvailable){s.className='status ok';s.innerHTML='<span></span> التوقيع على macOS متاح';sign.textContent='متاح';sign.style.color='var(--green)';}
  else{s.className='status off';s.innerHTML='<span></span> وضع البناء فقط';sign.textContent='يحتاج macOS';sign.style.color='var(--muted)';}
}

$('#addCatalogBtn').onclick=()=>$('#catalogDialog').showModal();
$('#catalogForm').addEventListener('submit',(e)=>{
  if(e.submitter?.value!=='default')return;
  e.preventDefault();const f=new FormData(e.currentTarget);const url=String(f.get('icloudUrl')||'').trim();
  if(url && !/^https:\/\/(www\.)?icloud\.com\/shortcuts\/[A-Za-z0-9]+/i.test(url))return toast('تحقق من رابط iCloud');
  catalog.unshift({id:crypto.randomUUID(),title:String(f.get('title')),description:String(f.get('description')),category:String(f.get('category')),icloudUrl:url,icon:'⌁',color:COLORS[Math.floor(Math.random()*COLORS.length)]});saveCatalog();renderCatalog();e.currentTarget.reset();$('#catalogDialog').close();toast('تمت إضافة الاختصار');
});

function safeFileName(s='Shortcut'){return String(s).replace(/[\\/:*?"<>|]/g,'-').trim().slice(0,80)||'Shortcut';}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function escapeAttr(s=''){return escapeHtml(s).replace(/`/g,'&#96;');}

initPalette();renderCatalog();restoreFlow();renderFlow();checkHealth();
const hash=location.hash.slice(1);if(['store','builder','guide'].includes(hash))switchView(hash);
