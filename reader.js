import {compact, normalize, scoreForAudio, scoreTitle, clamp} from './reader-utils.mjs';
import {ScoreViewer} from './score-viewer.js';
import {StudyAudio} from './audio-player.js';

const content = document.getElementById('content'), sidebar = document.getElementById('sidebar');
const source = content.dataset.textSource === 'texte-relecture.html' ? 'texte-relecture.html' : 'texte.html';
const storageKey = `dobbins:lecture:${source}:v1`;
let saved;
try {saved = JSON.parse(localStorage.getItem(storageKey));} catch {saved = null;}
let ready = false, restoring = false, mode = 'both', lastTextMode = 'both', headings = [], passages = [], searchItems = [];
let currentChapter, saveTimer, scrollFrame, viewer, lastReading = {anchor:'',offset:0};
history.scrollRestoration = 'manual';

const header = document.createElement('header');header.className = 'reader-bar';
header.innerHTML = `<a class="skip-link" href="#content">Aller au texte</a><div class="reader-actions"><span class="brand">Dobbins<span>ARRANGEMENT JAZZ</span></span><button type="button" id="open-toc" aria-haspopup="dialog">Sommaire</button><button type="button" id="open-search" aria-haspopup="dialog">Rechercher</button><div class="view-modes" role="group" aria-label="Mode de lecture"><button type="button" data-mode="text" aria-pressed="false">Texte</button><button type="button" data-mode="score" aria-pressed="false">Partition</button><button type="button" data-mode="both" aria-pressed="true">Ensemble</button></div></div><div class="reading-context"><span id="current-chapter">Une approche linéaire</span><div><button type="button" id="resume-reading" hidden>Reprendre ma lecture</button><button type="button" id="copy-passage">Partager ce passage</button></div></div>`;
document.body.prepend(header);
const workspace = document.createElement('div');workspace.id = 'workspace';workspace.className = 'workspace';
content.before(workspace);workspace.append(content);
const divider = document.createElement('div');divider.className = 'divider';divider.tabIndex = 0;divider.setAttribute('role','separator');divider.setAttribute('aria-label','Répartition du texte et de la partition');divider.setAttribute('aria-orientation','vertical');divider.setAttribute('aria-valuemin','25');divider.setAttribute('aria-valuemax','75');divider.setAttribute('aria-valuenow','48');
workspace.append(divider,sidebar);content.tabIndex = -1;
const announcement = document.createElement('div');announcement.className = 'sr-only';announcement.setAttribute('role','status');document.body.append(announcement);
const announce = text => {announcement.textContent = text;};
function createDialog(label) {
  const dialog = document.createElement('dialog');dialog.className = 'reader-dialog';dialog.setAttribute('aria-label',label);
  dialog.innerHTML = `<div class="dialog-top"><strong>${label}</strong><button type="button" class="close-dialog">Fermer</button></div>`;
  document.body.append(dialog);dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {if (event.target === dialog) {const r = dialog.getBoundingClientRect();if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();}});
  return dialog;
}
const navigation = createDialog('Parcourir le cours');
navigation.insertAdjacentHTML('beforeend','<label class="search-label" for="course-search">Rechercher un chapitre, un exemple ou une notion</label><input id="course-search" type="search" placeholder="Exemple 22, voicing, Minor D…" autocomplete="off"><p id="search-status" role="status"></p><div id="search-results" hidden></div><nav id="toc-tree" aria-label="Chapitres et sous-sections"></nav>');
const search = navigation.querySelector('#course-search');
document.getElementById('open-toc').addEventListener('click', () => {
  search.value = '';navigation.querySelector('#search-results').hidden = true;navigation.querySelector('#toc-tree').hidden = false;navigation.querySelector('#search-status').textContent = '';
  navigation.showModal();
  const current = navigation.querySelector('[aria-current="location"]');if (current) current.closest('details').open = true;
  navigation.querySelector('.close-dialog').focus();
});
document.getElementById('open-search').addEventListener('click', () => {navigation.showModal();search.focus();});
const glossary = createDialog('Définition');
const definition = document.createElement('div');definition.className = 'definition';glossary.append(definition);
const shareDialog = createDialog('Partager ce passage');
shareDialog.insertAdjacentHTML('beforeend','<p>Copiez ce lien pour retrouver exactement ce passage.</p><label for="share-url">Lien du passage</label><input id="share-url" readonly>');

function setMode(value, focus = false) {
  if (ready && mode !== 'score') lastReading = snapshot();
  const position = lastReading;
  mode = ['text','score','both'].includes(value) ? value : 'both';workspace.dataset.mode = mode;
  if (mode !== 'score') lastTextMode = mode;
  content.inert = mode === 'score';sidebar.inert = mode === 'text';
  header.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.mode === mode)));
  if (ready) alignReading(position);
  if (focus) (mode === 'score' ? sidebar.querySelector('.score-stage') : content).focus({preventScroll:true});
  viewer?.render();
}
header.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {setMode(button.dataset.mode,true);savePosition();}));
header.querySelector('.skip-link').addEventListener('click', event => {event.preventDefault();setMode('text',true);});
let split = 48;
function setSplit(value) {
  const position = ready && content.clientHeight ? snapshot() : lastReading;
  split = clamp(value,25,75);workspace.style.setProperty('--text-share',`${split}%`);divider.setAttribute('aria-valuenow',String(Math.round(split)));
  if (ready) alignReading(position);
  viewer?.render();
}
divider.addEventListener('keydown', event => {
  const portrait = matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  const down = portrait ? 'ArrowDown' : 'ArrowRight', up = portrait ? 'ArrowUp' : 'ArrowLeft';
  if ([up,down,'Home','End'].includes(event.key)) {event.preventDefault();setSplit(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : split + (event.key === down ? 3 : -3));savePosition();}
});
divider.addEventListener('pointerdown', event => {divider.setPointerCapture(event.pointerId);event.preventDefault();});
divider.addEventListener('pointermove', event => {
  if (!divider.hasPointerCapture(event.pointerId)) return;
  const r = workspace.getBoundingClientRect(), vertical = matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  setSplit(vertical ? 100 * (event.clientY-r.top)/r.height : 100 * (event.clientX-r.left)/r.width);
});
divider.addEventListener('pointerup', event => {if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);savePosition();});
const updateOrientation = () => divider.setAttribute('aria-orientation',matchMedia('(max-width: 700px) and (orientation: portrait)').matches ? 'horizontal' : 'vertical');
window.addEventListener('resize',updateOrientation);updateOrientation();
window.addEventListener('resize', () => {if (ready) {alignReading(lastReading);updateChapter();savePosition();}});
viewer = new ScoreViewer(sidebar, () => {if (ready && !restoring) savePosition();});
const audio = new StudyAudio((record, reveal) => {
  if (!record?.score) return;
  viewer.open({...record.score,context:record.context});
  if (reveal) setMode(matchMedia('(max-width: 700px)').matches ? 'score' : 'both');
}, async record => {if (sidebar.classList.contains('score-expanded')) await viewer.fullscreen();if (record) navigateTo(record.element.id);});
document.addEventListener('reader-fullscreen', event => {
  const active = event.detail.active;
  (active ? sidebar : document.body).append(audio.panel);
  header.inert = active;divider.inert = active;content.inert = active || mode === 'score';
});
setMode(matchMedia('(max-width: 700px)').matches ? 'text' : 'both');

function snapshot() {
  if (!content.clientHeight) return {...lastReading,score:viewer.snapshot(),mode,textMode:lastTextMode,split};
  const top = content.getBoundingClientRect().top;let anchor = passages[0];
  let distance = Infinity;
  for (const element of passages) {
    const delta = element.getBoundingClientRect().top - top;
    if (Math.abs(delta) < distance) {anchor = element;distance = Math.abs(delta);}
    if (delta >= 0) break;
  }
  lastReading = {anchor:anchor?.id || '',offset:anchor ? anchor.getBoundingClientRect().top-top : 0};
  return {...lastReading,score:viewer.snapshot(),mode,textMode:lastTextMode,split};
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
  setSplit(Number.isFinite(state.split) ? state.split : 48);setMode(state.mode === 'score' ? (state.textMode || 'both') : state.mode);
  const target = document.getElementById(state.anchor);
  if (target && content.contains(target)) {
    content.scrollTop += target.getBoundingClientRect().top-content.getBoundingClientRect().top-(state.offset || 0);
    if (focus && mode !== 'score') {target.tabIndex = -1;target.focus({preventScroll:true});}
  }
  if (state.score?.url) await viewer.open(state.score);
  setMode(state.mode);
  restoring = false;updateChapter();
}
function navigateTo(id, options = {}) {
  const target = document.getElementById(id);if (!target || !content.contains(target)) return;
  savePosition();navigation.close();glossary.close();
  if (mode === 'score') setMode('text');
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
  if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {scrollFrame = null;updateChapter();});
  clearTimeout(saveTimer);saveTimer = setTimeout(savePosition,200);
});
window.addEventListener('pagehide',savePosition);
window.addEventListener('popstate', event => {
  if (!ready) return;
  if (event.state?.reader) restore(event.state.reader,true);
  else {const id = decodeHash();if (id) navigateTo(id,{push:false});}
});
function decodeHash() {try {return decodeURIComponent(location.hash.slice(1));} catch {return '';}}
document.getElementById('resume-reading').addEventListener('click', async () => {
  savePosition();await restore(saved,true);history.pushState({reader:snapshot()},'',`#${encodeURIComponent(saved.anchor)}`);savePosition();announce('Votre passage de lecture a été retrouvé.');
});
document.getElementById('copy-passage').addEventListener('click', async () => {
  if (!ready) return;
  const state = snapshot(), url = new URL(location.href);url.hash = state.anchor;
  try {await navigator.clipboard.writeText(url.href);announce('Lien du passage copié.');const b = document.getElementById('copy-passage');b.textContent = 'Lien copié';setTimeout(() => b.textContent = 'Partager ce passage',2500);}
  catch {shareDialog.querySelector('#share-url').value = url.href;shareDialog.showModal();shareDialog.querySelector('input').select();}
});

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
    const p = document.createElement('p');p.textContent = id === 'shuffle' ? 'Le rythme « shuffle » est décrit dans le commentaire de l’exemple 11.' : 'Pulsation régulière à quatre temps — indication donnée dans le cours.';definition.append(p);
    const link = document.createElement('a');link.href = id === 'shuffle' ? '#exemple-11' : '#lécriture-de-la-section-rythmique';link.textContent = 'Consulter le passage du cours';definition.append(link);
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
    const link = document.createElement('a');link.href = `#${heading.id}`;link.textContent = heading.tagName === 'H2' ? 'Lire ce chapitre →' : compact(heading.textContent);link.classList.toggle('toc-subsection',heading.tagName === 'H4');group?.append(link);
  }
  navigation.addEventListener('click', event => {const link = event.target.closest('a[href^="#"]');if (link) {event.preventDefault();navigateTo(decodeURIComponent(link.hash.slice(1)));}});
  const toc = document.getElementById('toc');if (headings[0]) headings[0].before(toc);
  toc.innerHTML = '<h2>Sommaire</h2><div class="toc-overview"></div>';
  for (const h of headings.filter(h=>h.tagName === 'H2')) {const a = document.createElement('a');a.href = `#${h.id}`;a.textContent = compact(h.textContent);toc.lastElementChild.append(a);}
}
let searchTimer;
search.addEventListener('input', () => {clearTimeout(searchTimer);searchTimer = setTimeout(() => {
  const words = normalize(search.value).split(/\s+/).filter(Boolean), results = navigation.querySelector('#search-results'), tree = navigation.querySelector('#toc-tree');results.replaceChildren();results.hidden = !words.length;tree.hidden = !!words.length;
  if (!words.length) {navigation.querySelector('#search-status').textContent = '';return;}
  const matches = searchItems.filter(item=>words.every(word=>item.normalized.includes(word)));
  navigation.querySelector('#search-status').textContent = matches.length ? `${matches.length} résultat${matches.length > 1 ? 's' : ''}${matches.length > 30 ? ' — 30 premiers affichés, précisez votre recherche.' : ''}` : 'Aucun résultat. Essayez un numéro d’exemple ou un autre terme.';
  for (const item of matches.slice(0,30)) {const a = document.createElement('a');a.href = `#${item.id}`;const strong = document.createElement('strong');strong.textContent = item.title;const excerpt = document.createElement('span');const start = Math.max(0,item.normalized.indexOf(words[0])-45);excerpt.textContent = (start ? '…' : '') + item.text.slice(start,start+190) + (item.text.length>start+190 ? '…' : '');a.append(strong,excerpt);results.append(a);}
},120);});

async function loadBook() {
  document.getElementById('initial-status')?.remove();
  let book = document.getElementById('book');if (!book) {book = document.createElement('article');book.id = 'book';content.append(book);}
  book.innerHTML = '<p role="status">Chargement du cours…</p>';
  try {
    const response = await fetch(source);if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();if (!html.includes('<h1')) throw new Error('Texte indisponible');
    book.innerHTML = html;document.getElementById('initial-status')?.remove();searchItems = [];
    buildNavigation(book);
    let passageNumber = 0, chapter = '', section = null;
    const originals = [...book.querySelectorAll('h1,h2,h3,h4,p,figure')].filter(el=>!el.closest('.revision-before') && !el.closest('#toc'));
    for (const element of originals) {if (!element.id) element.id = `passage-${++passageNumber}`;if (element.tagName === 'H2') chapter = compact(element.textContent);const text = compact(element.textContent);if (text) searchItems.push({id:element.id,title:chapter || 'Préface',text,normalized:normalize(text)});}
    const glossaryStart = book.querySelector('#glossaire-anglais-français');
    const glossaryTerms = new Set([...book.querySelectorAll('h3')].filter(h => glossaryStart.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING).map(h=>h.id));
    for (const link of book.querySelectorAll('a[href^="#"]')) {
      let id = link.getAttribute('href').slice(1);if (id === 'glossaire-anglais-français') id = glossaryId(link);
      if (id && (glossaryTerms.has(id) || ['straight-ahead','shuffle'].includes(id))) {link.dataset.definition = id;link.href = `#${id === 'shuffle' ? 'exemple-11' : id === 'straight-ahead' ? 'lécriture-de-la-section-rythmique' : id}`;link.setAttribute('aria-haspopup','dialog');link.setAttribute('aria-label',`Définition : ${compact(document.getElementById(id)?.textContent || (id === 'shuffle' ? 'Shuffle' : 'Straight ahead'))}`);}
    }
    for (const element of book.querySelectorAll('h2,h3,h4,a')) {
      if (element.closest('.revision-before') || element.closest('#toc')) continue;
      if (/^H[234]$/.test(element.tagName)) {if (element.tagName === 'H2') section = null;else section = element;continue;}
      const href = element.getAttribute('href') || '';
      if (/\.mp3(?:[?#]|$)/i.test(href)) {
        const score = scoreForAudio(href,section?.querySelector('a')?.getAttribute('href')), context = section ? compact(section.textContent) : '';
        const record = audio.add(element,score,context);searchItems.push({id:record.id,title:score?.title || 'Écoute',text:record.name,normalized:normalize(record.name)});
      } else if (/\.(pdf|jpe?g|png|svg)([?#]|$)/i.test(href)) {
        const n = href.match(/^(\d+)\.(pdf|jpg)/)?.[1];if (n && !document.getElementById(`exemple-${n}`)) element.id = `exemple-${n}`;
        element.dataset.scoreTitle = scoreTitle(href);element.dataset.scoreContext = section ? compact(section.textContent) : '';
      }
    }
    for (const img of book.querySelectorAll('img')) {
      img.decoding = 'async';if (img.closest('a')) continue;
      const button = document.createElement('button');button.type = 'button';button.className = 'enlarge-illustration';button.setAttribute('aria-label',`Agrandir : ${img.alt}`);img.before(button);button.append(img);
      button.addEventListener('click', () => {viewer.open({url:img.getAttribute('src'),title:img.alt});setMode(matchMedia('(max-width: 700px)').matches ? 'score' : 'both');});
    }
    passages = [...book.querySelectorAll('h1,h2,h3,h4,p,figure,.audio-player')].filter(el=>el.id&&!el.closest('.revision-before')&&!el.closest('#toc'));
    // Layout must settle before restoring a position inside the long article.
    await Promise.race([Promise.all([...book.querySelectorAll('img')].map(img=>img.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,4000))]);
    ready = true;
    if (saved?.anchor && document.getElementById(saved.anchor)) document.getElementById('resume-reading').hidden = false;
    const id = decodeHash();if (history.state?.reader) await restore(history.state.reader);else if (id && document.getElementById(id)) navigateTo(id,{push:false});else history.replaceState({reader:snapshot()},'');
    updateChapter();
  } catch (error) {
    book.innerHTML = '<div class="load-error" role="alert"><h2>Le cours n’a pas pu être chargé.</h2><p>Vérifiez votre connexion puis réessayez.</p><button type="button" id="retry-book">Réessayer</button><a href="texte.html">Ouvrir le texte directement</a></div>';
    book.querySelector('#retry-book').addEventListener('click',loadBook);
  }
}
content.addEventListener('click', event => {
  const link = event.target.closest('a');if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (link.dataset.definition) {event.preventDefault();openDefinition(link.dataset.definition,link);return;}
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {event.preventDefault();navigateTo(decodeURIComponent(href.slice(1)));return;}
  if (/\.(pdf|jpe?g|png|svg)([?#]|$)/i.test(href)) {event.preventDefault();viewer.open({url:href,title:link.dataset.scoreTitle || compact(link.textContent),context:link.dataset.scoreContext});setMode(matchMedia('(max-width: 700px)').matches ? 'score' : 'both');}
});
loadBook();
