// Import de la librairie PDF.js (display layer) depuis le dossier build
import * as pdfjsLib from './build/pdf.mjs';

// Configure le chemin du worker (core layer)
pdfjsLib.GlobalWorkerOptions.workerSrc = './build/pdf.worker.mjs';

/* =========================================================
   1. Cache des PDF déjà ouverts
   ========================================================= */
const pdfCache = new Map(); // absURL -> Promise<pdfjsLib.PDFDocumentProxy>

/* =========================================================
   2. Chargement du fichier principal (texte.html)
   ========================================================= */
fetch('texte.html')
  .then(r => r.text())
  .then(html => {
    // On insère le contenu après le sommaire (TOC)
    document.getElementById('toc').insertAdjacentHTML('afterend', html);
    initTOC();
    initInteractions();
  })
  .catch(console.error);

/* =========================================================
   3. Table des matières dynamique
   ========================================================= */
function initTOC() {
  const toc = document.getElementById('toc');
  toc.innerHTML = '<h2>Sommaire</h2><ul></ul>';
  const ul = toc.querySelector('ul');

  document.querySelectorAll('#content h2').forEach((h, i) => {
    // Évite d'inclure le titre du TOC lui-même
    if (h.closest('#toc')) return;
    const id = h.id || 'section-' + i;
    h.id = id;
    ul.insertAdjacentHTML('beforeend',
      `<li><a href="#${id}">${h.textContent}</a></li>`);
  });

  toc.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });
  });
}

/* =========================================================
   4. Mise en place des interactions :
      audio, images et PDF
   ========================================================= */
function initInteractions() {
  // 4-1. Affichage d'une image par défaut dans la sidebar
  const sidebar = document.getElementById('sidebar');
  sidebar.style.backgroundImage = 'url(1.jpg)';

  // 4-2. Création du lecteur audio pour tous les liens .mp3
  document
    .querySelectorAll('.content a[href$=".mp3"], .content a[href*=".mp3?"]')
    .forEach(createAudioPlayer);

  // 4-3. Gestion des clics sur les liens (images / PDF) dans la zone texte
  document.querySelector('.content').addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href) return;

    if (/\.pdf(\?|#|$)/i.test(href)) {
      e.preventDefault();
      showPdfInSidebar(href);
      return;
    }
    if (/\.(jpe?g|png|gif|bmp|webp|svg)(\?|#|$)/i.test(href)) {
      e.preventDefault();
      showImageInSidebar(href);
    }
  });
}

/* =========================================================
   5. Lecteur audio personnalisé
   ========================================================= */
function createAudioPlayer(link) {
  const label = link.textContent;
  const urlObj = new URL(link.getAttribute('href'), location.href);
  const start = parseFloat(urlObj.searchParams.get('start')) || 0;

  const wrapper = document.createElement('span');
  wrapper.className = 'audio-player';
  wrapper.dataset.start = start;
  if (link.classList.contains('reset')) wrapper.classList.add('reset');

  wrapper.innerHTML = `
    <button class="play-btn" title="Écouter">►</button>
    <span class="audio-label">${label}</span>
    <span class="audio-controls">
      <span class="progress"><span class="progress-filled"></span></span>
    </span>
    <audio src="${urlObj.pathname + urlObj.search}"></audio>
  `;

  link.replaceWith(wrapper);

  // Références aux éléments
  const audio = wrapper.querySelector('audio');
  const playBtn = wrapper.querySelector('.play-btn');
  const progressBar = wrapper.querySelector('.progress');
  const progressFilled = wrapper.querySelector('.progress-filled');

  // Positionnement initial via 'start'
  audio.addEventListener('loadedmetadata', () => {
    if (start) audio.currentTime = start;
  });

  // Gestion du play / pause
  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      // Pause toute autre lecture audio
      document.querySelectorAll('.audio-player audio').forEach(other => {
        if (other === audio) return;
        other.pause();
        const wrap = other.closest('.audio-player');
        if (wrap && wrap.classList.contains('reset')) {
          other.currentTime = parseFloat(wrap.dataset.start) || 0;
          wrap.querySelector('.progress-filled').style.width = '0%';
        }
        const btn = wrap.querySelector('.play-btn');
        if (btn) btn.textContent = '►';
      });
      audio.play();
      playBtn.textContent = '❚❚';
    } else {
      audio.pause();
      if (wrapper.classList.contains('reset')) {
        audio.currentTime = start;
        progressFilled.style.width = '0%';
      }
      playBtn.textContent = '►';
    }
  });

  // Mise à jour de la barre de progression
  audio.addEventListener('timeupdate', () => {
    if (!audio.duration) return;
    const pct = ((audio.currentTime - start) / (audio.duration - start)) * 100;
    progressFilled.style.width = Math.max(0, Math.min(100, pct)) + '%';
  });

  progressBar.addEventListener('click', e => {
    const r = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - r.left) / r.width;
    audio.currentTime = start + ratio * (audio.duration - start);
  });

  // Réinitialisation à la fin de lecture
  audio.addEventListener('ended', () => {
    playBtn.textContent = '►';
    progressFilled.style.width = '0%';
  });
}

/* =========================================================
   6. Affichage d'une image dans la sidebar
   ========================================================= */
function showImageInSidebar(url) {
  const sidebar = document.getElementById('sidebar');
  sidebar.innerHTML = '';
  sidebar.style.backgroundImage = `url(${url})`;
}

/* =========================================================
   7. Lecteur PDF dans la sidebar
   ========================================================= */
function showPdfInSidebar(url) {
  // Normalisation de l'URL et gestion du cache
  const absURL = new URL(url, location.href).href;
  const pdfProm = pdfCache.get(absURL) ||
    (pdfjsLib.getDocument(absURL).promise.then(doc => {
      pdfCache.set(absURL, Promise.resolve(doc));
      return doc;
    }));

  // Préparer la sidebar pour afficher le viewer PDF
  const sidebar = document.getElementById('sidebar');
  sidebar.style.backgroundImage = '';
  sidebar.innerHTML = `
    <div class="sidebar-pdf-viewer">
      <button class="sidebar-pdf-btn prev" title="Page précédente">‹</button>
      <canvas class="sidebar-pdf-canvas"></canvas>
      <button class="sidebar-pdf-btn next" title="Page suivante">›</button>
    </div>
  `;

  const canvas  = sidebar.querySelector('.sidebar-pdf-canvas');
  const ctx     = canvas.getContext('2d');
  const prevBtn = sidebar.querySelector('.sidebar-pdf-btn.prev');
  const nextBtn = sidebar.querySelector('.sidebar-pdf-btn.next');

  // Variables d'état
  let pdfDoc    = null;
  let pageNum   = 1;
  let pageCount = 1;
  let rendering = false;

  // Fonction de rendu d'une page
  function renderPage(num) {
    rendering = true;
    pdfDoc.getPage(num).then(page => {
      // Calcul du scale pour tenir dans la sidebar
      const view = page.getViewport({ scale: 1 });
      const maxW = sidebar.clientWidth  * 0.95;
      const maxH = sidebar.clientHeight * 0.95;
      const scale = Math.min(maxW / view.width, maxH / view.height);

      const vp = page.getViewport({ scale });
      canvas.width = vp.width;
      canvas.height = vp.height;

      return page.render({ canvasContext: ctx, viewport: vp }).promise;
    })
    .then(() => {
      rendering = false;
      prevBtn.disabled = (pageNum === 1);
      nextBtn.disabled = (pageNum === pageCount);
    })
    .catch(console.error);
  }

  function queueRender(num) {
    if (rendering) {
      setTimeout(() => queueRender(num), 100);
    } else {
      pageNum = num;
      renderPage(pageNum);
    }
  }

  // Boutons de navigation du PDF
  prevBtn.addEventListener('click', () => {
    if (pageNum > 1) queueRender(pageNum - 1);
  });
  nextBtn.addEventListener('click', () => {
    if (pageNum < pageCount) queueRender(pageNum + 1);
  });

  // Recalibrer l'affichage lors d'un redimensionnement
  const resizeHandler = () => queueRender(pageNum);
  window.addEventListener('resize', resizeHandler);

  // Chargement du document PDF
  pdfProm.then(doc => {
    pdfDoc = doc;
    pageCount = doc.numPages;

    // Gestion éventuelle de paramètres de page dans l'URL
    const u = new URL(url, location.href);
    const pQuery = parseInt(u.searchParams.get('page')) || null;
    const pHash = parseInt((u.hash.match(/page=(\d+)/i) || [])[1]) || null;
    pageNum = Math.min(Math.max(pQuery || pHash || 1, 1), pageCount);

    renderPage(pageNum);
  })
  .catch(err => {
    console.error(err);
    sidebar.innerHTML = '<p style="padding:20px;color:#A64B3C">Impossible de charger le PDF.</p>';
    window.removeEventListener('resize', resizeHandler);
  });
}