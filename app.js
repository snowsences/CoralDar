'use strict';

const RELEASE = 7;
const TANK_GALLONS = 32;
const OWNER_UID = 'zZQ1UmFVKyMjmu4PvhVIoaqwPU93';
const FIREBASE_CONFIG = {apiKey:'AIzaSyBJWUH4WUZ5viWuj5XgXhDgSpdsneNhFUQ',authDomain:'coraldar-d348f.firebaseapp.com',projectId:'coraldar-d348f',storageBucket:'coraldar-d348f.firebasestorage.app',messagingSenderId:'111139321454',appId:'1:111139321454:web:2d4a1d61aec5a110c2987f'};
const STORAGE_KEY = 'coraldar-v1'; // legacy local mirror; migrated to Firestore's offline cache on sign-in
const TAB_KEY = 'coraldar-active-tab';
const BACKUP_FORMAT = 'coraldar-encrypted-backup';
const COLLECTIONS = ['tests','waterChanges','doses','fishEntries','corals','coralNotes','tankVisual','goals'];
const TEST_TYPES = [
  ['temperature','Temperature','°F','#ef5f59',78,81],['salinity','Salinity','SG','#5b9cf0',1.025,1.026],['ph','pH','','#44c9c0',7.8,8.4],['nitrate','Nitrate','ppm','#f29b45',5,15],
  ['phosphorus','Phosphorus','ppb','#a881e6',7,33],['nitrite','Nitrite','ppm','#ef744b',0,0],['ammonia','Ammonia','ppm','#d8bd3f',0,0],['magnesium','Magnesium','ppm','#64b87a',1250,1450]
];
const FISH_TABS = [['midas-blenny','Midas Blenny'],['clownfish','Clownfish'],['azure-damsel','Azure Damsel'],['mandarin-goby','Mandarin Goby'],['invertebrates','Invertebrates']];
const NAV = [
  ['testing','Testing','M4 19V5m0 7h16M8 5v14M12 8v8M16 6v12'],['water','Water Changes','M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11Z'],
  ['dosing','Dosing','M9 3h6M10 3v5l-4 7a4 4 0 0 0 3.5 6h5a4 4 0 0 0 3.5-6l-4-7V3M8 15h8'],['fish','Fish','M4 12c3-5 8-7 13-4l3-3v6l-3-3c-5 3-10 1-13-4Zm3 0h.01'],
  ['coral','Coral','M12 21v-8M12 13 8 9M12 13l4-5M8 9 5 4M16 8l-4-4M8 9 1-5'],['visual','Tank Visual','M3 5h18v14H3zM7 15l3-3 3 3 2-2 3 3M8 9h.01'],['goals','Goals','M12 3v18M5 7h7M5 7l3-3M5 7l3 3M19 17h-7M19 17l-3-3M19 17l-3 3']
];

const $ = s => document.querySelector(s);
const main = $('#main'), nav = $('#mainNav'), primaryAction = $('#primaryAction'), editorDialog = $('#editorDialog'), editorForm = $('#editorForm'), settingsDialog = $('#settingsDialog');
let data = emptyData();
let activeTab = localStorage.getItem(TAB_KEY) || 'testing';
let testType = 'temperature', testRange = '3m', fishTab = FISH_TABS[0][0], coralTab = '', firebase = null, currentUser = null, unsubscribers = [], toastTimer, renderQueued = false, editorSnapshot = '', authNotice = '', cacheReady = Promise.resolve(), pendingSync = {}, legacyCoralNotes = [];

function emptyData(){ return {tests:[],waterChanges:[],doses:[],fishEntries:[],corals:[],coralNotes:[],tankVisual:[],goals:[],settings:{schema:2}}; }
function readLegacyLocal(){ try{const raw=localStorage.getItem(STORAGE_KEY);return raw?normalizeData(JSON.parse(raw)):null}catch{return null} }
function clearPrivateLocal(){ localStorage.removeItem(STORAGE_KEY); data=emptyData(); pendingSync={}; legacyCoralNotes=[]; }
const esc = value => String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const safeText = (value,max=1000) => String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ').trim().slice(0,max);
const safeId = value => /^[A-Za-z0-9_-]{1,128}$/.test(String(value||'')) ? String(value) : crypto.randomUUID();
const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? String(value) : '';
const safeTime = value => /^\d{2}:\d{2}$/.test(String(value||'')) ? String(value) : '';
const finite = (value,min=-1e6,max=1e6) => { const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):0; };
// Photos may only point at Cloudinary image delivery URLs; anything else (javascript:, data:, other hosts, markup) is dropped.
const CLOUDINARY_IMAGE = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/[A-Za-z0-9_\-.\/,:]+$/;
const safePhotos = (list,max) => (Array.isArray(list)?list:[]).slice(0,max).map(p=>{const url=typeof p==='string'?p:p?.url;return typeof url==='string'&&url.length<=500&&CLOUDINARY_IMAGE.test(url)?{id:safeId(p?.id),url,caption:safeText(p?.caption,200),createdAt:safeText(p?.createdAt,40)||timestamp()}:null}).filter(Boolean);
const today = () => new Date().toLocaleDateString('en-CA');
const fmtTime = t => t ? new Date(`2000-01-01T${t}:00`).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) : '';
const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
const timestamp = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const testMeta = key => TEST_TYPES.find(item=>item[0]===key) || TEST_TYPES[0];
const targetLabel = meta => meta[4]===meta[5] ? `Target: ${meta[4]}${meta[2]?' '+meta[2]:''}` : `Target: ${meta[4]}–${meta[5]}${meta[2]?' '+meta[2]:''}`;
const targetStatus = (value,meta) => value<meta[4]?'Below target':value>meta[5]?'Above target':'Within target';

function normalizeData(raw){
  const base=emptyData(), source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  base.tests=(Array.isArray(source.tests)?source.tests:[]).slice(0,10000).map(v=>({id:safeId(v.id),type:TEST_TYPES.some(x=>x[0]===v.type)?v.type:'temperature',value:finite(v.value),date:safeDate(v.date)||today(),createdAt:safeText(v.createdAt,40)||timestamp()}));
  base.waterChanges=(Array.isArray(source.waterChanges)?source.waterChanges:[]).slice(0,5000).map(v=>({id:safeId(v.id),gallons:finite(v.gallons,0,TANK_GALLONS*3),date:safeDate(v.date)||today(),notes:safeText(v.notes,1000),createdAt:safeText(v.createdAt,40)||timestamp()}));
  base.doses=(Array.isArray(source.doses)?source.doses:[]).slice(0,10000).map(v=>({id:safeId(v.id),additive:safeText(v.additive,120),amount:safeText(v.amount,80),date:safeDate(v.date)||today(),time:safeTime(v.time),notes:safeText(v.notes,1000),createdAt:safeText(v.createdAt,40)||timestamp()})).filter(v=>v.additive);
  base.fishEntries=(Array.isArray(source.fishEntries)?source.fishEntries:[]).slice(0,10000).map(v=>({id:safeId(v.id),fish:FISH_TABS.some(x=>x[0]===v.fish)?v.fish:FISH_TABS[0][0],kind:['feeding','behavior'].includes(v.kind)?v.kind:'behavior',date:safeDate(v.date)||today(),time:safeTime(v.time),text:safeText(v.text,2000),photos:safePhotos(v.photos,20),createdAt:safeText(v.createdAt,40)||timestamp()})).filter(v=>v.text);
  const rawCorals=(Array.isArray(source.corals)?source.corals:[]).slice(0,1000).filter(v=>v&&typeof v==='object').map(v=>({...v,id:safeId(v.id)}));
  base.corals=rawCorals.map(v=>({id:v.id,name:safeText(v.name,120),genus:safeText(v.genus,120),acquisitionDate:safeDate(v.acquisitionDate),photos:safePhotos(v.photos,50),createdAt:safeText(v.createdAt,40)||timestamp()})).filter(v=>v.name);
  // Older data embedded notes inside each coral; lift them into coralNotes (deduped by id).
  const embedded=rawCorals.flatMap(c=>(Array.isArray(c.notes)?c.notes:[]).slice(0,1000).map(n=>({...n,coralId:c.id})));
  const noteMap=new Map();for(const n of [...embedded,...(Array.isArray(source.coralNotes)?source.coralNotes:[])].slice(0,20000)){const note=n&&typeof n==='object'&&/^[A-Za-z0-9_-]{1,128}$/.test(String(n.coralId||''))?{id:safeId(n.id),coralId:String(n.coralId),date:safeDate(n.date)||today(),text:safeText(n.text,4000),createdAt:safeText(n.createdAt,40)||timestamp()}:null;if(note?.text)noteMap.set(note.id,note)}
  base.coralNotes=[...noteMap.values()];
  base.tankVisual=(Array.isArray(source.tankVisual)?source.tankVisual:[]).slice(0,5000).map(v=>({id:safeId(v.id),date:safeDate(v.date)||today(),notes:safeText(v.notes,2000),photos:safePhotos(v.photos,50),createdAt:safeText(v.createdAt,40)||timestamp()}));
  base.goals=(Array.isArray(source.goals)?source.goals:[]).slice(0,2000).map(v=>({id:safeId(v.id),title:safeText(v.title,200),notes:safeText(v.notes,3000),targetDate:safeDate(v.targetDate),photos:safePhotos(v.photos,50),createdAt:safeText(v.createdAt,40)||timestamp()})).filter(v=>v.title);
  base.settings={schema:2}; return base;
}

function icon(path){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`}
const ICONS = {edit:'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',close:'M6 6l12 12M18 6 6 18',plus:'M12 5v14M5 12h14'};
function renderNav(){nav.innerHTML=NAV.map(([id,label,path])=>`<button class="nav-tab ${id===activeTab?'active':''}" data-tab="${id}" ${id===activeTab?'aria-current="page"':''}>${icon(path)}<span>${label}</span></button>`).join('');nav.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;localStorage.setItem(TAB_KEY,activeTab);render()})}
function render(){renderNav(); primaryAction.textContent=['visual','goals','fish','coral'].includes(activeTab)?(activeTab==='coral'&&!data.corals.length?'Add Coral':activeTab==='visual'?'Add Entry':activeTab==='goals'?'Add Goal':activeTab==='fish'?'Add Entry':'Add Note'):'Add Data';
  ({testing:renderTesting,water:renderWater,dosing:renderDosing,fish:renderFish,coral:renderCoral,visual:renderVisual,goals:renderGoals}[activeTab]||renderTesting)();
}
function screenHead(title,sub=''){return `<div class="screen-head"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div></div>`}
function empty(title,copy){return `<div class="empty"><h3>${esc(title)}</h3><div>${esc(copy)}</div></div>`}

function renderTesting(){
  const meta=testMeta(testType), rows=data.tests.filter(x=>x.type===testType).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  main.innerHTML=`<section class="screen stack">${screenHead('Testing','One measurement at a time.')}
    <div class="chips">${TEST_TYPES.map(([id,label])=>`<button class="chip ${id===testType?'active':''}" data-test-type="${id}">${esc(label)}</button>`).join('')}</div>
    <div class="panel"><div class="toolbar toolbar-split"><div><strong>${esc(meta[1])} history</strong><div class="muted subline">${esc(targetLabel(meta))}</div></div><div class="chips">${[['3m','3 Months'],['1y','1 Year'],['3y','3 Years']].map(([r,l])=>`<button class="chip ${r===testRange?'active':''}" data-range="${r}">${l}</button>`).join('')}</div></div>${chartSvg(rows,meta)}</div>
    <div class="list">${rows.length?rows.map(testRow).join(''):empty(`No ${meta[1].toLowerCase()} readings`,`Add your first ${meta[1].toLowerCase()} measurement.`)}</div></section>`;
  main.querySelectorAll('[data-test-type]').forEach(b=>b.onclick=()=>{testType=b.dataset.testType;renderTesting()});main.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{testRange=b.dataset.range;renderTesting()});wireRows('test');
}
function chartSvg(rows,meta){const days={"3m":92,"1y":366,"3y":1096}[testRange],cut=Date.now()-days*86400000,points=rows.filter(r=>new Date(r.date+'T12:00:00').getTime()>=cut).sort((a,b)=>a.date.localeCompare(b.date));if(!points.length)return `<div class="empty empty-inset">No readings in this range.</div>`;const vals=points.map(p=>p.value).concat([meta[4],meta[5]]),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1,w=760,h=220,pad=28,x=i=>pad+(points.length===1?(w-2*pad)/2:i*(w-2*pad)/(points.length-1)),y=v=>h-pad-(v-min)/span*(h-2*pad),coords=points.map((p,i)=>`${x(i)},${y(p.value)}`).join(' '),targetMarkup=meta[4]===meta[5]?`<line x1="${pad}" y1="${y(meta[4])}" x2="${w-pad}" y2="${y(meta[4])}" stroke="${meta[3]}" stroke-width="2" stroke-dasharray="6 5" opacity=".5"/>`:`<rect x="${pad}" y="${Math.min(y(meta[4]),y(meta[5]))}" width="${w-2*pad}" height="${Math.abs(y(meta[4])-y(meta[5]))}" fill="${meta[3]}" opacity=".09"/><line x1="${pad}" y1="${y(meta[4])}" x2="${w-pad}" y2="${y(meta[4])}" stroke="${meta[3]}" opacity=".35"/><line x1="${pad}" y1="${y(meta[5])}" x2="${w-pad}" y2="${y(meta[5])}" stroke="${meta[3]}" opacity=".35"/>`;return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(meta[1])} chart"><line class="gridline" x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}"/><line class="gridline" x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"/>${targetMarkup}<polyline class="series" stroke="${meta[3]}" points="${coords}"/>${points.map((p,i)=>`<circle class="dot" cx="${x(i)}" cy="${y(p.value)}" r="4" fill="${meta[3]}"><title>${esc(fmtDate(p.date))}: ${p.value}${meta[2]?' '+meta[2]:''} · ${targetStatus(p.value,meta)}</title></circle>`).join('')}<text x="${pad}" y="16">${max}${meta[2]?' '+meta[2]:''}</text><text x="${pad}" y="${h-5}">${esc(fmtDate(points[0].date))}</text><text x="${w-pad}" text-anchor="end" y="${h-5}">${esc(fmtDate(points.at(-1).date))}</text></svg>`}
function testRow(r){const m=testMeta(r.type);return `<article class="row"><div class="row-copy"><strong>${esc(fmtDate(r.date))}</strong><span>${esc(m[1])}</span><small>${esc(targetStatus(r.value,m))}</small></div><div class="row-end"><div class="row-value">${r.value}${m[2]?` <small>${esc(m[2])}</small>`:''}</div>${rowActions(r.id)}</div></article>`}

function renderWater(){const rows=[...data.waterChanges].sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)),last=rows[0],six=rows.filter(r=>new Date(r.date+'T12:00:00')>=new Date(Date.now()-184*86400000));main.innerHTML=`<section class="screen stack">${screenHead('Water Changes',`Tank volume: ${TANK_GALLONS} gallons`)}<div class="metric-row"><div class="metric"><span>Last water change</span><strong>${last?esc(fmtDate(last.date)):'—'}</strong></div><div class="metric"><span>Last amount</span><strong>${last?`${last.gallons} gal`:'—'}</strong></div><div class="metric"><span>Last percentage</span><strong>${last?`${pct(last.gallons)}%`:'—'}</strong></div></div><div class="panel"><strong>Last 6 months</strong>${waterChart(six)}</div><div class="list">${rows.length?rows.map(waterRow).join(''):empty('No water changes yet','Log the gallons changed; CoralDar calculates the percentage of the 32 gallon tank.')}</div></section>`;wireRows('water')}
const pct=g=>Math.round((Number(g)/TANK_GALLONS*100)*10)/10;
function waterChart(rows){const p=[...rows].sort((a,b)=>a.date.localeCompare(b.date));if(!p.length)return `<div class="empty empty-inset">No water changes in the last 6 months.</div>`;const vals=p.map(x=>pct(x.gallons)),max=Math.max(10,...vals),w=760,h=220,pad=28,x=i=>pad+(p.length===1?(w-2*pad)/2:i*(w-2*pad)/(p.length-1)),y=v=>h-pad-v/max*(h-2*pad),coords=p.map((r,i)=>`${x(i)},${y(pct(r.gallons))}`).join(' ');return `<svg class="chart" viewBox="0 0 ${w} ${h}"><line class="gridline" x1="${pad}" y1="${pad}" x2="${pad}" y2="${h-pad}"/><line class="gridline" x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"/><polyline class="series" stroke="#5b9cf0" points="${coords}"/>${p.map((r,i)=>`<circle class="dot" cx="${x(i)}" cy="${y(pct(r.gallons))}" r="4" fill="#5b9cf0"><title>${esc(fmtDate(r.date))}: ${pct(r.gallons)}%</title></circle>`).join('')}</svg>`}
function waterRow(r){return `<article class="row"><div class="row-copy"><strong>${esc(fmtDate(r.date))}</strong>${r.notes?`<span>${esc(r.notes)}</span>`:''}</div><div class="row-end"><div class="row-value">${r.gallons} gal <small>· ${pct(r.gallons)}%</small></div>${rowActions(r.id)}</div></article>`}

function renderDosing(){const rows=[...data.doses].sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));main.innerHTML=`<section class="screen stack">${screenHead('Dosing','A simple history of what was added and when.')} ${rows.length?`<div class="timeline">${rows.map(r=>`<article class="timeline-item"><time>${esc(fmtDate(r.date))}${r.time?` · ${esc(fmtTime(r.time))}`:''}</time><strong>${esc(r.additive)}${r.amount?` · ${esc(r.amount)}`:''}</strong>${r.notes?`<div class="muted">${esc(r.notes)}</div>`:''}<div class="timeline-actions">${rowActions(r.id)}</div></article>`).join('')}</div>`:empty('No dosing history','Add a dose when you add something to the tank.')}</section>`;wireRows('dose')}

function renderFish(){const label=FISH_TABS.find(x=>x[0]===fishTab)?.[1]||'',rows=data.fishEntries.filter(x=>x.fish===fishTab).sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));main.innerHTML=`<section class="screen stack">${screenHead('Fish','Feeding and behavior notes by animal.')}<div class="subtabs">${FISH_TABS.map(([id,l])=>`<button class="subtab ${id===fishTab?'active':''}" data-fish="${id}">${esc(l)}</button>`).join('')}</div><div class="list">${rows.length?rows.map(r=>`<article class="row"><div class="row-copy"><strong>${r.kind==='feeding'?'Feeding':'Behavior'} · ${esc(fmtDate(r.date))}${r.time?` · ${esc(fmtTime(r.time))}`:''}</strong><span>${esc(r.text)}</span></div>${rowActions(r.id)}</article>`).join(''):empty(`No ${label} entries`,'Add a feeding or behavior note.')}</div></section>`;main.querySelectorAll('[data-fish]').forEach(b=>b.onclick=()=>{fishTab=b.dataset.fish;renderFish()});wireRows('fish')}

function renderCoral(){if(!coralTab&&data.corals.length)coralTab=data.corals[0].id;const selected=data.corals.find(x=>x.id===coralTab);main.innerHTML=`<section class="screen stack">${screenHead('Coral','Your corals and their notes.')}<div class="subtabs"><button class="subtab ${!selected?'active':''}" data-coral-new>${icon(ICONS.plus)}<span>Add coral</span></button>${data.corals.map(c=>`<button class="subtab ${c.id===coralTab?'active':''}" data-coral="${c.id}">${esc(c.name)}</button>`).join('')}</div>${selected?coralDetail(selected):empty('No coral yet','Create a coral subtab to track its details and dated notes.')}</section>`;main.querySelector('[data-coral-new]')?.addEventListener('click',()=>openEditor('coral'));main.querySelectorAll('[data-coral]').forEach(b=>b.onclick=()=>{coralTab=b.dataset.coral;renderCoral()});$('#editCoral')?.addEventListener('click',()=>openEditor('coral',selected));$('#addCoralNote')?.addEventListener('click',()=>openEditor('coralNote',selected));$('#deleteCoral')?.addEventListener('click',()=>deleteItem('coral',selected.id));}
function notesFor(coralId){const ids=new Set(data.coralNotes.map(n=>n.id));return data.coralNotes.filter(n=>n.coralId===coralId).concat(legacyCoralNotes.filter(n=>n.coralId===coralId&&!ids.has(n.id)))}
function coralDetail(c){const notes=notesFor(c.id).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));return `<div class="grid"><section class="panel"><div class="screen-head"><div><h2>${esc(c.name)}</h2><p>${esc(c.genus||'Genus not set')}${c.acquisitionDate?` · Acquired ${esc(fmtDate(c.acquisitionDate))}`:''}</p></div></div><div class="toolbar"><button class="button secondary" id="editCoral">Edit coral</button><button class="button danger" id="deleteCoral">Delete coral</button></div></section><section class="panel"><div class="screen-head"><div><h2>Notes</h2><p>Newest first</p></div><button class="button secondary" id="addCoralNote">Add Note</button></div><div class="notes-list">${notes.length?notes.map(n=>`<article class="note-card"><time>${esc(fmtDate(n.date))}</time><p>${esc(n.text)}</p></article>`).join(''):`<div class="muted">No notes yet.</div>`}</div></section></div>`}

function renderVisual(){const rows=[...data.tankVisual].sort((a,b)=>b.date.localeCompare(a.date));main.innerHTML=`<section class="screen stack">${screenHead('Tank Visual','A dated visual journal of the tank.')}<div class="list">${rows.length?rows.map(r=>`<article class="row"><div class="row-copy"><strong>${esc(fmtDate(r.date))}</strong><span>${esc(r.notes||'Tank visual entry')}</span></div>${rowActions(r.id)}</article>`).join(''):empty('No visual entries yet','Add a dated note about how the tank looks.')}</div></section>`;wireRows('visual')}
function renderGoals(){const rows=[...data.goals].sort((a,b)=>(a.targetDate||'9999').localeCompare(b.targetDate||'9999')||a.createdAt.localeCompare(b.createdAt));main.innerHTML=`<section class="screen stack">${screenHead('Goals','Future ideas for the tank.')}<div class="list">${rows.length?rows.map(r=>`<article class="row"><div class="row-copy"><strong>${esc(r.title)}</strong>${r.targetDate?`<span>Target ${esc(fmtDate(r.targetDate))}</span>`:''}${r.notes?`<small>${esc(r.notes)}</small>`:''}</div>${rowActions(r.id)}</article>`).join(''):empty('No goals yet','Add something you want to change, add, or achieve with the tank.')}</div></section>`;wireRows('goal')}
function rowActions(id){return `<div class="row-actions"><button class="row-action" data-edit="${esc(id)}" aria-label="Edit">${icon(ICONS.edit)}</button><button class="row-action" data-delete="${esc(id)}" aria-label="Delete">${icon(ICONS.close)}</button></div>`}
function wireRows(kind){main.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(kind,findKind(kind,b.dataset.edit)));main.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteItem(kind,b.dataset.delete))}
function findKind(kind,id){const map={test:'tests',water:'waterChanges',dose:'doses',fish:'fishEntries',visual:'tankVisual',goal:'goals'};return data[map[kind]]?.find(x=>x.id===id)}

primaryAction.onclick=()=>{if(activeTab==='testing')openEditor('test');else if(activeTab==='water')openEditor('water');else if(activeTab==='dosing')openEditor('dose');else if(activeTab==='fish')openEditor('fish');else if(activeTab==='coral'){const c=data.corals.find(x=>x.id===coralTab);c?openEditor('coralNote',c):openEditor('coral')}else if(activeTab==='visual')openEditor('visual');else if(activeTab==='goals')openEditor('goal')};

function closeButton(){return `<button type="button" class="icon-button dialog-close" data-close aria-label="Close">${icon(ICONS.close)}</button>`}
function field(label,input,full=''){return `<label class="field ${full}"><span>${esc(label)}</span>${input}</label>`}
function openEditor(kind,item=null){const editing=!!item,id=item?.id||uid();let title='',fields='';
  if(kind==='test'){const type=item?.type||testType,m=testMeta(type);title=editing?'Edit reading':'Add reading';fields=field('Parameter',`<select name="type">${TEST_TYPES.map(([k,l])=>`<option value="${k}" ${k===type?'selected':''}>${esc(l)}</option>`).join('')}</select>`)+field('Measurement',`<input name="value" type="number" step="any" inputmode="decimal" required value="${editing?item.value:''}">`)+field('Date',`<input name="date" type="date" required value="${esc(item?.date||today())}">`)}
  if(kind==='water'){title=editing?'Edit water change':'Add water change';fields=field('Gallons changed',`<input name="gallons" type="number" min="0.1" max="96" step="0.1" inputmode="decimal" required value="${esc(item?.gallons||'')}">`)+field('Date',`<input name="date" type="date" required value="${esc(item?.date||today())}">`)+field('Notes',`<textarea name="notes" maxlength="1000" placeholder="Optional">${esc(item?.notes||'')}</textarea>`,'full')}
  if(kind==='dose'){title=editing?'Edit dose':'Add dose';fields=field('Additive',`<input name="additive" maxlength="120" required value="${esc(item?.additive||'')}" autocomplete="off">`)+field('Amount',`<input name="amount" maxlength="80" value="${esc(item?.amount||'')}" placeholder="e.g. 5 mL">`)+field('Date',`<input name="date" type="date" required value="${esc(item?.date||today())}">`)+field('Time',`<input name="time" type="time" value="${esc(item?.time||'')}">`)+field('Notes',`<textarea name="notes" maxlength="1000">${esc(item?.notes||'')}</textarea>`,'full')}
  if(kind==='fish'){title=editing?'Edit fish entry':'Add fish entry';fields=field('Animal',`<select name="fish">${FISH_TABS.map(([k,l])=>`<option value="${k}" ${k===(item?.fish||fishTab)?'selected':''}>${esc(l)}</option>`).join('')}</select>`)+field('Type',`<select name="kind"><option value="feeding" ${(item?.kind||'feeding')==='feeding'?'selected':''}>Feeding</option><option value="behavior" ${item?.kind==='behavior'?'selected':''}>Behavior</option></select>`)+field('Date',`<input name="date" type="date" required value="${esc(item?.date||today())}">`)+field('Time',`<input name="time" type="time" value="${esc(item?.time||'')}">`)+field('Note',`<textarea name="text" maxlength="2000" required>${esc(item?.text||'')}</textarea>`,'full')}
  if(kind==='coral'){title=editing?'Edit coral':'Add coral';fields=field('Name',`<input name="name" maxlength="120" required value="${esc(item?.name||'')}">`)+field('Genus',`<input name="genus" maxlength="120" value="${esc(item?.genus||'')}">`)+field('Acquisition date',`<input name="acquisitionDate" type="date" value="${esc(item?.acquisitionDate||'')}">`)}
  if(kind==='coralNote'){title=`Add note · ${item.name}`;fields=field('Date',`<input name="date" type="date" required value="${today()}">`)+field('Note',`<textarea name="text" maxlength="4000" required></textarea>`,'full')}
  if(kind==='visual'){title=editing?'Edit visual entry':'Add visual entry';fields=field('Date',`<input name="date" type="date" required value="${esc(item?.date||today())}">`)+field('Notes',`<textarea name="notes" maxlength="2000">${esc(item?.notes||'')}</textarea>`,'full')}
  if(kind==='goal'){title=editing?'Edit goal':'Add goal';fields=field('Goal',`<input name="title" maxlength="200" required value="${esc(item?.title||'')}">`)+field('Target date',`<input name="targetDate" type="date" value="${esc(item?.targetDate||'')}">`)+field('Notes',`<textarea name="notes" maxlength="3000">${esc(item?.notes||'')}</textarea>`,'full')}
  editorForm.dataset.kind=kind;editorForm.dataset.id=id;editorForm.dataset.parent=item?.id||'';editorForm.innerHTML=`${closeButton()}<h2>${esc(title)}</h2><div class="dialog-grid">${fields}</div><p class="dialog-hint" role="status"></p><div class="dialog-actions"><button type="button" class="button secondary" data-close>Cancel</button><button class="button primary" type="submit">Save</button></div>`;wireAutoGrow(editorForm);editorForm.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>editorDialog.close());editorSnapshot=formState();editorDialog.showModal();setTimeout(()=>editorForm.querySelector('input,select,textarea')?.focus(),0)}
const formState = () => JSON.stringify([...new FormData(editorForm)]);
// Unsaved edits survive an outside tap or Escape; Cancel and × still discard on purpose.
function guardEditorClose(){if(formState()===editorSnapshot)return true;const hint=editorForm.querySelector('.dialog-hint');hint.textContent='You have unsaved changes. Save them, or tap Cancel to discard.';return false}

editorForm.onsubmit=async e=>{e.preventDefault();const fd=new FormData(editorForm),kind=editorForm.dataset.kind,id=editorForm.dataset.id,now=timestamp();let collection='',record=null;
  if(kind==='test'){collection='tests';record={id,type:String(fd.get('type')),value:finite(fd.get('value')),date:safeDate(fd.get('date'))||today(),createdAt:findKind('test',id)?.createdAt||now}}
  if(kind==='water'){collection='waterChanges';record={id,gallons:finite(fd.get('gallons'),.1,96),date:safeDate(fd.get('date'))||today(),notes:safeText(fd.get('notes'),1000),createdAt:findKind('water',id)?.createdAt||now}}
  if(kind==='dose'){collection='doses';record={id,additive:safeText(fd.get('additive'),120),amount:safeText(fd.get('amount'),80),date:safeDate(fd.get('date'))||today(),time:safeTime(fd.get('time')),notes:safeText(fd.get('notes'),1000),createdAt:findKind('dose',id)?.createdAt||now}}
  if(kind==='fish'){collection='fishEntries';record={id,fish:String(fd.get('fish')),kind:String(fd.get('kind')),date:safeDate(fd.get('date'))||today(),time:safeTime(fd.get('time')),text:safeText(fd.get('text'),2000),photos:findKind('fish',id)?.photos||[],createdAt:findKind('fish',id)?.createdAt||now}}
  if(kind==='coral'){collection='corals';const old=data.corals.find(x=>x.id===id);record={id,name:safeText(fd.get('name'),120),genus:safeText(fd.get('genus'),120),acquisitionDate:safeDate(fd.get('acquisitionDate')),photos:old?.photos||[],createdAt:old?.createdAt||now};coralTab=id}
  if(kind==='coralNote'){collection='coralNotes';const coral=data.corals.find(x=>x.id===editorForm.dataset.parent);if(!coral)return;record={id:uid(),coralId:coral.id,date:safeDate(fd.get('date'))||today(),text:safeText(fd.get('text'),4000),createdAt:now}}
  if(kind==='visual'){collection='tankVisual';const old=findKind('visual',id);record={id,date:safeDate(fd.get('date'))||today(),notes:safeText(fd.get('notes'),2000),photos:old?.photos||[],createdAt:old?.createdAt||now}}
  if(kind==='goal'){collection='goals';const old=findKind('goal',id);record={id,title:safeText(fd.get('title'),200),targetDate:safeDate(fd.get('targetDate')),notes:safeText(fd.get('notes'),3000),photos:old?.photos||[],createdAt:old?.createdAt||now}}
  if(!record)return;upsertLocal(collection,record);editorDialog.close();render();toast('Saved');
  // Saving a coral rewrites its doc without embedded notes, so carry any not-yet-migrated notes along in the same batch.
  const carried=kind==='coral'?legacyCoralNotes.filter(n=>n.coralId===record.id):[];if(carried.length)commitOps([...carried.map(n=>['set','coralNotes',n]),['set','corals',record]]).catch(syncError);else cloudSet(collection,record);
};
function upsertLocal(collection,record){const a=data[collection],i=a.findIndex(x=>x.id===record.id);if(i>=0)a[i]=record;else a.push(record)}
function deleteItem(kind,id){const map={test:'tests',water:'waterChanges',dose:'doses',fish:'fishEntries',coral:'corals',visual:'tankVisual',goal:'goals'},collection=map[kind];if(!collection)return;const item=data[collection].find(x=>x.id===id);if(!item)return;data[collection]=data[collection].filter(x=>x.id!==id);
  if(kind==='coral'){const notes=notesFor(id);data.coralNotes=data.coralNotes.filter(n=>n.coralId!==id);legacyCoralNotes=legacyCoralNotes.filter(n=>n.coralId!==id);if(coralTab===id)coralTab=data.corals[0]?.id||'';render();commitOps([['delete','corals',id],...notes.map(n=>['delete','coralNotes',n.id])]).catch(syncError);
    toast(`${item.name} deleted`,{label:'Undo',run:()=>{upsertLocal('corals',item);notes.forEach(n=>upsertLocal('coralNotes',n));coralTab=id;render();commitOps([['set','corals',item],...notes.map(n=>['set','coralNotes',n])]).catch(syncError)}});return}
  render();cloudDelete(collection,id);toast('Entry deleted',{label:'Undo',run:()=>{upsertLocal(collection,item);render();cloudSet(collection,item)}})}
function wireAutoGrow(root){root.querySelectorAll('textarea').forEach(t=>{const grow=()=>{t.style.height='auto';t.style.height=Math.min(t.scrollHeight,600)+'px';t.style.overflowY=t.scrollHeight>600?'auto':'hidden'};t.addEventListener('input',grow);grow()})}
// Only treat it as an outside tap if the press also started outside (a text selection dragged past the edge shouldn't close).
let pressStartedOutside=false;document.addEventListener('pointerdown',e=>{pressStartedOutside=e.target===editorDialog||e.target===settingsDialog},true);
editorDialog.addEventListener('click',e=>{if(e.target===editorDialog&&pressStartedOutside&&guardEditorClose())editorDialog.close()});editorDialog.addEventListener('cancel',e=>{if(!guardEditorClose())e.preventDefault()});settingsDialog.addEventListener('click',e=>{if(e.target===settingsDialog&&pressStartedOutside)settingsDialog.close()});editorDialog.addEventListener('close',scheduleRender);settingsDialog.addEventListener('close',scheduleRender);

function toast(msg,action=null){clearTimeout(toastTimer);const el=$('#toast');el.textContent=msg;if(action){const b=document.createElement('button');b.type='button';b.className='toast-action';b.textContent=action.label;b.onclick=()=>{clearTimeout(toastTimer);el.classList.remove('show');action.run()};el.append(b)}el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),action?7000:2400)}

$('#moreButton').onclick=openSettings;
function openSettings(){$('#settingsContent').innerHTML=`${closeButton()}<h2>Settings</h2><section class="settings-section"><h3>Tank</h3><p>Volume: ${TANK_GALLONS} gallons</p></section><section class="settings-section"><h3>Backup & restore</h3><p>Backups are encrypted with a password you choose.</p><div class="toolbar"><button class="button secondary" id="backupButton">Download backup</button><button class="button secondary" id="restoreButton">Restore backup</button><input id="restoreFile" type="file" accept="application/json,.json" hidden></div><p id="backupStatus" class="settings-status" role="status"></p></section><section class="settings-section"><h3>Account</h3><p id="syncText">${syncLabel()}</p><button class="button secondary" id="signOutButton">Sign out</button><p>CoralDar release ${RELEASE}</p></section>`;settingsDialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>settingsDialog.close());$('#backupButton').onclick=downloadBackup;$('#restoreButton').onclick=()=>$('#restoreFile').click();$('#restoreFile').onchange=restoreBackup;$('#signOutButton').onclick=signOutUser;settingsDialog.showModal()}
function bytesToB64(bytes){let s='';bytes.forEach(b=>s+=String.fromCharCode(b));return btoa(s)}
function b64ToBytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function deriveKey(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:180000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
async function downloadBackup(){const password=prompt('Choose a password for this CoralDar backup.');if(!password)return;const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveKey(password,salt),plain=new TextEncoder().encode(JSON.stringify({data:allData(),exportedAt:timestamp()})),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain),payload={format:BACKUP_FORMAT,version:1,kdf:'PBKDF2-SHA-256',iterations:180000,salt:bytesToB64(salt),iv:bytesToB64(iv),ciphertext:bytesToB64(new Uint8Array(cipher))},blob=new Blob([JSON.stringify(payload)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`coraldar-backup-${today()}.json`;a.click();URL.revokeObjectURL(url)}
async function restoreBackup(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;try{const payload=JSON.parse(await file.text());if(payload.format!==BACKUP_FORMAT)throw Error('wrong format');const password=prompt('Enter this backup’s password.');if(!password)return;const key=await deriveKey(password,b64ToBytes(payload.salt)),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(payload.iv)},key,b64ToBytes(payload.ciphertext)),restored=normalizeData(JSON.parse(new TextDecoder().decode(plain)).data),before=allData();replaceAll(restored);settingsDialog.close();toast('Backup restored',{label:'Undo',run:()=>{replaceAll(before);toast('Restore undone')}})}catch(err){console.error(err);$('#backupStatus').textContent='That backup couldn’t be restored. Check the file and password.'}}
// Every record, including coral notes not yet moved out of their coral docs.
function allData(){return normalizeData({...data,coralNotes:[...data.coralNotes,...legacyCoralNotes]})}
// Make the synced data exactly match `target`: delete what it lacks, write everything it has.
function replaceAll(target){const ops=[];for(const c of COLLECTIONS){const keep=new Set(target[c].map(x=>x.id));for(const item of data[c])if(!keep.has(item.id))ops.push(['delete',c,item.id]);for(const item of target[c])ops.push(['set',c,item])}data=structuredClone(target);legacyCoralNotes=[];render();commitOps(ops).catch(syncError)}

function firebasePath(collection){return ['coraldarUsers',OWNER_UID,collection]}
const canSync = () => !!(firebase&&currentUser&&currentUser.uid===OWNER_UID);
function syncError(err){console.error(err);toast(err?.code==='permission-denied'?'Sync was rejected by the server':'Sync failed; change kept on this device')}
// Firestore's persistent cache queues writes offline and applies them to snapshots immediately, so writes are fire-and-forget.
function cloudSet(collection,record){if(canSync())firebase.setDoc(firebase.doc(firebase.db,...firebasePath(collection),record.id),record).catch(syncError)}
function cloudDelete(collection,id){if(canSync())firebase.deleteDoc(firebase.doc(firebase.db,...firebasePath(collection),id)).catch(syncError)}
async function commitOps(ops){if(!canSync())return;const commits=[];for(let i=0;i<ops.length;i+=200){const batch=firebase.writeBatch(firebase.db);for(const [op,c,v] of ops.slice(i,i+200)){const ref=firebase.doc(firebase.db,...firebasePath(c),op==='set'?v.id:v);op==='set'?batch.set(ref,v):batch.delete(ref)}commits.push(batch.commit())}await Promise.all(commits)}
function syncLabel(){return !currentUser?'Not signed in':Object.values(pendingSync).some(Boolean)?'Changes waiting to sync — they will upload when you are back online.':'All changes synced'}
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;const sync=$('#syncText');if(sync)sync.textContent=syncLabel();if(currentUser&&!editorDialog.open&&!settingsDialog.open)render()})}
function stopSnapshots(){unsubscribers.forEach(fn=>fn());unsubscribers=[]}
function startSnapshots(){stopSnapshots();const awaitingServer=new Set(COLLECTIONS);for(const collection of COLLECTIONS){let loaded=false;const unsub=firebase.onSnapshot(firebase.collection(firebase.db,...firebasePath(collection)),{includeMetadataChanges:true},snap=>{
    // Metadata-only events (pending-write / cache flags) don't change documents, so skip re-normalizing.
    if(!loaded||snap.docChanges().length){loaded=true;const remote=snap.docs.map(d=>({...d.data(),id:d.id})),normalized=normalizeData({[collection]:remote});data[collection]=normalized[collection];if(collection==='corals')legacyCoralNotes=normalized.coralNotes}
    pendingSync[collection]=snap.metadata.hasPendingWrites;if(!snap.metadata.fromCache&&awaitingServer.delete(collection)&&!awaitingServer.size){migrateEmbeddedCoralNotes();migrateLegacyLocal()}scheduleRender()},err=>console.error('snapshot',collection,err));unsubscribers.push(unsub)}}
// One-time move of notes embedded in coral documents into the coralNotes collection (keeps coral docs small).
function migrateEmbeddedCoralNotes(){if(!legacyCoralNotes.length)return;const have=new Set(data.coralNotes.map(n=>n.id)),owners=new Set(legacyCoralNotes.map(n=>n.coralId)),noteOps=legacyCoralNotes.filter(n=>!have.has(n.id)).map(n=>['set','coralNotes',n]),coralOps=data.corals.filter(c=>owners.has(c.id)).map(c=>['set','corals',c]);
  // Strip notes from coral docs only after the notes are safely stored on the server.
  commitOps(noteOps).then(()=>commitOps(coralOps)).catch(syncError)}
// One-time upload of entries that only exist in the old localStorage mirror (e.g. writes that never reached the server).
function migrateLegacyLocal(){const legacy=readLegacyLocal();if(!legacy)return;const ops=[];for(const c of COLLECTIONS){const have=new Set(data[c].map(x=>x.id));for(const item of legacy[c])if(!have.has(item.id))ops.push(['set',c,item])}if(!ops.length){localStorage.removeItem(STORAGE_KEY);return}toast(`Uploading ${ops.length} unsynced ${ops.length===1?'entry':'entries'}`);commitOps(ops).then(()=>localStorage.removeItem(STORAGE_KEY)).catch(syncError)}
// Remove the offline cache (private data) after sign-out; the instance must be terminated first, so reload for a fresh one.
async function wipeCacheAndReload(){try{await firebase.terminate(firebase.db)}catch{}try{await firebase.clearIndexedDbPersistence(firebase.db)}catch(err){console.warn('Could not clear offline cache',err)}location.reload()}
async function initFirebase(){
  try{
    const [appMod,authMod,firestoreMod]=await Promise.all([
      import('./vendor/firebase/12.18.0/firebase-app.js'),
      import('./vendor/firebase/12.18.0/firebase-auth.js'),
      import('./vendor/firebase/12.18.0/firebase-firestore.js')
    ]);
    const app=appMod.initializeApp(FIREBASE_CONFIG);
    const auth=authMod.initializeAuth(app,{persistence:authMod.browserLocalPersistence,popupRedirectResolver:authMod.browserPopupRedirectResolver});
    let db;
    try{db=firestoreMod.initializeFirestore(app,{localCache:firestoreMod.persistentLocalCache({tabManager:firestoreMod.persistentMultipleTabManager()})})}catch(err){console.warn('Offline cache unavailable',err);db=firestoreMod.getFirestore(app)}
    firebase={
      auth,
      db,
      doc:firestoreMod.doc,
      collection:firestoreMod.collection,
      onSnapshot:firestoreMod.onSnapshot,
      setDoc:firestoreMod.setDoc,
      deleteDoc:firestoreMod.deleteDoc,
      writeBatch:firestoreMod.writeBatch,
      terminate:firestoreMod.terminate,
      clearIndexedDbPersistence:firestoreMod.clearIndexedDbPersistence,
      GoogleAuthProvider:authMod.GoogleAuthProvider,
      onAuthStateChanged:authMod.onAuthStateChanged,
      signInWithPopup:authMod.signInWithPopup,
      signOut:authMod.signOut
    };
    $('#signInButton').disabled=false;
    firebase.onAuthStateChanged(firebase.auth,async user=>{
      if(!user){const wasSignedIn=!!currentUser;currentUser=null;stopSnapshots();clearPrivateLocal();if(wasSignedIn){$('#app').hidden=true;$('#authGate').hidden=false;$('#authStatus').textContent='Signing out…';return wipeCacheAndReload()}
        // Signed out at startup: clear any cache left behind (e.g. another tab held it open during sign-out). Allowed only before Firestore starts.
        cacheReady=firebase.clearIndexedDbPersistence(firebase.db).catch(err=>console.warn('Could not clear offline cache',err));$('#app').hidden=true;$('#authGate').hidden=false;$('#authStatus').textContent=authNotice||'Sign in with the owner account to continue.';authNotice='';return}
      if(user.uid!==OWNER_UID){console.info('Unauthorized CoralDar sign-in, UID:',user.uid);authNotice='This Google account can’t open this CoralDar journal. Try a different account.';firebase.signOut(firebase.auth);return}
      await cacheReady;currentUser=user;data=emptyData();$('#authGate').hidden=true;$('#app').hidden=false;render();startSnapshots();
    });
  }catch(err){console.error(err);$('#authStatus').textContent='CoralDar couldn’t start. Check your connection and reload.'}
}
$('#signInButton').onclick=async()=>{if(!firebase)return;const button=$('#signInButton');button.disabled=true;try{const provider=new firebase.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await firebase.signInWithPopup(firebase.auth,provider)}catch(err){console.error(err);const code=err?.code||'unknown-error';const messages={
  'auth/unauthorized-domain':'Sign-in isn’t available at this web address.',
  'auth/popup-blocked':'The browser blocked the Google sign-in popup. Allow popups for this site and try again.',
  'auth/popup-closed-by-user':'The Google sign-in window was closed before sign-in finished.',
  'auth/operation-not-allowed':'Google sign-in isn’t available right now.'
};$('#authStatus').textContent=messages[code]||'Sign-in didn’t finish. Please try again.'}finally{button.disabled=false}};
async function signOutUser(){settingsDialog.close();if(firebase)await firebase.signOut(firebase.auth);else clearPrivateLocal()}

// Seasonal card: shown once per year on its date, dismissal remembered on this device.
const OCCASION = {month:10, day:13, text:'SGFwcHkgYmlydGhkYXkgTWVnYW4hIXxMb3ZlLCBLZXZpbg=='};
function maybeShowOccasion(){const now=new Date();if(now.getMonth()!==OCCASION.month||now.getDate()!==OCCASION.day)return;const key=`coraldar-occasion-${now.getFullYear()}`;try{if(localStorage.getItem(key))return}catch{}
  const [title,sign]=new TextDecoder().decode(b64ToBytes(OCCASION.text)).split('|'),d=document.createElement('dialog');d.className='occasion';d.setAttribute('aria-labelledby','occasionTitle');
  d.innerHTML=`<canvas class="occasion-fx" aria-hidden="true"></canvas><div class="occasion-card"><h2 id="occasionTitle"></h2><p></p><button type="button" class="button primary">Thank you!</button></div>`;
  d.querySelector('h2').textContent=title;d.querySelector('p').textContent=sign;document.body.append(d);let stop=()=>{};
  const done=()=>d.close();d.querySelector('button').onclick=done;d.addEventListener('click',e=>{if(e.target===d||e.target.tagName==='CANVAS')done()});
  d.addEventListener('close',()=>{stop();d.remove();try{localStorage.setItem(key,'1')}catch{}});d.showModal();stop=runConfetti(d.querySelector('canvas'))}
function runConfetti(canvas){const ctx=canvas.getContext('2d'),colors=['#6bd6ca','#ff8fa3','#ffd166','#a881e6','#5b9cf0','#f29b45'],still=matchMedia('(prefers-reduced-motion: reduce)').matches;let w=0,h=0,raf=0;
  const size=()=>{const dpr=devicePixelRatio||1;w=canvas.clientWidth;h=canvas.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)};size();
  const bits=Array.from({length:Math.min(180,Math.round(w*h/6000))},()=>({x:Math.random()*w,y:still?Math.random()*h:Math.random()*h*1.4-h,r:Math.random()*Math.PI,vr:(Math.random()-.5)*.2,vy:1.2+Math.random()*2.2,vx:(Math.random()-.5)*1.2,s:6+Math.random()*6,c:colors[Math.floor(Math.random()*colors.length)]}));
  const draw=()=>{ctx.clearRect(0,0,w,h);for(const b of bits){ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.r);ctx.fillStyle=b.c;ctx.fillRect(-b.s/2,-b.s/4,b.s,b.s/2);ctx.restore()}};
  const tick=()=>{for(const b of bits){b.y+=b.vy;b.x+=b.vx+Math.sin(b.y/40)*.6;b.r+=b.vr;if(b.y>h+20){b.y=-20;b.x=Math.random()*w}}draw();raf=requestAnimationFrame(tick)};
  addEventListener('resize',size);still?draw():tick();return()=>{cancelAnimationFrame(raf);removeEventListener('resize',size)}}

function waitFirebase(){initFirebase()}
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(err=>console.warn('Service worker registration failed',err));
waitFirebase();render();maybeShowOccasion();

