export async function blobToImageBitmap(blob) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }

  const image = await blobToImageElement(blob);
  return imageToCanvasSource(image);
}

async function blobToImageElement(blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageToCanvasSource(image) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return canvas;
}

export function inferFrameSize(imageWidth, imageHeight, fallbackSize = 130) {
  if (imageHeight > 0 && imageWidth % imageHeight === 0) {
    return imageHeight;
  }

  if (fallbackSize > 0 && imageWidth % fallbackSize === 0) {
    return fallbackSize;
  }

  return imageHeight || fallbackSize;
}

export function inferFrameCount(imageWidth, frameWidth) {
  return Math.max(1, Math.floor(imageWidth / frameWidth));
}

export function sliceFrames(imageSource, frameWidth, frameHeight, frameCount) {
  const frames = [];

  for (let index = 0; index < frameCount; index += 1) {
    const frameCanvas = new OffscreenCanvas(frameWidth, frameHeight);
    const context = frameCanvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.drawImage(
      imageSource,
      index * frameWidth,
      0,
      frameWidth,
      frameHeight,
      0,
      0,
      frameWidth,
      frameHeight,
    );

    if (!isEmptyFrame(context, frameWidth, frameHeight)) {
      frames.push(frameCanvas);
    }
  }

  return frames;
}

export function isEmptyFrame(context, width, height) {
  const imageData = context.getImageData(0, 0, width, height).data;

  for (let index = 3; index < imageData.length; index += 4) {
    if (imageData[index] !== 0) {
      return false;
    }
  }

  return true;
}

export async function canvasToPngBlob(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    return canvas.convertToBlob({ type: "image/png" });
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

export async function imageBlobToPngBlob(blob) {
  const imageSource = await blobToImageBitmap(blob);
  const canvas = new OffscreenCanvas(imageSource.width, imageSource.height);
  const context = canvas.getContext("2d");
  context.drawImage(imageSource, 0, 0);
  return canvasToPngBlob(canvas);
}

export async function extractFramesFromSprite(blob, fallbackSize = 130) {
  const imageSource = await blobToImageBitmap(blob);
  const frameSize = inferFrameSize(imageSource.width, imageSource.height, fallbackSize);
  const frameCount = inferFrameCount(imageSource.width, frameSize);
  const frames = sliceFrames(imageSource, frameSize, frameSize, frameCount);

  return {
    frameWidth: frameSize,
    frameHeight: frameSize,
    frameCount,
    frames,
  };
}
