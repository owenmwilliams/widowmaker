const express = require('express');
const router = express.Router();
const axios = require('axios'); // You need to install axios with npm or yarn

// Define your Google Books API key
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Create a POST route for searching books
router.post('/search-books', async (req, res) => {
  try {
    const query = req.body.query;

    // Make a POST request to Google Books API
    const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
      params: {
        q: query,
        key: GOOGLE_BOOKS_API_KEY,
      },
    });

    // Extract the list of books from the API response
    const books = response.data.items || [];

    // Send the list of books as a JSON response
    res.json({ books });
  } catch (error) {
    console.error('Error searching for books:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a POST route for address validation
router.post('/validate-address', async (req, res) => {
  try {

    const postData = {
      address: {
        postalCode: req.query.zip,
        administrativeArea: req.query.state,
        locality: req.query.city,
        addressLines: [
          req.query.address
        ]
      }
    };

    const config = {
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const apiKey = GOOGLE_API_KEY; // Replace with your actual API key
    const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${apiKey}`;

    // Make a POST request to Google's Address Validation API
    
    const response = await axios.post(url, postData, config);

    // Extract the validation result from the API response
    const validationResult = response.data || {};

    // Send the validation result as a JSON response
    res.json(validationResult);
  } catch (error) {
    console.error('Error validating address:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
