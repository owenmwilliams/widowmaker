#!/bin/bash

# Test Google Maps API setup
echo "=========================================="
echo "Google Maps API Diagnostic Test"
echo "=========================================="
echo ""

# Check frontend .env
echo "1. Frontend API Key:"
if [ -f "movetrack-app/.env" ]; then
    grep VITE_GOOGLE_MAPS_API_KEY movetrack-app/.env | sed 's/=.*/=***HIDDEN***/'
    FRONTEND_KEY=$(grep VITE_GOOGLE_MAPS_API_KEY movetrack-app/.env | cut -d= -f2)
    if [ -n "$FRONTEND_KEY" ] && [ "$FRONTEND_KEY" != "your_google_maps_api_key_here" ]; then
        echo "   ✓ Frontend API key is set"
    else
        echo "   ✗ Frontend API key NOT properly set"
    fi
else
    echo "   ✗ No .env file in movetrack-app/"
fi
echo ""

# Check backend .env
echo "2. Backend API Key:"
if [ -f "movetrack-api/.env" ]; then
    grep GOOGLE_MAPS_API_KEY movetrack-api/.env | sed 's/=.*/=***HIDDEN***/'
    BACKEND_KEY=$(grep GOOGLE_MAPS_API_KEY movetrack-api/.env | cut -d= -f2)
    if [ -n "$BACKEND_KEY" ] && [ "$BACKEND_KEY" != "your_google_maps_api_key_here" ]; then
        echo "   ✓ Backend API key is set"
    else
        echo "   ✗ Backend API key NOT properly set"
    fi
else
    echo "   ✗ No .env file in movetrack-api/"
fi
echo ""

# Test backend API endpoint
echo "3. Testing Backend API Endpoint:"
echo "   Sending test request to http://localhost:3050/api/calculate-distance..."
RESPONSE=$(curl -s -X POST http://localhost:3050/api/calculate-distance \
  -H "Content-Type: application/json" \
  -d '{"origin":"Philadelphia, PA","destination":"San Francisco, CA","truckRoute":true}')

if echo "$RESPONSE" | grep -q "route_polyline"; then
    echo "   ✓ Backend API returned route data (Google Maps API working!)"
    echo "   Source: $(echo $RESPONSE | grep -o '"source":"[^"]*"' | cut -d'"' -f4)"
    echo "   Distance: $(echo $RESPONSE | grep -o '"distance_miles":[^,]*' | cut -d':' -f2) miles"
elif echo "$RESPONSE" | grep -q "estimated"; then
    echo "   ⚠ Backend using fallback estimates (Google Maps API not working)"
    echo "   Response: $RESPONSE"
else
    echo "   ✗ Backend API error or not running"
    echo "   Response: $RESPONSE"
fi
echo ""

# Check if servers are running
echo "4. Server Status:"
if lsof -i :3050 > /dev/null 2>&1; then
    echo "   ✓ Backend server running on port 3050"
else
    echo "   ✗ Backend server NOT running on port 3050"
fi

if lsof -i :5173 > /dev/null 2>&1; then
    echo "   ✓ Frontend dev server running on port 5173"
else
    echo "   ✗ Frontend dev server NOT running on port 5173"
fi
echo ""

echo "=========================================="
echo "Recommendations:"
echo "=========================================="
if [ -n "$BACKEND_KEY" ] && echo "$RESPONSE" | grep -q "estimated"; then
    echo "• Backend has API key but still using estimates"
    echo "  → Restart backend server: cd movetrack-api && npm start"
    echo "  → Check Google Cloud Console that Directions API is enabled"
    echo "  → Verify API key has no restrictions blocking localhost"
fi

if [ -z "$FRONTEND_KEY" ] || [ "$FRONTEND_KEY" == "your_google_maps_api_key_here" ]; then
    echo "• Set frontend API key in movetrack-app/.env"
fi

echo ""
