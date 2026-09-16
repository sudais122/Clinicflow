#!/bin/bash
BASE_URL="http://localhost:8000"
PATIENT_EMAIL="khansb17798@gmail.com"
PATIENT_PASSWORD="Patient@123"
DOCTOR_EMAIL="afaq@gmail.com"
DOCTOR_PASSWORD="Doctor@123"
DOCTOR_ID="6aaa35b1f3c78ec3d1e9de06"
APPOINTMENT_DATE="2026-09-17"
PATIENT_COOKIES="./patient_cookies.txt"
DOCTOR_COOKIES="./doctor_cookies.txt"

RUN_ID=$(date +%s)
FAILURES=0

echo "=== Step 1: Login as patient ==="
curl -s -c "$PATIENT_COOKIES" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$PATIENT_EMAIL\",\"password\":\"$PATIENT_PASSWORD\"}"
echo -e "\n"

echo "=== Step 2: Login as doctor ==="
curl -s -c "$DOCTOR_COOKIES" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DOCTOR_EMAIL\",\"password\":\"$DOCTOR_PASSWORD\"}"
echo -e "\n"

# ============================================================
# TEST A: appointmentBookLimiter — 10 requests / 15 minutes
# Fire 11 booking requests, each for a distinct patient (bookFor:
# "other" with a unique name/phone) so the unrelated
# duplicate-active-appointment rule never interferes with what
# THIS test is actually measuring — the rate limiter itself, not
# appointment business logic.
# ============================================================
echo "=== TEST A: appointmentBookLimiter (10 / 15 min) — firing 11 bookings ==="
BOOK_APPT_IDS=()
for i in $(seq 1 11); do
  N=$(printf "%02d" "$i")
  PHONE="0300-11${N}${RUN_ID: -4}"
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$PATIENT_COOKIES" -X POST "$BASE_URL/appointments/book" \
    -H "Content-Type: application/json" \
    -d "{
      \"doctorId\": \"$DOCTOR_ID\",
      \"appointmentDate\": \"${APPOINTMENT_DATE}T00:00:00.000Z\",
      \"bookFor\": \"other\",
      \"patientName\": \"RateLimit Book Test $i $RUN_ID\",
      \"patientPhone\": \"$PHONE\"
    }")
  STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

  if [ "$i" -le 10 ]; then
    EXPECT="not-429"
    if [ "$STATUS" == "429" ]; then
      echo "Booking #$i -> HTTP $STATUS !!! UNEXPECTED — should NOT be rate limited yet (limit is 10)"
      FAILURES=$((FAILURES + 1))
    else
      echo "Booking #$i -> HTTP $STATUS OK (allowed through the limiter)"
      APPT_ID=$(echo "$BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['appointment']['_id'])" 2>/dev/null)
      [ -n "$APPT_ID" ] && BOOK_APPT_IDS+=("$APPT_ID")
    fi
  else
    if [ "$STATUS" == "429" ]; then
      echo "Booking #$i -> HTTP $STATUS OK — correctly rate limited (11th request)"
    else
      echo "Booking #$i -> HTTP $STATUS !!! EXPECTED 429"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done
echo "Captured ${#BOOK_APPT_IDS[@]} appointment id(s) from successful bookings for later steps."
echo ""

# ============================================================
# TEST B: appointmentCancelLimiter — 10 requests / 15 minutes
# Reuses the appointment ids captured above. If TEST A didn't
# produce at least 11 real appointments (e.g. it was already rate
# limited from a previous run within the same 15-minute window),
# this test books a few more with bookFor:"other" to top up.
# ============================================================
echo "=== TEST B: appointmentCancelLimiter (10 / 15 min) — firing 11 cancels ==="
while [ "${#BOOK_APPT_IDS[@]}" -lt 11 ]; do
  IDX=${#BOOK_APPT_IDS[@]}
  PHONE="0301-12$(printf "%02d" "$IDX")${RUN_ID: -4}"
  RESPONSE=$(curl -s -b "$PATIENT_COOKIES" -X POST "$BASE_URL/appointments/book" \
    -H "Content-Type: application/json" \
    -d "{
      \"doctorId\": \"$DOCTOR_ID\",
      \"appointmentDate\": \"${APPOINTMENT_DATE}T00:00:00.000Z\",
      \"bookFor\": \"other\",
      \"patientName\": \"RateLimit Cancel Fill $IDX $RUN_ID\",
      \"patientPhone\": \"$PHONE\"
    }")
  TOPUP_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['appointment']['_id'])" 2>/dev/null)
  if [ -z "$TOPUP_ID" ]; then
    echo "!!! Could not top up appointments for the cancel test (likely appointmentBookLimiter still active from Test A). Waiting is required between runs — see notes at the end."
    break
  fi
  BOOK_APPT_IDS+=("$TOPUP_ID")
done

for i in $(seq 0 10); do
  APPT_ID="${BOOK_APPT_IDS[$i]}"
  N=$((i + 1))
  if [ -z "$APPT_ID" ]; then
    echo "Cancel #$N -> SKIPPED — no appointment id available"
    continue
  fi
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$PATIENT_COOKIES" -X PATCH "$BASE_URL/appointments/$APPT_ID/cancel")
  STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

  if [ "$N" -le 10 ]; then
    if [ "$STATUS" == "429" ]; then
      echo "Cancel #$N -> HTTP $STATUS !!! UNEXPECTED — should NOT be rate limited yet (limit is 10)"
      FAILURES=$((FAILURES + 1))
    else
      echo "Cancel #$N -> HTTP $STATUS OK (allowed through the limiter)"
    fi
  else
    if [ "$STATUS" == "429" ]; then
      echo "Cancel #$N -> HTTP $STATUS OK — correctly rate limited (11th request)"
    else
      echo "Cancel #$N -> HTTP $STATUS !!! EXPECTED 429"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done
echo ""

# ============================================================
# TEST C: appointmentStatusLimiter — 30 requests / 1 minute
# Fires 31 rapid PATCH status requests as the doctor against a
# single appointment. Business-rule responses (400 for an invalid
# transition, etc.) are expected and fine for most of these — this
# test only cares whether/when a 429 appears, not whether each
# individual status change succeeds.
# ============================================================
echo "=== TEST C: appointmentStatusLimiter (30 / 1 min) — firing 31 status updates ==="
STATUS_TARGET_ID="${BOOK_APPT_IDS[0]}"
if [ -z "$STATUS_TARGET_ID" ]; then
  echo "!!! No appointment id available to test the status limiter against. Skipping Test C."
else
  for i in $(seq 1 31); do
    RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$DOCTOR_COOKIES" -X PATCH "$BASE_URL/appointments/$STATUS_TARGET_ID/status" \
      -H "Content-Type: application/json" \
      -d '{"status":"in-progress"}')
    STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)

    if [ "$i" -le 30 ]; then
      if [ "$STATUS" == "429" ]; then
        echo "Status update #$i -> HTTP $STATUS !!! UNEXPECTED — should NOT be rate limited yet (limit is 30)"
        FAILURES=$((FAILURES + 1))
      else
        echo "Status update #$i -> HTTP $STATUS (allowed through the limiter; business-logic code is expected here, not an error)"
      fi
    else
      if [ "$STATUS" == "429" ]; then
        echo "Status update #$i -> HTTP $STATUS OK — correctly rate limited (31st request)"
      else
        echo "Status update #$i -> HTTP $STATUS !!! EXPECTED 429"
        FAILURES=$((FAILURES + 1))
      fi
    fi
  done
fi
echo ""

echo "=== Done. $FAILURES unexpected result(s) across all three limiter tests. ==="
echo "Notes:"
echo "- Each limiter's window (15 min for book/cancel, 1 min for status) is per-user,"
echo "  in-memory. Re-running this script inside the same window will start with the"
echo "  quota already partially consumed from the previous run — expect earlier 429s"
echo "  the second time, which is correct behavior, not a bug."
echo "- This created up to 11 real appointments and cancelled up to 11 of them."
echo "  Clean up any that remain via the doctor dashboard or direct DB access."