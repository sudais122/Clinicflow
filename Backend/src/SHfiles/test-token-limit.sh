#!/bin/bash
# Tests enforceDailyTokenLimit end-to-end against the real limit (30).
#
# ADJUST before running:
#   - BASE_URL
#   - PATIENT_EMAIL / PATIENT_PASSWORD — a real, already-registered
#     patient account (any patient works; bookFor:"other" is used
#     below so it's not tied to this patient's own name/phone)
#   - DOCTOR_ID — the Mongo _id of a doctor whose Subscription is
#     "free" (or paid+expired/cancelled) — get this via mongosh:
#       db.subscriptions.findOne({ plan: "free" })
#     and use its `doctor` field. The admin dashboard's Subscriptions
#     table only shows the human-readable doctorId code, not this —
#     mongosh is the fastest way to grab the real _id.
#
# What happens: logs in once, then books LIMIT+1 appointments with
# that doctor, each as a different fake "other" patient so the
# existing-active-appointment check never blocks any of them.
# Bookings 1..LIMIT should return 201; booking LIMIT+1 should return
# 403 with the "Free plan is limited to..." message.

BASE_URL="http://localhost:8000"
PATIENT_EMAIL="ayesha.khan@example.com"                # ADJUST
PATIENT_PASSWORD="Patient@123"                     # ADJUST
DOCTOR_ID="6a87de1d3d680274c9c683ac"  # ADJUST
COOKIE_JAR="./patient_cookies.txt"
LIMIT=30

echo "=== Step 0: Login as patient ==="
curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$PATIENT_EMAIL\",\"password\":\"$PATIENT_PASSWORD\"}"
echo -e "\n"

TOTAL=$((LIMIT + 1))
FAILURES=0

for i in $(seq 1 $TOTAL); do
  PHONE=$(printf "0300-%07d" "$i")
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$COOKIE_JAR" -X POST "$BASE_URL/appointments/book" \
    -H "Content-Type: application/json" \
    -d "{
      \"doctorId\": \"$DOCTOR_ID\",
      \"bookFor\": \"other\",
      \"patientName\": \"Test Patient $i\",
      \"patientPhone\": \"$PHONE\"
    }")
  STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

  echo "Booking #$i -> HTTP $STATUS"

  if [ "$i" -le "$LIMIT" ] && [ "$STATUS" != "201" ]; then
    echo "  !!! UNEXPECTED — should have succeeded (201). Body: $BODY"
    FAILURES=$((FAILURES + 1))
  fi
  if [ "$i" -gt "$LIMIT" ]; then
    if [ "$STATUS" == "403" ]; then
      echo "  OK — blocked as expected. Message: $(echo "$BODY" | grep -o '"message":"[^"]*"')"
    else
      echo "  !!! UNEXPECTED — should have been blocked (403), got $STATUS. Body: $BODY"
      FAILURES=$((FAILURES + 1))
    fi
  fi
done

echo -e "\n=== Done. $FAILURES unexpected result(s) out of $TOTAL bookings. ==="
echo "Cleanup note: this created $LIMIT real Appointment documents for"
echo "that doctor today. Cancel them via the doctor dashboard, or run"
echo "the doctor's 'Reset Queue' action, or delete them directly in"
echo "the DB if this was a throwaway test doctor."