import {t, localizeMarkup as h} from './i18n.mjs';
// The same controls are placed in a dialog on phones and back in the page on desktop.
// Moving them only when the layout changes keeps opening the dialog from resizing the score.
export class MobileControls {
  constructor(header, viewer, audio) {
    this.header = header;this.viewer = viewer;this.audio = audio;
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'mobile-controls';this.dialog.className = 'reader-dialog mobile-controls';
    this.dialog.setAttribute('aria-label',t('Commandes de lecture'));
    this.dialog.innerHTML = h('<div class="dialog-top"><strong>Commandes</strong><button type="button" class="close-controls">Reprendre la lecture</button></div><div class="mobile-navigation"></div><section class="mobile-score-controls" aria-label="Partition"></section><div class="mobile-audio-controls"></div>');
    this.launcher = document.createElement('div');this.launcher.className = 'mobile-launcher';
    this.launcher.innerHTML = h('<button type="button" class="mobile-pause" hidden>Pause</button><button type="button" class="mobile-menu" aria-label="Afficher les commandes" title="Afficher les commandes" aria-haspopup="dialog" aria-controls="mobile-controls" aria-expanded="false">•••</button>');
    this.toggle = this.launcher.querySelector('.mobile-menu');this.pause = this.launcher.querySelector('.mobile-pause');
    document.body.append(this.dialog,this.launcher);
    const slots = [this.dialog.querySelector('.mobile-navigation'),this.dialog.querySelector('.mobile-score-controls'),this.dialog.querySelector('.mobile-audio-controls')];
    this.portals = [header,viewer.heading,viewer.tools,viewer.footer,audio.panel].map((node,index) => {
      const anchor = document.createComment('desktop controls');node.before(anchor);
      return {node,anchor,slot:slots[index === 0 ? 0 : index === 4 ? 2 : 1]};
    });
    this.toggle.addEventListener('click', () => this.open());
    this.dialog.querySelector('.close-controls').addEventListener('click', () => this.close());
    this.dialog.addEventListener('close', () => {this.toggle.setAttribute('aria-expanded','false');});
    this.dialog.addEventListener('click', event => {
      if (event.target !== this.dialog) return;
      const r = this.dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) this.close();
    });
    header.addEventListener('click', event => {
      if (event.target.closest('#open-toc,#open-search,.skip-link')) this.close(false);
    },true);
    viewer.tools.addEventListener('click', event => {
      if (event.target.closest('[data-action="fullscreen"]')) this.close(false);
    },true);
    audio.panel.querySelector('#audio-locate').addEventListener('click', () => this.close(false),true);
    this.pause.addEventListener('click', () => {++audio.request;audio.audio.pause();this.toggle.focus({preventScroll:true});});
    for (const event of ['play','pause','ended','emptied']) audio.audio.addEventListener(event, () => this.syncAudio());
    document.addEventListener('reader-audio-controls', () => this.open());
    document.addEventListener('reader-audio-error', () => {if (this.mobile) this.open();});
  }
  sync(mobile) {
    this.mobile = mobile;
    document.body.classList.toggle('mobile-reading',mobile);
    if (!mobile) this.close(false);
    for (const {node,anchor,slot} of this.portals) {
      if (mobile) {if (node.parentElement !== slot) slot.append(node);}
      else if (node.previousSibling !== anchor) anchor.after(node);
    }
    this.syncFullscreen();this.syncAudio();
  }
  open() {
    if (!this.mobile || this.dialog.open) return;
    this.dialog.showModal();this.toggle.setAttribute('aria-expanded','true');
    this.dialog.querySelector('.close-controls').focus({preventScroll:true});
  }
  close(focus = true) {
    if (!this.dialog.open) return;
    this.dialog.close();
    if (focus && this.mobile) this.toggle.focus({preventScroll:true});
  }
  syncAudio() {
    this.pause.hidden = this.audio.audio.paused || this.audio.audio.ended;
    this.pause.setAttribute('aria-label',t('{action} — {title}',{action:t('Mettre en pause'),title:this.audio.current?.name || t('extrait audio')}));
  }
  syncFullscreen() {
    const expanded = this.viewer.sidebar.classList.contains('score-expanded');
    const parent = expanded ? this.viewer.sidebar : document.body;
    if (this.mobile) {
      if (this.dialog.parentElement !== parent) {this.close(false);parent.append(this.dialog);}
      if (this.launcher.parentElement !== parent) parent.append(this.launcher);
    } else {
      document.body.append(this.dialog,this.launcher);
      (expanded ? this.viewer.sidebar : this.portals[4].anchor.parentNode).append(this.audio.panel);
    }
    this.dialog.classList.toggle('controls-fullscreen',expanded);
  }
}
