export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const compact = value => String(value || '').replace(/\s+/g, ' ').trim();
export const normalize = value => compact(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ');
export function timeLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—:—';
  seconds = Math.max(0, Math.floor(seconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function mediaFile(href) {
  return decodeURIComponent(new URL(href, 'https://dobbins.invalid/').pathname.split('/').pop());
}
export function pdfPage(href) {
  const url = new URL(href, 'https://dobbins.invalid/');
  const value = Number(url.searchParams.get('page') || url.hash.match(/page=(\d+)/i)?.[1] || 1);
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
const pieces = {
  'minor d': 'Minor D', 'blues for barry': 'Blues for Barry',
  'beautiful dreamer': 'Beautiful Dreamer', "suite for swee' pea": 'Suite for Swee’ Pea'
};
const minorExamples = new Set([1, 2, 3, 4, 5, 10, 11, 12, 16, 17, 18, 22, 23, 27]);
export function scoreTitle(href) {
  const stem = mediaFile(href).replace(/\.[^.]+$/, '');
  if (/^\d+$/.test(stem)) {
    const n = Number(stem);
    return `Exemple ${n} · ${n === 30 ? 'Suite for Swee’ Pea' : minorExamples.has(n) ? 'Minor D' : 'Blues for Barry'}`;
  }
  return pieces[stem] || ({appendix:'Appendice', discographies:'Discographies'}[stem]) || `Illustration · ${stem}`;
}
export function scoreForAudio(href, sectionHref = '') {
  const stem = mediaFile(href).replace(/\.mp3$/i, '');
  let file;
  if (/^2[a-d]/.test(stem)) file = '2.pdf';
  else if (/^\d+$/.test(stem)) file = `${stem}.${[10, 11, 12, 14].includes(Number(stem)) ? 'pdf' : 'jpg'}`;
  else if (pieces[stem]) file = `${stem}.pdf`;
  if (!file) return null;
  const page = sectionHref && mediaFile(sectionHref) === file ? pdfPage(sectionHref) : 1;
  return {url: encodeURI(file).replace(/#/g, '%23') + (page > 1 ? `#page=${page}` : ''), title:scoreTitle(file)};
}
export function validLoop(a, b, start, end) {
  return [a, b, start, end].every(Number.isFinite) && a >= start && b > a + .1 && b <= end;
}
