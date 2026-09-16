#!/bin/bash
BASE_URL="http://localhost:8000"
DOCTOR_EMAIL="afaq@gmail.com"
DOCTOR_PASSWORD="Doctor@123"
DOCTOR_ID="6aaa35b1f3c78ec3d1e9de06"
DOCTOR_COOKIES="./doctor_cookies.txt"

FAILURES=0

echo "=== Step 1: Login as doctor ==="
curl -s -c "$DOCTOR_COOKIES" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DOCTOR_EMAIL\",\"password\":\"$DOCTOR_PASSWORD\"}"
echo -e "\n"

# ============================================================
# TEST: queueLimiter — 60 requests / 1 minute
# GET /queue/:doctorId is read-only, so hammering it 61 times has
# no side effects on real queue state — unlike /queue/next or
# /queue/reset, which would actually mutate the queue each call.
# ============================================================
echo "=== TEST: queueLimiter (60 / 1 min) — firing 61 GET /queue/:doctorId requests ==="
for i in $(seq 1 61); do
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$DOCTOR_COOKIES" "$BASE_URL/queue/$DOCTOR_ID")
  STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

  if [ "$i" -le 60 ]; then
    if [ "$STATUS" == "429" ]; then
      echo "Request #$i -> HTTP $STATUS !!! UNEXPECTED — should NOT be rate limited yet (limit is 60)"
      FAILURES=$((FAILURES + 1))
    else
      # Only print every 10th to keep output readable — all 60 are
      # still checked above, just not all echoed individually.
      if [ $((i % 10)) -eq 0 ] || [ "$i" -eq 1 ]; then
        echo "Request #$i -> HTTP $STATUS OK (allowed through the limiter)"
      fi
    fi
  else
    if [ "$STATUS" == "429" ]; then
      echo "Request #$i -> HTTP $STATUS OK — correctly rate limited (61st request)"
    else
      echo "Request #$i -> HTTP $STATUS !!! EXPECTED 429"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done

echo ""
echo "=== Done. $FAILURES unexpected result(s). ==="
echo "Note: this limiter's 1-minute window is per-user and in-memory."
echo "Re-running within the same minute will start with quota already"
echo "partially used — expect an earlier 429 the second time, which is"
echo "correct behavior, not a bug. Wait ~60 seconds or restart the"
echo "server for a clean re-test."