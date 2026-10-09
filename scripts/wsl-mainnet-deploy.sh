#!/usr/bin/env bash
# Pre-launch: build proof_vault for mainnet (launch authority = the deployer wallet), deploy it, and
# hand upgrade authority to the Squads vault. The program does not depend on the mint, so this runs
# before the token exists. Run inside WSL from the repo root:
#   bash scripts/wsl-mainnet-deploy.sh <SQUADS_VAULT>
set -euo pipefail
SQUADS_VAULT=${1:?usage: wsl-mainnet-deploy.sh <SQUADS_VAULT>}
. "$HOME/.cargo/env"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd "$(dirname "$0")/.."
RPC_URL=$(sed -n 's/^RPC_URL=//p' .env.mainnet)
DEPLOYER=/mnt/c/Users/Admin/sequents-keys/deployer.json
PROGRAM_KEY=target/deploy/proof_vault-keypair.json

# 1. Mainnet build: no "devnet" feature, so the launch authority is the deployer wallet.
anchor build -p proof_vault
cargo test -p proof-vault --lib

# 2. Deploy (the deployer pays rent, ~1.61 SOL).
solana balance -k "$DEPLOYER" -u "$RPC_URL"
solana program deploy target/deploy/proof_vault.so --program-id "$PROGRAM_KEY" \
  -k "$DEPLOYER" -u "$RPC_URL" --with-compute-unit-price 20000 --max-sign-attempts 30

# 3. Hand upgrade authority to the Squads vault (a PDA, so it cannot co-sign).
PROGRAM_ID=$(solana address -k "$PROGRAM_KEY")
solana program set-upgrade-authority "$PROGRAM_ID" --new-upgrade-authority "$SQUADS_VAULT" \
  --skip-new-upgrade-authority-signer-check -k "$DEPLOYER" -u "$RPC_URL"
solana program show "$PROGRAM_ID" -u "$RPC_URL"
echo "program: $PROGRAM_ID"
