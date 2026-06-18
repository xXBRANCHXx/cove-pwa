#!/bin/bash
BASE="http://127.0.0.1:8090/api"

# Get auth token
TOKEN=$(curl -s -X POST "$BASE/admins/auth-with-password" \
  -H "Content-Type: application/json" \
  -d '{"identity":"admin@cove.local","password":"Admin123456!"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not authenticate. Trying superuser endpoint..."
  TOKEN=$(curl -s -X POST "$BASE/collections/_superusers/auth-with-password" \
    -H "Content-Type: application/json" \
    -d '{"identity":"admin@cove.local","password":"Admin123456!"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
fi

if [ -z "$TOKEN" ]; then
  echo "ERROR: Could not get auth token"
  exit 1
fi

echo "✅ Authenticated. Creating collections..."

AUTH="Authorization: Bearer $TOKEN"
CT="Content-Type: application/json"

# 1. Update existing users collection - add custom fields
echo "Updating users collection..."
# First get the users collection ID
USERS_ID=$(curl -s "$BASE/collections/users" -H "$AUTH" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$USERS_ID" ]; then
  curl -s -X PATCH "$BASE/collections/$USERS_ID" -H "$AUTH" -H "$CT" -d '{
    "fields": [
      {"name":"name","type":"text","required":false},
      {"name":"photoURL","type":"text","required":false},
      {"name":"publicKey","type":"text","required":false},
      {"name":"privateKeySecure","type":"text","required":false},
      {"name":"blocked","type":"json","required":false}
    ]
  }' > /dev/null && echo "  ✅ users updated" || echo "  ⚠️ users update failed (may need manual field addition)"
fi

# 2. contacts
echo "Creating contacts..."
curl -s -X POST "$BASE/collections" -H "$AUTH" -H "$CT" -d '{
  "name": "contacts",
  "type": "base",
  "fields": [
    {"name":"participants","type":"json","required":true},
    {"name":"lastMessage","type":"text","required":false},
    {"name":"lastSender","type":"text","required":false},
    {"name":"isGroup","type":"bool","required":false},
    {"name":"groupName","type":"text","required":false},
    {"name":"groupPhoto","type":"text","required":false},
    {"name":"admins","type":"json","required":false},
    {"name":"createdBy","type":"text","required":false},
    {"name":"pinnedBy","type":"json","required":false}
  ],
  "listRule": "participants ~ @request.auth.email",
  "viewRule": "participants ~ @request.auth.email",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "participants ~ @request.auth.email",
  "deleteRule": "participants ~ @request.auth.email"
}' > /dev/null && echo "  ✅ contacts created" || echo "  ⚠️ contacts failed"

# 3. messages
echo "Creating messages..."
# Note: In production we use the ID of the contacts collection
curl -s -X POST "$BASE/collections" -H "$AUTH" -H "$CT" -d '{
  "name": "messages",
  "type": "base",
  "fields": [
    {"name":"contact","type":"relation","required":true,"options":{"collectionId":"contacts","maxSelect":1}},
    {"name":"text","type":"text","required":false},
    {"name":"fileUrl","type":"text","required":false},
    {"name":"fileType","type":"text","required":false},
    {"name":"senderEmail","type":"text","required":false},
    {"name":"replyTo","type":"json","required":false},
    {"name":"tempId","type":"text","required":false},
    {"name":"edited","type":"bool","required":false},
    {"name":"editedAt","type":"text","required":false},
    {"name":"isForwarded","type":"bool","required":false},
    {"name":"imported","type":"bool","required":false},
    {"name":"importedFrom","type":"text","required":false},
    {"name":"encryptedPayload","type":"text","required":false},
    {"name":"encryptedKeys","type":"text","required":false},
    {"name":"seenAt","type":"text","required":false}
  ],
  "listRule": "contact.participants ~ @request.auth.email",
  "viewRule": "contact.participants ~ @request.auth.email",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "senderEmail = @request.auth.email",
  "deleteRule": "senderEmail = @request.auth.email"
}' > /dev/null && echo "  ✅ messages created" || echo "  ⚠️ messages failed"

# 4. pending_requests
echo "Creating pending_requests..."
curl -s -X POST "$BASE/collections" -H "$AUTH" -H "$CT" -d '{
  "name": "pending_requests",
  "type": "base",
  "fields": [
    {"name":"from","type":"text","required":true},
    {"name":"to","type":"text","required":true},
    {"name":"status","type":"text","required":false}
  ],
  "listRule": "from = @request.auth.email || to = @request.auth.email",
  "viewRule": "from = @request.auth.email || to = @request.auth.email",
  "createRule": "@request.auth.id != \"\"",
  "updateRule": "from = @request.auth.email || to = @request.auth.email",
  "deleteRule": "from = @request.auth.email || to = @request.auth.email"
}' > /dev/null && echo "  ✅ pending_requests created" || echo "  ⚠️ pending_requests failed"

# 5. calls
echo "Creating calls..."
curl -s -X POST "$BASE/collections" -H "$AUTH" -H "$CT" -d '{
  "name": "calls",
  "type": "base",
  "fields": [
    {"name":"type","type":"text","required":false},
    {"name":"caller","type":"text","required":false},
    {"name":"receiver","type":"text","required":false},
    {"name":"status","type":"text","required":false},
    {"name":"offer","type":"text","required":false},
    {"name":"answer","type":"text","required":false},
    {"name":"relayDetected","type":"bool","required":false},
    {"name":"maxResolution","type":"text","required":false},
    {"name":"endedAt","type":"text","required":false}
  ],
  "listRule": "",
  "viewRule": "",
  "createRule": "",
  "updateRule": "",
  "deleteRule": ""
}' > /dev/null && echo "  ✅ calls created" || echo "  ⚠️ calls failed"

# 6. ice_candidates
echo "Creating ice_candidates..."
curl -s -X POST "$BASE/collections" -H "$AUTH" -H "$CT" -d '{
  "name": "ice_candidates",
  "type": "base",
  "fields": [
    {"name":"callId","type":"text","required":true},
    {"name":"sender","type":"text","required":true},
    {"name":"candidate","type":"text","required":false}
  ],
  "listRule": "",
  "viewRule": "",
  "createRule": "",
  "updateRule": "",
  "deleteRule": ""
}' > /dev/null && echo "  ✅ ice_candidates created" || echo "  ⚠️ ice_candidates failed"

# 7. reports
echo "Creating reports..."
curl -s -X POST "$BASE/collections" -H "$AUTH" -H "$CT" -d '{
  "name": "reports",
  "type": "base",
  "fields": [
    {"name":"chatId","type":"text","required":true},
    {"name":"reportedBy","type":"text","required":true},
    {"name":"status","type":"text","required":false}
  ],
  "listRule": "",
  "viewRule": "",
  "createRule": "",
  "updateRule": "",
  "deleteRule": ""
}' > /dev/null && echo "  ✅ reports created" || echo "  ⚠️ reports failed"

echo ""
echo "🎉 Done! Refresh your PocketBase dashboard to see all collections."
