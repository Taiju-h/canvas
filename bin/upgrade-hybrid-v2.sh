#!/usr/bin/env bash
set -Eeuo pipefail

repo_url="https://github.com/Taiju-h/canvas.git"
site_root="/var/www/canvas.uzero.style"
legacy_repo="/var/www/uzero.style"
branch="main"
staging=""

stop() { printf '停止: %s\n' "$*" >&2; exit 1; }
cleanup() {
  [[ -n ${staging:-} && -d ${staging:-} ]] && rm -rf -- "$staging"
}
trap cleanup EXIT

[[ $EUID -eq 0 ]] || stop 'sudo bash で実行してください。'
for tool in git node npm php mysql python3; do command -v "$tool" >/dev/null || stop "$tool が見つかりません。"; done
node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[[ $node_major -ge 20 ]] || stop "Node.js 20以上が必要です。現在: $(node -v)"

is_standalone_repo() {
  [[ -d "$site_root/.git" ]] || return 1
  local remote
  remote=$(git -C "$site_root" config --get remote.origin.url 2>/dev/null || true)
  [[ "$remote" == "$repo_url" || "$remote" == "https://github.com/Taiju-h/Canvas.git" || "$remote" == "git@github.com:Taiju-h/canvas.git" || "$remote" == "git@github.com:Taiju-h/Canvas.git" ]]
}

run_as_owner() {
  local root=$1; shift
  local owner
  owner=$(stat -c %U "$root")
  if [[ $owner == root ]]; then "$@"; else runuser -u "$owner" -- "$@"; fi
}

prepare_db() {
  local root=$1
  local mysql_admin=(mysql --user=root)
  if ! "${mysql_admin[@]}" --batch --skip-column-names -e 'SELECT 1' >/dev/null 2>&1; then
    mysql_admin=(mysql --user=root --password)
  fi
  "${mysql_admin[@]}" canvas < "$root/sql/schema.mysql.sql" || stop 'Canvas DBスキーマ確認に失敗しました。'
  "${mysql_admin[@]}" canvas < "$root/sql/migrate-visitors.mysql.sql" || stop '利用者DB更新に失敗しました。'
}

build_canvas() {
  local root=$1
  local editor="$root/src/components/hybrid-canvas-editor.tsx"
  local editor_backup
  [[ -f "$editor" ]] || stop "エディタが見つかりません: $editor"

  editor_backup=$(mktemp)
  cp -p -- "$editor" "$editor_backup"
  restore_editor() {
    if [[ -f "$editor_backup" ]]; then
      cp -p -- "$editor_backup" "$editor" || true
      rm -f -- "$editor_backup"
    fi
  }
  trap 'restore_editor; cleanup' EXIT

  cd "$root"
  run_as_owner "$root" node scripts/apply-raster-layers.mjs || stop 'ラスタライズ・レイヤー結合機能の適用に失敗しました。'
  run_as_owner "$root" node scripts/apply-smooth-brushes.mjs || stop '滑らかブラシ機能の適用に失敗しました。'

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

  printf 'Node依存関係を確認します。\n'
  run_as_owner "$root" npm install --no-audit --no-fund --package-lock=false || stop 'npm install に失敗しました。'
  printf 'TypeScript確認・本番ビルドを実行します。\n'
  run_as_owner "$root" npm run build || stop 'Canvasのビルドに失敗しました。上のTypeScript/Viteエラーを貼ってください。'

  restore_editor
  trap cleanup EXIT

  for file in "$root/public/canvas/api.php" "$root/public/canvas/admin-visitors.php" "$root/public/canvas/login.php" "$root/server/bootstrap.php"; do
    php -l "$file" >/dev/null || stop "PHP構文エラー: $file"
  done
  [[ -s "$root/public/canvas/index.html" ]] || stop '公開index.htmlが生成されませんでした。'
  ls "$root/public/canvas/assets"/*.js >/dev/null 2>&1 || stop 'JavaScriptが生成されませんでした。'
}

printf 'Canvas standalone 更新を開始します。GitHub: Taiju-h/canvas / main\n'

if is_standalone_repo; then
  printf 'standalone リポジトリを更新します。\n'
  if ! git -C "$site_root" diff --quiet || ! git -C "$site_root" diff --cached --quiet; then
    stop 'Canvasソースに未コミット変更があります。自動上書きしません。'
  fi
  git -C "$site_root" fetch origin "$branch" || stop 'GitHubからmainを取得できません。'
  git -C "$site_root" merge --ff-only "origin/$branch" || stop 'mainをfast-forwardできません。'
  prepare_db "$site_root"
  build_canvas "$site_root"
else
  printf '旧 uzero-style worktree から standalone リポジトリへ移行します。\n'
  [[ -d "$site_root" ]] || stop "$site_root が見つかりません。"
  [[ -f "$site_root/CONF/canvas-db.ini" ]] || stop '既存の CONF/canvas-db.ini が見つかりません。DB設定を保護するため停止しました。'

  staging=$(mktemp -d /var/www/canvas.uzero.style.new.XXXXXX)
  rmdir "$staging"
  git clone --branch "$branch" --single-branch "$repo_url" "$staging" || stop '新Canvasリポジトリをcloneできません。'
  mkdir -p "$staging/CONF"
  cp -p -- "$site_root/CONF/canvas-db.ini" "$staging/CONF/canvas-db.ini"

  prepare_db "$staging"
  build_canvas "$staging"

  if [[ -d "$legacy_repo/.git" ]] && git -C "$legacy_repo" worktree list --porcelain 2>/dev/null | grep -Fqx "worktree $site_root"; then
    git -C "$legacy_repo" worktree remove --force "$site_root" || stop '旧Canvas worktreeを解除できません。'
  else
    backup="${site_root}.legacy.$(date +%Y%m%d-%H%M%S)"
    mv -- "$site_root" "$backup" || stop '旧Canvasディレクトリを退避できません。'
    printf '旧ディレクトリ退避: %s\n' "$backup"
  fi
  mv -- "$staging" "$site_root" || stop 'standalone Canvasを本番位置へ移動できません。'
  staging=""
fi

printf '\nCanvas standalone デプロイ完了。\n'
printf 'GitHub: https://github.com/Taiju-h/canvas\n'
printf 'Branch: main\n'
printf 'Server: %s\n' "$site_root"
printf 'Source: %s/src\n' "$site_root"
printf 'Web: %s/public/canvas\n' "$site_root"
printf '公開URL: https://canvas.uzero.style/\n'
printf '利用者管理: https://canvas.uzero.style/canvas/admin-visitors.php\n'
printf 'Commit: %s\n' "$(git -C "$site_root" rev-parse --short HEAD)"
printf 'uzero.style / nobunaga は更新対象から外れました。\n'
