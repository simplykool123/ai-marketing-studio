#!/usr/bin/env bash
# setup-local.sh
# Run this ONCE before `pnpm install` on macOS or Windows.
# It removes the Linux-only esbuild/platform overrides from pnpm-workspace.yaml
# so that pnpm can install the correct native binaries for your OS.

set -e

WORKSPACE="$(dirname "$0")/../pnpm-workspace.yaml"
BACKUP="${WORKSPACE}.bak"

if grep -q "overrides:" "$WORKSPACE"; then
  cp "$WORKSPACE" "$BACKUP"
  # Strip everything from the overrides: section to end of file
  awk '/^overrides:/{found=1} !found{print}' "$WORKSPACE" > "${WORKSPACE}.tmp"
  mv "${WORKSPACE}.tmp" "$WORKSPACE"
  echo "✓ Removed Linux-only overrides from pnpm-workspace.yaml"
  echo "  (backup saved to pnpm-workspace.yaml.bak)"
else
  echo "✓ No overrides found — nothing to remove"
fi

echo ""
echo "Now run: pnpm install"
