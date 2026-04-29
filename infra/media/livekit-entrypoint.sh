#!/bin/sh

set -eu

turn_tls_port="${LIVEKIT_TURN_TLS_PORT:-}"
turn_domain="${LIVEKIT_TURN_DOMAIN:-}"
turn_external_tls="${LIVEKIT_TURN_EXTERNAL_TLS:-false}"
turn_cert="${LIVEKIT_TURN_CERT:-}"
turn_key="${LIVEKIT_TURN_KEY:-}"

if [ -n "$turn_domain" ] && [ -z "$turn_tls_port" ]; then
  turn_tls_port="5349"
fi

if [ -n "$turn_tls_port" ] && [ -z "$turn_domain" ]; then
  echo "LIVEKIT_TURN_DOMAIN must be set when LIVEKIT_TURN_TLS_PORT is enabled." >&2
  exit 1
fi

if [ -n "$turn_tls_port" ] && [ "$turn_external_tls" != "true" ] && { [ -z "$turn_cert" ] || [ -z "$turn_key" ]; }; then
  echo "LIVEKIT_TURN_CERT and LIVEKIT_TURN_KEY must be set when TURN/TLS is enabled without LIVEKIT_TURN_EXTERNAL_TLS=true." >&2
  exit 1
fi

awk \
  -v turn_tls_port="$turn_tls_port" \
  -v turn_domain="$turn_domain" \
  -v turn_external_tls="$turn_external_tls" \
  -v turn_cert="$turn_cert" \
  -v turn_key="$turn_key" '
  {
    print

    if ($1 == "udp_port:") {
      if (turn_tls_port != "") {
        print "  tls_port: " turn_tls_port
      }

      if (turn_domain != "") {
        print "  domain: \"" turn_domain "\""
      }

      if (turn_external_tls == "true") {
        print "  external_tls: true"
      }

      if (turn_cert != "") {
        print "  cert_file: \"" turn_cert "\""
      }

      if (turn_key != "") {
        print "  key_file: \"" turn_key "\""
      }
    }
  }
' /etc/livekit-base.yaml > /tmp/livekit.yaml

exec /livekit-server --config /tmp/livekit.yaml --node-ip "${LIVEKIT_NODE_IP:-poker.poker.dev}"