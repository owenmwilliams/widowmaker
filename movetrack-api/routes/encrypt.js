var express = require('express');
var router = express.Router();


function arrayBufferToBase64(buffer) {
  const binary = new Uint8Array(buffer);
  const base64 = Buffer.from(String.fromCharCode(...binary));
  return base64;
}
// Endpoint to ping the CoinMarketCap API
router.post('/encrypt', async (req, res) => {
  try {
    // Get key from environment variable
    const encryptionKey = process.env.URL_ENCRYPTION_KEY;

    //  Get the URL slug from the request
    const url = req.query.url;

    // Generate the initialization vector
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Convert the key to an ArrayBuffer
    const keyEncoder = new TextEncoder();
    const keyArrayBuffer = keyEncoder.encode(encryptionKey);

    // Import the key
    const importedKey = await crypto.subtle.importKey(
        "raw",
        keyArrayBuffer,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
      );

    // Convert the value to Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(url);

    // Encrypt the data using AES-GCM
    const encryptedData = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      importedKey,
      data
    );
    
    // Convert the encrypted data to uint256
    const encrypted = new Uint8Array(encryptedData);

    // Send the encrypted data and the initialization vector
    res.json({ encrypted, iv });
  } catch (error) {
    res.status(500).json({ error: 'Encryption did not work' });
  }
});

router.post('/decrypt', async (req, res) => {
  try {
    // Get key from environment variable
    const encryptionKey = process.env.URL_ENCRYPTION_KEY;

    // Get the encrypted data and the initialization vector
    const encrypted = req.query.encrypted;
    const iv = req.query.iv;

    console.log('encrypted', encrypted)
    console.log('iv', iv)

    // const inputDecoder = new TextDecoder();
    // Convert the encrypted data to an ArrayBuffer
    const encryptedBuffer = Buffer.from(encrypted, 'base64');
    const encryptedArrayBuffer = encryptedBuffer.buffer.slice(encryptedBuffer.byteOffset, encryptedBuffer.byteOffset + encryptedBuffer.byteLength);

    console.log('encryptedArrayBuffer', encryptedArrayBuffer)

    // const ivDecoder = new TextDecoder();
    // Convert base64 to Buffer
    const ivBuffer = Buffer.from(iv, 'base64');

    // Convert Buffer to Uint8Array
    const ivArray = new Uint8Array(ivBuffer);

    console.log('ivArray', ivArray);

    // Convert the key to an ArrayBuffer
    const keyEncoder = new TextEncoder();
    const keyArrayBuffer = keyEncoder.encode(encryptionKey);

    // Import the key
    const importedKey = await crypto.subtle.importKey(
        "raw",
        keyArrayBuffer,
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"]
      );

    // Decrypt the data using AES-GCM
    const decryptedData = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivArray },
      importedKey,
      encryptedArrayBuffer
    );

    // Convert the decrypted data to a string
    const decoder = new TextDecoder();
    const decrypted = decoder.decode(decryptedData);
    
    // Send the decrypted data
    res.json({ decrypted });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Decryption did not work' });
  }
})

module.exports = router;