#!/usr/bin/env bash
# Generates development RSA key pairs for the BoT integration, into ./secrets/.
#
#   tcb-bot-private.pem / tcb-bot-public.pem   TCB's pair. bot-gateway signs requests with
#                                              the private key; the simulator verifies them
#                                              with the public key.
#   bot-sim-private.pem / bot-public.pem       The simulator's pair, standing in for BoT's.
#                                              The simulator signs callbacks; bot-gateway
#                                              verifies them with bot-public.pem.
#
# secrets/ is gitignored. These keys are for local development only. For the BoT sandbox,
# TCB's public key is exchanged with BoT at onboarding; in production the private key
# lives in the HSM (TAD §10.1).
set -euo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)/secrets"
mkdir -p "$dir"
chmod 700 "$dir"

make_pair() {
  local private="$dir/$1" public="$dir/$2"
  if [[ -f "$private" ]]; then
    echo "exists: $private (delete it to regenerate)"
    return
  fi
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private" 2>/dev/null
  openssl pkey -in "$private" -pubout -out "$public"
  chmod 600 "$private"
  echo "created: $private"
}

make_pair tcb-bot-private.pem tcb-bot-public.pem
make_pair bot-sim-private.pem bot-public.pem
