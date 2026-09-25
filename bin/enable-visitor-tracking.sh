#!/usr/bin/env bash
set -Eeuo pipefail

site_root=/var/www/canvas.uzero.style
stop() { printf '停止: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || stop 'sudo bash で実行してください。'
[[ -d "$site_root/.git" ]] || stop 'standalone Canvas が見つかりません。先に upgrade-hybrid-v2.sh を実行してください。'

mysql_admin=(mysql --user=root)
if ! "${mysql_admin[@]}" --batch --skip-column-names -e 'SELECT 1' >/dev/null 2>&1; then
  mysql_admin=(mysql --user=root --password)
fi
"${mysql_admin[@]}" canvas < "$site_root/sql/schema.mysql.sql" || stop 'Canvas DBスキーマ確認に失敗しました。'
"${mysql_admin[@]}" canvas < "$site_root/sql/migrate-visitors.mysql.sql" || stop 'visitor用DB更新に失敗しました。'

for file in "$site_root/server/bootstrap.php" "$site_root/public/canvas/api.php" "$site_root/public/canvas/admin-visitors.php"; do
  php -l "$file" >/dev/null || stop "PHP構文エラー: $file"
done

printf 'visitor DB: OK\n'
printf 'PHP構文: OK\n'
printf '管理画面: https://canvas.uzero.style/canvas/admin-visitors.php\n'
