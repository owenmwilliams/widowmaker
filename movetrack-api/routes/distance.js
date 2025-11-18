const express = require('express');
const router = express.Router();
const axios = require('axios');

// Google Maps API Key - should be in environment variables
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * POST /api/calculate-distance
 * Calculate driving distance between two addresses using Google Maps Distance Matrix API
 */
// Helper function to estimate distance using city-to-city lookup or approximation
function estimateDistance(origin, destination) {
  // Comprehensive city-to-city distance estimates (in miles)
  // Major US cities with common abbreviations
  const cityDistances = {
    // Same city variations
    'nyc-ny': 0, 'ny-nyc': 0, 'new york-nyc': 0, 'nyc-new york': 0,
    'la-los angeles': 0, 'los angeles-la': 0,
    'sf-san francisco': 0, 'san francisco-sf': 0,

    // East Coast to West Coast (2,400 - 3,000 miles)
    'new york-los angeles': 2800, 'los angeles-new york': 2800,
    'nyc-la': 2800, 'la-nyc': 2800, 'ny-la': 2800, 'la-ny': 2800,
    'new york-san francisco': 2900, 'san francisco-new york': 2900,
    'nyc-sf': 2900, 'sf-nyc': 2900, 'ny-sf': 2900, 'sf-ny': 2900,
    'philadelphia-san francisco': 2850, 'san francisco-philadelphia': 2850,
    'philadelphia-sf': 2850, 'sf-philadelphia': 2850,
    'boston-los angeles': 3000, 'los angeles-boston': 3000,
    'boston-la': 3000, 'la-boston': 3000,
    'boston-san francisco': 3100, 'san francisco-boston': 3100,
    'boston-sf': 3100, 'sf-boston': 3100,
    'boston-seattle': 3000, 'seattle-boston': 3000,
    'washington-seattle': 2750, 'seattle-washington': 2750,
    'dc-seattle': 2750, 'seattle-dc': 2750,
    'miami-seattle': 3300, 'seattle-miami': 3300,
    'miami-san francisco': 3100, 'san francisco-miami': 3100,
    'miami-sf': 3100, 'sf-miami': 3100,

    // East Coast to Pacific Northwest (2,400 - 2,900 miles)
    'new york-seattle': 2850, 'seattle-new york': 2850,
    'nyc-seattle': 2850, 'seattle-nyc': 2850, 'ny-seattle': 2850, 'seattle-ny': 2850,
    'seattle-brooklyn': 2850, 'brooklyn-seattle': 2850,
    'philadelphia-seattle': 2800, 'seattle-philadelphia': 2800,
    'boston-portland': 3100, 'portland-boston': 3100,

    // East Coast cities (100 - 1,200 miles)
    'new york-boston': 215, 'boston-new york': 215,
    'nyc-boston': 215, 'boston-nyc': 215, 'ny-boston': 215, 'boston-ny': 215,
    'new york-philadelphia': 95, 'philadelphia-new york': 95,
    'nyc-philadelphia': 95, 'philadelphia-nyc': 95,
    'new york-washington': 225, 'washington-new york': 225,
    'nyc-dc': 225, 'dc-nyc': 225, 'ny-dc': 225, 'dc-ny': 225,
    'philadelphia-washington': 140, 'washington-philadelphia': 140,
    'philadelphia-dc': 140, 'dc-philadelphia': 140,
    'boston-washington': 440, 'washington-boston': 440,
    'boston-dc': 440, 'dc-boston': 440,
    'new york-miami': 1280, 'miami-new york': 1280,
    'nyc-miami': 1280, 'miami-nyc': 1280,
    'boston-miami': 1500, 'miami-boston': 1500,
    'philadelphia-miami': 1200, 'miami-philadelphia': 1200,

    // Midwest to East Coast (500 - 1,000 miles)
    'chicago-new york': 790, 'new york-chicago': 790,
    'chicago-nyc': 790, 'nyc-chicago': 790,
    'chicago-boston': 980, 'boston-chicago': 980,
    'chicago-philadelphia': 760, 'philadelphia-chicago': 760,
    'chicago-washington': 700, 'washington-chicago': 700,
    'chicago-dc': 700, 'dc-chicago': 700,
    'chicago-miami': 1380, 'miami-chicago': 1380,
    'detroit-new york': 640, 'new york-detroit': 640,
    'detroit-nyc': 640, 'nyc-detroit': 640,

    // Midwest to West Coast (1,200 - 2,100 miles)
    'chicago-los angeles': 2015, 'los angeles-chicago': 2015,
    'chicago-la': 2015, 'la-chicago': 2015,
    'chicago-san francisco': 2130, 'san francisco-chicago': 2130,
    'chicago-sf': 2130, 'sf-chicago': 2130,
    'chicago-seattle': 2050, 'seattle-chicago': 2050,
    'chicago-denver': 1000, 'denver-chicago': 1000,
    'detroit-los angeles': 2280, 'los angeles-detroit': 2280,
    'detroit-la': 2280, 'la-detroit': 2280,

    // Mountain West to coasts
    'denver-new york': 1780, 'new york-denver': 1780,
    'denver-nyc': 1780, 'nyc-denver': 1780,
    'denver-los angeles': 1020, 'los angeles-denver': 1020,
    'denver-la': 1020, 'la-denver': 1020,
    'denver-san francisco': 1260, 'san francisco-denver': 1260,
    'denver-sf': 1260, 'sf-denver': 1260,
    'denver-seattle': 1300, 'seattle-denver': 1300,
    'denver-miami': 2100, 'miami-denver': 2100,
    'salt lake city-los angeles': 700, 'los angeles-salt lake city': 700,
    'salt lake city-la': 700, 'la-salt lake city': 700,
    'salt lake city-san francisco': 750, 'san francisco-salt lake city': 750,
    'salt lake city-sf': 750, 'sf-salt lake city': 750,

    // Southwest
    'phoenix-los angeles': 370, 'los angeles-phoenix': 370,
    'phoenix-la': 370, 'la-phoenix': 370,
    'phoenix-san diego': 355, 'san diego-phoenix': 355,
    'phoenix-denver': 865, 'denver-phoenix': 865,
    'phoenix-chicago': 1750, 'chicago-phoenix': 1750,
    'austin-houston': 165, 'houston-austin': 165,
    'dallas-houston': 240, 'houston-dallas': 240,
    'dallas-austin': 195, 'austin-dallas': 195,
    'dallas-chicago': 925, 'chicago-dallas': 925,
    'houston-chicago': 1080, 'chicago-houston': 1080,
    'dallas-los angeles': 1435, 'los angeles-dallas': 1435,
    'dallas-la': 1435, 'la-dallas': 1435,

    // West Coast cities
    'los angeles-san francisco': 380, 'san francisco-los angeles': 380,
    'la-sf': 380, 'sf-la': 380,
    'los angeles-san diego': 120, 'san diego-los angeles': 120,
    'la-san diego': 120, 'san diego-la': 120,
    'los angeles-seattle': 1135, 'seattle-los angeles': 1135,
    'la-seattle': 1135, 'seattle-la': 1135,
    'san francisco-seattle': 810, 'seattle-san francisco': 810,
    'sf-seattle': 810, 'seattle-sf': 810,
    'san francisco-portland': 635, 'portland-san francisco': 635,
    'sf-portland': 635, 'portland-sf': 635,
    'seattle-portland': 175, 'portland-seattle': 175,

    // South to various regions
    'atlanta-new york': 870, 'new york-atlanta': 870,
    'atlanta-nyc': 870, 'nyc-atlanta': 870,
    'atlanta-chicago': 715, 'chicago-atlanta': 715,
    'atlanta-miami': 660, 'miami-atlanta': 660,
    'atlanta-los angeles': 2180, 'los angeles-atlanta': 2180,
    'atlanta-la': 2180, 'la-atlanta': 2180,
  };

  const key = `${origin.toLowerCase()}-${destination.toLowerCase()}`.replace(/[^a-z-]/g, '');

  if (cityDistances[key]) {
    return cityDistances[key];
  }

  // Default fallback - return a medium distance
  console.log(`No distance estimate for ${origin} to ${destination}, using default`);
  return 500; // Default 500 miles for local/regional moves
}

router.post('/calculate-distance', async (req, res) => {
  try {
    const { origin, destination, avoidTolls = false, truckRoute = false } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination addresses are required' });
    }

    // Try Google Maps API if available
    if (GOOGLE_MAPS_API_KEY) {
      try {
        // Use Directions API instead of Distance Matrix for route geometry
        const params = {
          origin: origin,
          destination: destination,
          mode: 'driving',
          units: 'imperial',
          key: GOOGLE_MAPS_API_KEY
        };

        // Add avoid parameters
        const avoid = [];
        if (avoidTolls) avoid.push('tolls');
        if (avoid.length > 0) {
          params.avoid = avoid.join('|');
        }

        // For truck routing, we'll use travel_mode=driving but note limitations
        // Google doesn't have full truck-specific routing in Directions API
        // We'd need to use Routes API (newer) for truck restrictions
        // Note: Full truck routing requires Google Routes API with vehicle restrictions

        const response = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
          params,
          timeout: 10000 // 10 second timeout
        });

        const data = response.data;

        if (data.status === 'OK' && data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const leg = route.legs[0];

          const distanceMeters = leg.distance.value;
          const distanceMiles = Math.round(distanceMeters * 0.000621371);

          // Extract route overview polyline for map rendering
          const overviewPolyline = route.overview_polyline.points;

          // Calculate estimated tolls (rough estimate based on distance and highways)
          const estimatedTolls = !avoidTolls && distanceMiles > 100
            ? Math.round(distanceMiles * 0.15) // Rough estimate: $0.15/mile for toll routes
            : 0;

          return res.json({
            success: true,
            distance_miles: distanceMiles,
            distance_text: leg.distance.text,
            duration_seconds: leg.duration.value,
            duration_text: leg.duration.text,
            origin_address: leg.start_address,
            destination_address: leg.end_address,
            source: 'google_maps',
            route_polyline: overviewPolyline,
            route_summary: route.summary || 'Route via highways',
            warnings: route.warnings || [],
            estimated_tolls: estimatedTolls,
            truck_friendly: truckRoute,
            // Add waypoint/leg information for future multi-stop support
            steps_count: leg.steps.length,
            // Suggest overnight stops for long distances
            overnight_stops: distanceMiles > 500 ? Math.ceil(distanceMiles / 500) - 1 : 0
          });
        } else {
          console.warn('Google Directions API returned no routes:', data.status, data.error_message);
        }
      } catch (apiError) {
        console.warn('Google Maps API unavailable, using fallback:', apiError.message);
      }
    }

    // Fallback to estimate
    const estimatedDistance = estimateDistance(origin, destination);

    res.json({
      success: true,
      distance_miles: estimatedDistance,
      distance_text: `${estimatedDistance} mi`,
      duration_seconds: Math.round(estimatedDistance / 60 * 3600), // Assume 60mph average
      duration_text: `${Math.round(estimatedDistance / 60)} hours`,
      origin_address: origin,
      destination_address: destination,
      source: 'estimated',
      note: 'Distance is estimated. For accurate routing, configure Google Maps API key.'
    });

  } catch (error) {
    console.error('Error calculating distance:', error.message);
    res.status(500).json({ error: 'Failed to calculate distance', details: error.message });
  }
});

module.exports = router;
