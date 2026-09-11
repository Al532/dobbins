import {t, localizeMarkup as h} from './i18n.mjs';
import {clamp, compact, timeLabel} from './reader-utils.mjs';

export class StudyAudio {
  constructor(onScore, onLocate) {
    this.onScore = onScore; this.onLocate = onLocate;
    this.records = []; this.positions = new Map(); this.request = 0;
    this.panel = document.createElement('section');this.panel.className = 'study-audio';this.panel.hidden = true;
    this.panel.setAttribute('aria-label',t('Lecteur audio'));
    this.panel.innerHTML = h(`
      <div class="now-playing"><button type="button" id="audio-locate" title="Revenir à cet extrait dans le cours"></button><span id="audio-state" role="status"></span></div>
      <div class="transport"><button type="button" id="audio-play">Écouter</button><button type="button" id="audio-replay">Rejouer</button><label for="audio-seek" class="sr-only">Position dans l’extrait</label><input id="audio-seek" type="range" min="0" max="1" step="0.1" value="0" disabled><output id="audio-time">0:00 / —:—</output></div>
      <div class="audio-error" role="alert" hidden><span>Lecture impossible.</span><button type="button" id="audio-retry">Réessayer</button></div><audio preload="none"></audio>`);
    document.body.append(this.panel);
    this.audio = this.panel.querySelector('audio');this.seek = this.panel.querySelector('#audio-seek');
    this.state = this.panel.querySelector('#audio-state');this.playButton = this.panel.querySelector('#audio-play');
    this.panel.querySelector('#audio-play').addEventListener('click', () => this.toggle(this.current));
    this.panel.querySelector('#audio-replay').addEventListener('click', () => this.replay(this.current));
    this.panel.querySelector('#audio-locate').addEventListener('click', () => this.onLocate(this.current));
    this.seek.addEventListener('input', () => {
      const position = this.current.start + Number(this.seek.value);
      this.audio.currentTime = position;this.update();
    });
    this.panel.querySelector('#audio-retry').addEventListener('click', () => {this.audio.load();this.pendingPosition = this.positions.get(this.current.id) ?? this.current.start;this.play();});
    this.audio.addEventListener('loadedmetadata', () => {
      if (!this.current) return;
      this.audio.currentTime = clamp(this.pendingPosition ?? this.current.start,this.current.start,this.audio.duration);
      this.pendingPosition = null;this.update();
    });
    this.audio.addEventListener('timeupdate', () => {
      this.update();
    });
    this.audio.addEventListener('play', () => this.update());
    this.audio.addEventListener('playing', () => {this.state.textContent = t('En écoute');this.update();});
    this.audio.addEventListener('pause', () => {this.state.textContent = t('En pause');this.update();});
    this.audio.addEventListener('waiting', () => {this.state.textContent = t('Chargement audio…');});
    this.audio.addEventListener('ended', () => {
      this.state.textContent = t('Extrait terminé');this.update();
    });
    this.audio.addEventListener('error', () => this.error());
  }
  add(link, score, context) {
    const url = new URL(link.href);
    const record = {id:link.dataset.audioId || `audio-${this.records.length + 1}`,label:compact(link.textContent),start:Number(url.searchParams.get('start')) || 0,score,context};
    url.searchParams.delete('start');record.url = url.href;
    record.name = [...new Set([score?.title,context,record.label].filter(Boolean))].filter((part,i,parts) => !parts.some((other,j) => j < i && other.toLowerCase().includes(part.toLowerCase()))).join(' · ');
    const wrapper = document.createElement('span');wrapper.className = 'audio-player';wrapper.id = record.id;wrapper.dataset.start = record.start;
    wrapper.innerHTML = h('<button type="button" class="play-btn">Écouter</button><span class="audio-label"></span><button type="button" class="mobile-excerpt" aria-haspopup="dialog" aria-controls="mobile-controls"></button><button type="button" class="replay-btn" title="Rejouer cet extrait">↺</button>');
    wrapper.querySelector('.audio-label').textContent = record.label;
    const mobileExcerpt = wrapper.querySelector('.mobile-excerpt');
    mobileExcerpt.textContent = t('{action} — {title}',{action:t('Écouter'),title:record.label});
    mobileExcerpt.setAttribute('aria-label',t('{action} — {title}',{action:t('Commandes audio'),title:record.name}));
    mobileExcerpt.addEventListener('click', () => {this.select(record);document.dispatchEvent(new Event('reader-audio-controls'));});
    wrapper.querySelector('.play-btn').setAttribute('aria-label',t('{action} — {title}',{action:t('Écouter'),title:record.name}));
    wrapper.querySelector('.replay-btn').setAttribute('aria-label',t('{action} — {title}',{action:t('Rejouer'),title:record.name}));
    wrapper.querySelector('.play-btn').addEventListener('click', () => this.toggle(record));
    wrapper.querySelector('.replay-btn').addEventListener('click', () => this.replay(record));
    link.replaceWith(wrapper);record.element = wrapper;this.records.push(record);
    return record;
  }
  select(record) {
    if (!record || this.current === record) return;
    ++this.request;
    if (this.current) {
      this.positions.set(this.current.id,this.audio.currentTime);
      this.audio.pause();this.current.element.classList.remove('is-active');
      const previous = this.current.element.querySelector('.play-btn');previous.textContent = t('Écouter');previous.setAttribute('aria-label',t('{action} — {title}',{action:t('Écouter'),title:this.current.name}));
    }
    this.current = record;this.panel.hidden = false;record.element.classList.add('is-active');
    this.panel.querySelector('#audio-locate').textContent = record.name;
    this.panel.querySelector('.audio-error').hidden = true;
    this.state.textContent = t('Prêt à écouter');
    this.pendingPosition = this.positions.get(record.id) ?? record.start;
    if (this.audio.src !== record.url || this.audio.error) {this.audio.src = record.url;this.audio.load();}
    else if (this.audio.readyState >= 1) {this.audio.currentTime = this.pendingPosition;this.pendingPosition = null;}
    this.onScore(record);this.update();
  }
  toggle(record) {
    if (!record) return;
    if (this.current === record && !this.audio.paused) {++this.request;this.audio.pause();return;}
    if (this.current === record) this.onScore(record);
    this.select(record);
    if (this.audio.ended || this.audio.currentTime >= this.audio.duration - .05) this.audio.currentTime = record.start;
    this.play();
  }
  replay(record) {
    if (!record) return;
    if (this.current === record) this.onScore(record);
    this.select(record);
    const start = record.start;
    if (this.audio.readyState >= 1) this.audio.currentTime = start;
    else this.pendingPosition = start;
    this.play();
  }
  async play() {
    const request = ++this.request;
    this.panel.querySelector('.audio-error').hidden = true;this.state.textContent = t('Chargement audio…');
    try {await this.audio.play();} catch (error) {if (request === this.request && error.name !== 'AbortError') this.error();}
  }
  error() {
    this.panel.querySelector('.audio-error').hidden = false;this.state.textContent = t('Lecture impossible');this.update();
    document.dispatchEvent(new Event('reader-audio-error'));
  }
  update() {
    if (!this.current) return;
    const ready = Number.isFinite(this.audio.duration) && this.audio.readyState >= 1;
    const elapsed = Math.max(0,this.audio.currentTime - this.current.start);
    const duration = ready ? Math.max(0,this.audio.duration - this.current.start) : NaN;
    const playing = !this.audio.paused && !this.audio.ended;
    for (const button of [this.playButton,this.current.element.querySelector('.play-btn')]) {
      button.textContent = playing ? t('Pause') : t('Écouter');button.setAttribute('aria-label',t('{action} — {title}',{action:playing ? t('Mettre en pause') : t('Écouter'),title:this.current.name}));
    }
    this.seek.disabled = !ready;this.seek.max = ready ? duration : 1;this.seek.value = Math.min(elapsed,duration || 0);
    this.seek.setAttribute('aria-valuetext',t('{elapsed} sur {duration}',{elapsed:timeLabel(elapsed),duration:timeLabel(duration)}));
    this.panel.querySelector('#audio-time').textContent = `${timeLabel(elapsed)} / ${timeLabel(duration)}`;
    if (ready) this.positions.set(this.current.id,this.audio.currentTime);
  }
}
