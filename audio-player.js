import {clamp, compact, timeLabel, validLoop} from './reader-utils.mjs';

export class StudyAudio {
  constructor(onScore, onLocate) {
    this.onScore = onScore; this.onLocate = onLocate;
    this.records = []; this.positions = new Map(); this.request = 0;
    this.panel = document.createElement('section');this.panel.className = 'study-audio';this.panel.hidden = true;
    this.panel.setAttribute('aria-label','Lecteur audio et outils d’étude');
    this.panel.innerHTML = `
      <div class="now-playing"><button type="button" id="audio-locate" title="Revenir à cet extrait dans le cours"></button><span id="audio-state" role="status"></span></div>
      <div class="transport"><button type="button" id="audio-play">Écouter</button><button type="button" id="audio-replay">Rejouer</button><label for="audio-seek" class="sr-only">Position dans l’extrait</label><input id="audio-seek" type="range" min="0" max="1" step="0.1" value="0" disabled><output id="audio-time">0:00 / —:—</output><button type="button" id="audio-score">Partition</button><details id="study-tools"><summary>Outils d’étude</summary><div class="study-options"><label for="audio-speed">Vitesse</label><select id="audio-speed"><option value="0.5">0,5×</option><option value="0.75">0,75×</option><option value="1" selected>1×</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option></select><button type="button" id="loop-a" disabled>Début A</button><button type="button" id="loop-b" disabled>Fin B</button><label class="loop-toggle"><input id="audio-loop" type="checkbox" disabled> Boucle A–B</label><output id="loop-range">Choisissez le début puis la fin.</output><button type="button" id="loop-clear">Effacer</button></div></details></div>
      <div class="audio-error" role="alert" hidden><span>Lecture impossible.</span><button type="button" id="audio-retry">Réessayer</button><a id="audio-original" target="_blank" rel="noopener">Ouvrir l’audio séparément ↗</a></div><audio preload="none"></audio>`;
    document.body.append(this.panel);
    this.audio = this.panel.querySelector('audio');this.seek = this.panel.querySelector('#audio-seek');
    this.state = this.panel.querySelector('#audio-state');this.playButton = this.panel.querySelector('#audio-play');
    this.loop = this.panel.querySelector('#audio-loop');
    this.panel.querySelector('#audio-play').addEventListener('click', () => this.toggle(this.current));
    this.panel.querySelector('#audio-replay').addEventListener('click', () => this.replay(this.current));
    this.panel.querySelector('#audio-score').addEventListener('click', () => this.onScore(this.current,true));
    this.panel.querySelector('#audio-locate').addEventListener('click', () => this.onLocate(this.current));
    this.panel.querySelector('#audio-speed').addEventListener('change', event => {this.audio.playbackRate = Number(event.target.value);});
    this.seek.addEventListener('input', () => {
      const position = this.current.start + Number(this.seek.value);
      if (this.loop.checked && (position < this.a || position > this.b)) this.loop.checked = false;
      this.audio.currentTime = position;this.update();
    });
    this.panel.querySelector('#loop-a').addEventListener('click', () => {this.a = this.audio.currentTime;this.b = null;this.loop.checked = false;this.updateLoop();});
    this.panel.querySelector('#loop-b').addEventListener('click', () => {
      const b = this.audio.currentTime;
      if (!validLoop(this.a,b,this.current.start,this.audio.duration)) {this.state.textContent = 'Placez B après A pour définir une boucle.';return;}
      this.b = b;this.updateLoop();this.loop.checked = true;
      if (this.audio.currentTime >= this.b) this.audio.currentTime = this.a;
    });
    this.panel.querySelector('#loop-clear').addEventListener('click', () => this.clearLoop());
    this.loop.addEventListener('change', () => {if (this.loop.checked && (this.audio.currentTime < this.a || this.audio.currentTime >= this.b)) this.audio.currentTime = this.a;});
    this.panel.querySelector('#audio-retry').addEventListener('click', () => {this.audio.load();this.pendingPosition = this.positions.get(this.current.id) ?? this.current.start;this.play();});
    this.audio.addEventListener('loadedmetadata', () => {
      if (!this.current) return;
      this.audio.currentTime = clamp(this.pendingPosition ?? this.current.start,this.current.start,this.audio.duration);
      this.pendingPosition = null;this.update();this.updateLoop();
    });
    this.audio.addEventListener('timeupdate', () => {
      if (this.loop.checked && this.b != null && (this.audio.currentTime >= this.b || this.audio.currentTime < this.a)) this.audio.currentTime = this.a;
      this.update();
    });
    this.audio.addEventListener('play', () => this.update());
    this.audio.addEventListener('playing', () => {this.state.textContent = 'En écoute';this.update();});
    this.audio.addEventListener('pause', () => {this.state.textContent = 'En pause';this.update();});
    this.audio.addEventListener('waiting', () => {this.state.textContent = 'Chargement audio…';});
    this.audio.addEventListener('ended', () => {
      if (this.loop.checked && this.b != null) {this.audio.currentTime = this.a;this.play();}
      else {this.state.textContent = 'Extrait terminé';this.update();}
    });
    this.audio.addEventListener('error', () => this.error());
  }
  add(link, score, context) {
    const url = new URL(link.href);
    const record = {id:`audio-${this.records.length + 1}`,label:compact(link.textContent),start:Number(url.searchParams.get('start')) || 0,score,context};
    url.searchParams.delete('start');record.url = url.href;
    record.name = [...new Set([score?.title,context,record.label].filter(Boolean))].filter((part,i,parts) => !parts.some((other,j) => j < i && other.toLowerCase().includes(part.toLowerCase()))).join(' · ');
    const wrapper = document.createElement('span');wrapper.className = 'audio-player';wrapper.id = record.id;wrapper.dataset.start = record.start;
    wrapper.innerHTML = '<button type="button" class="play-btn">Écouter</button><span class="audio-label"></span><button type="button" class="replay-btn" title="Rejouer cet extrait">↺</button><button type="button" class="study-btn">Étudier cet exemple</button>';
    wrapper.querySelector('.audio-label').textContent = record.label;
    wrapper.querySelector('.play-btn').setAttribute('aria-label',`Écouter — ${record.name}`);
    wrapper.querySelector('.replay-btn').setAttribute('aria-label',`Rejouer — ${record.name}`);
    wrapper.querySelector('.study-btn').setAttribute('aria-label',`Étudier cet exemple — ${record.name}`);
    wrapper.querySelector('.study-btn').disabled = !score;
    wrapper.querySelector('.play-btn').addEventListener('click', () => this.toggle(record));
    wrapper.querySelector('.replay-btn').addEventListener('click', () => this.replay(record));
    wrapper.querySelector('.study-btn').addEventListener('click', () => {this.select(record);this.onScore(record,true);});
    link.replaceWith(wrapper);record.element = wrapper;this.records.push(record);
    return record;
  }
  select(record) {
    if (!record || this.current === record) return;
    ++this.request;
    if (this.current) {
      this.positions.set(this.current.id,this.audio.currentTime);
      this.audio.pause();this.current.element.classList.remove('is-active');
      const previous = this.current.element.querySelector('.play-btn');previous.textContent = 'Écouter';previous.setAttribute('aria-label',`Écouter — ${this.current.name}`);
    }
    this.current = record;this.panel.hidden = false;record.element.classList.add('is-active');this.clearLoop();
    this.panel.querySelector('#audio-locate').textContent = record.name;
    this.panel.querySelector('#audio-score').disabled = !record.score;
    this.panel.querySelector('#audio-original').href = record.url + `#t=${record.start}`;
    this.panel.querySelector('.audio-error').hidden = true;
    this.state.textContent = 'Prêt à écouter';
    this.pendingPosition = this.positions.get(record.id) ?? record.start;
    if (this.audio.src !== record.url || this.audio.error) {this.audio.src = record.url;this.audio.load();}
    else if (this.audio.readyState >= 1) {this.audio.currentTime = this.pendingPosition;this.pendingPosition = null;}
    this.audio.playbackRate = Number(this.panel.querySelector('#audio-speed').value);
    this.onScore(record,false);this.update();
  }
  toggle(record) {
    if (!record) return;
    if (this.current === record && !this.audio.paused) {++this.request;this.audio.pause();return;}
    this.select(record);
    if (this.audio.ended || this.audio.currentTime >= this.audio.duration - .05) this.audio.currentTime = this.loop.checked ? this.a : record.start;
    this.play();
  }
  replay(record) {
    if (!record) return;
    this.select(record);
    const start = this.loop.checked ? this.a : record.start;
    if (this.audio.readyState >= 1) this.audio.currentTime = start;
    else this.pendingPosition = start;
    this.play();
  }
  async play() {
    const request = ++this.request;
    this.panel.querySelector('.audio-error').hidden = true;this.state.textContent = 'Chargement audio…';
    try {await this.audio.play();} catch (error) {if (request === this.request && error.name !== 'AbortError') this.error();}
  }
  error() {
    this.panel.querySelector('.audio-error').hidden = false;this.state.textContent = 'Lecture impossible';this.update();
  }
  update() {
    if (!this.current) return;
    const ready = Number.isFinite(this.audio.duration) && this.audio.readyState >= 1;
    const elapsed = Math.max(0,this.audio.currentTime - this.current.start);
    const duration = ready ? Math.max(0,this.audio.duration - this.current.start) : NaN;
    const playing = !this.audio.paused && !this.audio.ended;
    for (const button of [this.playButton,this.current.element.querySelector('.play-btn')]) {
      button.textContent = playing ? 'Pause' : 'Écouter';button.setAttribute('aria-label',`${playing ? 'Mettre en pause' : 'Écouter'} — ${this.current.name}`);
    }
    this.seek.disabled = !ready;this.seek.max = ready ? duration : 1;this.seek.value = Math.min(elapsed,duration || 0);
    this.seek.setAttribute('aria-valuetext',`${timeLabel(elapsed)} sur ${timeLabel(duration)}`);
    this.panel.querySelector('#audio-time').textContent = `${timeLabel(elapsed)} / ${timeLabel(duration)}`;
    this.panel.querySelector('#loop-a').disabled = !ready;this.panel.querySelector('#loop-b').disabled = !ready;
    if (ready) this.positions.set(this.current.id,this.audio.currentTime);
  }
  clearLoop() {this.a = this.current?.start ?? 0;this.b = null;this.loop.checked = false;this.updateLoop();}
  updateLoop() {
    this.loop.disabled = !validLoop(this.a,this.b,this.current?.start,this.audio.duration);
    this.panel.querySelector('#loop-range').textContent = this.b == null ? `A : ${timeLabel(this.a - (this.current?.start || 0))} · Placez la fin B.` : `A : ${timeLabel(this.a - this.current.start)} → B : ${timeLabel(this.b - this.current.start)}`;
  }
}
