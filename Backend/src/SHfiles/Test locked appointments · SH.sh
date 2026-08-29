BASE_URL="http://localhost:8000"
PATIENT_EMAIL="sudais@gmail.com"                 # ADJUST
PATIENT_PASSWORD="Patient@123"                       # ADJUST
DOCTOR_EMAIL="test1@gmail.com"                     # ADJUST
DOCTOR_PASSWORD="Doctor@123"                        # ADJUST
DOCTOR_ID="6a927024329273fb37f41c01"      # ADJUST
APPOINTMENT_DATE="2026-08-29"                         # ADJUST
PATIENT_COOKIES="./patient_cookies.txt"
DOCTOR_COOKIES="./doctor_cookies.txt"
LIMIT=25
TOTAL=$((LIMIT + 1))  # book one past the limit

echo "=== Step 1: Login as patient ==="
curl -s -c "$PATIENT_COOKIES" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$PATIENT_EMAIL\",\"password\":\"$PATIENT_PASSWORD\"}"
echo -e "\n"

echo "=== Step 2: Book $TOTAL appointments — every one should return 201 ==="
FAILURES=0
for i in $(seq 1 $TOTAL); do
  PHONE=$(printf "0300-%07d" "$i")
  RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$PATIENT_COOKIES" -X POST "$BASE_URL/appointments/book" \
    -H "Content-Type: application/json" \
    -d "{
      \"doctorId\": \"$DOCTOR_ID\",
      \"appointmentDate\": \"${APPOINTMENT_DATE}T00:00:00.000Z\",
      \"bookFor\": \"other\",
      \"patientName\": \"Sample Patient $i\",
      \"patientPhone\": \"$PHONE\"
    }")
  STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
  echo "Booking #$i -> HTTP $STATUS $([ "$STATUS" == "201" ] && echo "OK" || echo "!!! EXPECTED 201")"
  if [ "$STATUS" != "201" ]; then
    FAILURES=$((FAILURES + 1))
    echo "$RESPONSE" | sed '/HTTP_STATUS/d'
  fi
done

echo -e "\n=== Step 3: Login as the doctor ==="
curl -s -c "$DOCTOR_COOKIES" -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DOCTOR_EMAIL\",\"password\":\"$DOCTOR_PASSWORD\"}"
echo -e "\n"

echo "=== Step 4: Check appointment #$LIMIT is unlocked, #$TOTAL is locked ==="
DOCTOR_APPTS=$(curl -s -b "$DOCTOR_COOKIES" "$BASE_URL/appointments/doctor?date=${APPOINTMENT_DATE}")
echo "$DOCTOR_APPTS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
appts = data.get('data', [])
for a in appts:
    tok = a.get('tokenNumber')
    locked = a.get('locked')
    has_name = 'patientName' in a
    if tok in [$LIMIT, $TOTAL]:
        print(f'Token #{tok}: locked={locked}, patientName present={has_name}')
" 2>/dev/null || echo "$DOCTOR_APPTS"

echo -e "\n=== Step 5: Open the clinic and serve up to the limit ==="
curl -s -b "$DOCTOR_COOKIES" -X PATCH "$BASE_URL/queue/start" > /dev/null
for i in $(seq 1 $LIMIT); do
  curl -s -b "$DOCTOR_COOKIES" -X PATCH "$BASE_URL/queue/next" > /dev/null
done
echo "Served through token #$LIMIT."

echo -e "\n=== Step 6: Try to serve token #$TOTAL — should be 403 ==="
RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -b "$DOCTOR_COOKIES" -X PATCH "$BASE_URL/queue/next")
STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
echo "Serve token #$TOTAL -> HTTP $STATUS $([ "$STATUS" == "403" ] && echo "OK — correctly blocked" || echo "!!! EXPECTED 403")"
echo "$RESPONSE" | sed '/HTTP_STATUS/d'

echo -e "\n=== Done. $FAILURES unexpected booking result(s). ==="
echo "Cleanup: this created $TOTAL real appointments and advanced this"
echo "doctor's queue by $LIMIT tokens. Use Reset Queue in the doctor"
echo "dashboard, or delete the test data directly, when finished."