'use strict';

const visionService = require('./visionService');

async function augmentItemFromImage(imageSource, mimeType, provider, itemHint) {
  return visionService.analyzeItemPhoto(imageSource, mimeType, provider, undefined, itemHint);
}

async function augmentBatchFromImages(images, provider) {
  const results = await Promise.allSettled(
    images.map(async (image) => {
      const { imageSource, mimeType } = image;
      return visionService.analyzeItemPhoto(imageSource, mimeType, provider);
    })
  );

  return results.map((result) =>
    result.status === 'fulfilled'
      ? result.value
      : { success: false, error: result.reason?.message || 'Unknown error' }
  );
}

module.exports = {
  augmentItemFromImage,
  augmentBatchFromImages
};
