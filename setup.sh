#!/usr/bin/env bash
# Trex one-step setup and launcher for macOS and Linux.
#
#   Inside a clone:   ./setup.sh
#   From anywhere:    curl -fsSL https://raw.githubusercontent.com/mhbdev/trex/main/setup.sh | bash
#
# What it does: installs Bun if missing, downloads Trex if this is not a clone, installs
# dependencies, builds the dashboard on first run, creates the encryption key automatically,
# starts the local service, and opens the dashboard in your browser. If Trex is already
# running, it just opens the browser. Set TREX_HOME to change the install folder and
# TREX_PORT to change the port.

main() {
  set -euo pipefail

  local repo_url="https://github.com/mhbdev/trex.git"
  local archive_url="https://github.com/mhbdev/trex/archive/refs/heads/main.tar.gz"
  local install_dir="${TREX_HOME:-$HOME/trex}"
  local port="${TREX_PORT:-4173}"

  say() { printf '\n==> %s\n' "$*"; }
  fail() { printf '\nError: %s\n' "$*" >&2; exit 1; }
  have() { command -v "$1" >/dev/null 2>&1; }
  is_trex_project() { [ -f "$1/package.json" ] && grep -q '"name": "trex"' "$1/package.json"; }

  # 1. Find the project: the folder this script lives in, an existing install, or a fresh download.
  local script_dir="" project_dir=""
  if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fi
  if [ -n "$script_dir" ] && is_trex_project "$script_dir"; then
    project_dir="$script_dir"
  elif is_trex_project "$install_dir"; then
    project_dir="$install_dir"
  else
    say "Downloading Trex into $install_dir"
    if [ -e "$install_dir" ] && [ -n "$(ls -A "$install_dir" 2>/dev/null)" ]; then
      fail "$install_dir exists but is not a Trex folder. Set TREX_HOME to another folder."
    fi
    if have git; then
      git clone --depth 1 "$repo_url" "$install_dir" </dev/null
    else
      have curl || fail "git or curl is required to download Trex."
      mkdir -p "$install_dir"
      curl -fsSL "$archive_url" | tar -xz --strip-components=1 -C "$install_dir"
    fi
    project_dir="$install_dir"
  fi

  # 2. Bun runtime (https://bun.sh), installed per-user when missing.
  export PATH="$HOME/.bun/bin:$PATH"
  if ! have bun; then
    say "Installing Bun, the JavaScript runtime Trex uses"
    have curl || fail "curl is required to install Bun. Install Bun from https://bun.sh and rerun this script."
    curl -fsSL https://bun.sh/install | bash </dev/null
    export PATH="$HOME/.bun/bin:$PATH"
    have bun || fail "Bun was installed but is not on PATH yet. Open a new terminal and rerun this script."
  fi
  local version major minor
  version="$(bun --version)"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  if [ "$major" -lt 1 ] || { [ "$major" -eq 1 ] && [ "$minor" -lt 2 ]; }; then
    fail "Bun $version is too old. Run 'bun upgrade' (Trex needs 1.2 or newer) and rerun this script."
  fi

  # 3. Dependencies, then launch. The launcher builds the UI on first run and opens the browser.
  cd "$project_dir"
  say "Installing dependencies"
  bun install </dev/null
  say "Starting Trex (press Ctrl+C to stop it)"
  exec bun run --no-env-file apps/cli/src/main.ts start --port "$port"
}

main "$@"
