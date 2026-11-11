#!/usr/bin/env bash
# A repository holding one completed OpenPlanr design for a checkout flow.
set -euo pipefail

export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid
export GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid
export GIT_AUTHOR_DATE=2026-01-05T09:00:00Z GIT_COMMITTER_DATE=2026-01-05T09:00:00Z

mkdir -p design/checkout/.design design/checkout/screens
cat > design/checkout/spec.md <<'EOF'
# Checkout design specification

Status: Complete

A two-step checkout for returning customers: review the cart, then pay with a
saved card. The design targets 375 px and 1280 px frames.
EOF
cat > design/checkout/design-document.json <<'EOF'
{
  "kind": "openplanr-design-document",
  "title": "Checkout",
  "status": "complete",
  "specification": "spec.md",
  "screens": [
    { "id": "cart-review", "title": "Review cart", "source": "screens/cart-review.html" },
    { "id": "payment", "title": "Pay with a saved card", "source": "screens/payment.html" }
  ]
}
EOF
cat > design/checkout/screens/cart-review.html <<'EOF'
<main><h1>Review your cart</h1><ul><li>Desk lamp · 1 · €48</li></ul><button>Continue to payment</button></main>
EOF
cat > design/checkout/screens/payment.html <<'EOF'
<main><h1>Payment</h1><p>Visa ending 4242</p><button>Pay €48</button></main>
EOF
cat > design/checkout/.design/studio-state.json <<'EOF'
{ "selectedVariant": "a", "pins": [], "ratings": { "cart-review": 4, "payment": 3 } }
EOF

git init -q -b main
git add .
git commit -q -m "design: complete the checkout design"
