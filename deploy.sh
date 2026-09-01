#!/bin/bash
set -e

AWS=/Users/peterchen/Library/Python/3.9/bin/aws
INSTANCE=i-07cb866fad56e0586
BUCKET=pumpkinit
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "=== Building frontend ==="
npm run build --prefix client

echo "=== Packaging (database and uploads excluded) ==="
tar czf /tmp/therapy-deploy.tar.gz \
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
$AWS s3 cp /tmp/therapy-deploy.tar.gz s3://$BUCKET/therapy-deploy.tar.gz

PRESIGN=$($AWS s3 presign s3://$BUCKET/therapy-deploy.tar.gz --expires-in 3600)
DB_BACKUP_KEY="therapy-db-backups/pm-${TIMESTAMP}.db"

echo "=== Deploying to EC2 ==="
CMD_ID=$($AWS ssm send-command \
  --instance-ids $INSTANCE \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"echo '--- Backing up database to S3 ($DB_BACKUP_KEY) ---'\",
    \"aws s3 cp /opt/therapy/server/pm.db s3://$BUCKET/$DB_BACKUP_KEY && echo 'S3 backup ok' || echo 'S3 backup failed (non-fatal)'\",
    \"cp /opt/therapy/server/pm.db /opt/therapy/server/pm.db.bak\",
    \"echo '--- Downloading package ---'\",
    \"curl -s -o /tmp/therapy-deploy.tar.gz '$PRESIGN'\",
    \"echo '--- Extracting new code (database and uploads excluded) ---'\",
    \"tar -xzf /tmp/therapy-deploy.tar.gz -C /opt/therapy --exclude='server/pm.db' --exclude='server/pm.db-shm' --exclude='server/pm.db-wal' --exclude='server/._pm*' --exclude='uploads' 2>/dev/null || true\",
    \"echo '--- Verifying database intact ---'\",
    \"sqlite3 /opt/therapy/server/pm.db 'SELECT count(*) || \\\" clients\\\" FROM clients;'\",
    \"cd /opt/therapy && npm install --production\",
    \"node /opt/therapy/server/scripts/verify-deps.js || (cd /opt/therapy/server && npm install --production --force && node /opt/therapy/server/scripts/verify-deps.js)\",
    \"rm -rf /opt/therapy/frontend/assets && cp -r /opt/therapy/client/dist/. /opt/therapy/frontend/\",
    \"systemctl restart therapy\",
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
echo "=== Syncing to GitHub ==="
git add -A
git diff --cached --stat
git commit -m "Deploy $TIMESTAMP" \
  -m "Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" 2>/dev/null || echo "(nothing new to commit)"
git push origin main
echo "=== Deploy complete ==="
