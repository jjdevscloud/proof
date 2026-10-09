#!/usr/bin/env bash
# Build both programs for devnet / local tests and run the Rust unit tests. Run inside WSL from the repo root.
# (proof_vault is built with feature "devnet": the devnet payer is its launch authority.)
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
anchor build -p mock_curve
anchor build -p proof_vault -- --features devnet
cargo test -p proof-vault --lib --features devnet
ls -l target/deploy/*.so
