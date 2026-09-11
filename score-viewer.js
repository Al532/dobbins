import {t, localizeMarkup as h} from './i18n.mjs';
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
    this.viewPosition = {left:0,top:0};
    sidebar.innerHTML = h(`
      <header class="score-heading"><h2 id="score-title">Votre espace d’étude</h2>
      <div class="score-tools" aria-label="Affichage de la partition" hidden>
        <div class="tool-group"><button type="button" data-action="out" aria-label="Réduire la partition">−</button><output id="zoom-status">100 %</output><button type="button" data-action="in" aria-label="Agrandir la partition">+</button></div>
        <label class="sr-only" for="score-fit">Ajustement de la partition</label><select id="score-fit"><option value="page">Page entière</option><option value="width">À la largeur</option></select>
      </div></header>
      <div class="score-stage" tabindex="0" role="region" aria-label="Partition, défilement et zoom">
        <div class="score-message"><span class="eyebrow">LIRE · ÉCOUTER · COMPARER</span><p>Ouvrez un exemple musical<br>pour étudier sa partition ici.</p><p class="muted">Lancer une écoute affiche automatiquement la partition correspondante.</p></div>
      </div>
      <footer class="score-pages" hidden><button type="button" data-action="prev" aria-label="Page précédente">←</button><label for="score-page">Page</label><input id="score-page" type="number" min="1" value="1" inputmode="numeric"><output id="page-count"></output><button type="button" data-action="next" aria-label="Page suivante">→</button><span id="score-status" role="status"></span></footer>`);
    this.stage = sidebar.querySelector('.score-stage');
    this.pageHint = document.createElement('div');
    this.pageHint.className = 'score-page-hint';
    this.pageHint.hidden = true;
    this.pageHint.setAttribute('role','status');
    this.stage.after(this.pageHint);
    this.heading = sidebar.querySelector('.score-heading');
    this.tools = sidebar.querySelector('.score-tools');
    this.footer = sidebar.querySelector('.score-pages');
    this.status = sidebar.querySelector('#score-status');
    for (const controls of [this.tools,this.footer]) controls.addEventListener('click', event => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'in' || action === 'out') {this.zoom = clamp(this.zoom * (action === 'in' ? 1.25 : .8), .5, 4); this.render();}
      if (action === 'prev' || action === 'next') this.goToPage(this.page + (action === 'next' ? 1 : -1));
    });
    this.stage.addEventListener('scroll', () => {
      if (!this.rendering && this.renderedWidth) {
        this.viewPosition = {left:this.stage.scrollLeft / this.renderedWidth,top:this.stage.scrollTop / this.renderedWidth};
        clearTimeout(this.scrollSaveTimer);
        this.scrollSaveTimer = setTimeout(() => this.onChange(this.snapshot()),150);
      }
    });
    sidebar.querySelector('#score-fit').addEventListener('change', event => {this.fit = event.target.value; this.zoom = 1; this.viewPosition = {left:0,top:0}; this.render();});
    sidebar.querySelector('#score-page').addEventListener('change', event => this.goToPage(Number(event.target.value)));
    this.stage.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault();this.goToPage(this.page + (event.key === 'ArrowRight' ? 1 : -1));}
      if (event.key === '+' || event.key === '=') {event.preventDefault();this.zoom = clamp(this.zoom * 1.25,.5,4);this.render();}
      if (event.key === '-') {event.preventDefault();this.zoom = clamp(this.zoom * .8,.5,4);this.render();}
    });
    // Scrollbars change the content box, not the space allocated to the viewer.
    // Observing that content box feeds our own fitted render back into itself.
    new ResizeObserver(() => {
      const {width,height} = this.stage.getBoundingClientRect();
      if (width === this.stageWidth && height === this.stageHeight) return;
      this.stageWidth = width; this.stageHeight = height;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.render(),80);
    }).observe(this.stage,{box:'border-box'});
    this.bindTouch();
  }
  bindTouch() {
    const points = new Map();
    let drag, pinch, multiple = false;
    const midpoint = () => {
      const [a,b] = [...points.values()];
      return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)};
    };
    const startDrag = point => ({...point,left:this.stage.scrollLeft,top:this.stage.scrollTop,
      right:this.stage.scrollWidth-this.stage.clientWidth-this.stage.scrollLeft,time:performance.now()});
    this.cancelTouch = () => {points.clear();drag = pinch = null;multiple = false;};
    this.stage.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' || !document.body.classList.contains('mobile-reading') || this.rendering || !this.stage.querySelector('canvas,img')) return;
      event.preventDefault();this.stage.setPointerCapture(event.pointerId);
      points.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if (points.size === 1) {multiple = false;drag = startDrag(points.get(event.pointerId));}
      else if (points.size === 2) {
        multiple = true;
        const middle = midpoint(), node = this.stage.firstElementChild, rect = node.getBoundingClientRect();
        pinch = {distance:Math.max(1,middle.d),zoom:this.zoom,width:rect.width,height:rect.height,
          x:(middle.x-rect.left)/rect.width,y:(middle.y-rect.top)/rect.height,node};
      }
    });
    this.stage.addEventListener('pointermove', event => {
      if (!points.has(event.pointerId)) return;
      event.preventDefault();points.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if (points.size >= 2 && pinch) {
        const middle = midpoint();this.zoom = clamp(pinch.zoom*middle.d/pinch.distance,.5,4);
        const ratio = this.zoom/pinch.zoom;
        pinch.node.style.width = `${pinch.width*ratio}px`;pinch.node.style.height = `${pinch.height*ratio}px`;
        const rect = pinch.node.getBoundingClientRect();
        this.stage.scrollLeft += rect.left+pinch.x*rect.width-middle.x;
        this.stage.scrollTop += rect.top+pinch.y*rect.height-middle.y;
        this.renderedWidth = rect.width;
      } else if (drag) {
        this.stage.scrollLeft = drag.left+drag.x-event.clientX;
        this.stage.scrollTop = drag.top+drag.y-event.clientY;
      }
      this.viewPosition = {left:this.stage.scrollLeft/this.renderedWidth,top:this.stage.scrollTop/this.renderedWidth};
    });
    const finish = event => {
      if (!points.has(event.pointerId)) return;
      points.delete(event.pointerId);
      if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId);
      if (points.size) {drag = startDrag([...points.values()][0]);return;}
      const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
      const swipe = event.type === 'pointerup' && !multiple && Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.5 && performance.now()-drag.time<700;
      if (swipe && ((dx<0 && drag.right<=2) || (dx>0 && drag.left<=2))) this.goToPage(this.page+(dx<0 ? 1 : -1));
      else if (pinch) this.render();
      else this.onChange(this.snapshot());
      this.cancelTouch();
    };
    this.stage.addEventListener('pointerup',finish);
    this.stage.addEventListener('pointercancel',finish);
    this.stage.addEventListener('lostpointercapture', event => {
      if (points.has(event.pointerId)) {this.cancelTouch();this.render();}
    });
  }
  control(selector) {return this.heading.querySelector(selector) || this.tools.querySelector(selector) || this.footer.querySelector(selector);}
  snapshot() {return this.current ? {...this.current, page:this.page, fit:this.fit, zoom:this.zoom,viewPosition:{...this.viewPosition}} : null;}
  async open(item) {
    if (!item?.url) return;
    const same = this.current?.url === item.url && this.current?.context === item.context && (this.doc || this.image);
    if (same && this.page === pdfPage(item.url) && item.page == null && item.zoom == null && item.fit == null && item.viewPosition == null) return;
    this.current = {...item};
    this.cancelTouch();
    const generation = ++this.generation;
    this.renderId = (this.renderId || 0) + 1;
    this.rendering = true;
    this.renderTask?.cancel();
    this.doc = null; this.image = null;
    this.page = item.page || pdfPage(item.url);
    this.fit = item.fit || 'width'; this.zoom = clamp(item.zoom || 1,.5,4);
    this.viewPosition = {left:Math.max(0,Number(item.viewPosition?.left) || 0),top:Math.max(0,Number(item.viewPosition?.top) || 0)};
    this.control('#score-fit').value = this.fit;
    this.control('#score-title').textContent = item.title || t('Partition');
    this.tools.hidden = false;
    this.footer.hidden = true;
    this.pageHint.hidden = true;
    this.message(t('Chargement de la partition…'));
    try {
      if (/\.pdf(?:[?#]|$)/i.test(item.url)) {
        const doc = await loadPdf(item.url);
        if (generation !== this.generation) return;
        this.doc = doc; this.count = doc.numPages; this.page = clamp(this.page,1,this.count);
      } else {
        const image = new Image(); image.alt = item.title || t('Partition musicale'); image.src = item.url;
        await image.decode();
        if (generation !== this.generation) return;
        this.image = image; this.count = 1; this.page = 1;
      }
      this.stage.replaceChildren();
      this.stage.scrollTo(0,0);
      this.footer.hidden = this.count <= 1;
      await this.render();
      this.onChange(this.snapshot());
    } catch (error) {
      if (generation !== this.generation) return;
      this.rendering = false;
      this.message(t('Impossible de charger la partition.'), true);
    }
  }
  message(text, retry = false) {
    this.pageHint.hidden = true;
    const box = document.createElement('div'); box.className = 'score-message'; box.setAttribute('role', retry ? 'alert' : 'status');
    const p = document.createElement('p'); p.textContent = text; box.append(p);
    if (retry) {
      const button = document.createElement('button'); button.textContent = t('Réessayer'); button.addEventListener('click', () => {this.doc = null;this.image = null;this.open(this.current);});box.append(button);
    }
    this.stage.replaceChildren(box);
  }
  goToPage(value) {
    if (!this.doc) return;
    this.page = clamp(Number.isFinite(value) ? Math.round(value) : 1,1,this.count);
    this.viewPosition = {left:0,top:0};
    this.stage.scrollTo(0,0);this.render();this.onChange(this.snapshot());
  }
  async render() {
    if ((!this.doc && !this.image) || !this.stage.clientWidth || !this.stage.clientHeight) return;
    const generation = this.generation;
    const renderId = this.renderId = (this.renderId || 0) + 1;
    const position = {...this.viewPosition};
    this.rendering = true;
    this.renderTask?.cancel();
    this.control('#zoom-status').textContent = `${Math.round(this.zoom * 100)} %`;
    this.control('#score-page').value = this.page;
    this.control('#score-page').max = this.count;
    this.control('#page-count').textContent = `/ ${this.count}`;
    this.control('[data-action="prev"]').disabled = this.page <= 1;
    this.control('[data-action="next"]').disabled = this.page >= this.count;
    const padding = getComputedStyle(this.stage);
    const width = Math.max(1,this.stage.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight));
    // Fit against the full height, even if the previous zoom needed a horizontal
    // scrollbar. The stable vertical gutter keeps the width independent as well.
    const height = Math.max(1,this.stage.getBoundingClientRect().height - parseFloat(padding.borderTopWidth) - parseFloat(padding.borderBottomWidth) - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom));
    try {
      const page = this.doc ? await this.doc.getPage(this.page) : null;
      if (generation !== this.generation || renderId !== this.renderId) return;
      const natural = page ? page.getViewport({scale:1}) : {width:this.image.naturalWidth,height:this.image.naturalHeight};
      const base = this.fit === 'width' ? width / natural.width : Math.min(width / natural.width,height / natural.height);
      const scale = base * this.zoom;
      if (page) {
        // A separate canvas per render prevents cancelled pages from overwriting a newer page.
        const canvas = document.createElement('canvas');
        canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('{title}, page {page} sur {count}',{title:this.current.title,page:this.page,count:this.count}));
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
      this.renderedWidth = natural.width * scale;
      this.stage.scrollTo(position.left * this.renderedWidth,position.top * this.renderedWidth);
      this.viewPosition = position;
      this.status.textContent = t('Page {page} sur {count}',{page:this.page,count:this.count});
      this.pageHint.textContent = `${this.status.textContent} · ${t('Balayez ↔')}`;
      this.pageHint.hidden = !this.doc || this.count <= 1;
      this.onChange(this.snapshot());
    } catch (error) {
      if (error.name === 'RenderingCancelledException' || generation !== this.generation || renderId !== this.renderId) return;
      this.message(t('Impossible d’afficher cette page.'),true);
    } finally {
      requestAnimationFrame(() => {if (renderId === this.renderId) this.rendering = false;});
    }
  }
}
