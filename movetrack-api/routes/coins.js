var express = require('express');
var router = express.Router();
const axios = require('axios');

// Endpoint to ping the CoinMarketCap API
router.get('/', async (req, res) => {
  try {
    // Replace 'YOUR_API_KEY' with your actual CoinMarketCap API key
    const apiKey = process.env.COIN_MARKET_CAP_API;
    const apiUrl = 'https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest';

    const response = await axios.get(apiUrl, {
      params: {
        id: 1027 // Ethereum's CoinMarketCap ID, you may need to check if it's still accurate
      },
      headers: {
        'X-CMC_PRO_API_KEY': apiKey,
      },
    });

    // Send the CoinMarketCap API response as the endpoint response
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching data from CoinMarketCap API:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;