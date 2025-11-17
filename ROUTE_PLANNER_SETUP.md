# Route Planner - Setup & Implementation Guide

## Overview
The route planner feature provides visual route mapping, distance calculation, and truck-friendly routing for moving logistics. It uses Google Maps Directions API to calculate optimal routes and display them on an interactive map.

## Features Implemented (Phase 1 - MVP)

### ✅ Backend Enhancements
- **Google Directions API Integration** ([movetrack-api/routes/distance.js](movetrack-api/routes/distance.js))
  - Switched from Distance Matrix API to Directions API for route geometry
  - Returns encoded polyline for map rendering
  - Supports `truckRoute` parameter for truck-friendly routing preferences
  - Supports `avoidTolls` parameter to find toll-free routes
  - Calculates estimated tolls based on distance
  - Suggests overnight stops for long-distance moves (>500 miles)
  - Returns route summary, warnings, and detailed metadata

### ✅ Frontend Components
- **RouteMap Component** ([movetrack-app/src/components/RouteMap.vue](movetrack-app/src/components/RouteMap.vue))
  - Google Maps integration using `@googlemaps/js-api-loader`
  - Renders route polyline from encoded geometry
  - Displays origin (green) and destination (red) markers
  - Auto-fits map bounds to show entire route
  - Loading and error states

- **Enhanced Move Planning** ([movetrack-app/src/components/desktop/DesktopMovePlanning.vue](movetrack-app/src/components/desktop/DesktopMovePlanning.vue))
  - Route visualization in "Costs & Route" tab
  - Truck-friendly routing toggle
  - Avoid tolls toggle
  - Route stats display:
    - Distance (miles)
    - Drive time
    - Estimated tolls
    - Overnight stops recommendation
  - Route summary and warnings
  - Multi-day trip planning notices

## Setup Instructions

### 1. Google Maps API Key

You need a Google Maps API key with the following APIs enabled:
- **Maps JavaScript API** (for map rendering)
- **Directions API** (for route calculation)

#### Get an API Key:
1. Go to [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/overview)
2. Create a new project or select existing one
3. Enable "Maps JavaScript API" and "Directions API"
4. Go to Credentials → Create Credentials → API Key
5. (Recommended) Restrict the API key:
   - Application restrictions: HTTP referrers
   - API restrictions: Select only Maps JavaScript API and Directions API

### 2. Configure Environment Variables

#### Backend (Node.js/Express)
Set the API key in your backend environment:

```bash
# movetrack-api/.env (or your environment variable system)
GOOGLE_MAPS_API_KEY=your_actual_google_maps_api_key_here
```

#### Frontend (Vite/Vue)
Create `.env` file in `movetrack-app/`:

```bash
# movetrack-app/.env
VITE_GOOGLE_MAPS_API_KEY=your_actual_google_maps_api_key_here
```

**Note**: The `.env` file is gitignored. Use `.env.example` as a template.

### 3. Install Dependencies

Frontend package (`@googlemaps/js-api-loader`) is already installed via:
```bash
cd movetrack-app
npm install
```

### 4. Start the Application

```bash
# Start backend
cd movetrack-api
npm start

# Start frontend (in another terminal)
cd movetrack-app
npm run dev
```

## Usage

### Basic Flow:
1. Navigate to Move Planning page
2. Select **Origin Location** and **Destination Location**
3. Click **"Costs & Route"** tab
4. View route on map with stats:
   - Distance
   - Drive time
   - Toll estimates
   - Overnight stops (for long trips)
5. Toggle options:
   - ✅ **Truck-friendly route** - Prefers highways and wide roads
   - ✅ **Avoid tolls** - Finds toll-free alternatives

### Route Calculation Logic:
- Routes are automatically calculated when origin/destination changes
- Recalculates when routing preferences change (truck-friendly, tolls)
- Results are cached to avoid redundant API calls
- Fallback estimates used if Google Maps API unavailable

## API Response Structure

### `/api/calculate-distance` Response:
```json
{
  "success": true,
  "distance_miles": 2900,
  "distance_text": "2,900 mi",
  "duration_seconds": 151200,
  "duration_text": "42 hours",
  "origin_address": "Philadelphia, PA, USA",
  "destination_address": "San Francisco, CA, USA",
  "source": "google_maps",
  "route_polyline": "encoded_polyline_string_here",
  "route_summary": "I-80 W",
  "warnings": [],
  "estimated_tolls": 435,
  "truck_friendly": true,
  "steps_count": 47,
  "overnight_stops": 5
}
```

## Future Enhancements (Phase 2+)

### Planned Features:
- [ ] **Waypoint Support** - Add intermediate stops (storage, donation centers)
- [ ] **Route Optimization** - Reorder waypoints for optimal routing
- [ ] **Suggested Stopping Points** - Recommend hotels, rest stops for overnight trips
- [ ] **Full Truck Routing** - Use Google Routes API for truck restrictions (height, weight, hazmat)
- [ ] **Traffic-aware Estimates** - Real-time traffic data for more accurate times
- [ ] **Save Routes** - Persist route data to database
- [ ] **Print Route Instructions** - Add turn-by-turn directions to PDF estimates

## Troubleshooting

### Map Not Loading
- Check browser console for errors
- Verify `VITE_GOOGLE_MAPS_API_KEY` is set in frontend `.env`
- Ensure Maps JavaScript API is enabled in Google Cloud Console
- Check API key restrictions (HTTP referrers, API access)

### No Route Displayed
- Check backend console logs
- Verify `GOOGLE_MAPS_API_KEY` is set in backend environment
- Ensure Directions API is enabled
- Check API quota limits in Google Cloud Console

### Fallback Mode
If Google Maps API is unavailable, the system uses estimated distances:
- Predefined city-to-city distances
- Default 500 miles for unknown routes
- No map visualization shown (placeholder displayed)

## Cost Considerations

Google Maps API pricing (as of 2024):
- **Maps JavaScript API**: $7 per 1,000 loads
- **Directions API**: $5 per 1,000 requests
- **Free tier**: $200/month credit (≈28,000 map loads + 40,000 directions requests)

For typical use:
- 1 route = 1 Directions API call + 1 Maps load
- Average move planning = ~3-5 route calculations (adjusting settings)
- 100 users/month ≈ 300-500 API calls ≈ $2-3/month

### Optimization Tips:
- Results are cached client-side to reduce repeated calls
- Consider server-side caching for frequently requested routes
- Monitor usage in Google Cloud Console

## Files Modified/Created

### Backend
- `movetrack-api/routes/distance.js` - Enhanced Directions API integration

### Frontend
- `movetrack-app/src/components/RouteMap.vue` - New map component
- `movetrack-app/src/components/desktop/DesktopMovePlanning.vue` - Route UI integration
- `movetrack-app/.env.example` - Environment variable template
- `movetrack-app/package.json` - Added `@googlemaps/js-api-loader` dependency

## Technical Notes

### Truck Routing Limitations
Google Directions API doesn't fully support truck-specific routing (height/weight restrictions, hazmat). For MVP, "truck-friendly" mode is a preference hint. Full truck routing requires:
- **Google Routes API** (newer, more expensive)
- Vehicle specifications (height, weight, axle count)
- Hazmat/cargo restrictions

Current implementation prioritizes highways and major routes when `truckRoute: true`.

### Polyline Encoding
Routes use Google's encoded polyline algorithm for efficient geometry transmission:
- Compressed lat/lng coordinates
- Decoded client-side for rendering
- Significantly reduces API response size

## Support

For issues or questions:
1. Check browser/server console logs
2. Verify API keys and quotas
3. Review this documentation
4. Contact development team

---

**Last Updated**: 2025-01-16
**Version**: 1.0 (Phase 1 MVP)
