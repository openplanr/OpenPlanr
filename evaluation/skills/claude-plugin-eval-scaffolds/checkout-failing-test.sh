#!/usr/bin/env bash
# A small checkout service whose test fails because discounts are applied after tax.
set -euo pipefail

export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-01-05T09:00:00Z GIT_COMMITTER_DATE=2026-01-05T09:00:00Z

mkdir -p src test
cat > package.json <<'EOF'
{
  "name": "shop-checkout",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
EOF
cat > src/checkout.js <<'EOF'
export const TAX_RATE = 0.2;

export function checkoutTotal(items, discount = 0) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const taxed = subtotal * (1 + TAX_RATE);
  return Math.round((taxed - discount) * 100) / 100;
}
EOF
cat > test/checkout.test.js <<'EOF'
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutTotal } from '../src/checkout.js';

test('a discount is applied before tax', () => {
  assert.equal(checkoutTotal([{ price: 50, quantity: 2 }], 10), 108);
});
EOF
cat > CHECKOUT-FAILURE.md <<'EOF'
# Checkout failure

`npm test` fails on main since the last pricing change:

    not ok 1 - a discount is applied before tax
      expected: 108
      actual: 110

Customers report checkout totals that are 2 units too high when a discount code is used.
EOF

git init -q -b main
git add .
git commit -q -m "feat: apply discount codes at checkout"
