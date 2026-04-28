import { GifWriter } from "../vendor/omggif-esm.js";

export async function buildGifBlob(frames, duration = 100, loop = 0) {
  if (!frames.length) {
    throw new Error("Không có frame hợp lệ để tạo GIF.");
  }

  if (typeof GifWriter !== "function") {
    throw new Error("Không nạp được thư viện omggif.");
  }

  const width = frames[0].width;
  const height = frames[0].height;
  const framePayloads = frames.map((frame) => buildFramePayload(frame, width, height));
  const estimatedSize = estimateGifSize(width, height, framePayloads);
  const output = new Uint8Array(estimatedSize);
  const writer = new GifWriter(output, width, height, { loop });

  for (const frame of framePayloads) {
    writer.addFrame(0, 0, width, height, frame.indexedPixels, {
      delay: Math.max(2, Math.round(duration / 10)),
      disposal: 2,
      transparent: 0,
      palette: frame.palette,
    });
  }

  const finalSize = writer.end();
  return new Blob([output.slice(0, finalSize)], { type: "image/gif" });
}

function buildFramePayload(frame, width, height) {
  const rgba = getFrameRgba(frame, width, height);
  const palette = buildLocalPalette(rgba);
  const indexedPixels = rgbaToIndexedPixels(rgba, palette);

  return {
    palette,
    indexedPixels,
  };
}

function getFrameRgba(frame, width, height) {
  const context = frame.getContext("2d", { willReadFrequently: true });
  return context.getImageData(0, 0, width, height).data;
}

function buildLocalPalette(rgba) {
  const palette = [0x000000];
  const buckets = new Map();

  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3];
    if (alpha === 0) {
      continue;
    }

    const red = rgba[index];
    const green = rgba[index + 1];
    const blue = rgba[index + 2];
    const bucketKey = quantizeColorKey(red, green, blue);
    const bucket = buckets.get(bucketKey) || {
      count: 0,
      redSum: 0,
      greenSum: 0,
      blueSum: 0,
    };

    bucket.count += 1;
    bucket.redSum += red;
    bucket.greenSum += green;
    bucket.blueSum += blue;
    buckets.set(bucketKey, bucket);
  }

  const rankedBuckets = [...buckets.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 255);

  for (const bucket of rankedBuckets) {
    const red = Math.round(bucket.redSum / bucket.count);
    const green = Math.round(bucket.greenSum / bucket.count);
    const blue = Math.round(bucket.blueSum / bucket.count);
    palette.push(rgbToInt(red, green, blue));
  }

  while (palette.length < 2) {
    palette.push(0x000000);
  }

  while (!isPowerOfTwo(palette.length)) {
    palette.push(palette[palette.length - 1]);
  }

  return palette;
}

function quantizeColorKey(red, green, blue) {
  const redBucket = red >> 3;
  const greenBucket = green >> 3;
  const blueBucket = blue >> 3;
  return (redBucket << 10) | (greenBucket << 5) | blueBucket;
}

function rgbaToIndexedPixels(rgba, palette) {
  const colorIndex = new Map(palette.map((color, index) => [color, index]));
  const indexedPixels = new Uint8Array(rgba.length / 4);

  for (let sourceIndex = 0, pixelIndex = 0; sourceIndex < rgba.length; sourceIndex += 4, pixelIndex += 1) {
    const alpha = rgba[sourceIndex + 3];
    if (alpha === 0) {
      indexedPixels[pixelIndex] = 0;
      continue;
    }

    const color = rgbToInt(rgba[sourceIndex], rgba[sourceIndex + 1], rgba[sourceIndex + 2]);
    indexedPixels[pixelIndex] = colorIndex.get(color) ?? findNearestPaletteIndex(color, palette);
  }

  return indexedPixels;
}

function rgbToInt(red, green, blue) {
  return (red << 16) | (green << 8) | blue;
}

function findNearestPaletteIndex(color, palette) {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < palette.length; index += 1) {
    const paletteColor = palette[index];
    const paletteRed = (paletteColor >> 16) & 0xff;
    const paletteGreen = (paletteColor >> 8) & 0xff;
    const paletteBlue = paletteColor & 0xff;
    const distance =
      (red - paletteRed) ** 2 +
      (green - paletteGreen) ** 2 +
      (blue - paletteBlue) ** 2;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function estimateGifSize(width, height, framePayloads) {
  let total = 2048;

  for (const frame of framePayloads) {
    total += width * height;
    total += frame.palette.length * 3;
    total += 2048;
  }

  return total;
}

function isPowerOfTwo(value) {
  return value >= 2 && (value & (value - 1)) === 0;
}
