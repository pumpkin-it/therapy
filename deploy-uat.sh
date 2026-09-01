#!/bin/bash
set -e

AWS=/Users/peterchen/Library/Python/3.9/bin/aws
INSTANCE=i-07cb866fad56e0586
BUCKET=pumpkinit
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "=== Building frontend ==="
npm run build --prefix client

echo "=== Packaging (database and uploads excluded) ==="
tar czf /tmp/therapy-uat-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='client/node_modules' \
  --exclude='.git' \
  --exclude='server/*.db' \
  --exclude='server/*.db-shm' \
  --exclude='server/*.db-wal' \
  --exclude='server/._pm*' \
  --exclude='uploads' \
  .

echo "=== Uploading package ==="
$AWS s3 cp /tmp/therapy-uat-deploy.tar.gz s3://$BUCKET/therapy-uat-deploy.tar.gz

PRESIGN=$($AWS s3 presign s3://$BUCKET/therapy-uat-deploy.tar.gz --expires-in 3600)

echo "=== Deploying to UAT on EC2 (database and uploads untouched) ==="
CMD_ID=$($AWS ssm send-command \
  --instance-ids $INSTANCE \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"echo '--- Downloading package ---'\",
    \"curl -s -o /tmp/therapy-uat-deploy.tar.gz '$PRESIGN'\",
    \"echo '--- Extracting new code (database and uploads excluded) ---'\",
    \"tar -xzf /tmp/therapy-uat-deploy.tar.gz -C /opt/therapy-uat --exclude='server/pm.db' --exclude='server/pm.db-shm' --exclude='server/pm.db-wal' --exclude='server/._pm*' --exclude='uploads' 2>/dev/null || true\",
    \"cd /opt/therapy-uat/server && npm install --production\",
    \"node /opt/therapy-uat/server/scripts/verify-deps.js || (cd /opt/therapy-uat/server && npm install --production --force && node /opt/therapy-uat/server/scripts/verify-deps.js)\",
    \"rm -rf /opt/therapy-uat/frontend/assets && cp -r /opt/therapy-uat/client/dist/. /opt/therapy-uat/frontend/\",
    \"systemctl restart therapy-uat\",
    \"echo '--- Done ---'\"
  ]" \
  --query 'Command.CommandId' --output text)

echo "=== Waiting for result (command $CMD_ID) ==="
sleep 12
$AWS ssm get-command-invocation \
  --command-id "$CMD_ID" \
  --instance-id $INSTANCE \
  --query '[Status,StandardOutputContent,StandardErrorContent]' \
  --output text

echo ""
echo "=== UAT deploy complete (not pushed to GitHub — verify in UAT, then run deploy.sh to ship to production) ==="
