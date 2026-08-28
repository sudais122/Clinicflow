#!/bin/bash
# Seeds appointments for a Free-plan doctor to just under the daily
# limit (24 of 25), so you can do the LAST two bookings by hand in
# the actual patient dashboard UI and see both:
#   - booking #25 succeed normally
#   - booking #26 get blocked with the queue-full modal
#
# ADJUST before running:
#   - BASE_URL
#   - PATIENT_EMAIL / PATIENT_PASSWORD — any real patient account
#   - DOCTOR_ID — Mongo _id of a Free-plan doctor (mongosh:
#       db.subscriptions.findOne({ plan: "free" })  -> use its `doctor` field)
#   - APPOINTMENT_DATE — the exact date you'll pick in the UI wizard
#     too (YYYY-MM-DD). Must match, since the limit is scoped per day.

BASE_URL="http://localhost:8000"
PATIENT_EMAIL="m.safeer@gmail.com"                 # ADJUST
PATIENT_PASSWORD="Patient@123"                      # ADJUST
DOCTOR_ID="6a910f84470bfcb673029f24"   # ADJUST
APPOINTMENT_DATE="2026-08-28"                        # ADJUST — same date you'll test in the UI
COOKIE_JAR="./patient_cookies.txt"
SEED_COUNT=24   # leaves exactly 1 slot for you to fill by hand in the UI

echo "=== Login as patient ==="
curl -s -c "$COOKIE_JAR" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$PATIENT_EMAIL\",\"password\":\"$PATIENT_PASSWORD\"}"
echo -e "\n"

for i in $(seq 1 $SEED_COUNT); do
  PHONE=$(printf "0300-%07d" "$i")
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$COOKIE_JAR" -X POST "$BASE_URL/appointments/book" \
    -H "Content-Type: application/json" \
    -d "{
      \"doctorId\": \"$DOCTOR_ID\",
      \"appointmentDate\": \"${APPOINTMENT_DATE}T00:00:00.000Z\",
      \"bookFor\": \"other\",
      \"patientName\": \"Seed Patient $i\",
      \"patientPhone\": \"$PHONE\"
    }")
  STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
  echo "Seed booking #$i -> HTTP $STATUS"
  if [ "$STATUS" != "201" ]; then
    echo "  !!! Stopped early — unexpected status. Body:"
    echo "$RESPONSE" | sed '/HTTP_STATUS/d'
    break
  fi
done

echo -e "\n=== Seeding done. This doctor now has $SEED_COUNT appointments on $APPOINTMENT_DATE. ==="
echo "Now go test in the actual patient dashboard UI:"
echo "  1. Book appointment #25 for this same doctor + date -> should succeed normally."
echo "  2. Immediately book #26 for the same doctor + date -> should show the queue-full modal"
echo "     with 'Change Date' / 'Choose Another Doctor' buttons, not a generic 'Booking failed' toast."