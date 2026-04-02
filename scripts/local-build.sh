#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "=== Reins Local Build ==="
echo ""

# 1. Install dependencies
echo "  [1/4] Installing dependencies..."
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
echo "  ✓ Dependencies installed"

# 2. Type check
echo "  [2/4] Type checking..."
pnpm typecheck
echo "  ✓ Type check passed"

# 3. Build
echo "  [3/4] Building..."
pnpm build
echo "  ✓ Build completed → dist/"

# 4. Link globally
echo "  [4/4] Linking globally..."
pnpm link --global 2>/dev/null || npm link 2>/dev/null
echo "  ✓ Linked: 'reins' command available globally"

echo ""
echo "=== Done ==="
echo ""
echo "  Verify:"
echo "    reins --version"
echo "    reins --help"
echo ""
echo "  Usage:"
echo "    cd your-project"
echo "    reins init              # scan + generate constraints + hooks"
echo "    reins status            # view constraint summary"
echo "    reins gate context      # test gate context (internal)"
echo ""
echo "  Dev mode (no build needed):"
echo "    pnpm dev -- init        # run directly via tsx"
echo "    pnpm dev -- status"
