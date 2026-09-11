import {t, localizeMarkup as h, language, mountLanguageSelector} from './i18n.mjs';
import {compact, normalize, scoreForAudio, scoreTitle, clamp} from './reader-utils.mjs';
import {ScoreViewer} from './score-viewer.js';
import {StudyAudio} from './audio-player.js';
import {MobileControls} from './mobile-controls.js';

const content = document.getElementById('content'), sidebar = document.getElementById('sidebar');
const proofreading = content.dataset.textSource === 'texte-relecture.html';
const source = proofreading ? 'texte-relecture.html' : language === 'en' ? 'texte-en.html' : 'texte.html';
document.documentElement.lang = language;
document.title = t('Dobbins : Arrangement jazz');
content.lang = proofreading ? 'fr' : language;
sidebar.setAttribute('aria-label',t('Partitions et illustrations'));
document.getElementById('toc').setAttribute('aria-label',t('Sommaire'));
const storageKey = `dobbins:lecture:${source}:v1`;
let saved;
try {saved = JSON.parse(localStorage.getItem(storageKey));} catch {saved = null;}
let ready = false, restoring = false, headings = [], passages = [], searchItems = [];
let currentChapter, saveTimer, scrollFrame, viewer, lastReading = {anchor:'',offset:0};
history.scrollRestoration = 'manual';

const header = document.createElement('header');header.className = 'reader-bar';
header.innerHTML = h(`<a class="skip-link" href="#content">Aller au texte</a><div class="reader-actions"><span class="brand">Dobbins<span>ARRANGEMENT JAZZ</span></span><button type="button" id="open-toc" aria-haspopup="dialog">Sommaire</button></div><div class="reading-context"><span id="current-chapter">Une approche linéaire</span></div>`);
document.body.prepend(header);
if (!proofreading) mountLanguageSelector(header.querySelector('.reader-actions'), nextLanguage => {
  savePosition();
  const state = snapshot(), url = new URL(location.href);
  // Chapter/section IDs and audio IDs are shared; paragraph IDs belong to one text.
  const target = document.getElementById(state.anchor);
  let anchor = target?.closest('.audio-player')?.id;
  if (!anchor) {
    const top = content.getBoundingClientRect().top;
    for (const heading of headings.filter(el => !el.id.startsWith('discography-') && !el.id.startsWith('exemple-'))) {
      if (heading.getBoundingClientRect().top <= top + 48) anchor = heading.id;
      else break;
    }
  }
  anchor ||= 'préface';
  url.searchParams.set('lang',nextLanguage);url.hash = anchor;
  try {sessionStorage.setItem('dobbins:language-transfer',JSON.stringify({language:nextLanguage,anchor,score:state.score,split:state.split,splits:state.splits}));} catch { /* The shared anchor still works. */ }
  return url;
});
const workspace = document.createElement('div');workspace.id = 'workspace';workspace.className = 'workspace';
workspace.dataset.mode = 'both';
content.before(workspace);workspace.append(content);
const divider = document.createElement('div');divider.className = 'divider';divider.tabIndex = 0;divider.setAttribute('role','separator');divider.setAttribute('aria-label',t('Répartition du texte et de la partition'));divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-valuemin','25');divider.setAttribute('aria-valuemax','75');divider.setAttribute('aria-valuenow','48');
workspace.append(divider,sidebar);content.tabIndex = -1;
function createDialog(label) {
  const dialog = document.createElement('dialog');dialog.className = 'reader-dialog';dialog.setAttribute('aria-label',label);
  dialog.innerHTML = h(`<div class="dialog-top"><strong>${label}</strong><button type="button" class="close-dialog">Fermer</button></div>`);
  document.body.append(dialog);dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {if (event.target === dialog) {const r = dialog.getBoundingClientRect();if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();}});
  return dialog;
}
const navigation = createDialog(t('Parcourir le cours'));
navigation.insertAdjacentHTML('beforeend',h('<label class="search-label" for="course-search">Rechercher un chapitre, un exemple ou une notion</label><input id="course-search" type="search" placeholder="Exemple 22, voicing, Minor D…" autocomplete="off"><p id="search-status" role="status"></p><div id="search-results" hidden></div><nav id="toc-tree" aria-label="Chapitres et sous-sections"></nav>'));
const search = navigation.querySelector('#course-search');
document.getElementById('open-toc').addEventListener('click', () => {
  search.value = '';navigation.querySelector('#search-results').hidden = true;navigation.querySelector('#toc-tree').hidden = false;navigation.querySelector('#search-status').textContent = '';
  navigation.showModal();
  const current = navigation.querySelector('[aria-current="location"]');if (current) current.closest('details').open = true;
  navigation.querySelector('.close-dialog').focus();
});
const glossary = createDialog(t('Définition'));
const definition = document.createElement('div');definition.className = 'definition';glossary.append(definition);

header.querySelector('.skip-link').addEventListener('click', event => {event.preventDefault();content.focus({preventScroll:true});});
const mobileQuery = matchMedia('(max-width:700px), (max-width:1000px) and (max-height:500px)');
const layoutKey = () => mobileQuery.matches ? (innerHeight >= innerWidth ? 'portrait' : 'landscape') : 'desktop';
const splits = {portrait:48,landscape:48,desktop:48};
for (const key of Object.keys(splits)) if (Number.isFinite(saved?.splits?.[key])) splits[key] = clamp(saved.splits[key],25,75);
let layout = layoutKey(), split = splits[layout];
let scoreOpened = false;
function openScore(item) {
  if (!item?.url) return;
  if (!scoreOpened) {
    if (ready) snapshot();
    scoreOpened = true;
    updateLayout();
  }
  return viewer.open(item);
}
if (!saved?.splits && Number.isFinite(saved?.split)) splits[layout] = split = clamp(saved.split,25,75);
function setSplit(value) {
  const position = ready && content.clientHeight ? snapshot() : lastReading;
  split = clamp(value,25,75);splits[layout] = split;workspace.style.setProperty('--text-share',`${split}%`);divider.setAttribute('aria-valuenow',String(Math.round(split)));
  if (ready) alignReading(position);
  viewer?.render();
}
divider.addEventListener('keydown', event => {
  const portrait = layout === 'portrait';
  const down = portrait ? 'ArrowDown' : 'ArrowRight', up = portrait ? 'ArrowUp' : 'ArrowLeft';
  if ([up,down,'Home','End'].includes(event.key)) {event.preventDefault();setSplit(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : split + (event.key === down ? 3 : -3));savePosition();}
});
divider.addEventListener('pointerdown', event => {divider.setPointerCapture(event.pointerId);event.preventDefault();});
divider.addEventListener('pointermove', event => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const r = workspace.getBoundingClientRect(), vertical = layout === 'portrait';
  setSplit(vertical ? 100 * (event.clientY-r.top)/r.height : 100 * (event.clientX-r.left)/r.width);
});
divider.addEventListener('pointerup', event => {if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);savePosition();});
viewer = new ScoreViewer(sidebar, () => {if (ready && !restoring) savePosition();});
const audio = new StudyAudio(record => {
  if (!record?.score) return;
  openScore({...record.score,context:record.context});
}, record => {if (record) navigateTo(record.element.id);});
const mobileControls = new MobileControls(header,viewer,audio);
let layoutWidth = innerWidth;
function updateLayout() {
  // A phone's on-screen keyboard can make a portrait viewport look landscape.
  // Keep the reading arrangement while editing; a real rotation changes width.
  if (mobileControls.mobile && innerWidth === layoutWidth && document.activeElement.matches('input,textarea,select')) return;
  layoutWidth = innerWidth;
  const position = {...lastReading};
  layout = layoutKey();split = splits[layout];
  workspace.style.setProperty('--text-share',`${split}%`);
  workspace.dataset.layout = layout;
  // Restoring a previous score must not open the mobile panel on launch.
  workspace.dataset.mode = mobileQuery.matches && !scoreOpened ? 'text' : 'both';
  divider.setAttribute('aria-valuenow',String(Math.round(split)));
  divider.setAttribute('aria-orientation',layout === 'portrait' ? 'horizontal' : 'vertical');
  mobileControls.sync(mobileQuery.matches);
  if (ready) {alignReading(position);updateChapter();savePosition();}
  viewer.render();
}
window.addEventListener('resize',updateLayout);updateLayout();

function snapshot() {
  if (!content.clientHeight) return {...lastReading,score:viewer.snapshot(),split,splits:{...splits}};
  const top = content.getBoundingClientRect().top;let anchor = passages[0];
  let distance = Infinity;
  for (const element of passages) {
    const delta = element.getBoundingClientRect().top - top;
    if (Math.abs(delta) < distance) {anchor = element;distance = Math.abs(delta);}
    if (delta >= 0) break;
  }
  lastReading = {anchor:anchor?.id || '',offset:anchor ? anchor.getBoundingClientRect().top-top : 0};
  return {...lastReading,score:viewer.snapshot(),split,splits:{...splits}};
}
function alignReading(position) {
  const target = document.getElementById(position?.anchor);
  if (target && content.contains(target) && content.clientHeight) content.scrollTop += target.getBoundingClientRect().top-content.getBoundingClientRect().top-(position.offset || 0);
}
function savePosition() {
  if (!ready || restoring) return;
  const state = snapshot();
  try {localStorage.setItem(storageKey,JSON.stringify(state));} catch { /* Storage is optional. */ }
  history.replaceState({...history.state,reader:state},'');
}
async function restore(state, focus = false) {
  if (!state) return;restoring = true;
  setSplit(Number.isFinite(state.splits?.[layout]) ? state.splits[layout] : (Number.isFinite(state.split) ? state.split : splits[layout]));
  const target = document.getElementById(state.anchor);
  if (target && content.contains(target)) {
    content.scrollTop += target.getBoundingClientRect().top-content.getBoundingClientRect().top-(state.offset || 0);
    if (focus) {target.tabIndex = -1;target.focus({preventScroll:true});}
  }
  if (state.score?.url) await viewer.open(state.score);
  restoring = false;updateChapter();
}
function navigateTo(id, options = {}) {
  const target = document.getElementById(id);if (!target || !content.contains(target)) return;
  savePosition();navigation.close();glossary.close();
  mobileControls.close(false);
  target.scrollIntoView({block:'start'});target.tabIndex = -1;target.focus({preventScroll:true});
  const next = snapshot();next.anchor = id;next.offset = target.getBoundingClientRect().top-content.getBoundingClientRect().top;
  if (options.push !== false) history.pushState({reader:next},'',`#${encodeURIComponent(id)}`);
  updateChapter();savePosition();
}
function updateChapter() {
  if (!content.clientHeight) return;
  const top = content.getBoundingClientRect().top;let active = headings[0];
  for (const heading of headings) {if (heading.getBoundingClientRect().top <= top+48) active = heading;else break;}
  let chapter = active;
  if (active) {for (const heading of headings) {if (heading === active) break;if (heading.tagName === 'H2') chapter = heading;}if (active.tagName === 'H2') chapter = active;}
  if (chapter && chapter !== currentChapter) {currentChapter = chapter;document.getElementById('current-chapter').textContent = compact(chapter.textContent);}
  navigation.querySelectorAll('a[href^="#"]').forEach(link => {if (link.getAttribute('href') === `#${active?.id}`) link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
}
content.addEventListener('scroll', () => {
  if (!ready || restoring) return;
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {scrollFrame = null;updateChapter();snapshot();});
  clearTimeout(saveTimer);saveTimer = setTimeout(savePosition,200);
});
window.addEventListener('pagehide',savePosition);
window.addEventListener('popstate', event => {
  if (!ready) return;
  if (event.state?.reader) restore(event.state.reader,true);
  else {const id = decodeHash();if (id) navigateTo(id,{push:false});}
});
function decodeHash() {try {return decodeURIComponent(location.hash.slice(1));} catch {return '';}}

function glossaryId(link) {
  const range = document.createRange();range.setStart(link.closest('p') || link.parentElement,0);range.setEndBefore(link);
  const before = normalize(range.toString());
  const candidates = [['chorus','chorus'],['scores','score---conducteur'],['close position','close-position-position-fermée'],['open position','open-position-position-ouverte'],['triad','triad'],['fills','fill-remplir'],['vamp','vamp-ostinato'],['shuffle','shuffle'],['straight ahead','straight-ahead']]
    .map(([term,id]) => ({id,index:before.lastIndexOf(term)})).filter(x=>x.index>=0).sort((a,b)=>b.index-a.index);
  return candidates[0]?.id;
}
function openDefinition(id, trigger) {
  definition.replaceChildren();const title = document.createElement('h2');title.id = 'definition-title';
  const heading = document.getElementById(id);
  if (heading) {
    title.textContent = compact(heading.textContent);definition.append(title);let next = heading.nextElementSibling;
    while (next && !/^H[123]$/.test(next.tagName)) {const clone = next.cloneNode(true);clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));definition.append(clone);next = next.nextElementSibling;}
  } else if (id === 'straight-ahead' || id === 'shuffle') {
    title.textContent = id === 'shuffle' ? 'Shuffle' : 'Straight ahead';definition.append(title);
    const p = document.createElement('p');p.textContent = id === 'shuffle' ? t('Le rythme « shuffle » est décrit dans le commentaire de l’exemple 11.') : t('Pulsation régulière à quatre temps — indication donnée dans le cours.');definition.append(p);
    const link = document.createElement('a');link.href = id === 'shuffle' ? '#exemple-11' : '#lécriture-de-la-section-rythmique';link.textContent = t('Consulter le passage du cours');definition.append(link);
  } else return;
  glossary.setAttribute('aria-labelledby','definition-title');glossary.showModal();
  glossary.addEventListener('close', () => {if (!glossary.dataset.navigating) trigger.focus({preventScroll:true});delete glossary.dataset.navigating;},{once:true});
}
glossary.addEventListener('click', event => {const link = event.target.closest('a[href^="#"]');if (link) {event.preventDefault();glossary.dataset.navigating = 'true';navigateTo(decodeURIComponent(link.hash.slice(1)));}});

function buildNavigation(book) {
  headings = [...book.querySelectorAll('h2,h3,h4')].filter(h=>!h.closest('.revision-before'));
  const tree = navigation.querySelector('#toc-tree');tree.replaceChildren();let group;
  for (const heading of headings) {
    if (heading.tagName === 'H2') {const details = document.createElement('details'), summary = document.createElement('summary');summary.textContent = compact(heading.textContent);details.append(summary);group = document.createElement('div');group.className = 'toc-links';details.append(group);tree.append(details);}
    const link = document.createElement('a');link.href = `#${heading.id}`;link.textContent = heading.tagName === 'H2' ? t('Lire ce chapitre →') : compact(heading.textContent);link.classList.toggle('toc-subsection',heading.tagName === 'H4');group?.append(link);
  }
  navigation.addEventListener('click', event => {const link = event.target.closest('a[href^="#"]');if (link) {event.preventDefault();navigateTo(decodeURIComponent(link.hash.slice(1)));}});
  const toc = document.getElementById('toc');if (headings[0]) headings[0].before(toc);
  toc.innerHTML = h('<h2>Sommaire</h2><div class="toc-overview"></div>');
  for (const h of headings.filter(h=>h.tagName === 'H2')) {const a = document.createElement('a');a.href = `#${h.id}`;a.textContent = compact(h.textContent);toc.lastElementChild.append(a);}
}
let searchTimer;
search.addEventListener('input', () => {clearTimeout(searchTimer);searchTimer = setTimeout(() => {
  const words = normalize(search.value).split(/\s+/).filter(Boolean), results = navigation.querySelector('#search-results'), tree = navigation.querySelector('#toc-tree');results.replaceChildren();results.hidden = !words.length;tree.hidden = !!words.length;
  if (!words.length) {navigation.querySelector('#search-status').textContent = '';return;}
  const matches = searchItems.filter(item=>words.every(word=>item.normalized.includes(word)));
  navigation.querySelector('#search-status').textContent = matches.length ? t(matches.length === 1 ? '{count} résultat' : '{count} résultats',{count:matches.length}) + (matches.length > 30 ? t(' — 30 premiers affichés, précisez votre recherche.') : '') : t('Aucun résultat. Essayez un numéro d’exemple ou un autre terme.');
  for (const item of matches.slice(0,30)) {const a = document.createElement('a');a.href = `#${item.id}`;const strong = document.createElement('strong');strong.textContent = item.title;const excerpt = document.createElement('span');const start = Math.max(0,item.normalized.indexOf(words[0])-45);excerpt.textContent = (start ? '…' : '') + item.text.slice(start,start+190) + (item.text.length>start+190 ? '…' : '');a.append(strong,excerpt);results.append(a);}
},120);});

async function loadBook() {
  document.getElementById('initial-status')?.remove();
  let book = document.getElementById('book');if (!book) {book = document.createElement('article');book.id = 'book';content.append(book);}
  book.innerHTML = h('<p role="status">Chargement du cours…</p>');
  try {
    const response = await fetch(source);if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();if (!html.includes('<h1')) throw new Error(t('Texte indisponible'));
    book.innerHTML = html;document.getElementById('initial-status')?.remove();searchItems = [];
    buildNavigation(book);
    let passageNumber = 0, chapter = '', section = null;
    const originals = [...book.querySelectorAll('h1,h2,h3,h4,p,figure')].filter(el=>!el.closest('.revision-before') && !el.closest('#toc'));
    for (const element of originals) {if (!element.id) element.id = `passage-${++passageNumber}`;if (element.tagName === 'H2') chapter = compact(element.textContent);const text = compact(element.textContent);if (text) searchItems.push({id:element.id,title:chapter || t('Préface'),text,normalized:normalize(text)});}
    const glossaryStart = book.querySelector('#glossaire-anglais-français');
    const glossaryTerms = new Set([...book.querySelectorAll('h3')].filter(h => glossaryStart && glossaryStart.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).map(h=>h.id));
    for (const link of book.querySelectorAll('a[href^="#"]')) {
      let id = link.getAttribute('href').slice(1);if (id === 'glossaire-anglais-français') id = glossaryId(link);
      if (id && (glossaryTerms.has(id) || ['straight-ahead','shuffle'].includes(id))) {link.dataset.definition = id;link.href = `#${id === 'shuffle' ? 'exemple-11' : id === 'straight-ahead' ? 'lécriture-de-la-section-rythmique' : id}`;link.setAttribute('aria-haspopup','dialog');link.setAttribute('aria-label',t('Définition : {title}',{title:compact(document.getElementById(id)?.textContent || (id === 'shuffle' ? 'Shuffle' : 'Straight ahead'))}));}
    }
    for (const element of book.querySelectorAll('h2,h3,h4,a')) {
      if (element.closest('.revision-before') || element.closest('#toc')) continue;
      if (/^H[234]$/.test(element.tagName)) {if (element.tagName === 'H2') section = null;else section = element;continue;}
      const href = element.getAttribute('href') || '';
      if (/\.mp3(?:[?#]|$)/i.test(href)) {
        const score = scoreForAudio(href,section?.querySelector('a')?.getAttribute('href')), context = section ? compact(section.textContent) : '';
        const record = audio.add(element,score,context);searchItems.push({id:record.id,title:score?.title || t('Écoute'),text:record.name,normalized:normalize(record.name)});
      } else if (/\.(pdf|jpe?g|png|svg)([?#]|$)/i.test(href)) {
        const n = href.match(/^(\d+)\.(pdf|jpg)/)?.[1];if (n && !document.getElementById(`exemple-${n}`)) element.id = `exemple-${n}`;
        element.dataset.scoreTitle = scoreTitle(href);element.dataset.scoreContext = section ? compact(section.textContent) : '';
      }
    }
    for (const img of book.querySelectorAll('img')) {
      img.decoding = 'async';if (img.closest('a')) continue;
      const button = document.createElement('button');button.type = 'button';button.className = 'enlarge-illustration';button.setAttribute('aria-label',t('Agrandir : {title}',{title:img.alt}));img.before(button);button.append(img);
      button.addEventListener('click', () => {openScore({url:img.getAttribute('src'),title:img.alt});});
    }
    passages = [...book.querySelectorAll('h1,h2,h3,h4,p,figure,.audio-player')].filter(el=>el.id&&!el.closest('.revision-before')&&!el.closest('#toc'));
    // Layout must settle before restoring a position inside the long article.
    await Promise.race([Promise.all([...book.querySelectorAll('img')].map(img=>img.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,4000))]);
    ready = true;
    let transfer;
    try {transfer = JSON.parse(sessionStorage.getItem('dobbins:language-transfer'));sessionStorage.removeItem('dobbins:language-transfer');} catch { /* Optional transfer. */ }
    const id = decodeHash();
    if (transfer?.language === language && transfer.anchor === id) {
      if (transfer.score?.url) transfer.score = {...transfer.score,title:scoreTitle(transfer.score.url),context:''};
      await restore(transfer);history.replaceState({reader:snapshot()},'');
    } else if (history.state?.reader) await restore(history.state.reader);
    else if (id && document.getElementById(id)) navigateTo(id,{push:false});
    else history.replaceState({reader:snapshot()},'');
    updateChapter();
  } catch (error) {
    book.innerHTML = h('<div class="load-error" role="alert"><h2>Le cours n’a pas pu être chargé.</h2><p>Vérifiez votre connexion puis réessayez.</p><button type="button" id="retry-book">Réessayer</button><a href="texte.html">Ouvrir le texte directement</a></div>');
    book.querySelector('a').href = source;
    book.querySelector('#retry-book').addEventListener('click',loadBook);
  }
}
content.addEventListener('click', event => {
  const link = event.target.closest('a');if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (link.dataset.definition) {event.preventDefault();openDefinition(link.dataset.definition,link);return;}
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {event.preventDefault();navigateTo(decodeURIComponent(href.slice(1)));return;}
  if (/\.(pdf|jpe?g|png|svg)([?#]|$)/i.test(href)) {event.preventDefault();openScore({url:href,title:link.dataset.scoreTitle || compact(link.textContent),context:link.dataset.scoreContext});}
});
loadBook();
