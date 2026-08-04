#!/bin/sh
# Provisions the two shielded identities this service acts as, then starts the seller.
#
# Privacy keys are DERIVED from a signature over a fixed message, so re-running onboarding in a
# fresh container reproduces the same note keys for the same Stellar secret. That is what makes
# this safe to run on every boot: the seller's payment address is stable across restarts and
# redeploys, and its existing on-chain registration still applies.
set -eu

: "${SPP_SELLER_SECRET:?set SPP_SELLER_SECRET (S...) on this service}"
: "${SPP_BUYER_SECRET:?set SPP_BUYER_SECRET (S...) on this service}"

SELLER_ALIAS="${SPP_SELLER_ACCOUNT:-spp-seller}"
BUYER_ALIAS="${SPP_BUYER_ACCOUNT:-spp-buyer}"

mkdir -p "${SPP_DATA_DIR:-/data/spp}"

# Write the identity TOML directly. `stellar keys add --secret-key` reads the key from a TTY
# (it fails with "secret input error" on a pipe), so there is no non-interactive CLI path — but
# a file containing `secret_key = "S..."` resolves identically, verified against v23. The secret
# never appears in argv (readable via /proc) or in any log line.
import_key() {
  alias="$1"
  # Strip surrounding whitespace: a secret piped into `railway variable set --stdin` keeps the
  # producing command's trailing newline, and an embedded newline makes the TOML below
  # syntactically valid but semantically junk — which surfaces only as "the strkey is invalid".
  secret=$(printf '%s' "$2" | tr -d '[:space:]')
  identity_dir="$HOME/.config/stellar/identity"
  if stellar keys address "$alias" >/dev/null 2>&1; then
    echo "identity $alias already present"
    return
  fi
  mkdir -p "$identity_dir"
  ( umask 077; printf 'secret_key = "%s"\n' "$secret" > "$identity_dir/$alias.toml" )
  if ! address=$(stellar keys address "$alias" 2>&1); then
    # Diagnostics only — never the value. A bad secret and a HOME/config-dir mismatch produce
    # the same symptom, and these three facts separate them without leaking anything.
    echo "identity $alias did not resolve" >&2
    echo "  secret length: ${#secret} (expected 56), first char: $(printf '%.1s' "$secret")" >&2
    echo "  identity dir:  $identity_dir (HOME=$HOME)" >&2
    echo "  cli said:      $address" >&2
    exit 1
  fi
  echo "identity $alias imported ($(printf '%.6s' "$address")…)"
}

import_key "$SELLER_ALIAS" "$SPP_SELLER_SECRET"
import_key "$BUYER_ALIAS" "$SPP_BUYER_SECRET"

# `--no-register` because both accounts are already registered in the on-chain public-key
# registry; re-registering costs a transaction and would fail the boot if the account were
# short of XLM. Onboarding still derives the privacy keys, which is what we actually need.
for alias in "$SELLER_ALIAS" "$BUYER_ALIAS"; do
  spp onboard \
    --account "$alias" \
    --accept \
    --no-register \
    --no-bootnode \
    --deployment "$SPP_DEPLOYMENT" \
    --circuits-dir "$SPP_CIRCUITS_DIR" \
    --data-dir "$SPP_DATA_DIR" \
    >/dev/null 2>&1 </dev/null || {
      echo "onboarding failed for $alias" >&2
      exit 1
    }
  echo "privacy keys derived for $alias"
done

exec pnpm --filter @stellarpay-examples/private-api start
