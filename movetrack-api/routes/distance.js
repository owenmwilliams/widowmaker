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
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination addresses are required' });
    }

    // Try Google Maps API if available
    if (GOOGLE_MAPS_API_KEY) {
      try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
          params: {
            origins: origin,
            destinations: destination,
            units: 'imperial',
            key: GOOGLE_MAPS_API_KEY
          },
          timeout: 5000 // 5 second timeout
        });

        const data = response.data;

        if (data.status === 'OK' && data.rows[0]?.elements[0]?.status === 'OK') {
          const element = data.rows[0].elements[0];
          const distanceMeters = element.distance.value;
          const distanceMiles = Math.round(distanceMeters * 0.000621371);

          return res.json({
            success: true,
            distance_miles: distanceMiles,
            distance_text: element.distance.text,
            duration_seconds: element.duration.value,
            duration_text: element.duration.text,
            origin_address: data.origin_addresses[0],
            destination_address: data.destination_addresses[0],
            source: 'google_maps'
          });
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
