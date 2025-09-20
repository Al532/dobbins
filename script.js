// Charger le texte HTML
fetch("texte.html")
  .then(response => response.text())
  .then(data => {
    document.getElementById("content").innerHTML = data;
    initTOC();
    initInteractions();
  })
  .catch(err => console.error("Erreur chargement texte:", err));

function initTOC() {
  const toc = document.getElementById("toc");
  toc.innerHTML = "<h2>Sommaire</h2><ul></ul>";
  const list = toc.querySelector("ul");

  // Cibler les titres dans le texte
  document.querySelectorAll("#content h1, #content h2, #content h3").forEach((heading, i) => {
    const id = heading.id || "section-" + i;
    heading.id = id;

    const li = document.createElement("li");
    li.innerHTML = `<a href="#${id}">${heading.textContent}</a>`;
    list.appendChild(li);
  });

  // Défilement fluide
  toc.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const target = document.querySelector(link.getAttribute("href"));
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function initInteractions() {
  const sidebar = document.getElementById('sidebar');
  sidebar.style.backgroundImage = 'url(1.jpg)';

  // Images dans la sidebar
  document.querySelectorAll('.content a[data-image]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      sidebar.style.backgroundImage = `url(${link.dataset.image})`;
    });
  });

  // Lecteurs audio
  document.querySelectorAll('.audio-player').forEach(player => {
    const audio = player.querySelector('audio');
    const playBtn = player.querySelector('.play-btn');
    const progressFilled = player.querySelector('.progress-filled');
    const startTime = parseFloat(player.dataset.start) || 0;

    audio.addEventListener('loadedmetadata', () => audio.currentTime = startTime);

    playBtn.addEventListener('click', () => {
      if (audio.paused) {
        // stop tous les autres lecteurs
        document.querySelectorAll('.audio-player').forEach(other => {
          const otherAudio = other.querySelector('audio');
          if (otherAudio !== audio) {
            otherAudio.pause();
            otherAudio.currentTime = parseFloat(other.dataset.start) || 0;
            const otherBtn = other.querySelector('.play-btn');
            if (otherBtn) otherBtn.textContent = '►';
            const otherProgress = other.querySelector('.progress-filled');
            if (otherProgress) otherProgress.style.width = '0%';
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
