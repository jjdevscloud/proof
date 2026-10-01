#!/usr/bin/env bash
# One-time toolchain setup inside WSL Ubuntu: Solana (Agave) CLI + Anchor.
# Assumes build-essential, pkg-config, libudev-dev, libssl-dev and rustup are installed.
set -euo pipefail

SOLANA_VERSION=v2.1.21
ANCHOR_VERSION=0.31.1

. "$HOME/.cargo/env"

if ! command -v solana >/dev/null 2>&1; then
  sh -c "$(curl -sSfL https://release.anza.xyz/${SOLANA_VERSION}/install)"
fi
SOLANA_BIN="$HOME/.local/share/solana/install/active_release/bin"
grep -q active_release "$HOME/.bashrc" || echo "export PATH=\"$SOLANA_BIN:\$PATH\"" >> "$HOME/.bashrc"
export PATH="$SOLANA_BIN:$PATH"
solana --version

if ! command -v avm >/dev/null 2>&1; then
  cargo install --git https://github.com/coral-xyz/anchor avm --tag "v${ANCHOR_VERSION}" --locked
fi
avm install "$ANCHOR_VERSION"
avm use "$ANCHOR_VERSION"
anchor --version
