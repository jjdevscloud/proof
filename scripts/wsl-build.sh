#!/usr/bin/env bash
# Build both programs and run the Rust unit tests. Run inside WSL from the repo root.
set -euo pipefail
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
anchor keys sync
# Solana's platform tools bundle an older Cargo; resolve dependencies to versions it can build.
if [ ! -f Cargo.lock ]; then
  CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS=fallback cargo +stable generate-lockfile
  # Newer blake3 pulls digest 0.11 (edition 2024), which platform tools cannot parse.
  cargo +stable update -p blake3 --precise 1.5.5
fi
anchor build
cargo test -p proof-vault --lib
ls -l target/deploy/*.so
