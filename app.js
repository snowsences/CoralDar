'use strict';

const RELEASE = 15;
const TANK_GALLONS = 32;
const OWNER_UID = 'zZQ1UmFVKyMjmu4PvhVIoaqwPU93';
const FIREBASE_CONFIG = {apiKey:'AIzaSyBJWUH4WUZ5viWuj5XgXhDgSpdsneNhFUQ',authDomain:'coraldar-d348f.firebaseapp.com',projectId:'coraldar-d348f',storageBucket:'coraldar-d348f.firebasestorage.app',messagingSenderId:'111139321454',appId:'1:111139321454:web:2d4a1d61aec5a110c2987f'};
// Photos upload straight to Cloudinary using a one-time signature from the CoralDar Worker, which only signs for the
// owner's Firebase account. Only the resulting URL is stored in Firestore.
const CLOUDINARY = {cloudName:'qacj7ove', signUrl:'https://gentle-cell-f554.meganec96.workers.dev'};
const SHIMMER_KEY = 'coraldar-shimmer'; // per-device preference for the Home photo's water shimmer
const STORAGE_KEY = 'coraldar-v1'; // legacy local mirror; migrated to Firestore's offline cache on sign-in
const BACKUP_FORMAT = 'coraldar-backup';
const LEGACY_ENCRYPTED_FORMAT = 'coraldar-encrypted-backup'; // older password-protected backups; still restorable
const COLLECTIONS = ['tests','waterChanges','doses','fish','fishEntries','feedings','corals','coralNotes','tankVisual','goals','photos','atoRefills','meta'];
// [key, label, unit, chart color, target low, target high] — targets are intentionally fixed.
const TEST_TYPES = [
  ['temperature','Temperature','°F','#ef5f59',78,81],['salinity','Salinity','SG','#5b9cf0',1.025,1.026],['ph','pH','','#44c9c0',7.8,8.4],
  ['alkalinity','Alkalinity','dKH','#a3e635',8,9.5],['calcium','Calcium','ppm','#f4f7f6',400,450],['magnesium','Magnesium','ppm','#64b87a',1250,1450],
  ['nitrate','Nitrate','ppm','#f29b45',5,15],['phosphorus','Phosphorus','ppb','#a881e6',7,33],['nitrite','Nitrite','ppm','#ef744b',0,0],['ammonia','Ammonia','ppm','#d8bd3f',0,0]
];
// Starting fish list (ids match entries logged before the list became editable).
const DEFAULT_FISH = [['midas-blenny','Midas Blenny'],['clownfish','Clownfish'],['azure-damsel','Azure Damsel'],['mandarin-goby','Mandarin Goby'],['invertebrates','Invertebrates']];
const PHOTO_OWNERS = ['fish','coral','visual','goal'];
const ICONS = {
  edit:'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',close:'M6 6l12 12M18 6 6 18',plus:'M12 5v14M5 12h14',back:'M15 5l-7 7 7 7',
  camera:'M4 8h3.2l1.6-2.5h6.4L16.8 8H20v11H4zM12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
  fish:'M21 12c-2.2 3.6-5.2 5.5-8.6 5.5C9 17.5 7.2 15 7 12c.2-3 2-5.5 5.4-5.5 3.4 0 6.4 1.9 8.6 5.5ZM7 12 3 8.5v7L7 12Zm9.6-1h.01',
  coral:'M12 21v-8M12 13 8 9M12 13l4-5M8 9 5 4M16 8l-4-4M8 9 1-5',check:'M5 12.5l4.5 4.5L19 7.5',
  bubbles:'M9 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM16 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'
};
const NAV = [
  ['home','Home','M3 11.5 12 4l9 7.5M5.5 9.5V20h13V9.5M10 20v-5h4v5'],
  ['feed','Feed','M3 14c1.4 -2.4 3.6 -2.4 5 0s3.6 2.4 5 0 3.6 -2.4 5 0 3.6 2.4 5 0M7 5h.01M12 3.4h.01M17 5h.01'],
  ['testing','Testing','M4 19V5m0 7h16M8 5v14M12 8v8M16 6v12'],
  ['water','Water','M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11Z','Water changes'],['dosing','Dosing','M9 3h6M10 3v5l-4 7a4 4 0 0 0 3.5 6h5a4 4 0 0 0 3.5-6l-4-7V3M8 15h8'],
  ['fish','Fish',ICONS.fish],['coral','Coral',ICONS.coral],['visual','Tank Visual','M3 5h18v14H3zM7 15l3-3 3 3 2-2 3 3M8 9h.01']
];
const KIND_COLLECTION = {test:'tests',water:'waterChanges',dose:'doses',feed:'feedings',fish:'fish',fishEntry:'fishEntries',coral:'corals',coralNote:'coralNotes',visual:'tankVisual',goal:'goals',photo:'photos',ato:'atoRefills'};

const $ = s => document.querySelector(s);
const main = $('#main'), nav = $('#mainNav'), primaryAction = $('#primaryAction'), editorDialog = $('#editorDialog'), editorForm = $('#editorForm'), settingsDialog = $('#settingsDialog'), photoDialog = $('#photoDialog');
const narrowQuery = matchMedia('(max-width:680px)'), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)'), coarsePointer = matchMedia('(pointer: coarse)');
// iOS gives home-screen apps no swipe-back of their own; in a Safari tab the edge swipe belongs to the browser.
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let data = emptyData();
let activeTab = 'home';
let testType = 'temperature', testRange = '3m', fishTab = '', coralTab = '', fishDetailOpen = false, coralDetailOpen = false, heroPhotos = [], heroIndex = 0, heroTimer = null;
let firebase = null, currentUser = null, unsubscribers = [], toastTimer, renderQueued = false, editorSnapshot = '', authNotice = '', cacheReady = Promise.resolve(), pendingSync = {}, legacyCoralNotes = [], pendingFiles = [], nextAnim = '', animateChart = false, highlightId = '', highlight = null, renderHoldUntil = 0, renderSkipped = false;

function emptyData(){ return {tests:[],waterChanges:[],doses:[],fish:[],fishEntries:[],feedings:[],corals:[],coralNotes:[],tankVisual:[],goals:[],photos:[],atoRefills:[],meta:[]}; }
function readLegacyLocal(){ try{const raw=localStorage.getItem(STORAGE_KEY);return raw?normalizeData(JSON.parse(raw)):null}catch{return null} }
function clearPrivateLocal(){ localStorage.removeItem(STORAGE_KEY); data=emptyData(); pendingSync={}; legacyCoralNotes=[]; }
const esc = value => String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const safeText = (value,max=1000) => String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,' ').trim().slice(0,max);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const safeId = value => ID_PATTERN.test(String(value||'')) ? String(value) : crypto.randomUUID();
const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value||'')) ? String(value) : '';
const safeTime = value => /^\d{2}:\d{2}$/.test(String(value||'')) ? String(value) : '';
const finite = (value,min=-1e6,max=1e6) => { const n=Number(value); return Number.isFinite(n)?Math.max(min,Math.min(max,n)):0; };
// Photos may only point at Cloudinary image delivery URLs; anything else (javascript:, data:, other hosts, markup) is dropped.
const CLOUDINARY_IMAGE = /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/image\/upload\/[A-Za-z0-9_\-.\/,:]+$/;
const shimmerOn = () => { try{ return localStorage.getItem(SHIMMER_KEY)!=='off'; }catch{ return true; } };
const safePhotoUrl = url => typeof url==='string'&&url.length<=500&&CLOUDINARY_IMAGE.test(url) ? url : '';
const safePhotos = (list,max) => (Array.isArray(list)?list:[]).slice(0,max).map(p=>{const url=safePhotoUrl(typeof p==='string'?p:p?.url);return url?{id:safeId(p?.id),url,caption:safeText(p?.caption,200),createdAt:safeText(p?.createdAt,40)||timestamp()}:null}).filter(Boolean);
const today = () => new Date().toLocaleDateString('en-CA');
const nowTime = () => new Date().toTimeString().slice(0,5);
const fmtTime = t => t ? new Date(`2000-01-01T${t}:00`).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) : '';
const fmtDate = d => d ? new Date(d+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
const fmtWhen = (d,t) => `${fmtDate(d)}${t?` · ${fmtTime(t)}`:''}`;
const timestamp = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const daysSince = d => Math.max(0,Math.round((Date.parse(today()+'T12:00:00')-Date.parse(d+'T12:00:00'))/864e5));
const dayCount = n => `${n} ${n===1?'day':'days'}`;
const byNewest = (a,b) => `${b.date||''} ${b.time||''} ${b.createdAt||''}`.localeCompare(`${a.date||''} ${a.time||''} ${a.createdAt||''}`);
const testMeta = key => TEST_TYPES.find(item=>item[0]===key) || TEST_TYPES[0];
const targetLabel = meta => meta[4]===meta[5] ? `Target: ${meta[4]}${meta[2]?' '+meta[2]:''}` : `Target: ${meta[4]}–${meta[5]}${meta[2]?' '+meta[2]:''}`;
const targetStatus = (value,meta) => value<meta[4]?'Below target':value>meta[5]?'Above target':'Within target';

function normalizeData(raw){
  const base=emptyData(), source=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const list=(key,max)=>(Array.isArray(source[key])?source[key]:[]).slice(0,max).filter(v=>v&&typeof v==='object');
  const created=v=>safeText(v.createdAt,40)||timestamp();
  base.tests=list('tests',20000).map(v=>({id:safeId(v.id),type:TEST_TYPES.some(x=>x[0]===v.type)?v.type:'temperature',value:finite(v.value),date:safeDate(v.date)||today(),time:safeTime(v.time),createdAt:created(v)}));
  base.waterChanges=list('waterChanges',5000).map(v=>({id:safeId(v.id),gallons:finite(v.gallons,0,TANK_GALLONS*3),date:safeDate(v.date)||today(),notes:safeText(v.notes,1000),createdAt:created(v)}));
  base.doses=list('doses',10000).map(v=>({id:safeId(v.id),additive:safeText(v.additive,120),amount:safeText(v.amount,80),date:safeDate(v.date)||today(),time:safeTime(v.time),notes:safeText(v.notes,1000),createdAt:created(v)})).filter(v=>v.additive);
  base.fish=list('fish',500).map(v=>({id:safeId(v.id),name:safeText(v.name,80),createdAt:created(v)})).filter(v=>v.name);
  base.feedings=list('feedings',10000).map(v=>({id:safeId(v.id),food:safeText(v.food,120),date:safeDate(v.date)||today(),time:safeTime(v.time),notes:safeText(v.notes,500),createdAt:created(v)})).filter(v=>v.food);
  base.fishEntries=list('fishEntries',10000).map(v=>({id:safeId(v.id),fish:ID_PATTERN.test(String(v.fish||''))?String(v.fish):'',kind:['feeding','behavior'].includes(v.kind)?v.kind:'behavior',date:safeDate(v.date)||today(),time:safeTime(v.time),text:safeText(v.text,2000),photos:safePhotos(v.photos,20),createdAt:created(v)})).filter(v=>v.text&&v.fish);
  const rawCorals=list('corals',1000).map(v=>({...v,id:safeId(v.id)}));
  base.corals=rawCorals.map(v=>({id:v.id,name:safeText(v.name,120),genus:safeText(v.genus,120),acquisitionDate:safeDate(v.acquisitionDate),photos:safePhotos(v.photos,50),createdAt:created(v)})).filter(v=>v.name);
  // Older data embedded notes inside each coral; lift them into coralNotes (deduped by id).
  const embedded=rawCorals.flatMap(c=>(Array.isArray(c.notes)?c.notes:[]).slice(0,1000).map(n=>({...n,coralId:c.id})));
  const noteMap=new Map();for(const n of [...embedded,...list('coralNotes',20000)]){const note=n&&typeof n==='object'&&ID_PATTERN.test(String(n.coralId||''))?{id:safeId(n.id),coralId:String(n.coralId),date:safeDate(n.date)||today(),text:safeText(n.text,4000),createdAt:created(n)}:null;if(note?.text)noteMap.set(note.id,note)}
  base.coralNotes=[...noteMap.values()];
  base.tankVisual=list('tankVisual',5000).map(v=>({id:safeId(v.id),date:safeDate(v.date)||today(),notes:safeText(v.notes,2000),photos:safePhotos(v.photos,50),createdAt:created(v)}));
  base.goals=list('goals',2000).map(v=>({id:safeId(v.id),title:safeText(v.title,200),notes:safeText(v.notes,3000),targetDate:safeDate(v.targetDate),photos:safePhotos(v.photos,50),createdAt:created(v)})).filter(v=>v.title);
  base.photos=list('photos',20000).map(v=>({id:safeId(v.id),owner:PHOTO_OWNERS.includes(v.owner)?v.owner:'',ownerId:ID_PATTERN.test(String(v.ownerId||''))?String(v.ownerId):'',url:safePhotoUrl(v.url),publicId:safeText(v.publicId,300),width:finite(v.width,0,1e5),height:finite(v.height,0,1e5),takenDate:safeDate(v.takenDate)||today(),caption:safeText(v.caption,200),createdAt:created(v)})).filter(v=>v.owner&&v.ownerId&&v.url);
  base.atoRefills=list('atoRefills',5000).map(v=>({id:safeId(v.id),date:safeDate(v.date)||today(),time:safeTime(v.time),createdAt:created(v)}));
  base.meta=list('meta',20).map(v=>({id:safeId(v.id),fishSeeded:v.fishSeeded===true}));
  return base;
}

// ---- Photos (Cloudinary delivery URLs with on-the-fly resizing) ----
const photoSize = (url,t) => url.replace('/image/upload/',`/image/upload/${t}/`);
const thumbSrc = p => photoSize(p.url,'c_fill,g_auto,w_320,h_320,q_auto,f_auto');
const fullSrc = p => photoSize(p.url,'c_limit,w_1800,h_1800,q_auto,f_auto');
const photosFor = (owner,ownerId) => data.photos.filter(p=>p.owner===owner&&p.ownerId===ownerId).sort((a,b)=>`${b.takenDate} ${b.createdAt}`.localeCompare(`${a.takenDate} ${a.createdAt}`));
const latestPhoto = (owner,ownerId) => (ownerId?photosFor(owner,ownerId):data.photos.filter(p=>p.owner===owner).sort((a,b)=>`${b.takenDate} ${b.createdAt}`.localeCompare(`${a.takenDate} ${a.createdAt}`)))[0];
function photoStrip(owner,ownerId){const photos=photosFor(owner,ownerId);return `<div class="photo-strip">${photos.map(p=>`<button type="button" class="photo-thumb skeleton" data-photo="${esc(p.id)}" aria-label="Photo from ${esc(fmtDate(p.takenDate))}"><img class="fade-img" src="${esc(thumbSrc(p))}" alt="" loading="lazy" crossorigin="anonymous"></button>`).join('')}<button type="button" class="photo-add" data-add-photo="${owner}" data-owner-id="${esc(ownerId)}">${icon(ICONS.camera)}<span>Add photo</span></button></div>`}
function avatar(photo,fallbackIcon){return photo?`<span class="avatar skeleton"><img class="fade-img" src="${esc(thumbSrc(photo))}" alt="" loading="lazy" crossorigin="anonymous"></span>`:`<span class="avatar avatar-empty">${icon(fallbackIcon)}</span>`}
function photoOwnerLabel(p){if(p.owner==='fish')return data.fish.find(f=>f.id===p.ownerId)?.name||'Fish';if(p.owner==='coral')return data.corals.find(c=>c.id===p.ownerId)?.name||'Coral';if(p.owner==='goal')return data.goals.find(g=>g.id===p.ownerId)?.title||'Goal';return 'Tank Visual'}
// Downscale on the device before uploading: faster on mobile data and lighter on the Cloudinary quota.
async function shrinkImage(file,maxEdge=2048){let bitmap;try{bitmap=await createImageBitmap(file)}catch{throw Error('unreadable')}const scale=Math.min(1,maxEdge/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('unreadable')),'image/jpeg',.86))}
async function uploadPhoto(file){if(!CLOUDINARY.cloudName||!CLOUDINARY.signUrl)throw Error('not-configured');if(!navigator.onLine)throw Error('offline');
  const [image,idToken]=await Promise.all([shrinkImage(file),currentUser?.getIdToken?.()]);if(!idToken)throw Error('upload-failed');
  let sign;try{const res=await fetch(CLOUDINARY.signUrl,{method:'POST',headers:{Authorization:`Bearer ${idToken}`}});if(!res.ok)throw Error();sign=await res.json()}catch{throw Error('sign-failed')}
  const uploadUrl=String(sign?.uploadUrl||'');if(!uploadUrl.startsWith(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/`)||!sign.signature||!sign.apiKey||!sign.timestamp)throw Error('sign-failed');
  const body=new FormData();body.append('file',image);body.append('api_key',sign.apiKey);body.append('timestamp',sign.timestamp);body.append('signature',sign.signature);if(sign.folder)body.append('folder',sign.folder);
  const res=await fetch(uploadUrl,{method:'POST',body});if(!res.ok)throw Error('upload-failed');const out=await res.json();const url=safePhotoUrl(out.secure_url);if(!url)throw Error('upload-failed');
  return {url,publicId:safeText(out.public_id,300),width:finite(out.width,0,1e5),height:finite(out.height,0,1e5)}}
const photoErrors = {'not-configured':'Photo uploads aren’t set up yet.','offline':'You’re offline. Photos need a connection to upload.','unreadable':'That image couldn’t be read. Try a different photo.','upload-failed':'The photo didn’t upload. Please try again.','sign-failed':'The photo couldn’t be authorized for upload. Try signing out and back in.'};

function icon(path){return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`}
// Built once, then only the active state changes, so the desktop underline can slide and the tapped icon can pop.
function renderNav(){if(!nav.dataset.built){nav.dataset.built='1';nav.innerHTML=NAV.map(([id,label,path,aria])=>`<button class="nav-tab" data-tab="${id}" ${aria?`aria-label="${esc(aria)}"`:''}>${icon(path)}<span>${esc(label)}</span></button>`).join('')+'<span class="nav-indicator" aria-hidden="true"></span>';
    nav.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{const changed=activeTab!==b.dataset.tab;activeTab=b.dataset.tab;
      // Tapping Fish or Coral always lands on the full list, even from a fish or coral's detail view.
      if(activeTab==='fish')fishDetailOpen=false;if(activeTab==='coral')coralDetailOpen=false;nextAnim='fade';
      if(changed&&!reducedMotion.matches){b.classList.remove('pop');void b.offsetWidth;b.classList.add('pop')}render();scrollTo(0,0)})}
  nav.querySelectorAll('[data-tab]').forEach(b=>{const on=b.dataset.tab===activeTab;b.classList.toggle('active',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});placeIndicator()}
function placeIndicator(){const ind=nav.querySelector('.nav-indicator'),b=nav.querySelector('.nav-tab.active');if(!ind||!b||!b.offsetWidth)return;ind.style.width=`${b.offsetWidth-18}px`;ind.style.transform=`translateX(${b.offsetLeft+9}px)`;if(!ind.classList.contains('ready'))requestAnimationFrame(()=>ind.classList.add('ready'))}
document.fonts?.ready.then(placeIndicator);
const selectedFish = () => data.fish.find(f=>f.id===fishTab);
const selectedCoral = () => data.corals.find(c=>c.id===coralTab);
const fishDetailShown = () => !!selectedFish()&&(!narrowQuery.matches||fishDetailOpen);
const coralDetailShown = () => !!selectedCoral()&&(!narrowQuery.matches||coralDetailOpen);
function primaryLabel(){return {fish:fishDetailShown()?'Add Entry':'Add Fish',coral:coralDetailShown()?'Add Note':'Add Coral',visual:'Add Entry'}[activeTab]||'Log Data'}
function render(){renderNav();primaryAction.textContent=primaryLabel();
  if(heroTimer){clearInterval(heroTimer);heroTimer=null}
  const anim=nextAnim,motion=!reducedMotion.matches;nextAnim='';animateChart=!!anim;
  ({home:renderHome,feed:renderFeed,testing:renderTesting,water:renderWater,dosing:renderDosing,fish:renderFish,coral:renderCoral,visual:renderVisual}[activeTab]||renderHome)();
  wirePhotos();openSwipeRow=null;animateChart=false;markLoadedImages(main);
  // One-shot motion requested by a user action (never by background sync re-renders).
  if(anim&&motion){main.firstElementChild?.classList.add(`anim-${anim}`);main.querySelectorAll('.list,.entity-list,.timeline,.notes-list,.home-stats').forEach(l=>l.classList.add('stagger'));main.querySelectorAll('[data-count]').forEach(el=>countUp(el));staggerChartDots()}
  // The saved/restored item glows; a sync re-render mid-glow picks the animation up where it was instead of dropping it.
  if(highlightId){highlight={id:highlightId,t0:performance.now()};highlightId='';const el=findRendered(highlight.id);if(el&&motion)el.scrollIntoView({block:'nearest',behavior:'smooth'})}
  if(highlight&&motion){const elapsed=performance.now()-highlight.t0,el=elapsed<1600&&findRendered(highlight.id);if(el){el.classList.add('just-added');el.style.animationDelay=`-${Math.round(elapsed)}ms`}else if(elapsed>=1600)highlight=null}
}
// The element showing a record (row, list entry, or photo), used for the saved-glow and the delete collapse.
function findRendered(id){const q=CSS.escape(id);return main.querySelector(`.entity[data-fish="${q}"],.entity[data-coral="${q}"],.photo-thumb[data-photo="${q}"]`)||main.querySelector(`[data-delete][data-id="${q}"]`)?.closest('.row,.timeline-item,.note-card')||null}
function countUp(el,from=0){const to=+el.dataset.count;if(!(to>0)&&!from)return;const t0=performance.now(),dur=Math.min(900,350+Math.abs(to-from)*40);const step=now=>{const k=Math.min(1,(now-t0)/dur);el.textContent=dayCount(Math.round(from+(to-from)*(1-Math.pow(1-k,3))));if(k<1)requestAnimationFrame(step)};el.textContent=dayCount(from);requestAnimationFrame(step)}
// Photos fade in once loaded (over a shimmer placeholder) instead of popping in.
function markLoadedImages(root){root.querySelectorAll('img.fade-img').forEach(i=>{if(i.complete&&i.naturalWidth)i.classList.add('loaded')})}
document.addEventListener('load',e=>{if(e.target.classList?.contains('fade-img'))e.target.classList.add('loaded')},true);document.addEventListener('error',e=>{if(e.target.classList?.contains('fade-img'))e.target.classList.add('loaded')},true);
// Dots pop in as the line draws past them.
function staggerChartDots(){main.querySelectorAll('.chart-animate').forEach(svg=>{const w=svg.viewBox.baseVal.width||1;svg.querySelectorAll('.dot').forEach(d=>d.style.animationDelay=`${.1+.75*(+d.getAttribute('cx')/w)}s`)})}
primaryAction.onclick=()=>{
  if(activeTab==='fish')return fishDetailShown()?openEditor('fishEntry',null,{fish:fishTab}):openEditor('fish');
  if(activeTab==='coral')return coralDetailShown()?openEditor('coralNote',null,{coralId:coralTab}):openEditor('coral');
  openEditor({water:'water',dosing:'dose',visual:'visual',feed:'feed'}[activeTab]||'test');
};
narrowQuery.addEventListener('change',()=>{if(currentUser)render()});
let lastWidth=innerWidth,resizeTimer;addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{placeIndicator();if(innerWidth===lastWidth)return;lastWidth=innerWidth;if(currentUser&&['testing','water'].includes(activeTab)&&!document.querySelector('dialog[open]'))render()},150)});
function screenHead(title,sub=''){return `<div class="screen-head"><div><h2>${esc(title)}</h2>${sub?`<p>${esc(sub)}</p>`:''}</div></div>`}
function empty(title,copy){return `<div class="empty"><div class="empty-icon">${icon(ICONS.bubbles)}</div><h3>${esc(title)}</h3><div>${esc(copy)}</div></div>`}
function rowActions(kind,id,photoOwner=''){return `<div class="row-actions">${photoOwner?`<button class="row-action" data-add-photo="${photoOwner}" data-owner-id="${esc(id)}" aria-label="Add photo">${icon(ICONS.camera)}</button>`:''}<button class="row-action" data-edit="${kind}" data-id="${esc(id)}" aria-label="Edit">${icon(ICONS.edit)}</button><button class="row-action" data-delete="${kind}" data-id="${esc(id)}" aria-label="Delete">${icon(ICONS.close)}</button></div>`}
function wireRows(){main.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(b.dataset.edit,findKind(b.dataset.edit,b.dataset.id)));main.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteItem(b.dataset.delete,b.dataset.id))}
function wirePhotos(){main.querySelectorAll('[data-photo]').forEach(b=>b.onclick=()=>openPhotoViewer(b.dataset.photo));main.querySelectorAll('[data-add-photo]').forEach(b=>b.onclick=()=>openEditor('photo',null,{owner:b.dataset.addPhoto,ownerId:b.dataset.ownerId}))}
function findKind(kind,id){return (kind==='coralNote'?[...data.coralNotes,...legacyCoralNotes]:data[KIND_COLLECTION[kind]]||[]).find(x=>x.id===id)}

// ---- Home ----
function collectHeroPhotos(){return data.photos.filter(p=>p.owner==='fish'||p.owner==='visual').sort((a,b)=>`${b.takenDate} ${b.createdAt}`.localeCompare(`${a.takenDate} ${a.createdAt}`)).slice(0,10)}
function heroCaption(p){if(!p)return '';if(p.owner==='fish'){const f=data.fish.find(x=>x.id===p.ownerId);return `${f?f.name+' · ':''}${fmtDate(p.takenDate)}`}return `Tank Visual · ${fmtDate(p.takenDate)}`}
// Only the current and next slide's photo are ever loaded: the rest sit as data-src until it's their turn.
function ensureSlideLoaded(i){const wrap=$('#homeSlideshow'),slide=wrap?.children[i],img=slide?.querySelector('img[data-src]');if(img){img.src=img.dataset.src;img.removeAttribute('data-src')}}
function advanceHero(){if(document.hidden)return;const wrap=$('#homeSlideshow');if(!wrap)return;const slides=[...wrap.children];
  slides[heroIndex]?.classList.remove('active');heroIndex=(heroIndex+1)%slides.length;slides[heroIndex]?.classList.add('active');ensureSlideLoaded((heroIndex+1)%slides.length);
  const cap=$('#homePhotoCaption');if(cap)cap.textContent=heroCaption(heroPhotos[heroIndex])}
function renderHome(){
  heroPhotos=collectHeroPhotos();heroIndex=0;
  const hasPhotos=heroPhotos.length>0,lastWater=[...data.waterChanges].sort(byNewest)[0],lastAto=[...data.atoRefills].sort(byNewest)[0];
  main.innerHTML=`<section class="screen home">
    <figure class="home-hero">${hasPhotos?`<div class="home-slideshow" id="homeSlideshow">${heroPhotos.map((p,i)=>`<button type="button" class="home-photo skeleton slide ${i===0?'active':''}" data-photo="${esc(p.id)}" aria-label="Open photo">${i===0?`<img class="fade-img" src="${esc(fullSrc(p))}" alt="Photo, ${esc(fmtDate(p.takenDate))}" crossorigin="anonymous">`:`<img class="fade-img" data-src="${esc(fullSrc(p))}" alt="" crossorigin="anonymous">`}${i===0&&shimmerOn()&&!reducedMotion.matches?'<span class="shimmer" aria-hidden="true"></span>':''}</button>`).join('')}</div>`:`<button type="button" class="home-photo home-photo-empty" id="homeAddPhoto">${icon(ICONS.camera)}<span>Add a tank or fish photo</span></button>`}
      <figcaption><h2 class="home-title">${TANK_GALLONS} Gallon Reef</h2>${hasPhotos?`<span class="muted" id="homePhotoCaption">${esc(heroCaption(heroPhotos[0]))}</span>`:''}</figcaption></figure>
    <div class="home-stats">
      <div class="home-stat">${lastWater?`<p><strong data-count="${daysSince(lastWater.date)}">${dayCount(daysSince(lastWater.date))}</strong> since last water change</p>`:`<p>No water changes logged yet</p>`}</div>
      <div class="home-stat">${lastAto?`<p><strong data-count="${daysSince(lastAto.date)}">${dayCount(daysSince(lastAto.date))}</strong> since ATO refill</p>`:`<p>No ATO refill logged yet</p>`}<button type="button" class="button primary" id="atoRefilled">Refilled!</button></div>
    </div>
    ${renderHomeGoals()}</section>`;
  $('#homeAddPhoto')?.addEventListener('click',()=>{activeTab='visual';render()});
  main.querySelector('[data-add-goal]')?.addEventListener('click',()=>openEditor('goal'));
  $('#atoRefilled').onclick=e=>{const btn=e.currentTarget,stat=btn.parentElement,strong=stat.querySelector('[data-count]'),record={id:uid(),date:today(),time:nowTime(),createdAt:timestamp()};upsertLocal('atoRefills',record);cloudSet('atoRefills',record);
    // A short "Done" moment: the button checks off and the counter rolls down to 0 before the screen refreshes.
    if(reducedMotion.matches)render();else{renderHoldUntil=Date.now()+1400;btn.classList.add('done');btn.innerHTML=`${icon(ICONS.check)}<span>Done</span>`;if(strong){const from=+strong.dataset.count;strong.dataset.count='0';countUp(strong,from)}else stat.querySelector('p').innerHTML=`<strong>${dayCount(0)}</strong> since ATO refill`;setTimeout(()=>{renderHoldUntil=0;render()},1400)}toast('ATO refill logged',{label:'Undo',run:()=>{data.atoRefills=data.atoRefills.filter(x=>x.id!==record.id);render();cloudDelete('atoRefills',record.id)}})};
  wireRows();
  if(hasPhotos&&heroPhotos.length>1&&!reducedMotion.matches){ensureSlideLoaded(1);heroTimer=setInterval(advanceHero,4500)}
}
function renderHomeGoals(){const rows=[...data.goals].sort((a,b)=>(a.targetDate||'9999').localeCompare(b.targetDate||'9999')||a.createdAt.localeCompare(b.createdAt));
  return `<section class="home-goals"><div class="detail-label-row"><h3 class="detail-label">Goals</h3><button type="button" class="button secondary" data-add-goal>Add Goal</button></div><div class="list">${rows.length?rows.map(r=>`<article class="row row-media"><div class="row-copy"><strong>${esc(r.title)}</strong>${r.targetDate?`<span>Target ${esc(fmtDate(r.targetDate))}</span>`:''}${r.notes?`<small>${esc(r.notes)}</small>`:''}${photosFor('goal',r.id).length?photoStrip('goal',r.id):''}</div>${rowActions('goal',r.id,'goal')}</article>`).join(''):empty('No goals yet','Add something you want to change, add, or achieve with the tank.')}</div></section>`}

// ---- Feed ----
function renderFeed(){const rows=[...data.feedings].sort(byNewest);main.innerHTML=`<section class="screen stack">${screenHead('Feed','A log of what and when the tank was fed.')} ${rows.length?`<div class="timeline">${rows.map(r=>`<article class="timeline-item"><time>${esc(fmtWhen(r.date,r.time))}</time><strong>${esc(r.food)}</strong>${r.notes?`<div class="muted">${esc(r.notes)}</div>`:''}<div class="timeline-actions">${rowActions('feed',r.id)}</div></article>`).join('')}</div>`:empty('No feedings logged yet','Log what you feed the tank and when.')}</section>`;wireRows()}

// ---- Testing ----
const testTime = r => Date.parse(`${r.date}T${r.time||'12:00'}:00`);
function testingPanel(meta,rows){return `<div class="panel test-panel"><div class="toolbar toolbar-split"><div><strong>${esc(meta[1])} history</strong><div class="muted subline">${esc(targetLabel(meta))}</div></div><div class="chips">${[['3m','3 Months'],['1y','1 Year'],['3y','3 Years']].map(([r,l])=>`<button class="chip ${r===testRange?'active':''}" data-range="${r}">${l}</button>`).join('')}</div></div>${testChart(rows,meta)}</div>`}
function testingList(meta,rows){return `<div class="list test-list">${rows.length?rows.map(testRow).join(''):empty(`No ${meta[1].toLowerCase()} readings`,`Add your first ${meta[1].toLowerCase()} measurement.`)}</div>`}
function renderTesting(){
  const meta=testMeta(testType), rows=data.tests.filter(x=>x.type===testType).sort(byNewest);
  main.innerHTML=`<section class="screen stack">${screenHead('Testing','One measurement at a time.')}
    <div class="chips">${TEST_TYPES.map(([id,label])=>`<button class="chip test-chip chip-${id} ${id===testType?'active':''}" data-test-type="${id}">${esc(label)}</button>`).join('')}</div>
    ${testingPanel(meta,rows)}${testingList(meta,rows)}</section>`;
  wireTesting();
}
function wireTesting(){main.querySelectorAll('[data-test-type]').forEach(b=>b.onclick=()=>{testType=b.dataset.testType;updateTesting(b)});main.querySelectorAll('[data-range]').forEach(b=>b.onclick=()=>{testRange=b.dataset.range;updateTesting()});wireRows()}
// Parameter/range changes update in place: chip colors transition, the chart redraws itself, and the list flows in.
function updateTesting(chip){const meta=testMeta(testType),rows=data.tests.filter(x=>x.type===testType).sort(byNewest),motion=!reducedMotion.matches;
  main.querySelectorAll('[data-test-type]').forEach(b=>b.classList.toggle('active',b.dataset.testType===testType));chip?.scrollIntoView({inline:'nearest',block:'nearest',behavior:motion?'smooth':'auto'});
  animateChart=true;main.querySelector('.test-panel').outerHTML=testingPanel(meta,rows);main.querySelector('.test-list').outerHTML=testingList(meta,rows);animateChart=false;
  if(motion){main.querySelector('.test-list').classList.add('stagger');staggerChartDots()}openSwipeRow=null;wireTesting()}
function testChart(rows,meta){const days={'3m':92,'1y':366,'3y':1096}[testRange],end=Date.now(),start=end-days*864e5,points=rows.map(r=>({t:testTime(r),v:r.value,r})).filter(p=>p.t>=start).sort((a,b)=>a.t-b.t);
  if(!points.length)return `<div class="empty empty-inset">No readings in this range.</div>`;
  return timeChart({points,start,end,color:meta[3],unit:meta[2],label:`${meta[1]} chart`,lo:meta[4],hi:meta[5],title:p=>`${fmtWhen(p.r.date,p.r.time)}: ${p.v}${meta[2]?' '+meta[2]:''} · ${targetStatus(p.v,meta)}`})}
// Points are placed by their date/time across the whole range, so gaps between readings show as gaps.
function timeChart({points,start,end,color,unit,label,lo=null,hi=null,floor=null,title}){
  // Drawn at the panel's real width (not scaled down from a fixed size) so labels stay 12px and the chart fills its box.
  const narrow=narrowQuery.matches,w=Math.max(280,Math.round(main.clientWidth-34)),h=narrow?200:240,pad=narrow?14:28;
  const vals=points.map(p=>p.v).concat(lo===null?[]:[lo,hi]),min=floor??Math.min(...vals),max=Math.max(...vals),span=max-min||1,left=pad+Math.ceil(Math.max(`${max}${unit?' '+unit:''}`.length,String(min).length)*6.8)+8;
  const x=t=>left+(t-start)/(end-start||1)*(w-left-pad),y=v=>h-pad-(v-min)/span*(h-2*pad),u=unit?' '+unit:'';
  const target=lo===null?'':lo===hi?`<line class="band" x1="${left}" y1="${y(lo)}" x2="${w-pad}" y2="${y(lo)}" stroke="${color}" stroke-width="2" stroke-dasharray="6 5" opacity=".5"/>`:`<rect class="band" x="${left}" y="${Math.min(y(lo),y(hi))}" width="${w-left-pad}" height="${Math.abs(y(lo)-y(hi))}" fill="${color}" opacity=".09"/><line x1="${left}" y1="${y(lo)}" x2="${w-pad}" y2="${y(lo)}" stroke="${color}" opacity=".35"/><line x1="${left}" y1="${y(hi)}" x2="${w-pad}" y2="${y(hi)}" stroke="${color}" opacity=".35"/>`;
  const fmtDay=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  return `<svg class="chart${animateChart&&!reducedMotion.matches?' chart-animate':''}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><line class="gridline" x1="${left}" y1="${pad}" x2="${left}" y2="${h-pad}"/><line class="gridline" x1="${left}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"/>${target}${points.length>1?`<path class="series" stroke="${color}" pathLength="1" d="M${points.map(p=>`${x(p.t)},${y(p.v)}`).join(' L')}"/>`:''}${points.map(p=>`<circle class="dot" cx="${x(p.t)}" cy="${y(p.v)}" r="4" fill="${color}"><title>${esc(title(p))}</title></circle>`).join('')}<text x="${left-6}" y="${pad+4}" text-anchor="end">${max}${esc(u)}</text><text x="${left-6}" y="${h-pad}" text-anchor="end">${min}</text><text x="${left}" y="${h-5}">${esc(fmtDay(start))}</text><text x="${w-pad}" text-anchor="end" y="${h-5}">Today</text></svg>`;
}
function testRow(r){const m=testMeta(r.type);return `<article class="row"><div class="row-copy"><strong>${esc(fmtWhen(r.date,r.time))}</strong><span>${esc(m[1])}</span><small>${esc(targetStatus(r.value,m))}</small></div><div class="row-end"><div class="row-value">${r.value}${m[2]?` <small>${esc(m[2])}</small>`:''}</div>${rowActions('test',r.id)}</div></article>`}

// ---- Water changes ----
const pct=g=>Math.round((Number(g)/TANK_GALLONS*100)*10)/10;
function renderWater(){const rows=[...data.waterChanges].sort(byNewest),last=rows[0],end=Date.now(),start=end-184*864e5,points=rows.map(r=>({t:Date.parse(r.date+'T12:00:00'),v:pct(r.gallons),r})).filter(p=>p.t>=start).sort((a,b)=>a.t-b.t);
  main.innerHTML=`<section class="screen stack">${screenHead('Water Changes',`Tank volume: ${TANK_GALLONS} gallons`)}<div class="metric-row"><div class="metric"><span>Last water change</span><strong>${last?esc(fmtDate(last.date)):'—'}</strong></div><div class="metric"><span>Last amount</span><strong>${last?`${last.gallons} gal`:'—'}</strong></div><div class="metric"><span>Last percentage</span><strong>${last?`${pct(last.gallons)}%`:'—'}</strong></div></div>
    <div class="panel"><strong>Last 6 months</strong>${points.length?timeChart({points,start,end,color:'#5b9cf0',unit:'%',label:'Water change chart',floor:0,title:p=>`${fmtDate(p.r.date)}: ${p.v}%`}):`<div class="empty empty-inset">No water changes in the last 6 months.</div>`}</div>
    <div class="list">${rows.length?rows.map(r=>`<article class="row"><div class="row-copy"><strong>${esc(fmtDate(r.date))}</strong>${r.notes?`<span>${esc(r.notes)}</span>`:''}</div><div class="row-end"><div class="row-value">${r.gallons} gal <small>· ${pct(r.gallons)}%</small></div>${rowActions('water',r.id)}</div></article>`).join(''):empty('No water changes yet',`Log the gallons changed; CoralDar calculates the percentage of the ${TANK_GALLONS} gallon tank.`)}</div></section>`;wireRows()}

// ---- Dosing ----
function renderDosing(){const rows=[...data.doses].sort(byNewest);main.innerHTML=`<section class="screen stack">${screenHead('Dosing','A simple history of what was added and when.')} ${rows.length?`<div class="timeline">${rows.map(r=>`<article class="timeline-item"><time>${esc(fmtWhen(r.date,r.time))}</time><strong>${esc(r.additive)}${r.amount?` · ${esc(r.amount)}`:''}</strong>${r.notes?`<div class="muted">${esc(r.notes)}</div>`:''}<div class="timeline-actions">${rowActions('dose',r.id)}</div></article>`).join('')}</div>`:empty('No dosing history','Add a dose when you add something to the tank.')}</section>`;wireRows()}

// ---- Fish & Coral: vertical list with latest photo, plus a detail panel ----
const sortedFish = () => [...data.fish].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
const sortedCorals = () => [...data.corals].sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
function entityList(items,{owner,fallbackIcon,selected,dataAttr,meta,addLabel,addAttr}){return `<div class="entity-list">${items.map(item=>`<button type="button" class="entity ${item.id===selected&&!narrowQuery.matches?'active':''}" ${dataAttr}="${esc(item.id)}">${avatar(latestPhoto(owner,item.id),fallbackIcon)}<span class="entity-copy"><span class="entity-name">${esc(item.name)}</span><span class="entity-meta">${esc(meta(item))}</span></span></button>`).join('')}<button type="button" class="entity entity-add" ${addAttr}><span class="avatar avatar-empty">${icon(ICONS.plus)}</span><span class="entity-copy"><span class="entity-name">${esc(addLabel)}</span></span></button></div>`}
function detailBack(label,attr){return narrowQuery.matches?`<button type="button" class="back-link" ${attr}>${icon(ICONS.back)}<span>${esc(label)}</span></button>`:''}
function renderFish(){const fish=sortedFish();if(!selectedFish())fishTab=fish[0]?.id||'';const sel=selectedFish(),showDetail=fishDetailShown(),showList=!narrowQuery.matches||!showDetail;
  main.innerHTML=`<section class="screen stack">${screenHead('Fish','Feeding and behavior notes by animal.')}<div class="master-detail">${showList?entityList(fish,{owner:'fish',fallbackIcon:ICONS.fish,selected:fishTab,dataAttr:'data-fish',meta:f=>{const n=data.fishEntries.filter(e=>e.fish===f.id).length;return `${n} ${n===1?'entry':'entries'}`},addLabel:'Add fish',addAttr:'data-add-fish'}):''}${showDetail?fishDetail(sel):(!narrowQuery.matches?empty('No fish yet','Add a fish to start its feeding and behavior notes.'):'')}</div></section>`;
  main.querySelectorAll('[data-fish]').forEach(b=>b.onclick=()=>{fishTab=b.dataset.fish;fishDetailOpen=true;nextAnim=narrowQuery.matches?'detail-in':'';render();scrollTo(0,0)});main.querySelector('[data-add-fish]')?.addEventListener('click',()=>openEditor('fish'));main.querySelector('[data-back-fish]')?.addEventListener('click',()=>slideBack());wireRows()}
function fishDetail(f){const rows=data.fishEntries.filter(e=>e.fish===f.id).sort(byNewest);return `<section class="panel detail">${detailBack('All fish','data-back-fish')}<div class="detail-head"><h2>${esc(f.name)}</h2>${rowActions('fish',f.id)}</div><h3 class="detail-label">Photos</h3>${photoStrip('fish',f.id)}<div class="detail-label-row"><h3 class="detail-label">Entries</h3><button type="button" class="button secondary" data-add-entry>Add Entry</button></div><div class="list">${rows.length?rows.map(r=>`<article class="row"><div class="row-copy"><strong>${r.kind==='feeding'?'Feeding':'Behavior'} · ${esc(fmtWhen(r.date,r.time))}</strong><span>${esc(r.text)}</span></div>${rowActions('fishEntry',r.id)}</article>`).join(''):`<div class="muted">No entries yet.</div>`}</div></section>`}
main.addEventListener('click',e=>{if(e.target.closest('[data-add-entry]'))openEditor('fishEntry',null,{fish:fishTab});if(e.target.closest('[data-add-note]'))openEditor('coralNote',null,{coralId:coralTab})});
function renderCoral(){const corals=sortedCorals();if(!selectedCoral())coralTab=corals[0]?.id||'';const sel=selectedCoral(),showDetail=coralDetailShown(),showList=!narrowQuery.matches||!showDetail;
  main.innerHTML=`<section class="screen stack">${screenHead('Coral','Your corals and their notes.')}<div class="master-detail">${showList?entityList(corals,{owner:'coral',fallbackIcon:ICONS.coral,selected:coralTab,dataAttr:'data-coral',meta:c=>c.genus||(c.acquisitionDate?`Acquired ${fmtDate(c.acquisitionDate)}`:''),addLabel:'Add coral',addAttr:'data-add-coral'}):''}${showDetail?coralDetail(sel):(!narrowQuery.matches?empty('No coral yet','Add a coral to track its details, photos, and dated notes.'):'')}</div></section>`;
  main.querySelectorAll('[data-coral]').forEach(b=>b.onclick=()=>{coralTab=b.dataset.coral;coralDetailOpen=true;nextAnim=narrowQuery.matches?'detail-in':'';render();scrollTo(0,0)});main.querySelector('[data-add-coral]')?.addEventListener('click',()=>openEditor('coral'));main.querySelector('[data-back-coral]')?.addEventListener('click',()=>slideBack());wireRows()}
function notesFor(coralId){const ids=new Set(data.coralNotes.map(n=>n.id));return data.coralNotes.filter(n=>n.coralId===coralId).concat(legacyCoralNotes.filter(n=>n.coralId===coralId&&!ids.has(n.id)))}
function coralDetail(c){const notes=notesFor(c.id).sort(byNewest);return `<section class="panel detail">${detailBack('All coral','data-back-coral')}<div class="detail-head"><div><h2>${esc(c.name)}</h2><p class="muted">${esc(c.genus||'Genus not set')}${c.acquisitionDate?` · Acquired ${esc(fmtDate(c.acquisitionDate))}`:''}</p></div>${rowActions('coral',c.id)}</div><h3 class="detail-label">Photos</h3>${photoStrip('coral',c.id)}<div class="detail-label-row"><h3 class="detail-label">Notes</h3><button type="button" class="button secondary" data-add-note>Add Note</button></div><div class="notes-list">${notes.length?notes.map(n=>`<article class="note-card"><div class="note-head"><time>${esc(fmtDate(n.date))}</time>${rowActions('coralNote',n.id)}</div><p>${esc(n.text)}</p></article>`).join(''):`<div class="muted">No notes yet.</div>`}</div></section>`}

// ---- Tank Visual & Goals ----
function renderVisual(){const rows=[...data.tankVisual].sort(byNewest);main.innerHTML=`<section class="screen stack">${screenHead('Tank Visual','A dated visual journal of the tank.')}<div class="list">${rows.length?rows.map(r=>`<article class="row row-media"><div class="row-copy"><strong>${esc(fmtDate(r.date))}</strong>${r.notes?`<span>${esc(r.notes)}</span>`:''}${photoStrip('visual',r.id)}</div>${rowActions('visual',r.id)}</article>`).join(''):empty('No visual entries yet','Add a dated entry with a photo of the tank.')}</div></section>`;wireRows()}

// ---- Photo viewer ----
async function openPhotoViewer(id){const p=data.photos.find(x=>x.id===id);if(!p)return;photoDialog.dataset.photoId=p.id;
  $('#photoContent').innerHTML=`${closeButton()}<figure class="photo-view"><div class="photo-frame"><img class="fade-img" src="${esc(fullSrc(p))}" alt="${esc(p.caption||`Photo from ${fmtDate(p.takenDate)}`)}" crossorigin="anonymous"></div><figcaption><strong>${esc(fmtDate(p.takenDate))}</strong><span class="muted">${esc(photoOwnerLabel(p))}</span>${p.caption?`<span>${esc(p.caption)}</span>`:''}</figcaption></figure><div class="dialog-actions"><button type="button" class="button danger" data-photo-delete>Delete</button>${canShareFiles()?`<button type="button" class="button secondary" data-photo-share>Share</button>`:''}<button type="button" class="button secondary" data-photo-edit>Edit</button></div>`;
  photoDialog.querySelector('[data-close]').onclick=closePhotoViewer;photoDialog.querySelector('[data-photo-edit]').onclick=()=>{photoDialog.close();openEditor('photo',p)};photoDialog.querySelector('[data-photo-delete]').onclick=()=>{dismiss(photoDialog);deleteItem('photo',p.id)};
  // Fetch the shareable JPEG up front: iOS only opens the share sheet straight from a tap, so it can't wait on a download.
  const share=photoDialog.querySelector('[data-photo-share]');if(share){const file=fetch(photoSize(p.url,'q_auto,f_jpg')).then(r=>r.ok?r.blob():Promise.reject()).then(b=>new File([b],`coraldar-${p.takenDate}.jpg`,{type:'image/jpeg'})).catch(()=>null);let ready=null;file.then(f=>ready=f);
    share.onclick=async()=>{const f=ready||await file;if(!f)return toast('That photo couldn’t be shared. Long-press it to save instead.');try{await navigator.share({files:[f]})}catch(err){if(err.name!=='AbortError')toast('That photo couldn’t be shared. Long-press it to save instead.')}}}
  const img=photoDialog.querySelector('.photo-view img'),thumb=main.querySelector(`[data-photo="${CSS.escape(p.id)}"] img.fade-img`);enablePinch(img);markLoadedImages(photoDialog);
  // Grow the photo out of its thumbnail (View Transitions); waits briefly for the full image so the morph lands on it.
  if(document.startViewTransition&&thumb&&inViewport(thumb)&&!reducedMotion.matches&&await Promise.race([decodeImage(fullSrc(p)),new Promise(r=>setTimeout(()=>r(false),350))])){
    img.classList.add('loaded');thumb.style.viewTransitionName='photo-hero';photoDialog.classList.add('vt');
    const t=document.startViewTransition(()=>{thumb.style.viewTransitionName='';img.style.viewTransitionName='photo-hero';photoDialog.showModal()});t.finished.finally(()=>{img.style.viewTransitionName='';photoDialog.classList.remove('vt')});return}
  photoDialog.showModal()}
const inViewport = el => {const r=el.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.width>0};
const decodeImage = src => {const i=new Image();i.crossOrigin='anonymous';i.src=src;return i.decode().then(()=>true,()=>false)};
function closePhotoViewer(){const img=photoDialog.querySelector('.photo-view img'),thumb=main.querySelector(`[data-photo="${CSS.escape(photoDialog.dataset.photoId||'')}"] img.fade-img`);
  if(document.startViewTransition&&img&&thumb&&inViewport(thumb)&&!img.classList.contains('zoomed')&&!reducedMotion.matches){img.style.viewTransitionName='photo-hero';photoDialog.classList.add('vt');
    const t=document.startViewTransition(()=>{img.style.viewTransitionName='';photoDialog.close();thumb.style.viewTransitionName='photo-hero'});t.finished.finally(()=>{thumb.style.viewTransitionName='';photoDialog.classList.remove('vt')});return}
  dismiss(photoDialog)}
// Pinch to zoom, drag to pan while zoomed, double-tap to toggle zoom.
function enablePinch(img){let scale=1,tx=0,ty=0,start=null,lastTap=0;
  const clamp=()=>{const lim=(scale-1)/2;tx=Math.max(-img.offsetWidth*lim,Math.min(img.offsetWidth*lim,tx));ty=Math.max(-img.offsetHeight*lim,Math.min(img.offsetHeight*lim,ty))};
  const apply=(animate=false)=>{img.style.transition=animate?'transform .25s cubic-bezier(.2,.8,.2,1)':'none';img.style.transform=scale>1?`translate(${tx}px,${ty}px) scale(${scale})`:'';img.classList.toggle('zoomed',scale>1.01)};
  const gap=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);
  img.addEventListener('touchstart',e=>{const t=e.touches;if(t.length===2)start={dist:gap(t[0],t[1]),scale,tx,ty,cx:(t[0].clientX+t[1].clientX)/2,cy:(t[0].clientY+t[1].clientY)/2};else if(t.length===1){start=scale>1?{pan:true,x:t[0].clientX,y:t[0].clientY,tx,ty}:null;
    if(e.timeStamp-lastTap<300){scale=scale>1?1:2.5;tx=ty=0;apply(true);lastTap=0}else lastTap=e.timeStamp}},{passive:true});
  img.addEventListener('touchmove',e=>{if(!start)return;const t=e.touches;if(start.dist&&t.length===2){scale=Math.min(4,Math.max(1,start.scale*gap(t[0],t[1])/start.dist));tx=start.tx+(t[0].clientX+t[1].clientX)/2-start.cx;ty=start.ty+(t[0].clientY+t[1].clientY)/2-start.cy}else if(start.pan&&t.length===1){tx=start.tx+t[0].clientX-start.x;ty=start.ty+t[0].clientY-start.y}else return;clamp();apply();e.preventDefault()},{passive:false});
  img.addEventListener('touchend',e=>{if(e.touches.length)return;start=null;if(scale<1.05){scale=1;tx=ty=0;apply(true)}})}


// ---- Editor ----
function closeButton(){return `<button type="button" class="icon-button dialog-close" data-close aria-label="Close">${icon(ICONS.close)}</button>`}
function field(label,input,full=''){return `<label class="field ${full}"><span>${esc(label)}</span>${input}</label>`}
const dateInput = (name,value,required=true) => `<input name="${name}" type="date" ${required?'required':''} value="${esc(value||'')}">`;
function photoFields(dateValue,required){return field(required?'Photos':'Photos (optional)',`<input name="photo" type="file" accept="image/*" multiple ${required?'required':''} data-photo-input>`,'full')+`<div class="field full photo-preview" hidden></div>`+field('Date taken',dateInput('takenDate',dateValue,required))}
function openEditor(kind,item=null,ctx={}){const editing=!!item,id=item?.id||uid();let title='',fields='';
  if(kind==='test'){const type=item?.type||testType;title=editing?'Edit reading':'Log reading';fields=field('Parameter',`<select name="type">${TEST_TYPES.map(([k,l])=>`<option value="${k}" ${k===type?'selected':''}>${esc(l)}</option>`).join('')}</select>`)+field('Measurement',`<input name="value" type="number" step="any" inputmode="decimal" required value="${editing?item.value:''}">`)+field('Date',dateInput('date',item?.date||today()))+field('Time',`<input name="time" type="time" value="${esc(editing?item.time:nowTime())}">`)}
  if(kind==='water'){title=editing?'Edit water change':'Log water change';fields=field('Gallons changed',`<input name="gallons" type="number" min="0.1" max="96" step="0.1" inputmode="decimal" required value="${esc(item?.gallons||'')}">`)+field('Date',dateInput('date',item?.date||today()))+field('Notes',`<textarea name="notes" maxlength="1000" placeholder="Optional">${esc(item?.notes||'')}</textarea>`,'full')}
  if(kind==='dose'){title=editing?'Edit dose':'Log dose';fields=field('Additive',`<input name="additive" maxlength="120" required value="${esc(item?.additive||'')}" autocomplete="off">`)+field('Amount',`<input name="amount" maxlength="80" value="${esc(item?.amount||'')}" placeholder="e.g. 5 mL">`)+field('Date',dateInput('date',item?.date||today()))+field('Time',`<input name="time" type="time" value="${esc(item?.time||'')}">`)+field('Notes',`<textarea name="notes" maxlength="1000">${esc(item?.notes||'')}</textarea>`,'full')}
  if(kind==='feed'){title=editing?'Edit feeding':'Log feeding';fields=field('Food type',`<input name="food" maxlength="120" required value="${esc(item?.food||'')}" autocomplete="off">`)+field('Date',dateInput('date',item?.date||today()))+field('Time',`<input name="time" type="time" value="${esc(editing?item.time:nowTime())}">`)+field('Notes',`<textarea name="notes" maxlength="500" placeholder="Optional">${esc(item?.notes||'')}</textarea>`,'full')}
  if(kind==='fish'){title=editing?'Edit fish':'Add fish';fields=field('Name',`<input name="name" maxlength="80" required value="${esc(item?.name||'')}" autocomplete="off">`,'full')}
  if(kind==='fishEntry'){const fishId=item?.fish||ctx.fish||fishTab;title=editing?'Edit fish entry':'Add fish entry';fields=field('Animal',`<select name="fish">${sortedFish().map(f=>`<option value="${esc(f.id)}" ${f.id===fishId?'selected':''}>${esc(f.name)}</option>`).join('')}</select>`)+field('Type',`<select name="kind"><option value="feeding" ${(item?.kind||'feeding')==='feeding'?'selected':''}>Feeding</option><option value="behavior" ${item?.kind==='behavior'?'selected':''}>Behavior</option></select>`)+field('Date',dateInput('date',item?.date||today()))+field('Time',`<input name="time" type="time" value="${esc(item?.time||'')}">`)+field('Note',`<textarea name="text" maxlength="2000" required>${esc(item?.text||'')}</textarea>`,'full')}
  if(kind==='coral'){title=editing?'Edit coral':'Add coral';fields=field('Name',`<input name="name" maxlength="120" required value="${esc(item?.name||'')}">`)+field('Genus',`<input name="genus" maxlength="120" value="${esc(item?.genus||'')}">`)+field('Acquisition date',dateInput('acquisitionDate',item?.acquisitionDate,false))}
  if(kind==='coralNote'){const coral=data.corals.find(c=>c.id===(item?.coralId||ctx.coralId));title=`${editing?'Edit':'Add'} note · ${coral?.name||'Coral'}`;ctx={coralId:coral?.id||''};fields=field('Date',dateInput('date',item?.date||today()))+field('Note',`<textarea name="text" maxlength="4000" required>${esc(item?.text||'')}</textarea>`,'full')}
  if(kind==='visual'){title=editing?'Edit visual entry':'Add visual entry';fields=field('Date',dateInput('date',item?.date||today()))+field('Notes',`<textarea name="notes" maxlength="2000">${esc(item?.notes||'')}</textarea>`,'full')+(editing?'':photoFields(today(),false))}
  if(kind==='goal'){title=editing?'Edit goal':'Add goal';fields=field('Goal',`<input name="title" maxlength="200" required value="${esc(item?.title||'')}">`)+field('Target date',dateInput('targetDate',item?.targetDate,false))+field('Notes',`<textarea name="notes" maxlength="3000">${esc(item?.notes||'')}</textarea>`,'full')}
  if(kind==='photo'){title=editing?'Edit photo':`Add photo · ${photoOwnerLabel({owner:ctx.owner,ownerId:ctx.ownerId})}`;ctx=editing?{owner:item.owner,ownerId:item.ownerId}:ctx;fields=editing?`<div class="field full photo-preview"><img src="${esc(thumbSrc(item))}" alt="" crossorigin="anonymous"></div>`+field('Date taken',dateInput('takenDate',item.takenDate))+field('Caption',`<input name="caption" maxlength="200" value="${esc(item.caption)}" placeholder="Optional">`,'full'):photoFields(today(),true)+field('Caption',`<input name="caption" maxlength="200" placeholder="Optional">`,'full')}
  editorForm.dataset.kind=kind;editorForm.dataset.id=id;editorForm.dataset.ctx=JSON.stringify(ctx);pendingFiles=[];editorForm._uploaded=[];
  editorForm.innerHTML=`${closeButton()}<h2>${esc(title)}</h2><div class="dialog-grid">${fields}</div><p class="dialog-hint" role="status"></p><div class="dialog-actions"><button type="button" class="button secondary" data-close>Cancel</button><button class="button primary" type="submit">Save</button></div>`;
  wireAutoGrow(editorForm);wirePhotoInput(editorForm);tuneKeyboard(editorForm);editorForm.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dismiss(editorDialog));editorSnapshot=formState();editorDialog.showModal();setTimeout(()=>editorForm.querySelector('input:not([type=file]),select,textarea')?.focus(),0)}
// Picking photos shows previews and fills "Date taken" from the first file's date, unless the date was already edited.
const fileDate = f => new Date(f.lastModified).toLocaleDateString('en-CA');
function wirePhotoInput(root){const input=root.querySelector('[data-photo-input]');if(!input)return;const date=root.querySelector('[name=takenDate]'),preview=root.querySelector('.photo-preview');date.addEventListener('input',()=>date.dataset.touched='1');
  input.addEventListener('change',()=>{const files=[...(input.files||[])].slice(0,20);pendingFiles=files;root._uploaded=[];preview.querySelectorAll('img').forEach(i=>URL.revokeObjectURL(i.src));preview.innerHTML=files.map(()=>'<img alt="">').join('');preview.querySelectorAll('img').forEach((img,i)=>img.src=URL.createObjectURL(files[i]));preview.hidden=!files.length;preview.classList.toggle('photo-preview-grid',files.length>1);
    if(files.length){if(!date.dataset.touched&&fileDate(files[0])<=today())date.value=fileDate(files[0]);date.required=true}})}
// Return-key labels and capitalization that match each field on phone keyboards.
function tuneKeyboard(root){root.querySelectorAll('input[type=text],input:not([type]),input[type=number]').forEach(i=>i.enterKeyHint='done');root.querySelectorAll('[name=name],[name=genus],[name=additive],[name=food]').forEach(i=>i.autocapitalize='words');root.querySelectorAll('textarea,[name=title],[name=caption]').forEach(i=>i.autocapitalize='sentences')}
const formState = () => JSON.stringify([...new FormData(editorForm)].map(([k,v])=>[k,v instanceof File?v.name:v]));
// Unsaved edits survive an outside tap or Escape; Cancel and × still discard on purpose.
function guardEditorClose(){if(formState()===editorSnapshot&&!pendingFiles.length)return true;editorForm.querySelector('.dialog-hint').textContent='You have unsaved changes. Save them, or tap Cancel to discard.';return false}

editorForm.onsubmit=async e=>{e.preventDefault();const fd=new FormData(editorForm),kind=editorForm.dataset.kind,id=editorForm.dataset.id,ctx=JSON.parse(editorForm.dataset.ctx||'{}'),now=timestamp(),old=findKind(kind,id),collection=KIND_COLLECTION[kind];let record=null;
  if(kind==='test')record={id,type:String(fd.get('type')),value:finite(fd.get('value')),date:safeDate(fd.get('date'))||today(),time:safeTime(fd.get('time')),createdAt:old?.createdAt||now};
  if(kind==='water')record={id,gallons:finite(fd.get('gallons'),.1,96),date:safeDate(fd.get('date'))||today(),notes:safeText(fd.get('notes'),1000),createdAt:old?.createdAt||now};
  if(kind==='dose')record={id,additive:safeText(fd.get('additive'),120),amount:safeText(fd.get('amount'),80),date:safeDate(fd.get('date'))||today(),time:safeTime(fd.get('time')),notes:safeText(fd.get('notes'),1000),createdAt:old?.createdAt||now};
  if(kind==='feed')record={id,food:safeText(fd.get('food'),120),date:safeDate(fd.get('date'))||today(),time:safeTime(fd.get('time')),notes:safeText(fd.get('notes'),500),createdAt:old?.createdAt||now};
  if(kind==='fish'){record={id,name:safeText(fd.get('name'),80),createdAt:old?.createdAt||now};if(!old){fishTab=id;fishDetailOpen=true}}
  if(kind==='fishEntry')record={id,fish:String(fd.get('fish')),kind:String(fd.get('kind')),date:safeDate(fd.get('date'))||today(),time:safeTime(fd.get('time')),text:safeText(fd.get('text'),2000),photos:old?.photos||[],createdAt:old?.createdAt||now};
  if(kind==='coral'){record={id,name:safeText(fd.get('name'),120),genus:safeText(fd.get('genus'),120),acquisitionDate:safeDate(fd.get('acquisitionDate')),photos:old?.photos||[],createdAt:old?.createdAt||now};if(!old){coralTab=id;coralDetailOpen=true}}
  if(kind==='coralNote'){if(!ctx.coralId)return;record={id,coralId:ctx.coralId,date:safeDate(fd.get('date'))||today(),text:safeText(fd.get('text'),4000),createdAt:old?.createdAt||now}}
  if(kind==='visual')record={id,date:safeDate(fd.get('date'))||today(),notes:safeText(fd.get('notes'),2000),photos:old?.photos||[],createdAt:old?.createdAt||now};
  if(kind==='goal')record={id,title:safeText(fd.get('title'),200),targetDate:safeDate(fd.get('targetDate')),notes:safeText(fd.get('notes'),3000),photos:old?.photos||[],createdAt:old?.createdAt||now};
  if(kind==='photo'){if(old)record={...old,takenDate:safeDate(fd.get('takenDate'))||old.takenDate,caption:safeText(fd.get('caption'),200)};else if(!pendingFiles.length)return}
  const files=pendingFiles,dateField=editorForm.querySelector('[name=takenDate]'),fieldDate=safeDate(fd.get('takenDate'))||today(),caption=safeText(fd.get('caption'),200);
  // Each photo keeps its own file date unless "Date taken" was set by hand, which then applies to all of them.
  const photoDate=f=>dateField?.dataset.touched||fileDate(f)>today()?fieldDate:fileDate(f);
  // Photos upload first (the dialog stays open meanwhile), so a failed upload never leaves a half-saved entry; a retry skips ones already uploaded.
  const uploaded=editorForm._uploaded,submit=editorForm.querySelector('[type=submit]');if(files.length>uploaded.length){const hint=editorForm.querySelector('.dialog-hint');submit.disabled=true;submit.classList.add('busy');
    try{for(let i=uploaded.length;i<files.length;i++){hint.textContent=files.length>1?`Uploading photo ${i+1} of ${files.length}…`:'Uploading photo…';uploaded.push({...await uploadPhoto(files[i]),takenDate:photoDate(files[i])})}}
    catch(err){console.error(err);hint.textContent=(uploaded.length?`Uploaded ${uploaded.length} of ${files.length}. `:'')+(photoErrors[err.message]||photoErrors['upload-failed']);submit.disabled=false;submit.classList.remove('busy');return}
    hint.textContent='';submit.classList.replace('busy','success');if(!reducedMotion.matches)await new Promise(r=>setTimeout(r,420))}
  if(record){upsertLocal(collection,record);
    // Saving a coral rewrites its doc without embedded notes, so carry any not-yet-migrated notes along in the same batch.
    const carried=kind==='coral'?legacyCoralNotes.filter(n=>n.coralId===record.id):[];if(carried.length)commitOps([...carried.map(n=>['set','coralNotes',n]),['set','corals',record]]).catch(syncError);else cloudSet(collection,record)}
  const owner=kind==='photo'?ctx.owner:'visual',ownerId=kind==='photo'?ctx.ownerId:record?.id;
  const photos=uploaded.map(u=>({id:uid(),owner,ownerId,...u,caption:kind==='photo'?caption:'',createdAt:now}));photos.forEach(ph=>upsertLocal('photos',ph));if(photos.length)commitOps(photos.map(ph=>['set','photos',ph])).catch(syncError);
  highlightId=photos[0]?.id&&kind!=='visual'?photos[0].id:record?.id||'';pendingFiles=[];editorForm._uploaded=[];dismiss(editorDialog);render();toast(photos.length>1?`${photos.length} photos saved`:photos.length?'Photo saved':'Saved');
};
function upsertLocal(collection,record){const a=data[collection],i=a.findIndex(x=>x.id===record.id);if(i>=0)a[i]=record;else a.push(record)}
// Delete immediately (with related notes/entries/photos) and offer Undo, which writes everything back.
function deleteItem(kind,id){const el=findRendered(id);if(!el||reducedMotion.matches||!findKind(kind,id))return performDelete(kind,id);
  // Collapse the row/photo smoothly, then remove it.
  el.style.height=`${el.offsetHeight}px`;if(el.classList.contains('photo-thumb'))el.style.width=`${el.offsetWidth}px`;void el.offsetHeight;el.classList.add('collapsing');setTimeout(()=>performDelete(kind,id),210)}
function performDelete(kind,id){const collection=KIND_COLLECTION[kind],item=findKind(kind,id);if(!collection||!item)return;
  const related=[];if(kind==='fish')related.push(...data.fishEntries.filter(e=>e.fish===id).map(e=>['fishEntries',e]));if(kind==='coral')related.push(...notesFor(id).map(n=>['coralNotes',n]));
  const photoOwner={fish:'fish',coral:'coral',visual:'visual',goal:'goal'}[kind];if(photoOwner)related.push(...photosFor(photoOwner,id).map(p=>['photos',p]));
  const all=[[collection,item],...related];
  for(const [c,r] of all)data[c]=data[c].filter(x=>x.id!==r.id);
  const legacy=kind==='coral'?legacyCoralNotes.filter(n=>n.coralId===id):kind==='coralNote'?legacyCoralNotes.filter(n=>n.id===id):[];legacyCoralNotes=legacyCoralNotes.filter(n=>!legacy.includes(n));
  const ops=all.map(([c,r])=>['delete',c,r.id]);
  // A not-yet-migrated note lives inside its coral doc: move the coral's other notes out and rewrite the coral without it.
  if(kind==='coralNote'&&legacy.length){const coral=data.corals.find(c=>c.id===item.coralId);if(coral)ops.push(...legacyCoralNotes.filter(n=>n.coralId===coral.id).map(n=>['set','coralNotes',n]),['set','corals',coral])}
  if(kind==='fish'&&fishTab===id){fishTab='';fishDetailOpen=false}if(kind==='coral'&&coralTab===id){coralTab='';coralDetailOpen=false}
  render();commitOps(ops).catch(syncError);
  const label=kind==='fish'||kind==='coral'?`${item.name} deleted`:kind==='photo'?'Photo deleted':kind==='coralNote'?'Note deleted':'Entry deleted';
  toast(label,{label:'Undo',run:()=>{for(const [c,r] of all)upsertLocal(c,r);if(kind==='fish'){fishTab=id}if(kind==='coral'){coralTab=id}highlightId=id;render();commitOps(all.map(([c,r])=>['set',c,r])).catch(syncError)}})}
function wireAutoGrow(root){root.querySelectorAll('textarea').forEach(t=>{const grow=()=>{t.style.height='auto';t.style.height=Math.min(t.scrollHeight,600)+'px';t.style.overflowY=t.scrollHeight>600?'auto':'hidden'};t.addEventListener('input',grow);grow()})}
// Only treat it as an outside tap if the press also started outside (a text selection dragged past the edge shouldn't close).
let pressStartedOutside=false;document.addEventListener('pointerdown',e=>{pressStartedOutside=e.target===editorDialog||e.target===settingsDialog||e.target===photoDialog},true);
editorDialog.addEventListener('click',e=>{if(e.target===editorDialog&&pressStartedOutside&&guardEditorClose())dismiss(editorDialog)});editorDialog.addEventListener('cancel',e=>{if(!guardEditorClose())e.preventDefault()});
settingsDialog.addEventListener('click',e=>{if(e.target===settingsDialog&&pressStartedOutside)dismiss(settingsDialog)});photoDialog.addEventListener('click',e=>{if(e.target===photoDialog&&pressStartedOutside)closePhotoViewer()});
editorDialog.addEventListener('close',()=>{editorForm.querySelectorAll('.photo-preview img').forEach(img=>{if(img.src.startsWith('blob:'))URL.revokeObjectURL(img.src)});pendingFiles=[];renderIfSkipped()});settingsDialog.addEventListener('close',renderIfSkipped);

function toast(msg,action=null){clearTimeout(toastTimer);const el=$('#toast');el.textContent=msg;if(action){const b=document.createElement('button');b.type='button';b.className='toast-action';b.textContent=action.label;b.onclick=()=>{clearTimeout(toastTimer);el.classList.remove('show');action.run()};el.append(b)}el.classList.remove('countdown');if(action){void el.offsetWidth;el.classList.add('countdown')}el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),action?7000:2400)}

$('#moreButton').onclick=openSettings;
function openSettings(){$('#settingsContent').innerHTML=`${closeButton()}<h2>Settings</h2><section class="settings-section"><h3>Tank</h3><p>Volume: ${TANK_GALLONS} gallons</p></section><section class="settings-section"><h3>Appearance</h3><label class="setting-toggle"><span>Water shimmer on the Home photo<small>A slow ripple of light across the tank photo. Saved on this device.</small></span><input type="checkbox" switch id="shimmerToggle" ${shimmerOn()?'checked':''}></label></section><section class="settings-section"><h3>Backup & restore</h3><p>Download a copy of all your CoralDar data, or restore from one. Restoring replaces what’s in the app now. Photos stay in Cloudinary; the backup keeps their links.</p><div class="toolbar"><button class="button secondary" id="backupButton">Download backup</button><button class="button secondary" id="restoreButton">Restore backup</button><input id="restoreFile" type="file" accept="application/json,.json" hidden></div><p id="backupStatus" class="settings-status" role="status"></p></section><section class="settings-section"><h3>Account</h3><p id="syncText">${syncLabel()}</p><button class="button secondary" id="signOutButton">Sign out</button><p>CoralDar release ${RELEASE}</p></section>`;settingsDialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dismiss(settingsDialog));$('#shimmerToggle').onchange=e=>{try{localStorage.setItem(SHIMMER_KEY,e.target.checked?'on':'off')}catch{}renderSkipped=true};$('#backupButton').onclick=downloadBackup;$('#restoreButton').onclick=()=>$('#restoreFile').click();$('#restoreFile').onchange=restoreBackup;$('#signOutButton').onclick=signOutUser;settingsDialog.showModal()}
function bytesToB64(bytes){let s='';bytes.forEach(b=>s+=String.fromCharCode(b));return btoa(s)}
function b64ToBytes(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function deriveKey(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:180000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
function downloadBackup(){const payload={format:BACKUP_FORMAT,version:3,exportedAt:timestamp(),data:allData()};saveFile(new Blob([JSON.stringify(payload,null,1)],{type:'application/json'}),`coraldar-backup-${today()}.json`)}
const canShareFiles = () => coarsePointer.matches&&!!navigator.canShare?.({files:[new File([''],'x.jpg',{type:'image/jpeg'})]});
// On phones, hand files to the native share sheet (Save to Files, AirDrop…); elsewhere, download.
async function saveFile(blob,filename){const file=new File([blob],filename,{type:blob.type});if(coarsePointer.matches&&navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file]});return}catch(err){if(err.name==='AbortError')return}}
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)}
async function readBackup(payload){if(payload?.format===BACKUP_FORMAT)return payload.data;if(payload?.format!==LEGACY_ENCRYPTED_FORMAT)throw Error('wrong format');const password=prompt('This older backup is password protected. Enter its password.');if(!password)return null;const key=await deriveKey(password,b64ToBytes(payload.salt)),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(payload.iv)},key,b64ToBytes(payload.ciphertext));return JSON.parse(new TextDecoder().decode(plain)).data}
async function restoreBackup(e){const file=e.target.files?.[0];e.target.value='';if(!file)return;$('#backupStatus').textContent='';try{const raw=await readBackup(JSON.parse(await file.text()));if(!raw)return;const restored=normalizeData(raw),before=allData();
  // Older backups predate some collections (fish list, photos, ATO refills); keep what's in the app for those.
  for(const c of COLLECTIONS)if(c!=='coralNotes'&&!Array.isArray(raw[c]))restored[c]=before[c];
  replaceAll(restored);settingsDialog.close();toast('Backup restored',{label:'Undo',run:()=>{replaceAll(before);toast('Restore undone')}})}catch(err){console.error(err);$('#backupStatus').textContent='That file couldn’t be restored. Make sure it’s a CoralDar backup.'}}
// Every record, including coral notes not yet moved out of their coral docs.
function allData(){return normalizeData({...data,coralNotes:[...data.coralNotes,...legacyCoralNotes]})}
// Make the synced data exactly match `target`: delete what it lacks, write everything it has.
function replaceAll(target){const ops=[];for(const c of COLLECTIONS){const keep=new Set(target[c].map(x=>x.id));for(const item of data[c])if(!keep.has(item.id))ops.push(['delete',c,item.id]);for(const item of target[c])ops.push(['set',c,item])}data=structuredClone(target);legacyCoralNotes=[];render();commitOps(ops).catch(syncError)}

function firebasePath(collection){return ['coraldarUsers',OWNER_UID,collection]}
const canSync = () => !!(firebase&&currentUser&&currentUser.uid===OWNER_UID);
function syncError(err){console.error(err);toast(err?.code==='permission-denied'?'Sync was rejected by the server':'Sync failed. Check your connection and try again.')}
// Firestore's persistent cache queues writes offline and applies them to snapshots immediately, so writes are fire-and-forget.
function cloudSet(collection,record){if(canSync())firebase.setDoc(firebase.doc(firebase.db,...firebasePath(collection),record.id),record).catch(syncError)}
function cloudDelete(collection,id){if(canSync())firebase.deleteDoc(firebase.doc(firebase.db,...firebasePath(collection),id)).catch(syncError)}
async function commitOps(ops){if(!canSync()||!ops.length)return;const commits=[];for(let i=0;i<ops.length;i+=200){const batch=firebase.writeBatch(firebase.db);for(const [op,c,v] of ops.slice(i,i+200)){const ref=firebase.doc(firebase.db,...firebasePath(c),op==='set'?v.id:v);op==='set'?batch.set(ref,v):batch.delete(ref)}commits.push(batch.commit())}await Promise.all(commits)}
function syncLabel(){return !currentUser?'Not signed in':Object.values(pendingSync).some(Boolean)?'Changes waiting to sync — they will upload when you are back online.':'All changes synced'}
function scheduleRender(){if(renderQueued)return;renderQueued=true;requestAnimationFrame(()=>{renderQueued=false;if(Date.now()<renderHoldUntil)return void setTimeout(scheduleRender,renderHoldUntil-Date.now()+30);const sync=$('#syncText');if(sync)sync.textContent=syncLabel();if(currentUser&&!editorDialog.open&&!settingsDialog.open)render();else renderSkipped=true})}
function renderIfSkipped(){if(renderSkipped){renderSkipped=false;scheduleRender()}}
function stopSnapshots(){unsubscribers.forEach(fn=>fn());unsubscribers=[]}
function startSnapshots(){stopSnapshots();const awaitingServer=new Set(COLLECTIONS),awaitingFirst=new Set(COLLECTIONS);for(const collection of COLLECTIONS){let loaded=false;const unsub=firebase.onSnapshot(firebase.collection(firebase.db,...firebasePath(collection)),{includeMetadataChanges:true},snap=>{
    // Metadata-only events (pending-write / cache flags) don't change documents, so skip re-normalizing.
    if(!loaded||snap.docChanges().length){loaded=true;const remote=snap.docs.map(d=>({...d.data(),id:d.id})),normalized=normalizeData({[collection]:remote});data[collection]=normalized[collection];if(collection==='corals')legacyCoralNotes=normalized.coralNotes}
    pendingSync[collection]=snap.metadata.hasPendingWrites;if(awaitingFirst.delete(collection)&&!awaitingFirst.size)nextAnim=nextAnim||'fade';if(!snap.metadata.fromCache&&awaitingServer.delete(collection)&&!awaitingServer.size){migrateEmbeddedCoralNotes();migrateLegacyLocal();seedFish()}scheduleRender()},err=>console.error('snapshot',collection,err));unsubscribers.push(unsub)}}
// One-time creation of the starting fish list once the server copy has loaded (so it never duplicates across devices).
function seedFish(){if(data.meta.find(m=>m.id==='app')?.fishSeeded)return;const have=new Set(data.fish.map(f=>f.id)),base=Date.parse('2026-01-01T00:00:00Z');const ops=DEFAULT_FISH.filter(([id])=>!have.has(id)).map(([id,name],i)=>['set','fish',{id,name,createdAt:new Date(base+i*1000).toISOString()}]);ops.push(['set','meta',{id:'app',fishSeeded:true}]);for(const [,c,r] of ops)upsertLocal(c,r);scheduleRender();commitOps(ops).catch(syncError)}
// One-time move of notes embedded in coral documents into the coralNotes collection (keeps coral docs small).
function migrateEmbeddedCoralNotes(){if(!legacyCoralNotes.length)return;const have=new Set(data.coralNotes.map(n=>n.id)),owners=new Set(legacyCoralNotes.map(n=>n.coralId)),noteOps=legacyCoralNotes.filter(n=>!have.has(n.id)).map(n=>['set','coralNotes',n]),coralOps=data.corals.filter(c=>owners.has(c.id)).map(c=>['set','corals',c]);
  // Strip notes from coral docs only after the notes are safely stored on the server.
  commitOps(noteOps).then(()=>commitOps(coralOps)).catch(syncError)}
// One-time upload of entries that only exist in the old localStorage mirror (e.g. writes that never reached the server).
function migrateLegacyLocal(){const legacy=readLegacyLocal();if(!legacy)return;const ops=[];for(const c of COLLECTIONS){const have=new Set(data[c].map(x=>x.id));for(const item of legacy[c])if(!have.has(item.id))ops.push(['set',c,item])}if(!ops.length){localStorage.removeItem(STORAGE_KEY);return}toast(`Uploading ${ops.length} unsynced ${ops.length===1?'entry':'entries'}`);commitOps(ops).then(()=>localStorage.removeItem(STORAGE_KEY)).catch(syncError)}
// Remove the offline cache (private data) after sign-out; the instance must be terminated first, so reload for a fresh one.
async function wipeCacheAndReload(){try{await firebase.terminate(firebase.db)}catch{}try{await firebase.clearIndexedDbPersistence(firebase.db)}catch(err){console.warn('Could not clear offline cache',err)}try{await caches.delete('coraldar-photos-v1')}catch{}location.reload()}

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

const topHeader=$('.top-header');addEventListener('scroll',()=>topHeader.classList.toggle('scrolled',scrollY>4),{passive:true});

// ---- Native-feel gestures ----
// Sheets animate away on phones; everywhere else (and with reduced motion) they just close.
function dismiss(dialog){if(!dialog.open||dialog.classList.contains('sheet-closing'))return;if(!narrowQuery.matches||reducedMotion.matches)return dialog.close();dialog.classList.add('sheet-closing');
  const done=()=>{if(!dialog.classList.contains('sheet-closing'))return;dialog.classList.remove('sheet-closing');dialog.style.removeProperty('--drag');dialog.close()};dialog.addEventListener('animationend',done,{once:true});setTimeout(done,400)}
// Drag a sheet down by its top edge (or from anywhere once its content is scrolled to the top) to dismiss it.
function enableSheetDrag(dialog){let startY=0,startT=0,dy=0,state='';
  dialog.addEventListener('touchstart',e=>{state='';if(!narrowQuery.matches||e.touches.length!==1||e.target.closest('input,textarea,select,.photo-strip,.photo-preview,.photo-view img.zoomed'))return;const inner=dialog.querySelector('.dialog-inner'),y=e.touches[0].clientY;if(y-dialog.getBoundingClientRect().top>48&&inner.scrollTop>0)return;startY=y;startT=e.timeStamp;dy=0;state='maybe'},{passive:true});
  dialog.addEventListener('touchmove',e=>{if(!state)return;if(e.touches.length>1){if(state==='drag'){dialog.classList.remove('sheet-dragging');dialog.style.setProperty('--drag','0px')}state='';return}const d=e.touches[0].clientY-startY;if(state==='maybe'){if(Math.abs(d)<6)return;if(d<0){state='';return}state='drag';dialog.classList.add('sheet-dragging')}dy=Math.max(0,d);dialog.style.setProperty('--drag',`${dy}px`);e.preventDefault()},{passive:false});
  dialog.addEventListener('touchend',e=>{if(state!=='drag'){state='';return}state='';dialog.classList.remove('sheet-dragging');const fast=dy/Math.max(1,e.timeStamp-startT)>.6,far=dy>Math.min(160,dialog.offsetHeight*.3);
    if((fast||far)&&(dialog!==editorDialog||guardEditorClose()))dismiss(dialog);else dialog.style.setProperty('--drag','0px')});
  dialog.addEventListener('touchcancel',()=>{if(state==='drag'){dialog.classList.remove('sheet-dragging');dialog.style.setProperty('--drag','0px')}state=''})}
[editorDialog,settingsDialog,photoDialog].forEach(enableSheetDrag);

// Back from a fish/coral page to its list, sliding the page away.
function inDetailView(){return narrowQuery.matches&&!document.querySelector('dialog[open]')&&((activeTab==='fish'&&fishDetailOpen&&!!selectedFish())||(activeTab==='coral'&&coralDetailOpen&&!!selectedCoral()))}
function showList(){if(activeTab==='fish')fishDetailOpen=false;else coralDetailOpen=false;nextAnim='list-in';render();scrollTo(0,0)}
function slideBack(){const screen=main.querySelector('.screen');if(reducedMotion.matches||!screen)return showList();screen.style.transition='transform .22s cubic-bezier(.4,0,.6,1)';screen.style.transform='translateX(100%)';setTimeout(showList,220)}
// Swipe from the left edge to go back (home-screen app only; in Safari the edge swipe is the browser's).
let edge=null;
document.addEventListener('touchstart',e=>{edge=null;if(!standalone||e.touches.length!==1||!inDetailView()||e.touches[0].clientX>24)return;edge={x0:e.touches[0].clientX,y0:e.touches[0].clientY,t0:e.timeStamp,dx:0,locked:false,screen:main.querySelector('.screen')}},{passive:true});
document.addEventListener('touchmove',e=>{if(!edge)return;const dx=e.touches[0].clientX-edge.x0,dy=e.touches[0].clientY-edge.y0;if(!edge.locked){if(Math.abs(dx)<8&&Math.abs(dy)<8)return;if(Math.abs(dy)>Math.abs(dx)||dx<0){edge=null;return}edge.locked=true;edge.screen.classList.add('swipe-back')}
  edge.dx=Math.max(0,dx);edge.screen.style.transform=`translateX(${edge.dx}px)`;e.preventDefault()},{passive:false});
document.addEventListener('touchend',e=>{if(!edge?.locked){edge=null;return}const {screen,dx,t0}=edge;edge=null;screen.classList.remove('swipe-back');
  if(dx>innerWidth*.35||dx/Math.max(1,e.timeStamp-t0)>.5){screen.style.transition='transform .18s ease-out';screen.style.transform='translateX(100%)';setTimeout(showList,180)}
  else{screen.style.transition='transform .25s cubic-bezier(.2,.8,.2,1)';screen.style.transform='';screen.addEventListener('transitionend',()=>screen.style.transition='',{once:true})}});

// Swipe a row left to reveal Delete; swipe far to delete right away (Undo stays available).
const SWIPE_ROWS='.row,.timeline-item,.note-card',SWIPE_OPEN=88;let swipe=null,openSwipeRow=null;
function setSwipe(row,dx){row.classList.toggle('swipe-active',dx!==0||row.classList.contains('swiping'));row.style.setProperty('--dx',`${dx}px`);if(dx===0)setTimeout(()=>{if(row.style.getPropertyValue('--dx')==='0px')row.classList.remove('swipe-active')},260)}
function closeSwipe(){if(openSwipeRow){setSwipe(openSwipeRow,0);openSwipeRow=null}}
function swipeDelete(row){const del=row.querySelector('[data-delete]');openSwipeRow=null;deleteItem(del.dataset.delete,del.dataset.id)}
main.addEventListener('touchstart',e=>{swipe=null;if(e.touches.length!==1)return;const row=e.target.closest(SWIPE_ROWS),t=e.touches[0];if(openSwipeRow&&openSwipeRow!==row)closeSwipe();
  if(!row||!row.querySelector(':scope [data-delete]')||e.target.closest('.photo-strip,.swipe-action')||(t.clientX<=24&&inDetailView()&&standalone))return;swipe={row,x0:t.clientX,y0:t.clientY,base:row===openSwipeRow?-SWIPE_OPEN:0,dx:0,locked:false}},{passive:true});
main.addEventListener('touchmove',e=>{if(!swipe)return;const dx=e.touches[0].clientX-swipe.x0,dy=e.touches[0].clientY-swipe.y0;if(!swipe.locked){if(Math.abs(dx)<8&&Math.abs(dy)<8)return;if(Math.abs(dy)>Math.abs(dx)){swipe=null;return}swipe.locked=true;const row=swipe.row;
    if(!row.querySelector(':scope > .swipe-action')){const b=document.createElement('button');b.type='button';b.className='swipe-action';b.textContent='Delete';b.onclick=()=>swipeDelete(row);row.append(b)}row.classList.add('swiping')}
  swipe.dx=Math.min(0,Math.max(-swipe.row.offsetWidth,swipe.base+dx));setSwipe(swipe.row,swipe.dx);e.preventDefault()},{passive:false});
main.addEventListener('touchend',()=>{if(!swipe?.locked){swipe=null;return}const {row,dx}=swipe;swipe=null;row.classList.remove('swiping');
  if(-dx>row.offsetWidth*.6){setSwipe(row,-row.offsetWidth);setTimeout(()=>swipeDelete(row),180)}else if(-dx>SWIPE_OPEN/2){setSwipe(row,-SWIPE_OPEN);openSwipeRow=row}else{setSwipe(row,0);if(openSwipeRow===row)openSwipeRow=null}});
document.addEventListener('touchstart',e=>{if(openSwipeRow&&!openSwipeRow.contains(e.target))closeSwipe()},{passive:true});

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

if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(err=>console.warn('Service worker registration failed',err));
initFirebase();render();maybeShowOccasion();
