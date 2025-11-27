#!/bin/bash

# STOP IF ANYTHING FAILS
set -e

# --- CONFIG ---
REMOTE_REPO="https://github.com/maxmcdevitt1/chessanalysis.git"
BRANCH="main"

# --- SCRIPT ---
echo "Preparing temporary git repo…"
git init .

echo "Adding files…"
git add .

echo "Creating commit…"
git commit -m "Upload full project (overwrite remote)"

echo "Setting remote…"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE_REPO"

echo "Force-pushing…"
git push -u origin "$BRANCH" --force

echo "Done. Remote repo overwritten successfully."

