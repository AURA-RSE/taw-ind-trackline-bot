#!/bin/bash
# Usage (macOS): bash <(curl -fsSL https://raw.githubusercontent.com/AURA-RSE/taw-ind-trackline-bot/main/scripts/setup-mac.sh)
# P4 TrackLine Bot: deploys to Vercel, sets env vars, connects Vapi, runs smoke tests.
# Secrets are typed here (hidden) and go only to Vercel/Vapi and p4 .env on this Mac.
set -u
NODEBIN="$HOME/Downloads/p3-triage/local-n8n/tools/node/bin"; [ -x "$NODEBIN/node" ] && export PATH="$NODEBIN:$PATH"
node -v >/dev/null 2>&1 || { echo "Node not found."; exit 1; }
DIR="$HOME/Documents/taw-ind-trackline-bot"
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q origin && git -C "$DIR" checkout -q feature/trackline-bot && git -C "$DIR" pull -q; else gh repo clone AURA-RSE/taw-ind-trackline-bot "$DIR" -- -q -b feature/trackline-bot || exit 1; fi
cd "$DIR" || exit 1
umask 077
if [ ! -f .env ]; then
  printf "WhatsApp via [T]wilio sandbox or [M]eta Cloud API? (T/M) [T]: "; read -r MODE; MODE=${MODE:-T}
  PNID=""; WTOK=""; ASEC=""; TSID=""; TTOK=""
  if [ "$MODE" = "M" ] || [ "$MODE" = "m" ]; then
    echo "== From developers.facebook.com > your app > WhatsApp > API Setup"
    printf "Phone number ID: "; read -r PNID
    printf "Access token (hidden): "; read -rs WTOK; echo
    printf "App secret, from App settings > Basic (hidden, Enter to skip): "; read -rs ASEC; echo
  else
    echo "== From console.twilio.com > Account Info (home page)"
    printf "Account SID (starts with AC): "; read -r TSID
    printf "Auth Token (hidden): "; read -rs TTOK; echo
  fi
  printf "Your WhatsApp number for ops alerts/voice transfer [+2347040387324]: "; read -r OPS; OPS=${OPS:-+2347040387324}; OPS=$(echo "$OPS" | tr -d ' -()')
  VKEY=$(grep '^VAPI_API_KEY=' "$HOME/Downloads/p3-triage/.env" 2>/dev/null | cut -d= -f2-)
  [ -z "$VKEY" ] && { printf "Vapi private key (hidden): "; read -rs VKEY; echo; }
  cat > .env <<ENV
WHATSAPP_TOKEN=$WTOK
WHATSAPP_PHONE_NUMBER_ID=$PNID
WHATSAPP_VERIFY_TOKEN=$(openssl rand -hex 16)
WHATSAPP_APP_SECRET=$ASEC
GRAPH_API_VERSION=v21.0
OPS_WHATSAPP_NUMBER=${OPS#+}
VAPI_API_KEY=$VKEY
VAPI_SHARED_SECRET=$(openssl rand -hex 24)
OPENAI_MODEL=gpt-4o-mini
OPS_PHONE_NUMBER=$OPS
TIMEZONE=Africa/Lagos
VAPI_SERVER_URL=pending
TWILIO_ACCOUNT_SID=$TSID
TWILIO_AUTH_TOKEN=$TTOK
TWILIO_WHATSAPP_FROM=+14155238886
PUBLIC_BASE_URL=https://taw-ind-trackline-bot.vercel.app
ENV
fi
get() { grep "^$1=" .env | cut -d= -f2-; }

echo "== Vercel: a browser window opens to log in (choose Continue with GitHub)"
npx --yes vercel@latest whoami >/dev/null 2>&1 || npx --yes vercel@latest login || exit 1
npx --yes vercel@latest link --yes --project taw-ind-trackline-bot >/dev/null || exit 1
for k in WHATSAPP_TOKEN WHATSAPP_PHONE_NUMBER_ID WHATSAPP_VERIFY_TOKEN WHATSAPP_APP_SECRET GRAPH_API_VERSION OPS_WHATSAPP_NUMBER VAPI_SHARED_SECRET TIMEZONE PUBLIC_BASE_URL TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_FROM; do
  v=$(get $k); [ -z "$v" ] && continue
  npx --yes vercel@latest env rm $k production -y >/dev/null 2>&1
  printf '%s' "$v" | npx --yes vercel@latest env add $k production >/dev/null 2>&1 && echo "   set $k"
done
echo "== Deploying to production ..."
OUT=$(npx --yes vercel@latest deploy --prod --yes 2>&1); echo "$OUT" | tail -4
URL=$(echo "$OUT" | grep -Eo 'https://[a-z0-9-]+\.vercel\.app' | grep -v -- '-[a-z0-9]\{9\}-' | tail -1)
[ -z "$URL" ] && URL="https://taw-ind-trackline-bot.vercel.app"
sed -i '' "s#^VAPI_SERVER_URL=.*#VAPI_SERVER_URL=$URL/api/vapi#" .env
if [ "$URL" != "$(get PUBLIC_BASE_URL)" ]; then
  sed -i '' "s#^PUBLIC_BASE_URL=.*#PUBLIC_BASE_URL=$URL#" .env
  npx --yes vercel@latest env rm PUBLIC_BASE_URL production -y >/dev/null 2>&1; printf '%s' "$URL" | npx --yes vercel@latest env add PUBLIC_BASE_URL production >/dev/null 2>&1
  npx --yes vercel@latest deploy --prod --yes >/dev/null 2>&1
fi

echo "== Vapi assistant"
node scripts/setup-vapi.js

echo
echo "================ P4 RESULTS (copy everything from here) ================"
echo "Live URL: $URL"
echo "health: $(curl -s -m 20 $URL/api/health)"
echo "track:  $(curl -s -m 20 "$URL/api/track?id=TL20481741" | cut -c1-160)"
echo "verify: $(curl -s -m 20 "$URL/api/whatsapp?hub.mode=subscribe&hub.verify_token=$(get WHATSAPP_VERIFY_TOKEN)&hub.challenge=OK123")"
echo "vapi:   $(curl -s -m 20 -X POST $URL/api/vapi -H "x-vapi-secret: $(get VAPI_SHARED_SECRET)" -H 'content-type: application/json' --data @sample-data/vapi-lookup.json | cut -c1-160)"
echo "========================================================================="
echo
if [ -n "$(get TWILIO_ACCOUNT_SID)" ]; then
echo "NOW IN TWILIO (Messaging > Try it out > Send a WhatsApp message > Sandbox settings):"
echo "  When a message comes in:  $URL/api/twilio-whatsapp   (Method: POST)  then Save"
else
echo "NOW IN META (WhatsApp > Configuration > Webhook > Edit):"
echo "  Callback URL:  $URL/api/whatsapp"
echo "  Verify token:  $(get WHATSAPP_VERIFY_TOKEN)"
echo "  Then click Verify and save, and under Webhook fields subscribe to: messages"
fi
