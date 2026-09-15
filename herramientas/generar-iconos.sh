#!/usr/bin/env bash
# Rasteriza los SVG de iconos/ a PNG usando Chrome en modo headless.
# Uso: bash herramientas/generar-iconos.sh   (desde la raiz de ranking-lan/)
set -euo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [[ ! -x "$CHROME" ]]; then
  echo "No se encontro Chrome en: $CHROME" >&2
  echo "Define la variable CHROME con la ruta correcta." >&2
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

rasterizar() {
  local svg="$1" tamano="$2" salida="$3"
  # Envoltorio HTML: garantiza tamano exacto y sin margenes.
  cat > "$TMP/envoltorio.html" <<HTML
<!DOCTYPE html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${tamano}px;height:${tamano}px}</style>
<img src="file://${svg}" alt="">
HTML
  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --window-size="${tamano},${tamano}" \
    --screenshot="$salida" \
    "file://$TMP/envoltorio.html" >/dev/null 2>&1
  echo "  ok  $(basename "$salida")  (${tamano}x${tamano})"
}

echo "Generando iconos PNG..."
rasterizar "$RAIZ/iconos/icono.svg"          192 "$RAIZ/iconos/icono-192.png"
rasterizar "$RAIZ/iconos/icono.svg"          512 "$RAIZ/iconos/icono-512.png"
rasterizar "$RAIZ/iconos/icono-maskable.svg" 512 "$RAIZ/iconos/icono-maskable-512.png"
rasterizar "$RAIZ/iconos/icono.svg"          180 "$RAIZ/iconos/apple-touch-icon.png"
echo "Listo."
