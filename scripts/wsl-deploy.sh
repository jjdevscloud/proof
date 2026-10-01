#!/usr/bin/env bash
# Deploy both programs to devnet with the devnet payer. Run inside WSL from the repo root.
set -euo pipefail
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
PAYER=devnet/keys/payer.json
URL=${RPC_URL:-https://api.devnet.solana.com}
solana balance -k "$PAYER" -u "$URL"
for p in proof_vault mock_curve; do
  solana program deploy "target/deploy/$p.so" --program-id "target/deploy/$p-keypair.json" \
    -k "$PAYER" -u "$URL" --with-compute-unit-price 1000 --max-sign-attempts 20
done
solana balance -k "$PAYER" -u "$URL"
