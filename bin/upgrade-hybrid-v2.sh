#!/usr/bin/env bash
set -Eeuo pipefail

source_repo=/var/www/uzero.style
site_root=/var/www/canvas.uzero.style
branch=canvas/isolated-deploy-20260923
editor="$site_root/canvas/src/components/hybrid-canvas-editor.tsx"
editor_backup=""

stop() { printf '停止: %s\n' "$*" >&2; exit 1; }
cleanup() {
  if [[ -n $editor_backup && -f $editor_backup ]]; then
    cp -p -- "$editor_backup" "$editor" || true
    rm -f -- "$editor_backup"
  fi
}
trap cleanup EXIT

[[ $EUID -eq 0 ]] || stop 'sudo bash で実行してください。'
[[ -d $source_repo && -f $site_root/.git ]] || stop 'CanvasのGit worktreeが見つかりません。'

repo_owner=$(stat -c %U "$source_repo")
run_git() {
  local root=$1; shift
  if [[ $repo_owner == root ]]; then git -C "$root" "$@"
  else runuser -u "$repo_owner" -- git -C "$root" "$@"
  fi
}
run_as_owner() {
  if [[ $repo_owner == root ]]; then "$@"
  else runuser -u "$repo_owner" -- "$@"
  fi
}

printf 'Canvas V2 更新を開始します。元サイト・nobunagaには触れません。\n'
run_git "$source_repo" fetch origin "refs/heads/$branch:refs/remotes/origin/$branch" || stop 'Canvasブランチを取得できません。'

# Production builds intentionally change only generated frontend files. Restore those
# before a fast-forward so source changes can be updated without touching other sites.
allowed='^( M|M |MM| D|D |A |\?\?) public/canvas/(assets/|index\.html$|offline-assets\.json$|sw\.js$)'
while IFS= read -r line; do
  [[ -z $line ]] && continue
  if ! grep -Eq "$allowed" <<< "$line"; then
    stop "Canvas worktreeに保護対象の未コミット変更があります: $line"
  fi
done < <(run_git "$site_root" status --porcelain --untracked-files=all -- canvas public/canvas)

run_git "$site_root" restore --worktree --staged -- public/canvas/assets public/canvas/index.html public/canvas/offline-assets.json public/canvas/sw.js 2>/dev/null || true
find "$site_root/public/canvas/assets" -maxdepth 1 -type f -print0 2>/dev/null | while IFS= read -r -d '' file; do
  rel=${file#"$site_root/"}
  run_git "$site_root" ls-files --error-unmatch "$rel" >/dev/null 2>&1 || rm -f -- "$file"
done

run_git "$site_root" merge --ff-only "origin/$branch" || stop 'Canvas公開worktreeを更新できません。'
printf 'Git更新: %s\n' "$(run_git "$site_root" rev-parse --short HEAD)"

for tool in node npm php mysql python3; do command -v "$tool" >/dev/null || stop "$tool が見つかりません。"; done
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[[ $node_major -ge 20 ]] || stop "Node.js 20以上が必要です。現在: $(node -v)"

# Visitor storage is idempotent and is required for guest document persistence.
mysql_admin=(mysql --user=root)
if ! "${mysql_admin[@]}" --batch --skip-column-names -e 'SELECT 1' >/dev/null 2>&1; then
  mysql_admin=(mysql --user=root --password)
fi
"${mysql_admin[@]}" canvas < "$site_root/canvas/sql/migrate-visitors.mysql.sql" || stop '利用者DB更新に失敗しました。'

# Build-only feature patches. The original tracked source is restored immediately after
# the production bundle is generated, so the worktree stays clean.
editor_backup=$(mktemp)
cp -p -- "$editor" "$editor_backup"
cd "$site_root/canvas"
run_as_owner node scripts/apply-raster-layers.mjs || stop 'ラスタライズ・レイヤー結合機能の適用に失敗しました。'
run_as_owner node scripts/apply-smooth-brushes.mjs || stop '滑らかブラシ機能の適用に失敗しました。'

# Small compile-time compatibility fixes for the current V2 source.
python3 - "$editor" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('history.replaceState(null, "", url)', 'window.history.replaceState(null, "", url)')
s = s.replace(
    'dirty.current = docRef.current !== sentDoc || titleRef.current !== sentTitle;',
    'dirty.current = JSON.stringify(docRef.current) !== JSON.stringify(sentDoc) || titleRef.current !== sentTitle;'
)
p.write_text(s)
PY
chown "$(stat -c %U "$editor_backup")":"$(stat -c %G "$editor_backup")" "$editor" 2>/dev/null || true

printf 'Node依存関係を確認します。\n'
run_as_owner npm install --no-audit --no-fund || stop 'npm install に失敗しました。'
printf 'TypeScript確認・V2ビルドを実行します。\n'
run_as_owner npm run build || stop 'Canvas V2のビルドに失敗しました。上のTypeScript/Viteエラーを貼ってください。'

# Restore source immediately; generated output remains in public/canvas.
cp -p -- "$editor_backup" "$editor"
rm -f -- "$editor_backup"
editor_backup=""

for file in "$site_root/public/canvas/api.php" "$site_root/public/canvas/admin-visitors.php" "$site_root/canvas/server/bootstrap.php"; do
  php -l "$file" >/dev/null || stop "PHP構文エラー: $file"
done
[[ -s $site_root/public/canvas/index.html ]] || stop '公開index.htmlが生成されませんでした。'
ls "$site_root/public/canvas/assets"/*.js >/dev/null 2>&1 || stop 'V2 JavaScriptが生成されませんでした。'

printf '\nCanvas V2 ビルド完了。\n'
printf '機能: ベクター/ペイント、滑らかブラシ、ラスタライズ、下と結合、表示を結合、全て統合、ラスタ消しゴム\n'
printf '公開URL: https://canvas.uzero.style/\n'
printf '利用者管理: https://canvas.uzero.style/canvas/admin-visitors.php\n'
printf 'Git: %s\n' "$(run_git "$site_root" rev-parse --short HEAD)"
printf 'Apache設定・uzero.style・nobunagaは変更していません。\n'
