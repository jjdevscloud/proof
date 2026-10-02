#!/usr/bin/env bash
# Local validator with proof_vault preloaded at its real program id. Run inside WSL.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
VAULT_ID=$(solana address -k target/deploy/proof_vault-keypair.json)
exec solana-test-validator --reset --quiet --ledger /tmp/proof-localnet \
  --bpf-program "$VAULT_ID" target/deploy/proof_vault.so
