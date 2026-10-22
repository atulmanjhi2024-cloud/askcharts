#!/bin/sh
# AskCharts for Mac and Linux. Paste into Terminal:
#   curl -fsSL https://github.com/realgrapedrop/askcharts/releases/latest/download/install.sh | sh
#
# It puts AskCharts in ~/AskCharts with its own copy of Node.js (checked against nodejs.org's checksums),
# starts it now and whenever you log in, and opens it in your browser. No admin rights. Run it again to
# update: your charts and settings stay in ~/AskCharts/data. To remove it: ~/AskCharts/uninstall
#
# For testing: ASKCHARTS_BASE (where to download AskCharts from), ASKCHARTS_HOME (instead of ~/AskCharts),
# ASKCHARTS_LABEL (the login item's name, default askcharts), ASKCHARTS_NO_SERVICE=1 (no systemd).
set -eu

BASE=${ASKCHARTS_BASE:-https://github.com/realgrapedrop/askcharts/releases/latest/download}
DIR=${ASKCHARTS_HOME:-$HOME/AskCharts}
LABEL=${ASKCHARTS_LABEL:-askcharts}
NODE_VERSION=24.21.0
NODE_BASE=https://nodejs.org/dist/v$NODE_VERSION

say() { printf '%s\n' "$*"; }
fail() {
  printf 'AskCharts: %s\n' "$*" >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || fail "this needs curl"
command -v tar >/dev/null 2>&1 || fail "this needs tar"
if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "this needs sha256sum or shasum, to check what it downloads"
fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "this is for Mac and Linux. On Windows, use install.ps1 (see the README)." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "this computer's processor ($(uname -m)) isn't one Node.js $NODE_VERSION supports here" ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

# fetch FILE from a base URL, then check it against that base's checksum list
fetch() { # base file sums-file
  curl -fsSL --retry 3 -o "$tmp/$2" "$1/$2" || fail "couldn't download $1/$2"
  want=$(grep " \*\{0,1\}$2\$" "$tmp/$3" | cut -d' ' -f1)
  [ -n "$want" ] || fail "$2 isn't in $1/$3"
  [ "$(sha "$tmp/$2")" = "$want" ] || fail "$2 didn't match its checksum: not installing it"
}

say "Downloading AskCharts..."
curl -fsSL --retry 3 -o "$tmp/SHA256SUMS" "$BASE/SHA256SUMS" || fail "couldn't download $BASE/SHA256SUMS"
fetch "$BASE" askcharts.tar.gz SHA256SUMS
mkdir -p "$DIR"

node="$DIR/node/bin/node"
if [ -x "$node" ] && [ "$("$node" --version 2>/dev/null)" = "v$NODE_VERSION" ]; then
  say "Node.js $NODE_VERSION is already here."
else
  say "Downloading Node.js $NODE_VERSION (about 50 MB)..."
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "$NODE_BASE/SHASUMS256.txt" || fail "couldn't reach nodejs.org"
  pkg=node-v$NODE_VERSION-$os-$arch
  fetch "$NODE_BASE" "$pkg.tar.gz" SHASUMS256.txt
  mkdir -p "$tmp/node"
  tar -xzf "$tmp/$pkg.tar.gz" -C "$tmp/node"
  # just the runtime and its licence: AskCharts needs no npm
  rm -rf "$DIR/node"
  mkdir -p "$DIR/node/bin"
  mv "$tmp/node/$pkg/bin/node" "$DIR/node/bin/node"
  mv "$tmp/node/$pkg/LICENSE" "$DIR/node/LICENSE"
fi

# stop the running one (an update), so its files can be swapped
stop_running() {
  if [ "$os" = darwin ]; then
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  elif [ -z "${ASKCHARTS_NO_SERVICE:-}" ] && systemctl --user show-environment >/dev/null 2>&1; then
    systemctl --user stop "$LABEL.service" >/dev/null 2>&1 || true
  fi
  if [ -f "$DIR/data/run.pid" ]; then
    pid=$(cat "$DIR/data/run.pid")
    kill "$pid" >/dev/null 2>&1 || true
    i=0
    while kill -0 "$pid" >/dev/null 2>&1 && [ $i -lt 50 ]; do
      sleep 0.2
      i=$((i + 1))
    done
  fi
}
stop_running
# a port from the last run would point at the wrong place until the new one writes its own
rm -f "$DIR/data/port"

say "Installing into $DIR..."
mkdir -p "$tmp/new"
tar -xzf "$tmp/askcharts.tar.gz" -C "$tmp/new"
[ -f "$tmp/new/askcharts/run.mjs" ] || fail "the download isn't an AskCharts release"
rm -rf "$DIR/program.old"
[ -d "$DIR/program" ] && mv "$DIR/program" "$DIR/program.old"
mv "$tmp/new/askcharts" "$DIR/program"
rm -rf "$DIR/program.old"
mkdir -p "$DIR/data"

# start: what the login item runs, and what you can run yourself (start --open opens the browser)
cat > "$DIR/start" <<EOF
#!/bin/sh
ASKCHARTS_DATA="$DIR/data" exec "$DIR/node/bin/node" "$DIR/program/run.mjs" "\$@"
EOF
chmod +x "$DIR/start"

plist="$HOME/Library/LaunchAgents/$LABEL.plist"
unit="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$LABEL.service"
autostart="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/$LABEL.desktop"
desktop="${XDG_DATA_HOME:-$HOME/.local/share}/applications/$LABEL.desktop"

if [ "$os" = darwin ]; then
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$DIR/node/bin/node</string><string>$DIR/program/run.mjs</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>ASKCHARTS_DATA</key><string>$DIR/data</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>$DIR/data/askcharts.log</string>
  <key>StandardErrorPath</key><string>$DIR/data/askcharts.log</string>
</dict>
</plist>
EOF
  launchctl bootstrap "gui/$(id -u)" "$plist" || fail "couldn't start AskCharts (launchctl)"
elif [ -z "${ASKCHARTS_NO_SERVICE:-}" ] && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$(dirname "$unit")"
  cat > "$unit" <<EOF
[Unit]
Description=AskCharts

[Service]
ExecStart=$DIR/start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "$LABEL.service" >/dev/null 2>&1 || fail "couldn't start AskCharts (systemd)"
else
  # no systemd for this user: start it from the desktop's autostart, and now
  mkdir -p "$(dirname "$autostart")"
  cat > "$autostart" <<EOF
[Desktop Entry]
Type=Application
Name=AskCharts
Exec=$DIR/start
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF
  nohup "$DIR/start" >> "$DIR/data/askcharts.log" 2>&1 &
fi

# Linux: AskCharts in the applications menu (it opens the browser on the running one)
if [ "$os" = linux ]; then
  mkdir -p "$(dirname "$desktop")"
  cat > "$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=AskCharts
Comment=Charts, backtests and an AI that works on the chart for you
Exec=$DIR/start --open
Icon=$DIR/program/app/public/icons/askcharts-512.png
Terminal=false
Categories=Office;Finance;
EOF
fi

cat > "$DIR/uninstall" <<EOF
#!/bin/sh
# Removes AskCharts: stops it, takes it out of your logins, deletes the program and its Node.js.
# Your charts and settings stay in $DIR/data until you delete that folder.
if [ "\$(uname -s)" = Darwin ]; then
  launchctl bootout "gui/\$(id -u)/$LABEL" >/dev/null 2>&1
  rm -f "$plist"
else
  systemctl --user disable --now "$LABEL.service" >/dev/null 2>&1
  rm -f "$unit" "$autostart" "$desktop"
  systemctl --user daemon-reload >/dev/null 2>&1
fi
[ -f "$DIR/data/run.pid" ] && kill "\$(cat "$DIR/data/run.pid")" >/dev/null 2>&1
rm -rf "$DIR/program" "$DIR/node" "$DIR/start" "$DIR/uninstall"
echo "AskCharts is removed. Your charts and settings are still in $DIR/data: delete that folder to remove them too."
EOF
chmod +x "$DIR/uninstall"

# wait for it, then open it
say "Starting AskCharts..."
i=0
url=""
while [ $i -lt 60 ]; do
  if [ -f "$DIR/data/port" ]; then
    port=$(cat "$DIR/data/port")
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then
      url="http://localhost:$port"
      break
    fi
  fi
  sleep 1
  i=$((i + 1))
done
[ -n "$url" ] || fail "AskCharts didn't start. What it said is in $DIR/data/askcharts.log (Mac) or: journalctl --user -u $LABEL"
if [ -z "${ASKCHARTS_NO_OPEN:-}" ]; then
  if [ "$os" = darwin ]; then open "$url"; else xdg-open "$url" >/dev/null 2>&1 || true; fi
fi
say ""
say "AskCharts is running: $url"
say "It starts by itself when you log in. To update, paste the same line again."
say "To remove it: $DIR/uninstall"
command -v unzip >/dev/null 2>&1 || say "For Kraken's history (Settings, Market data), install unzip first: on Ubuntu or Debian, sudo apt install unzip"
