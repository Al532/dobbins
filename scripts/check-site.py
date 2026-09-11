"""Check local HTML file references; fragments and external URLs are not fetched."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []
checked = 0


def check_reference(source, value):
    global checked
    url = urlsplit(value)
    if url.scheme or url.netloc or not url.path:
        return
    path = unquote(url.path)
    if path.startswith('/dobbins/'):
        target = ROOT / path.removeprefix('/dobbins/')
    elif path.startswith('/'):
        target = ROOT / path.lstrip('/')
    else:
        target = source.parent / path
    target = target.resolve()
    checked += 1
    if not target.is_relative_to(ROOT) or not target.is_file():
        errors.append(f'{source.relative_to(ROOT)}: missing local file {value!r}')


class Links(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.source = source

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ('href', 'src', 'poster') and value:
                check_reference(self.source, value)

    handle_startendtag = handle_starttag


for name in ('index.html', 'texte.html', 'texte-en.html', 'script.js',
             'reader.js', 'style.css', 'reader.css', 'i18n.mjs',
             'locales/en.mjs', 'pdf.mjs', 'pdf.worker.mjs'):
    if not (ROOT / name).is_file():
        errors.append(f'Missing required reader file: {name}')

for source in sorted(ROOT.glob('*.html')):
    parser = Links(source)
    parser.feed(source.read_text(encoding='utf-8'))
    parser.close()

if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'OK: {checked} local HTML references and required reader files.')
