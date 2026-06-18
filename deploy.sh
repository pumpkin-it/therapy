#!/bin/bash
set -e

AWS=/Users/peterchen/Library/Python/3.9/bin/aws
INSTANCE=i-07cb866fad56e0586
BUCKET=pumpkinit

echo "=== Building frontend ==="
npm run build --prefix client

echo "=== Packaging (database excluded) ==="
tar czf /tmp/therapy-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='client/node_modules' \
  --exclude='.git' \
  --exclude='server/*.db' \
  --exclude='server/*.db-shm' \
  --exclude='server/*.db-wal' \
  --exclude='server/._pm*' \
  .

echo "=== Uploading package ==="
$AWS s3 cp /tmp/therapy-deploy.tar.gz s3://$BUCKET/therapy-deploy.tar.gz

PRESIGN=$($AWS s3 presign s3://$BUCKET/therapy-deploy.tar.gz --expires-in 3600)
BACKUP_PRESIGN=$($AWS s3 presign "s3://$BUCKET/therapy-db-backup-$(date +%Y%m%d-%H%M%S).db" --expires-in 3600 2>/dev/null || echo "")

echo "=== Deploying to EC2 ==="
CMD_ID=$($AWS ssm send-command \
  --instance-ids $INSTANCE \
  --document-name "AWS-RunShellScript" \
  --parameters "commands=[
    \"echo '--- Backing up database ---'\",
    \"cp /opt/therapy/server/pm.db /opt/therapy/server/pm.db.bak\",
    \"echo '--- Downloading package ---'\",
    \"curl -s -o /tmp/therapy-deploy.tar.gz '$PRESIGN'\",
    \"echo '--- Extracting new code (database files excluded) ---'\",
    \"tar -xzf /tmp/therapy-deploy.tar.gz -C /opt/therapy --exclude='server/pm.db' --exclude='server/pm.db-shm' --exclude='server/pm.db-wal' --exclude='server/._pm*' 2>/dev/null || true\",
    \"echo '--- Verifying database intact ---'\",
    \"sqlite3 /opt/therapy/server/pm.db 'SELECT count(*) || \\\" clients\\\" FROM clients;'\",
    \"cd /opt/therapy && npm install --production\",
    \"cp -r /opt/therapy/client/dist/. /opt/therapy/frontend/\",
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
