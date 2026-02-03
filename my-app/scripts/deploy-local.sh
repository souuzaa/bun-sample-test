#!/bin/bash

set -e

cd "$(dirname "$0")/.."

echo "==> Stopping existing containers..."
docker compose down

echo "==> Building and starting services..."
docker compose up -d --build

echo "==> Waiting for services to be healthy..."
sleep 5

echo "==> Checking health..."
until curl -s http://localhost:3000/api/health | grep -q '"status":"ok"'; do
  echo "    Waiting for app..."
  sleep 2
done

echo "==> Services ready!"
curl -s http://localhost:3000/api/health | jq .

echo ""
echo "Available endpoints:"
echo "  API:        http://localhost:3000"
echo "  Metrics:    http://localhost:9464/metrics"
echo "  Prometheus: http://localhost:9090"
echo "  Grafana:    http://localhost:3030 (admin/admin)"
echo ""
echo "Run load test:"
echo "  BASE_URL=http://localhost:3000 k6 run k6/workload-test.js"
