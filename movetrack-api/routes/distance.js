const express = require('express');
const router = express.Router();
const axios = require('axios');

// Google Maps API Key - should be in environment variables
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * POST /api/calculate-distance
 * Calculate driving distance between two addresses using Google Maps Distance Matrix API
 */
router.post('/calculate-distance', async (req, res) => {
  try {
    const { origin, destination } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({ error: 'Origin and destination addresses are required' });
    }

    if (!GOOGLE_MAPS_API_KEY) {
      console.error('GOOGLE_MAPS_API_KEY not configured');
      return res.status(500).json({ error: 'Distance calculation service not configured' });
    }

    // Call Google Maps Distance Matrix API
    const response = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
      params: {
        origins: origin,
        destinations: destination,
        units: 'imperial', // Use miles
        key: GOOGLE_MAPS_API_KEY
      }
    });

    const data = response.data;

    if (data.status !== 'OK') {
      console.error('Google Maps API error:', data.status, data.error_message);
      return res.status(500).json({ error: 'Distance calculation failed', details: data.error_message });
    }

    const element = data.rows[0]?.elements[0];

    if (!element || element.status !== 'OK') {
      console.warn('No route found between addresses:', element?.status);
      return res.status(400).json({ error: 'No route found between the specified addresses' });
    }

    // Extract distance in miles
    const distanceMeters = element.distance.value;
    const distanceMiles = Math.round(distanceMeters * 0.000621371); // Convert meters to miles
    const distanceText = element.distance.text;

    // Extract duration
    const durationSeconds = element.duration.value;
    const durationText = element.duration.text;

    res.json({
      success: true,
      distance_miles: distanceMiles,
      distance_text: distanceText,
      duration_seconds: durationSeconds,
      duration_text: durationText,
      origin_address: data.origin_addresses[0],
      destination_address: data.destination_addresses[0]
    });

  } catch (error) {
    console.error('Error calculating distance:', error.message);
    res.status(500).json({ error: 'Failed to calculate distance', details: error.message });
  }
});

module.exports = router;
