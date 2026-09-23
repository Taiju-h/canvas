#!/usr/bin/env bash
set -Eeuo pipefail

source_repo=/var/www/uzero.style
site_root=/var/www/canvas.uzero.style
branch=canvas/isolated-deploy-20260923

stop() { printf '停止: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || stop 'sudo bash で実行してください。'
[[ -d $source_repo && -f $site_root/.git ]] || stop 'CanvasのGit worktreeが見つかりません。'

repo_owner=$(stat -c %U "$source_repo")
run_git() {
  local root=$1; shift
  if [[ $repo_owner == root ]]; then git -C "$root" "$@"
  else runuser -u "$repo_owner" -- git -C "$root" "$@"
  fi
}

run_git "$source_repo" fetch origin "refs/heads/$branch:refs/remotes/origin/$branch" || stop 'Canvasブランチを取得できません。'
[[ -z $(run_git "$site_root" status --porcelain --untracked-files=all -- canvas public/canvas) ]] ||
  stop 'Canvas公開worktreeに未コミット変更があります。上書きしません。'
run_git "$site_root" merge --ff-only "origin/$branch" || stop 'Canvas公開worktreeを更新できません。'

for file in \
  "$site_root/canvas/server/bootstrap.php" \
  "$site_root/public/canvas/api.php" \
  "$site_root/public/canvas/admin-visitors.php"; do
  php -l "$file" >/dev/null || stop "PHP構文エラー: $file"
done

mysql_admin=(mysql --user=root)
if ! "${mysql_admin[@]}" --batch --skip-column-names -e 'SELECT 1' >/dev/null 2>&1; then
  mysql_admin=(mysql --user=root --password)
fi
"${mysql_admin[@]}" canvas < "$site_root/canvas/sql/migrate-visitors.mysql.sql" || stop 'visitor用DB更新に失敗しました。'
exists=$("${mysql_admin[@]}" --batch --skip-column-names canvas -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='canvas' AND table_name='canvas_visitors'") ||
  stop 'visitorテーブルを確認できません。'
[[ $exists == 1 ]] || stop 'canvas_visitors テーブルが作成されていません。'

printf 'Canvas更新: %s\n' "$(run_git "$site_root" rev-parse --short HEAD)"
printf 'visitor DB: OK\n'
printf 'PHP構文: OK\n'
printf 'Apache設定は変更していません。\n'
printf 'ブラウザを再読み込みしてください: https://canvas.uzero.style/\n'
printf '管理画面: https://canvas.uzero.style/canvas/admin-visitors.php\n'
