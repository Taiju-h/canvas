#!/usr/bin/env bash
# Run on the UZERO server, after the canvas pull request is merged into main.
# sudo bash /tmp/deploy-uzero-canvas.sh admin@example.com [php-worker-user]
set -Eeuo pipefail
umask 077

repo=/var/www/uzero.style
db_config="$repo/CONF/canvas-db.ini"
email=${1:-}
web_user=${2:-www-data}
temporary_files=()

stop() { printf '停止: %s\n' "$*" >&2; exit 1; }
cleanup() {
  for file in "${temporary_files[@]}"; do rm -f -- "$file"; done
}
trap cleanup EXIT

[[ $# -le 2 && -n "$email" ]] || stop '使い方: sudo bash /tmp/deploy-uzero-canvas.sh メールアドレス [PHP実行ユーザー]'
[[ $EUID -eq 0 ]] || stop 'root で実行してください（sudo bash ...）。'
[[ -t 0 && -t 1 ]] || stop 'パスワードを対話入力できるターミナルから実行してください。'
for tool in git mysql php openssl curl runuser stat; do command -v "$tool" >/dev/null || stop "$tool が見つかりません。"; done
[[ -d "$repo/public" && -d "$repo/CONF" ]] || stop "$repo/public と $repo/CONF を確認してください。"
id "$web_user" >/dev/null 2>&1 || stop "PHP実行ユーザー $web_user が存在しません。第2引数で指定してください。"
web_group=$(id -gn "$web_user")
repo_owner=$(stat -c %U "$repo")
id "$repo_owner" >/dev/null 2>&1 || stop "Git作業ツリーの所有者 $repo_owner を確認してください。"

repo_git() {
  if [[ $repo_owner == root ]]; then git -C "$repo" "$@"
  else runuser -u "$repo_owner" -- git -C "$repo" "$@"
  fi
}

[[ $(repo_git rev-parse --show-toplevel) == "$repo" ]] || stop "$repo はGit作業ツリーのルートではありません。"
[[ $(repo_git branch --show-current) == main ]] || stop 'サーバーの作業ブランチが main ではありません。切替やリセットは自動実行しません。'
if [[ -n $(repo_git status --porcelain --untracked-files=normal) ]]; then
  repo_git status --short
  stop '未コミットの変更があります。先に内容を確認してください。'
fi

printf '現在のHEAD: %s\n' "$(repo_git rev-parse --short HEAD)"
repo_git fetch origin main || stop 'origin/main の取得に失敗しました。DBは変更していません。'
repo_git merge-base --is-ancestor HEAD origin/main || stop 'main と origin/main が分岐しています。自動でマージしません。'
for path in canvas/bin/deploy-canvas.sh canvas/sql/create-database.mysql.sql canvas/sql/schema.mysql.sql \
            canvas/server/bootstrap.php public/canvas/index.html public/canvas/api.php; do
  repo_git cat-file -e "origin/main:$path" || stop "main に $path がありません。PR #8 をマージしてから実行してください。"
done

# Never pull unrelated site changes as a side effect of this one-purpose installer.
while IFS= read -r path; do
  case "$path" in
    canvas/*|public/canvas/*|CONF/canvas-db.ini.example) ;;
    *) stop "キャンバス以外の更新 ($path) が含まれています。通常のデプロイ手順で差分を確認してください。" ;;
  esac
done < <(repo_git diff --name-only HEAD origin/main)

printf '反映する差分:\n'
repo_git diff --stat HEAD origin/main
printf 'PHP実行ユーザー: %s / 設定ファイル: %s\n' "$web_user" "$db_config"
repo_git check-ignore -q CONF/canvas-db.ini || stop 'CONF/canvas-db.ini がGitの除外対象ではありません。秘密を保存する前に停止します。'

modules=$(php -m)
for extension in pdo_mysql mbstring fileinfo; do
  grep -iq "^${extension}$" <<< "$modules" || stop "PHPに $extension 拡張がありません。DBは変更していません。"
done
if [[ -L "$db_config" ]]; then stop 'DB設定がシンボリックリンクです。安全のため停止します。'; fi

if [[ ! -e "$db_config" ]]; then
  mysql_admin=(mysql --user=root)
  if [[ -n ${CANVAS_MYSQL_LOGIN_PATH:-} ]]; then
    mysql_admin=(mysql "--login-path=$CANVAS_MYSQL_LOGIN_PATH")
  elif ! "${mysql_admin[@]}" --batch --skip-column-names -e 'SELECT 1' >/dev/null 2>&1; then
    mysql_admin=(mysql --user=root --password)
  fi

  existing=$("${mysql_admin[@]}" --batch --skip-column-names \
    -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'canvas'" \
    ) || stop 'MySQL管理者への接続に失敗しました。DBは変更していません。'
  [[ $existing == 0 ]] || stop 'canvas DBが既にあります。既存DBを確認してから設定してください。何も上書きしません。'

  db_user="canvas_$(openssl rand -hex 6)"
  db_password=$(openssl rand -hex 32)
  pepper=$(openssl rand -hex 32)
  conf_tmp=$(mktemp "$repo/CONF/.canvas-db.ini.XXXXXX")
  sql_tmp=$(mktemp)
  temporary_files+=("$conf_tmp" "$sql_tmp")
  printf '[mysql]\nhost = localhost\nport = 3306\ndatabase = canvas\nuser = %s\npassword = %s\nunix_socket =\n\n[auth]\npepper = %s\n' \
    "$db_user" "$db_password" "$pepper" > "$conf_tmp"
  install -o root -g "$web_group" -m 0640 "$conf_tmp" "$db_config"

  repo_git show origin/main:canvas/sql/create-database.mysql.sql > "$sql_tmp"
  printf '\nUSE `canvas`;\n' >> "$sql_tmp"
  repo_git show origin/main:canvas/sql/schema.mysql.sql >> "$sql_tmp"
  printf "\nCREATE USER '%s'@'localhost' IDENTIFIED BY '%s';\n" "$db_user" "$db_password" >> "$sql_tmp"
  printf "GRANT SELECT, INSERT, UPDATE, DELETE ON \`canvas\`.* TO '%s'@'localhost';\n" "$db_user" >> "$sql_tmp"

  if ! "${mysql_admin[@]}" < "$sql_tmp"; then
    stop "MySQL設定が途中で止まりました。$db_config は再開のため保持しました。DBを確認するまで再実行しないでください。"
  fi
  printf '専用のcanvas DB・表・制限付きDBユーザーを作成しました。\n'
else
  [[ -f "$db_config" ]] || stop "$db_config が通常ファイルではありません。"
  printf '既存のDB設定をそのまま利用します。DBやパスワードは上書きしません。\n'
fi

(umask 022; repo_git merge --ff-only origin/main) || stop 'Gitの早送り更新に失敗しました。DB設定は保持されています。'
printf '更新後のHEAD: %s\n' "$(repo_git rev-parse --short HEAD)"

for path in canvas/server/bootstrap.php public/canvas/api.php public/canvas/login.php public/canvas/icon.php; do
  php -l "$repo/$path" >/dev/null || stop "PHP構文に問題があります: $path"
done
runuser -u "$web_user" -- php -r '
  require $argv[1];
  $db = canvas_db();
  foreach (["canvas_users", "canvas_documents", "canvas_images", "canvas_login_attempts"] as $table) {
    $db->query("SELECT 1 FROM " . $table . " LIMIT 0");
  }
  echo "PHP実行ユーザーからDBに接続できました。\n";
' "$repo/canvas/server/bootstrap.php" || stop 'PHP実行ユーザーからDBを読めません。設定・権限・表を確認してください。'

html=$(curl -fsSL --max-time 15 'https://uzero.style/canvas/') || stop '公開URLの取得に失敗しました。DocumentRootとHTTPSを確認してください。'
[[ $html == *'<title>キャンバス | UZERO</title>'* && $html == *'/canvas/assets/'* ]] || \
  stop '公開URLでキャンバスのHTMLが見つかりません。ApacheのDocumentRootを確認してください。'
js_asset=$(sed -n 's/.*src="\(\/canvas\/assets\/[^\"]*\.js\)".*/\1/p' "$repo/public/canvas/index.html")
[[ -n $js_asset && -f "$repo/public$js_asset" ]] || stop 'ビルド済みJavaScriptがありません。公開アセットを確認してください。'
curl -fsSI --max-time 15 "https://uzero.style$js_asset" >/dev/null || stop '公開JavaScriptを取得できません。Apacheの設定を確認してください。'
session=$(curl -fsSL --max-time 15 'https://uzero.style/canvas/api.php?path=%2Fapi%2Fsession') || \
  stop 'PHPのセッションAPIが動いていません。ApacheのPHP設定を確認してください。'
[[ $session == *'"authenticated"'* && $session == *'"csrfToken"'* ]] || \
  stop 'セッションAPIがJSONを返していません。PHPが実行されているか確認してください。'

if runuser -u "$web_user" -- php -r '
  require $argv[1];
  $q = canvas_db()->prepare("SELECT COUNT(*) FROM canvas_users WHERE email = ?");
  $q->execute([strtolower(trim($argv[2]))]);
  exit((int)$q->fetchColumn() > 0 ? 0 : 1);
' "$repo/canvas/server/bootstrap.php" "$email"; then
  printf 'ログイン利用者 %s は登録済みです。\n' "$email"
else
  php "$repo/canvas/bin/create-user.php" "$email" || stop '利用者の作成に失敗しました。DBと公開画面は残っています。'
fi

printf '\n公開確認: https://uzero.style/canvas/\nログイン: https://uzero.style/canvas/login.php\n'
printf '作品の作成・再読み込み・端末間同期・共有リンクはブラウザで実際に確認してください。\n'
