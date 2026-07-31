#!/usr/bin/env bash
# Auto-deploy: if origin/main has new commits, pull them and restart the game.
# Runs as the repo owner (see bomberman-deploy.service). No-op when already up to date.
cd /var/www/bomberman || exit 0

git fetch --quiet origin main 2>/dev/null || exit 0
LOCAL=$(git rev-parse @ 2>/dev/null)
REMOTE=$(git rev-parse origin/main 2>/dev/null)
[ -z "$REMOTE" ] && exit 0
[ "$LOCAL" = "$REMOTE" ] && exit 0        # nothing new -> do nothing

echo "auto-deploy: ${LOCAL:0:7} -> ${REMOTE:0:7}"
git pull --ff-only --quiet origin main || { echo "pull failed"; exit 1; }
npm install --omit=dev --no-audit --no-fund --silent || { echo "npm install failed"; exit 1; }
sudo systemctl restart bomberman
echo "auto-deploy: restarted"
