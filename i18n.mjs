import english from './locales/en.mjs';

export const languages = Object.freeze({fr: 'Français', en: 'English'});
export const languageKey = 'dobbins:language:v1';
export function resolveLanguage(urlLanguage, storedLanguage) {
  return Object.hasOwn(languages, urlLanguage) ? urlLanguage
    : Object.hasOwn(languages, storedLanguage) ? storedLanguage : 'fr';
}
let stored;
try { stored = globalThis.localStorage?.getItem(languageKey); } catch { /* Optional storage. */ }
export const language = resolveLanguage(
  globalThis.location ? new URL(globalThis.location.href).searchParams.get('lang') : null, stored
);
export function translate(key, values = {}, locale = language) {
  const message = locale === 'en' ? (english[key] ?? key) : key;
  return message.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export const t = translate;

// Only call this on interface templates, never on the book or arbitrary page content.
// Text nodes and accessible labels are translated without changing DOM structure.
export function localizeMarkup(markup) {
  if (language === 'fr') return markup;
  const template = document.createElement('template');template.innerHTML = markup;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, value = node.textContent.trim();
    if (Object.hasOwn(english, value)) node.textContent = node.textContent.replace(value, t(value));
  }
  for (const element of template.content.querySelectorAll('*')) {
    for (const attribute of ['aria-label', 'title', 'placeholder', 'alt']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, t(element.getAttribute(attribute)));
    }
  }
  return template.innerHTML;
}

export function languageUrl(locale, href = location.href) {
  const url = new URL(href);
  url.searchParams.set('lang', resolveLanguage(locale));
  return url;
}
export function mountLanguageSelector(parent, beforeChange = () => {}) {
  const label = document.createElement('label');label.className = 'language-selector';
  const text = document.createElement('span');text.className = 'sr-only';text.textContent = t('Langue');
  const select = document.createElement('select');select.id = 'reader-language';
  for (const [value, name] of Object.entries(languages)) {
    const option = document.createElement('option');option.value = value;option.textContent = name;option.lang = value;select.append(option);
  }
  select.value = language;label.append(text, select);parent.append(label);
  select.addEventListener('change', () => {
    const destination = beforeChange(select.value);
    try {localStorage.setItem(languageKey, select.value);} catch { /* Optional storage. */ }
    location.assign(destination?.href || languageUrl(select.value).href);
  });
  return select;
}
