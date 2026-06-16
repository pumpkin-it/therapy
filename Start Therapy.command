#!/bin/bash

cd "$(dirname "$0")"

echo ""
echo "========================================="
echo "   Starting Therapy..."
echo "========================================="
echo ""

# Kill old instances
lsof -ti:3001 | xargs kill -9 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 1

# Install if needed
if [ ! -d "server/node_modules" ]; then
  echo "▶ Installing server dependencies..."
  cd server && npm install && cd ..
fi
if [ ! -d "client/node_modules" ]; then
  echo "▶ Installing client dependencies..."
  cd client && npm install && cd ..
fi

echo "▶ Starting backend..."
node server/index.js &
SERVER_PID=$!

echo "  Waiting for backend..."
for i in {1..20}; do
  if curl -s http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "  ✅ Backend ready."
    break
  fi
  sleep 1
done

echo "▶ Starting frontend..."
cd client && npm run dev &
CLIENT_PID=$!

echo "  Waiting for frontend..."
for i in {1..30}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "  ✅ Frontend ready."
    break
  fi
  sleep 1
done

echo ""
echo "========================================="
echo "  ✅ Therapy is running!"
echo "  Open: http://localhost:3000"
echo "  Login: admin@practice.com / admin123"
echo "========================================="
echo ""

open http://localhost:3000

trap "echo ''; echo 'Stopping...'; kill $SERVER_PID $CLIENT_PID 2>/dev/null; exit" INT
wait
