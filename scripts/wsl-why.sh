#!/usr/bin/env bash
. "$HOME/.cargo/env"
cd /mnt/c/git/rarity
cargo +stable tree -i "$1" --target all -e normal,build 2>&1 | head -25
