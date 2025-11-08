const express = require('express');
const path = require('path');
const vision = require('@google-cloud/vision');
var router = express.Router();
const multer = require('multer');
const isLocalEnvironment = process.env.NODE_ENV !== 'production'; // Detect local development environment



// const storageOptions = {
//   projectId: 'take-stock-364901',
// };

// if (isLocalEnvironment) {
//   storageOptions.keyFilename = path.join(__dirname, '../devkeys/take-stock-364901-c11c49339bff.json');
// }

// Create a Vision API client using the default service account identity

// Load the service account key JSON if in local/demo environment
let visionClient;
if (process.env.NODE_ENV !== 'production' || process.env.NODE_ENV === 'demo') {
  const serviceAccountKeyPath = path.join(__dirname, '../devkeys/take-stock-364901-c11c49339bff.json');
  const serviceAccountKey = require(serviceAccountKeyPath);
  visionClient = new vision.ImageAnnotatorClient({ credentials: serviceAccountKey });
} else {
  // Initialize the Google Cloud Vision API client without credentials (for production)
  visionClient = new vision.ImageAnnotatorClient();
}


// const visionClient = new vision.ImageAnnotatorClient();

// app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 5MB limit
  },
});

// POST route to analyze an uploaded image
router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const imageBuffer = req.file.buffer;

    // Analyze the image using Google Cloud Vision API
    const [result] = await visionClient.annotateImage({
      image: { content: imageBuffer },
      features: [
        { type: 'LABEL_DETECTION', maxResults: 10 },
        { type: 'TEXT_DETECTION' },
        { type: 'OBJECT_LOCALIZATION', maxResults: 10 },
        { type: 'IMAGE_PROPERTIES', maxResults: 10 },
      ],
    });

    const labels = result.labelAnnotations.map(label => label.description);
    const objects = result.localizedObjectAnnotations.map(obj => obj.name);
    const colors = result.imagePropertiesAnnotation.dominantColors.colors;
    const detectedText = result.textAnnotations[0]?.description || '';

    res.json({ labels, objects, colors, detectedText });
  } catch (error) {
    console.error('Error analyzing image:', error);
    res.status(500).send('Internal server error');
  }
});

module.exports = router;
