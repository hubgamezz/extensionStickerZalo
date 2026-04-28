import { buildUniqueFilename } from "./lib/naming.js";
import { buildGifBlob } from "./lib/gif.js";
import { extractFramesFromSprite } from "./lib/sprite.js";

const sessionNames = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "download-sticker") {
    downloadSticker(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "download-pack") {
    downloadPack(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function downloadPack(payload) {
  const results = [];

  for (const sticker of payload.stickers || []) {
    try {
      const result = await downloadSticker({ ...payload, sticker });
      results.push({ sticker: sticker.name, success: true, ...result });
    } catch (error) {
      results.push({ sticker: sticker.name, success: false, error: error.message });
    }
  }

  return results;
}

async function downloadSticker(payload) {
  const { packName, sticker, duration = 100, fallbackFrameSize = 130 } = payload;

  if (!sticker?.url) {
    throw new Error("Sticker không có URL sprite để tải.");
  }

  const response = await fetch(sticker.url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Tải sprite thất bại: ${response.status}`);
  }

  const blob = await response.blob();
  const inferredFrameSize = Number(sticker.frameSize) || Number(sticker.height) || Number(fallbackFrameSize) || 130;
  const { frames } = await extractFramesFromSprite(blob, inferredFrameSize);

  if (!frames.length) {
    throw new Error("Không tách được frame hợp lệ từ sprite.");
  }

  const gifBlob = await buildGifBlob(frames, Number(duration) || 100, 0);
  const fileName = buildUniqueFilename(packName, sticker.name, sessionNames);
  const dataUrl = await blobToDataUrl(gifBlob);

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: fileName,
    saveAs: false,
    conflictAction: "uniquify",
  });

  return { downloadId, fileName };
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 = btoa(binary);
  return `data:${blob.type};base64,${base64}`;
}
