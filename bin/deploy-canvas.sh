#!/usr/bin/env bash
# Deploy Canvas from its dedicated branch into a separate, sparse Git worktree.
# Run over SSH: sudo bash /tmp/uzero-canvas-deploy.sh admin@your-domain.jp [php-user]
set -Eeuo pipefail
umask 022

source_repo=/var/www/uzero.style
site_root=/var/www/canvas.uzero.style
branch=canvas/isolated-deploy-20260923
base_commit=38ca55297426257bdebe9213156d9511eb6f2093
old_docroot=/var/www/uzero.style/canvas
new_docroot="$site_root/public"
vhost=/etc/apache2/sites-available/canvas.uzero.style.conf
enabled_vhost=/etc/apache2/sites-enabled/canvas.uzero.style.conf
config="$site_root/CONF/canvas-db.ini"
base_url=https://canvas.uzero.style/canvas/
email=${1:-}
web_user=${2:-www-data}
temporary_files=()

stop() { printf '停止: %s\n' "$*" >&2; exit 1; }
cleanup() {
  for file in "${temporary_files[@]}"; do rm -f -- "$file"; done
}
trap cleanup EXIT

[[ $# -le 2 && -n $email ]] || stop '使い方: sudo bash /tmp/uzero-canvas-deploy.sh メールアドレス [PHP実行ユーザー]'
[[ $email != user@example.com && $email != your-address@domain.jp && $email != *@example.com ]] ||
  stop '例示メールアドレスを実際のログイン用に変更してください。'
[[ $EUID -eq 0 ]] || stop 'root で実行してください（sudo bash ...）。'
[[ -t 0 && -t 1 ]] || stop 'SSHの対話型ターミナルで実行してください。'
for tool in git mysql php openssl curl runuser stat install mktemp sed apache2ctl systemctl awk readlink; do
  command -v "$tool" >/dev/null || stop "$tool が見つかりません。"
done
php -r 'exit(filter_var($argv[1], FILTER_VALIDATE_EMAIL) ? 0 : 1);' "$email" ||
  stop '初期ログイン用メールアドレスが不正です。'
id "$web_user" >/dev/null 2>&1 || stop "PHP実行ユーザー $web_user が存在しません。"
[[ -d $source_repo && -f $vhost && -e $enabled_vhost ]] ||
  stop 'UZEROのGit作業ツリーまたはCanvasのApache設定が見つかりません。'
[[ $(readlink -f "$enabled_vhost") == "$vhost" ]] ||
  stop '有効なApache設定が確認したファイルと違います。'
grep -Eq '^[[:space:]]*ServerName[[:space:]]+canvas\.uzero\.style([[:space:]]|$)' "$vhost" ||
  stop 'Apache設定のServerNameがcanvas.uzero.styleではありません。'
docroots=$(awk '$1 == "DocumentRoot" {print $2}' "$vhost")
[[ $docroots == "$old_docroot" || $docroots == "$new_docroot" ]] ||
  stop 'ApacheのDocumentRootが確認時と違います。内容を確認してください。'
if [[ $docroots == "$old_docroot" ]]; then
  # The old path normally appears both in DocumentRoot and in a matching
  # <Directory ...> block. Allow only those known references; anything else
  # still stops the deploy instead of rewriting an unknown Apache directive.
  old_ref_lines=$(grep -Fn -- "$old_docroot" "$vhost" || true)
  while IFS= read -r ref; do
    [[ -n $ref ]] || continue
    line=${ref#*:}
    case "$line" in
      *DocumentRoot*"$old_docroot"*|*"<Directory $old_docroot>"*|*"<Directory \"$old_docroot\">"*) ;;
      *) stop "Apache設定の旧パス参照が想定外です: $ref" ;;
    esac
  done <<< "$old_ref_lines"
fi
web_group=$(id -gn "$web_user")
repo_owner=$(stat -c %U "$source_repo")
repo_group=$(stat -c %G "$source_repo")
id "$repo_owner" >/dev/null 2>&1 || stop "Gitの所有者 $repo_owner が見つかりません。"

repo_git() {
  if [[ $repo_owner == root ]]; then git -C "$source_repo" "$@"
  else runuser -u "$repo_owner" -- git -C "$source_repo" "$@"
  fi
}
site_git() {
  if [[ $repo_owner == root ]]; then git -C "$site_root" "$@"
  else runuser -u "$repo_owner" -- git -C "$site_root" "$@"
  fi
}
ensure_sparse_checkout() {
  local git_info
  git_info=$(site_git rev-parse --git-path info) || stop 'Canvas worktreeのGit管理パスを取得できません。'
  [[ $git_info == /* ]] || git_info="$site_root/$git_info"
  install -d -o "$repo_owner" -g "$repo_group" -m 0755 "$git_info" ||
    stop 'Canvas worktreeのsparse-checkout管理ディレクトリを作成できません。'
  site_git sparse-checkout init --no-cone || stop 'Canvasのsparse-checkout初期化に失敗しました。'
  site_git sparse-checkout set --no-cone '/canvas/' '/public/canvas/' '/.gitignore' ||
    stop 'Canvasだけの展開設定に失敗しました。'
}

[[ $(repo_git rev-parse --show-toplevel) == "$source_repo" ]] ||
  stop "$source_repo はGit作業ツリーのルートではありません。"
[[ $(repo_git branch --show-current) == main ]] || stop '元サイトの作業ブランチがmainではありません。'
[[ -z $(repo_git status --porcelain --untracked-files=all -- canvas public/canvas) ]] ||
  stop '元サイトのCanvasに変更があります。先に内容を確認してください。'
printf '元サイトのHEAD: %s / Canvasの変更: なし\n' "$(repo_git rev-parse --short HEAD)"
printf '元サイトのnobunaga等の作業ファイルには触れません。\n'
# Fetch only updates Git refs and objects, never the dirty production main files.
repo_git fetch origin main || stop 'origin/mainを取得できません。'
[[ $(repo_git rev-parse origin/main) == "$base_commit" ]] ||
  stop 'origin/mainが事前確認した版から変わりました。再確認してください。'
repo_git fetch origin "refs/heads/$branch:refs/remotes/origin/$branch" ||
  stop 'Canvas専用ブランチを取得できません。'
repo_git merge-base --is-ancestor "$base_commit" "origin/$branch" ||
  stop 'Canvasブランチの起点が確認した版と違います。'
changed_paths=$(repo_git diff --no-renames --name-only "$base_commit" "origin/$branch") ||
  stop 'Canvasブランチの差分を確認できません。'
while IFS= read -r path; do
  [[ -n $path ]] || continue
  case "$path" in canvas/*|public/canvas/*) ;; *) stop "Canvas以外の差分を検出: $path" ;; esac
done <<< "$changed_paths"

if [[ ! -e $site_root ]]; then
  if repo_git show-ref --verify --quiet "refs/heads/$branch"; then
    stop '同名のローカルブランチがあります。内容を確認してください。'
  fi
  install -d -o "$repo_owner" -g "$repo_group" -m 0755 "$site_root"
  repo_git worktree add --no-checkout -b "$branch" "$site_root" "origin/$branch" ||
    stop 'Canvas専用作業ツリーの作成に失敗しました。元サイトの作業ファイルは変更していません。'
  ensure_sparse_checkout
  site_git checkout "$branch" || stop 'Canvasだけの展開に失敗しました。'
else
  [[ -f $site_root/.git && $(site_git branch --show-current) == "$branch" ]] ||
    stop '公開先がCanvas専用の作業ツリーではありません。上書きしません。'

  # A previous run may have created the linked worktree but failed before
  # sparse-checkout could write its metadata. Recover only when no untracked
  # files exist and the expected Canvas files are still absent.
  if [[ ! -f $site_root/canvas/server/bootstrap.php && ! -f $site_root/public/canvas/index.html ]]; then
    [[ -z $(site_git ls-files --others --exclude-standard) ]] ||
      stop '未完成のCanvas worktreeに未追跡ファイルがあります。自動復旧せず停止します。'
    site_git merge-base --is-ancestor HEAD "origin/$branch" ||
      stop '未完成のCanvas worktreeのHEADが配布ブランチ系列ではありません。自動復旧せず停止します。'
    printf '前回失敗した未完成のCanvas worktreeを復旧します。\n'
    ensure_sparse_checkout
    site_git reset --hard "origin/$branch" || stop '未完成Canvas worktreeの復旧に失敗しました。'
  else
    [[ -z $(site_git status --porcelain --untracked-files=all -- canvas public/canvas) ]] ||
      stop '公開先のCanvasに未コミット変更があります。上書きしません。'
    site_git merge --ff-only "origin/$branch" || stop 'Canvasブランチの早送り更新に失敗しました。'
    ensure_sparse_checkout
  fi
fi
for path in canvas/server/bootstrap.php canvas/bin/create-user.php canvas/sql/create-database.mysql.sql \
            canvas/sql/schema.mysql.sql public/canvas/index.html public/canvas/api.php; do
  [[ -f $site_root/$path ]] || stop "公開先に $path がありません。"
done

[[ ! -e $site_root/nobunaga && ! -e $site_root/public/index.php ]] ||
  stop 'Canvas以外のサイトが作業ツリーに展開されました。'
site_git check-ignore -q CONF/canvas-db.ini ||
  stop 'DB秘密設定がGitの除外対象ではありません。'
install -d -o root -g "$web_group" -m 0755 "$site_root/CONF"
app=$site_root

modules=$(php -m)
for extension in pdo_mysql mbstring fileinfo; do
  grep -iq "^${extension}$" <<< "$modules" || stop "PHPに $extension 拡張がありません。"
done
for path in canvas/server/bootstrap.php canvas/bin/create-user.php public/canvas/api.php \
            public/canvas/login.php public/canvas/icon.php; do
  php -l "$app/$path" >/dev/null || stop "PHP構文を確認してください: $path"
done

[[ ! -L $config ]] || stop "$config がシンボリックリンクです。上書きしません。"
if [[ ! -e $config ]]; then
  [[ ! -e $source_repo/CONF/canvas-db.ini ]] ||
    stop '既存のUZERO側にcanvas-db.iniがあります。DBを二重作成しないよう確認してください。'
  mysql_admin=(mysql --user=root)
  if [[ -n ${CANVAS_MYSQL_LOGIN_PATH:-} ]]; then
    mysql_admin=(mysql "--login-path=$CANVAS_MYSQL_LOGIN_PATH")
  elif ! "${mysql_admin[@]}" --batch --skip-column-names -e 'SELECT 1' >/dev/null 2>&1; then
    mysql_admin=(mysql --user=root --password)
  fi
  existing=$("${mysql_admin[@]}" --batch --skip-column-names \
    -e "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = 'canvas'") ||
    stop 'MySQL管理者への接続に失敗しました。'
  [[ $existing == 0 ]] || stop '既にcanvas DBがあります。既存データを調べるまで作成しません。'

  db_user="canvas_$(openssl rand -hex 6)"
  db_password=$(openssl rand -hex 32)
  pepper=$(openssl rand -hex 32)
  conf_tmp=$(mktemp "$site_root/CONF/.canvas-db.ini.XXXXXX")
  sql_tmp=$(mktemp)
  temporary_files+=("$conf_tmp" "$sql_tmp")
  printf '[mysql]\nhost = localhost\nport = 3306\ndatabase = canvas\nuser = %s\npassword = %s\nunix_socket =\n\n[auth]\npepper = %s\n' \
    "$db_user" "$db_password" "$pepper" > "$conf_tmp"
  install -o root -g "$web_group" -m 0640 "$conf_tmp" "$config"

  cat "$app/canvas/sql/create-database.mysql.sql" > "$sql_tmp"
  printf '\nUSE `canvas`;\n' >> "$sql_tmp"
  cat "$app/canvas/sql/schema.mysql.sql" >> "$sql_tmp"
  printf "\nCREATE USER '%s'@'localhost' IDENTIFIED BY '%s';\n" "$db_user" "$db_password" >> "$sql_tmp"
  printf "GRANT SELECT, INSERT, UPDATE, DELETE ON \`canvas\`.* TO '%s'@'localhost';\n" "$db_user" >> "$sql_tmp"
  if ! "${mysql_admin[@]}" < "$sql_tmp"; then
    stop "MySQL設定が途中で止まりました。秘密設定は $config に保持しました。DBを調べるまで再実行しないでください。"
  fi
  printf '専用canvas DB、4テーブル、制限付きDBユーザーを作成しました。\n'
else
  [[ -f $config ]] || stop "$config は通常ファイルではありません。"
  printf '既存のDB設定を利用します。DBとパスワードは変更しません。\n'
fi

runuser -u "$web_user" -- php -r '
  require $argv[1];
  $db = canvas_db();
  foreach (["canvas_users", "canvas_documents", "canvas_images", "canvas_login_attempts"] as $table) {
    $db->query("SELECT 1 FROM " . $table . " LIMIT 0");
  }
  echo "PHP実行ユーザーからDB接続を確認しました。\n";
' "$app/canvas/server/bootstrap.php" ||
  stop 'PHP実行ユーザーからDB・テーブルを読めません。権限と設定を確認してください。'

if runuser -u "$web_user" -- php -r '
  require $argv[1];
  $q = canvas_db()->prepare("SELECT COUNT(*) FROM canvas_users WHERE email = ?");
  $q->execute([strtolower(trim($argv[2]))]);
  exit((int)$q->fetchColumn() > 0 ? 0 : 1);
' "$app/canvas/server/bootstrap.php" "$email"; then
  printf '利用者 %s は登録済みです。\n' "$email"
else
  php "$app/canvas/bin/create-user.php" "$email" || stop '初期ログイン利用者の作成に失敗しました。'
fi

if [[ $docroots == "$old_docroot" ]]; then
  vhost_backup=$(mktemp)
  temporary_files+=("$vhost_backup")
  cp -p -- "$vhost" "$vhost_backup"
  sed -i -E "s|^([[:space:]]*DocumentRoot[[:space:]]+)$old_docroot[[:space:]]*$|\1$new_docroot|" "$vhost"
  sed -i \
    -e "s|<Directory $old_docroot>|<Directory $new_docroot>|g" \
    -e "s|<Directory \"$old_docroot\">|<Directory \"$new_docroot\">|g" \
    "$vhost"
  if [[ $(awk '$1 == "DocumentRoot" {print $2}' "$vhost") != "$new_docroot" ]] ||
     grep -Fq -- "$old_docroot" "$vhost" ||
     ! apache2ctl configtest || ! systemctl reload apache2; then
    cp -p -- "$vhost_backup" "$vhost"
    apache2ctl configtest && systemctl reload apache2 || true
    stop 'Apache設定を元に戻しました。設定または再起動の失敗を確認してください。'
  fi
  printf 'ApacheのCanvas専用DocumentRootとDirectoryを更新しました。\n'
fi

page=$(curl -fsSL --max-time 20 "$base_url") ||
  stop "公開URLを開けません。Canvasの作業ツリーとDBは作成済みです: $base_url"
[[ $page == *'<title>キャンバス | UZERO</title>'* && $page == *'/canvas/assets/'* ]] ||
  stop '公開URLの内容がCanvasではありません。ApacheとDNSを確認してください。'
session=$(curl -fsSL --max-time 20 "${base_url}api.php?path=%2Fapi%2Fsession") ||
  stop 'PHPセッションAPIを開けません。'
[[ $session == *'"authenticated"'* && $session == *'"csrfToken"'* ]] ||
  stop 'PHPセッションAPIの応答が不正です。'
printf 'Canvasブランチ・専用DB・公開URLを確認しました: %s\n' "$base_url"
printf '元サイトのmainとnobunagaの作業ファイルは変更していません。\n'