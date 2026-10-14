#!/usr/bin/env bash
# Install Playfair Display + Inter so LibreOffice renders the real brand fonts.
# Without this, every PDF preview you inspect is a substituted font and your
# layout checks are against the wrong metrics.
set -e
cd "$(dirname "$0")"

npm install @fontsource/playfair-display @fontsource/inter --no-audit --no-fund --loglevel=error
pip install fonttools --break-system-packages -q

python3 - <<'PY'
from fontTools.ttLib import TTFont
import os
FS = "node_modules/@fontsource"
jobs = [
 (f"{FS}/playfair-display/files/playfair-display-latin-400-normal.woff", "PlayfairDisplay-Regular.ttf"),
 (f"{FS}/playfair-display/files/playfair-display-latin-700-normal.woff", "PlayfairDisplay-Bold.ttf"),
 (f"{FS}/playfair-display/files/playfair-display-latin-400-italic.woff", "PlayfairDisplay-Italic.ttf"),
 (f"{FS}/playfair-display/files/playfair-display-latin-700-italic.woff", "PlayfairDisplay-BoldItalic.ttf"),
 (f"{FS}/inter/files/inter-latin-400-normal.woff", "Inter-Regular.ttf"),
 (f"{FS}/inter/files/inter-latin-600-normal.woff", "Inter-SemiBold.ttf"),
 (f"{FS}/inter/files/inter-latin-700-normal.woff", "Inter-Bold.ttf"),
]
dest = os.path.expanduser("~/.fonts")
os.makedirs(dest, exist_ok=True)
for src, out in jobs:
    f = TTFont(src); f.flavor = None; f.save(os.path.join(dest, out))
    print("installed", out)
PY

fc-cache -f > /dev/null 2>&1
echo "--- registered ---"
fc-list : family | tr ',' '\n' | grep -iE "playfair|^Inter$" | sort -u
