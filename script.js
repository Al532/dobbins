// Charger le texte HTML dynamiquement
fetch("texte.html")
  .then(response => response.text())
  .then(data => {
    // Insère le texte APRÈS la TOC
    document.getElementById("toc").insertAdjacentHTML('afterend', data);
    initTOC();
    initInteractions();
  })
  .catch(err => console.error("Erreur chargement texte:", err));

function initTOC() {
  const toc = document.getElementById("toc");
  toc.innerHTML = "<h2>Sommaire</h2><ul></ul>";
  const list = toc.querySelector("ul");

  // Indexe uniquement les h2 (et pas le h2 "Sommaire" de la TOC)
  document.querySelectorAll("#content h2").forEach((heading, i) => {
    // Ignore le h2 "Sommaire" de la TOC lui-même
    if (heading.closest('#toc')) return;
    const id = heading.id || "section-" + i;
    heading.id = id;

    const li = document.createElement("li");
    li.innerHTML = `<a href="#${id}">${heading.textContent}</a>`;
    list.appendChild(li);
  });

  // Défilement instantané
  toc.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute("href"));
      if (target) {
        target.scrollIntoView({ behavior: "auto", block: "start" });
      }
    });
  });
}function initInteractions() {
  const sidebar = document.getElementById('sidebar');
  sidebar.style.backgroundImage = 'url(1.jpg)';

  // 1. Audio MP3 : remplacer chaque lien mp3 inline par un lecteur personnalisé
  document.querySelectorAll('.content a[href$=".mp3"], .content a[href*=".mp3?"]').forEach(link => {
    const label = link.textContent;
    const mp3Url = link.getAttribute('href');
    // Support des liens type "2co.mp3?start=4.8"
    const urlObj = new URL(mp3Url, window.location.href);
    const start = parseFloat(urlObj.searchParams.get("start")) || 0;

    // Construction du mini player custom inline
    const playerEl = document.createElement('span');
    playerEl.className = "audio-player";
    // Si le lien a la classe "reset", on la recopie sur le lecteur
    if (link.classList.contains('reset')) {
      playerEl.classList.add('reset');
    }
    playerEl.dataset.start = start;

    playerEl.innerHTML = `
      <button class="play-btn" title="Écouter">&#9654;</button>
      <span class="audio-label">${label}</span>
      <span class="audio-controls">
        <span class="progress"><span class="progress-filled"></span></span>
      </span>
      <audio src="${urlObj.pathname + urlObj.search}"></audio>
    `;

    link.parentNode.replaceChild(playerEl, link);
  });

  // 2. Délégation d'événement pour les liens image dans la sidebar
  document.querySelector('.content').addEventListener('click', function(e) {
    const link = e.target.closest('a');
    if (link) {
      const href = link.getAttribute('href');
      if (href && href.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i)) {
        e.preventDefault();
        sidebar.style.backgroundImage = `url(${href})`;
        return false;
      }
    }
  });

  // 3. Gestion des lecteurs audios personnalisés
  document.querySelectorAll('.audio-player').forEach(player => {
    const audio = player.querySelector('audio');
    const playBtn = player.querySelector('.play-btn');
    const progressFilled = player.querySelector('.progress-filled');
    const progressBar = player.querySelector('.progress');
    const startTime = parseFloat(player.dataset.start) || 0;

    // Positionner le temps de départ au moment où les métadonnées sont chargées
    audio.addEventListener('loadedmetadata', () => {
      if (startTime && Math.abs(audio.currentTime - startTime) > 0.5) {
        audio.currentTime = startTime;
      }
    });

    // Play/pause (pause tous les autres, reset seulement ceux avec .reset)
	playBtn.addEventListener('click', () => {
	  if (audio.paused) {
		// Pause tous les autres, reset seulement ceux avec .reset
		document.querySelectorAll('.audio-player').forEach(other => {
		  const otherAudio = other.querySelector('audio');
		  if (otherAudio !== audio) {
			otherAudio.pause();
			if (other.classList.contains('reset')) {
			  otherAudio.currentTime = parseFloat(other.dataset.start) || 0;
			  const otherProgress = other.querySelector('.progress-filled');
			  if (otherProgress) otherProgress.style.width = '0%';
			}
			const otherBtn = other.querySelector('.play-btn');
			if (otherBtn) otherBtn.textContent = '►';
		  }
		});
		audio.play();
		playBtn.textContent = '❚❚';
	  } else {
		audio.pause();
		if (player.classList.contains('reset')) {
		  audio.currentTime = startTime;
		  progressFilled.style.width = '0%';
		}
		playBtn.textContent = '►';
	  }
	});

    // Barre de progression dynamique
    audio.addEventListener('timeupdate', () => {
      if (audio.duration) {
        let percent = ((audio.currentTime - startTime) / (audio.duration - startTime)) * 100;
        percent = Math.max(0, Math.min(100, percent));
        progressFilled.style.width = percent + '%';
      }
    });

    // Clic sur la barre de progression pour avancer/reculer
    progressBar.addEventListener('click', e => {
      const rect = progressBar.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / progressBar.offsetWidth;
      audio.currentTime = startTime + ratio * (audio.duration - startTime);
    });

    // Quand terminé, reset bouton et barre
    audio.addEventListener('ended', () => {
      playBtn.textContent = '►';
      progressFilled.style.width = '0%';
    });
  });
}