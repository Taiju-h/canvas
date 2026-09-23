#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo 'rootで実行してください。' >&2; exit 1; }

root=/var/www/canvas.uzero.style/public/canvas
alias_line="Alias /canvas/ $root/"
files=(
  /etc/apache2/sites-available/canvas.uzero.style.conf
  /etc/apache2/sites-available/canvas.uzero.style-le-ssl.conf
)

[[ -f "$root/index.html" ]] || { echo "停止: $root/index.html がありません。" >&2; exit 1; }

stamp=$(date +%Y%m%d-%H%M%S)
changed=0

for f in "${files[@]}"; do
  [[ -f "$f" ]] || continue
  grep -Eq '^[[:space:]]*ServerName[[:space:]]+canvas[.]uzero[.]style([[:space:]]|$)' "$f" || continue

  cp -a "$f" "$f.bak.$stamp"

  # canvas.uzero.style のURL直下をビルド済みCanvasにする。
  sed -i -E \
    -e "s#^[[:space:]]*DocumentRoot[[:space:]]+.*#    DocumentRoot $root#" \
    -e "s#^[[:space:]]*<Directory[[:space:]]+\"?(/var/www/uzero[.]style/canvas|/var/www/canvas[.]uzero[.]style/public|/var/www/canvas[.]uzero[.]style/canvas|/var/www/canvas[.]uzero[.]style/public/canvas)\"?>#    <Directory $root>#" \
    -e '/^[[:space:]]*RedirectMatch[[:space:]]+302[[:space:]]+\^\/[\$][[:space:]]+\/canvas\/[[:space:]]*$/d' \
    "$f"

  # フロントの既存 /canvas/assets/... と /canvas/api.php を壊さないため同じ実体へAliasする。
  if ! grep -Fq "$alias_line" "$f"; then
    sed -i "/^[[:space:]]*ServerName[[:space:]]\+canvas[.]uzero[.]style/a\\    $alias_line" "$f"
  fi

  if ! grep -Fq "<Directory $root>" "$f"; then
    sed -i "/^[[:space:]]*<\/VirtualHost>/i\\    <Directory $root>\n        Require all granted\n        AllowOverride All\n        Options FollowSymLinks\n    </Directory>" "$f"
  fi

  changed=1
done

[[ $changed -eq 1 ]] || { echo '停止: canvas.uzero.style のApache設定が見つかりません。' >&2; exit 1; }

apache2ctl configtest
systemctl reload apache2

echo 'Apacheを更新しました。'
echo "ROOT: $root"

echo '--- / の確認 ---'
curl -fsSI --max-time 20 https://canvas.uzero.style/ | head -n 5

echo '--- Canvas API の確認 ---'
curl -fsSL --max-time 20 'https://canvas.uzero.style/canvas/api.php?path=%2Fapi%2Fsession' | head -c 300
echo
