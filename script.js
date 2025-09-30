// Import de la librairie PDF.js (display layer) depuis la racine
import * as pdfjsLib from './pdf.mjs';

// Configure le chemin du worker (core layer) dans la racine aussi
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';

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
    if (h.closest('#toc')) return; // évite d'inclure le titre du TOC
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

  // 4-3. Gestion des clics sur les liens (images / PDF)
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
   5. Lecteur audio personnalisé (lazy load)
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
    <audio preload="none"></audio>
  `;

  link.replaceWith(wrapper);

  const audio = wrapper.querySelector('audio');
  const playBtn = wrapper.querySelector('.play-btn');
  const progressBar = wrapper.querySelector('.progress');
  const progressFilled = wrapper.querySelector('.progress-filled');

  playBtn.addEventListener('click', () => {
    if (!audio.src) { // Lazy load du flux
      audio.src = urlObj.pathname + urlObj.search;
      audio.load();
    }

    if (audio.paused) {
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

  audio.addEventListener('loadedmetadata', () => {
    if (start) audio.currentTime = start;
  });

audio.addEventListener('timeupdate', () => {
  console.log('timeupdate fired',
              'currentTime=', audio.currentTime,
              'duration=', audio.duration);

  if (!audio.duration || !isFinite(audio.duration)) return;

  const pct = ((audio.currentTime - start) /
              (audio.duration   - start)) * 100;

  progressFilled.style.width =
    Math.max(0, Math.min(100, pct)) + '%';
});


  progressBar.addEventListener('click', e => {
    if (!audio.duration) return;
    const r = progressBar.getBoundingClientRect();
    const ratio = (e.clientX - r.left) / r.width;
    audio.currentTime = start + ratio * (audio.duration - start);
  });

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
   7. Lecteur PDF avec streaming + couverture
   ========================================================= */
function showPdfInSidebar(url) {
  const absURL = new URL(url, location.href).href;
  const pdfProm = pdfCache.get(absURL) ||
    (pdfjsLib.getDocument({
      url: absURL,
      rangeChunkSize: 65536 // téléchargement par blocs
    }).promise.then(doc => {
      pdfCache.set(absURL, Promise.resolve(doc));
      return doc;
    }));

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

  let pdfDoc    = null;
  let pageNum   = 1;
  let pageCount = 1;
  let rendering = false;

  function renderPage(num) {
    rendering = true;
    pdfDoc.getPage(num).then(page => {
      const view = page.getViewport({ scale: 1 });
      const maxW = sidebar.clientWidth * 0.95;
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
      prevBtn.style.opacity = prevBtn.disabled ? 0 : 1;
      nextBtn.style.opacity = nextBtn.disabled ? 0 : 1;
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

  prevBtn.addEventListener('click', () => {
    if (pageNum > 1) queueRender(pageNum - 1);
  });
  nextBtn.addEventListener('click', () => {
    if (pageNum < pageCount) queueRender(pageNum + 1);
  });

  const resizeHandler = () => queueRender(pageNum);
  window.addEventListener('resize', resizeHandler);

  // Afficher un placeholder dès le départ
  canvas.width = 200;
  canvas.height = 260;
  ctx.fillStyle = "#f3e9e3";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#A64B3C";
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Chargement du PDF…", canvas.width / 2, canvas.height / 2);

  pdfProm.then(doc => {
    pdfDoc = doc;
    pageCount = doc.numPages;

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
