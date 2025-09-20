// Charger le contenu de texte.html dans la zone "content"
fetch("texte.html")
  .then(response => response.text())
  .then(html => {
    document.getElementById("content").innerHTML = html;
    initInteractions();
  });

function initInteractions() {
  const sidebar = document.getElementById('sidebar');
  sidebar.style.backgroundImage = 'url(1.jpg)'; // image par défaut

  // --- Liens d’ancrage internes ---
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', e => {
      e.preventDefault();
      const target = document.getElementById(anchor.getAttribute('href').substring(1));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // --- Liens images → affichage dans sidebar ---
  document.querySelectorAll('.content a[href$=".jpg"], .content a[href$=".png"], .content a[href$=".gif"]')
    .forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        sidebar.style.backgroundImage = `url(${link.getAttribute("href")})`;
      });
    });

  // --- Liens audio → remplacer par lecteur custom ---
  document.querySelectorAll('.content a[href$=".mp3"]').forEach(link => {
    const url = new URL(link.getAttribute("href"), window.location.href);
    const src = url.pathname;
    const start = parseFloat(url.searchParams.get("start")) || 0;
    const label = link.textContent.trim() || "Audio";

    const playerHTML = `
      <div class="audio-player" data-start="${start}">
        <div class="audio-label">${label}</div>
        <div class="audio-controls">
          <button class="play-btn">►</button>
          <div class="progress"><div class="progress-filled"></div></div>
          <audio src="${src}"></audio>
        </div>
      </div>
    `;

    link.outerHTML = playerHTML;
  });

  // --- Activer les lecteurs audio ---
  initAudioPlayers();
}

function initAudioPlayers() {
  document.querySelectorAll('.audio-player').forEach(player => {
    const audio = player.querySelector('audio');
    const playBtn = player.querySelector('.play-btn');
    const progressFilled = player.querySelector('.progress-filled');
    const startTime = parseFloat(player.dataset.start) || 0;

    audio.addEventListener('loadedmetadata', () => audio.currentTime = startTime);

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        // stop tous les autres
        document.querySelectorAll('.audio-player').forEach(other => {
          const otherAudio = other.querySelector('audio');
          if (otherAudio !== audio) {
            otherAudio.pause();
            otherAudio.currentTime = parseFloat(other.dataset.start) || 0;
            other.querySelector('.play-btn').textContent = '►';
            other.querySelector('.progress-filled').style.width = '0%';
          }
        });
        audio.play();
        playBtn.textContent = '❚❚';
      } else {
        audio.pause();
        audio.currentTime = startTime;
        playBtn.textContent = '►';
        progressFilled.style.width = '0%';
      }
    });

    audio.addEventListener('timeupdate', () => {
      progressFilled.style.width = (audio.currentTime / audio.duration) * 100 + '%';
    });

    player.querySelector('.progress').addEventListener('click', e => {
      const ratio = (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.offsetWidth;
      audio.currentTime = ratio * audio.duration;
    });

    audio.addEventListener('ended', () => {
      playBtn.textContent = '►';
      progressFilled.style.width = '0%';
    });
  });
}
