import {clamp, pdfPage} from './reader-utils.mjs';

// PDF.js is loaded only when a score actually needs it. Reading remains available on failure.
let pdfLibrary;
const pdfCache = new Map();
async function loadPdf(href) {
  const url = new URL(href, location.href);
  url.hash = '';
  url.searchParams.delete('page');
  const key = url.href;
  if (!pdfLibrary) pdfLibrary = import('./pdf.mjs').then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.mjs', import.meta.url).href;
    return lib;
  }).catch(error => { pdfLibrary = null; throw error; });
  if (!pdfCache.has(key)) pdfCache.set(key, pdfLibrary.then(lib => lib.getDocument({url:key, rangeChunkSize:65536}).promise).catch(error => {
    pdfCache.delete(key); throw error;
  }));
  return pdfCache.get(key);
}

export class ScoreViewer {
  constructor(sidebar, onChange) {
    this.sidebar = sidebar;
    this.onChange = onChange;
    this.generation = 0;
    this.zoom = 1;
    this.fit = 'width';
    this.page = 1;
    this.count = 1;
    sidebar.innerHTML = `
      <header class="score-heading"><div><span class="eyebrow">PARTITION</span><h2 id="score-title">Votre espace d’étude</h2><p id="score-context"></p></div></header>
      <div class="score-tools" aria-label="Affichage de la partition" hidden>
        <div class="tool-group"><button type="button" data-action="out" aria-label="Réduire la partition">−</button><output id="zoom-status">100 %</output><button type="button" data-action="in" aria-label="Agrandir la partition">+</button></div>
        <label class="sr-only" for="score-fit">Ajustement de la partition</label><select id="score-fit"><option value="page">Page entière</option><option value="width">À la largeur</option></select>
        <button type="button" data-action="fullscreen" aria-pressed="false">Plein écran</button>
        <a id="score-original" target="_blank" rel="noopener">Ouvrir séparément ↗</a>
      </div>
      <div class="score-stage" tabindex="0" role="region" aria-label="Partition, défilement et zoom">
        <div class="score-message"><span class="eyebrow">LIRE · ÉCOUTER · COMPARER</span><p>Ouvrez un exemple musical<br>pour étudier sa partition ici.</p><p class="muted">Le bouton « Étudier cet exemple » réunit la partition et l’écoute.</p></div>
      </div>
      <footer class="score-pages" hidden><button type="button" data-action="prev" aria-label="Page précédente">←</button><label for="score-page">Page</label><input id="score-page" type="number" min="1" value="1" inputmode="numeric"><output id="page-count"></output><button type="button" data-action="next" aria-label="Page suivante">→</button><span id="score-status" role="status"></span></footer>`;
    this.stage = sidebar.querySelector('.score-stage');
    this.tools = sidebar.querySelector('.score-tools');
    this.footer = sidebar.querySelector('.score-pages');
    this.status = sidebar.querySelector('#score-status');
    sidebar.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'in' || action === 'out') {this.zoom = clamp(this.zoom * (action === 'in' ? 1.25 : .8), .5, 4); this.render();}
      if (action === 'prev' || action === 'next') this.goToPage(this.page + (action === 'next' ? 1 : -1));
      if (action === 'fullscreen') this.fullscreen();
    });
    sidebar.querySelector('#score-fit').addEventListener('change', event => {this.fit = event.target.value; this.zoom = 1; this.render();});
    sidebar.querySelector('#score-page').addEventListener('change', event => this.goToPage(Number(event.target.value)));
    this.stage.addEventListener('keydown', event => {
      if (event.key === '+' || event.key === '=') {event.preventDefault();this.zoom = clamp(this.zoom * 1.25,.5,4);this.render();}
      if (event.key === '-') {event.preventDefault();this.zoom = clamp(this.zoom * .8,.5,4);this.render();}
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) this.sidebar.classList.remove('score-expanded');
      this.syncFullscreen();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.sidebar.classList.contains('score-expanded') && !document.fullscreenElement) {
        this.sidebar.classList.remove('score-expanded'); this.syncFullscreen();
      }
    });
    new ResizeObserver(() => {clearTimeout(this.resizeTimer);this.resizeTimer = setTimeout(() => this.render(),80);}).observe(this.stage);
  }
  snapshot() {return this.current ? {...this.current, page:this.page, fit:this.fit, zoom:this.zoom} : null;}
  async open(item) {
    if (!item?.url) return;
    const same = this.current?.url === item.url && this.current?.context === item.context && (this.doc || this.image);
    if (same) return;
    this.current = {...item};
    const generation = ++this.generation;
    this.renderTask?.cancel();
    this.doc = null; this.image = null;
    this.page = item.page || pdfPage(item.url);
    this.fit = item.fit || 'width'; this.zoom = clamp(item.zoom || 1,.5,4);
    this.sidebar.querySelector('#score-fit').value = this.fit;
    this.sidebar.querySelector('#score-title').textContent = item.title || 'Partition';
    this.sidebar.querySelector('#score-context').textContent = item.context || '';
    this.sidebar.querySelector('#score-original').href = item.url;
    this.tools.hidden = false;
    this.footer.hidden = true;
    this.message('Chargement de la partition…');
    try {
      if (/\.pdf(?:[?#]|$)/i.test(item.url)) {
        const doc = await loadPdf(item.url);
        if (generation !== this.generation) return;
        this.doc = doc; this.count = doc.numPages; this.page = clamp(this.page,1,this.count);
      } else {
        const image = new Image(); image.alt = item.title || 'Partition musicale'; image.src = item.url;
        await image.decode();
        if (generation !== this.generation) return;
        this.image = image; this.count = 1; this.page = 1;
      }
      this.stage.replaceChildren();
      this.stage.scrollTo(0,0);
      this.footer.hidden = false;
      this.render();
      this.onChange(this.snapshot());
    } catch (error) {
      if (generation !== this.generation) return;
      this.message('Impossible de charger la partition.', true);
    }
  }
  message(text, retry = false) {
    const box = document.createElement('div'); box.className = 'score-message'; box.setAttribute('role', retry ? 'alert' : 'status');
    const p = document.createElement('p'); p.textContent = text; box.append(p);
    if (retry) {
      const button = document.createElement('button'); button.textContent = 'Réessayer'; button.addEventListener('click', () => {this.doc = null;this.image = null;this.open(this.current);});box.append(button);
      const link = document.createElement('a');link.textContent = 'Ouvrir la partition séparément ↗';link.href = this.current.url;link.target = '_blank';link.rel = 'noopener';box.append(link);
    }
    this.stage.replaceChildren(box);
  }
  goToPage(value) {
    if (!this.doc) return;
    this.page = clamp(Number.isFinite(value) ? Math.round(value) : 1,1,this.count);
    this.stage.scrollTo(0,0);this.render();this.onChange(this.snapshot());
  }
  async render() {
    if ((!this.doc && !this.image) || !this.stage.clientWidth || !this.stage.clientHeight) return;
    const generation = this.generation;
    const renderId = this.renderId = (this.renderId || 0) + 1;
    this.renderTask?.cancel();
    this.sidebar.querySelector('#zoom-status').textContent = `${Math.round(this.zoom * 100)} %`;
    this.sidebar.querySelector('#score-page').value = this.page;
    this.sidebar.querySelector('#score-page').max = this.count;
    this.sidebar.querySelector('#page-count').textContent = `/ ${this.count}`;
    this.sidebar.querySelector('[data-action="prev"]').disabled = this.page <= 1;
    this.sidebar.querySelector('[data-action="next"]').disabled = this.page >= this.count;
    const width = Math.max(1,this.stage.clientWidth - 32), height = Math.max(1,this.stage.clientHeight - 32);
    try {
      const page = this.doc ? await this.doc.getPage(this.page) : null;
      if (generation !== this.generation || renderId !== this.renderId) return;
      const natural = page ? page.getViewport({scale:1}) : {width:this.image.naturalWidth,height:this.image.naturalHeight};
      const base = this.fit === 'width' ? width / natural.width : Math.min(width / natural.width,height / natural.height);
      const scale = base * this.zoom;
      if (page) {
        // A separate canvas per render prevents cancelled pages from overwriting a newer page.
        const canvas = document.createElement('canvas');
        canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`${this.current.title}, page ${this.page} sur ${this.count}`);
        const density = Math.min(devicePixelRatio || 1,2,Math.sqrt(16000000 / (natural.width * natural.height * scale * scale)));
        const viewport = page.getViewport({scale:scale * density});
        canvas.width = Math.ceil(viewport.width);canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${natural.width * scale}px`;canvas.style.height = `${natural.height * scale}px`;
        this.renderTask = page.render({canvasContext:canvas.getContext('2d'),viewport});
        await this.renderTask.promise;
        if (generation !== this.generation || renderId !== this.renderId) return;
        this.stage.replaceChildren(canvas);
      } else {
        this.image.style.width = `${natural.width * scale}px`;this.image.style.height = `${natural.height * scale}px`;
        this.stage.replaceChildren(this.image);
      }
      this.status.textContent = `Page ${this.page} sur ${this.count}`;
    } catch (error) {
      if (error.name === 'RenderingCancelledException' || generation !== this.generation || renderId !== this.renderId) return;
      this.message('Impossible d’afficher cette page.',true);
    }
  }
  async fullscreen() {
    if (document.fullscreenElement === this.sidebar) await document.exitFullscreen();
    else if (this.sidebar.classList.contains('score-expanded')) this.sidebar.classList.remove('score-expanded');
    else {
      this.sidebar.classList.add('score-expanded');
      try {await this.sidebar.requestFullscreen();} catch { /* Full-window fallback, including browsers without the fullscreen API. */ }
    }
    this.syncFullscreen();
  }
  syncFullscreen() {
    const active = this.sidebar.classList.contains('score-expanded') || document.fullscreenElement === this.sidebar;
    const button = this.sidebar.querySelector('[data-action="fullscreen"]');
    button.textContent = active ? 'Quitter le plein écran' : 'Plein écran';button.setAttribute('aria-pressed',String(active));
    document.dispatchEvent(new CustomEvent('reader-fullscreen',{detail:{active}}));
    button.focus({preventScroll:true});this.render();
  }
}
