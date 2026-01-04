#!/bin/bash
set -e

echo "Installing dependencies..."
npm install

echo "Building project..."
npm run build

echo ""
echo "Setup complete!"
echo ""
echo "To start the dashboard:"
echo "  npm start"
echo ""
echo "Dashboard will be available at: http://localhost:3456"
