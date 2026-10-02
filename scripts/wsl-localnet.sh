#!/usr/bin/env bash
# Local validator with proof_vault and mock_curve preloaded at their real program ids. Run inside WSL.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
VAULT_ID=$(solana address -k target/deploy/proof_vault-keypair.json)
CURVE_ID=$(solana address -k target/deploy/mock_curve-keypair.json)
exec solana-test-validator --reset --quiet --ledger /tmp/proof-localnet \
  --bpf-program "$VAULT_ID" target/deploy/proof_vault.so \
  --bpf-program "$CURVE_ID" target/deploy/mock_curve.so
