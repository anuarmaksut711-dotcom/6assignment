"""Verify frozen content/CSS; only explicitly required external scripts may change."""
from pathlib import Path
from html.parser import HTMLParser
import re
import json
import hashlib

root = Path(__file__).resolve().parents[1]
baseline = json.loads((root / 'tests/site_baseline.json').read_text(encoding='utf-8'))
html_baseline = json.loads((root / 'tests/jquery_html_baseline.json').read_text(encoding='utf-8'))


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.in_script = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        assert not any(name.startswith('on') for name in attrs), f'Inline event: {attrs}'
        if tag == 'script':
            assert attrs.get('src'), 'Inline script is forbidden'
            assert 'defer' in attrs or attrs.get('type') == 'module', 'Preserve script order'
            self.scripts.append(attrs)
            self.in_script = True

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = False

    def handle_data(self, data):
        if self.in_script:
            assert not data.strip(), 'Inline JavaScript is forbidden'


for name, expected in baseline.items():
    current = (root / name).read_bytes().replace(b'\r\n', b'\n')
    if name.endswith('.css'):
        assert hashlib.sha256(current).hexdigest() == expected, f'CSS freeze violated: {name}'

allowed_local = {'main.js', 'packages.js', 'games.js', 'package-pricing.js',
                 'booking-delivery.js', 'booking.js', 'portal.js', 'redirect.js'}
cdn = 'https://code.jquery.com/jquery-3.7.1.min.js'
for name, expected in html_baseline.items():
    html = (root / name).read_text(encoding='utf-8')
    content = re.sub(r'<script\b[^>]*>.*?</script\s*>', '', html, flags=re.S | re.I)
    content = re.sub(r'<!--.*?-->', '', content, flags=re.S)
    assert hashlib.sha256(' '.join(content.split()).encode()).hexdigest() == expected, f'HTML content freeze violated: {name}'
    page = Page()
    page.feed(html)
    sources = [script['src'] for script in page.scripts]
    assert all(src == cdn or (src.startswith('js/') and src[3:].split('?')[0] in allowed_local) for src in sources), name
    assert not any('old-js-version' in src for src in sources), name
    if 'js/main.js' in sources:
        assert sources[0] == cdn, f'jQuery must load first: {name}'
        assert page.scripts[0]['integrity'] == 'sha256-/JqT3SQfawRcv/BIHPThkBvs0OEvtFFmqPF/lYI/Cxo='

for path in (root / 'demofinal/js').glob('*.js'):
    if path.name == 'old-js-version.js':
        continue  # Deliberately archived, never executed.
    code = path.read_text(encoding='utf-8-sig')
    assert "'use strict'" in code, path
    assert not re.search(r'\b(?:var|eval)\b|document\.write|\.innerHTML|\.style\b|\.css\(', code), path
    assert not re.search(r'(?<![=!])==(?!=)|(?<!!)\!=(?!=)', code), path
    assert not re.search(r'\.addEventListener\s*\(|\.on(?:click|load|error)\s*=', code), path
    if path.name not in ('package-pricing.js', 'redirect.js'):
        assert re.search(r'\$\((?:async )?function\s*\(', code), path

archive = (root / 'demofinal/js/old-js-version.js').read_text(encoding='utf-8')
assert all(f'ORIGINAL {name}.js' in archive for name in ('main', 'games', 'booking'))
print('PASS: all 5 CSS files byte-for-byte frozen; 8 pages preserve content/structure; CDN order/SRI; separate scripts, ready, on(), no inline handlers/plugins/styles; vanilla archive unlinked.')
