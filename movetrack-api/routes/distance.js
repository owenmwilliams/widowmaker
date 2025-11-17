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
  // Simple city-to-city distance estimates (in miles)
  const cityDistances = {
    'philadelphia-san francisco': 2900,
    'san francisco-philadelphia': 2900,
    'philadelphia-sf': 2900,
    'sf-philadelphia': 2900,
    'new york-los angeles': 2800,
    'los angeles-new york': 2800,
    'nyc-la': 2800,
    'la-nyc': 2800,
    'chicago-miami': 1380,
    'miami-chicago': 1380,
    'seattle-boston': 3000,
    'boston-seattle': 3000,
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
