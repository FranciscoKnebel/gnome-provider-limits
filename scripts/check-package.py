import gettext
import io
import json
from pathlib import Path
from zipfile import ZipFile

path = Path('dist/gnome-provider-limits@franciscoknebel.com.shell-extension.zip')
with ZipFile(path) as bundle:
    languages = json.loads(bundle.read('locale/languages.json'))
    for language in languages:
        catalog_path = f"locale/{language['code']}/LC_MESSAGES/gnome-provider-limits.mo"
        catalog = gettext.GNUTranslations(io.BytesIO(bundle.read(catalog_path)))
        assert catalog.gettext('LANGUAGE_NAME') == language['name'], catalog_path
        if language['code'] == 'pt_BR':
            assert catalog.gettext('Settings') == 'Configurações', catalog_path
print(f'Validated {len(languages)} packaged translation catalogs')
