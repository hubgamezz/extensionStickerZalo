const observedSpriteUrls = [];
const observedSpriteUrlSet = new Set();
let bridgeInjected = false;
let snapshotRequestId = 0;

listenBridgeEvents();
injectBridge();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "scan-current-pack") {
    scanCurrentPack()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "get-observed-sprites") {
    requestObservedSnapshot()
      .then(() => sendResponse({ ok: true, result: getObservedSpritesSummary() }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "refresh-observed-sprites") {
    requestObservedSnapshot()
      .then((resources) => sendResponse({ ok: true, result: resources }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

function injectBridge() {
  if (bridgeInjected) {
    return;
  }

  bridgeInjected = true;
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-bridge.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

function listenBridgeEvents() {
  window.addEventListener("zalo-sticker-sprite", (event) => {
    mergeObservedResource(event.detail);
  });
}

function mergeObservedResource(resource) {
  const url = resource?.url;
  if (!url || !isSpriteResourceUrl(url) || observedSpriteUrlSet.has(url)) {
    return;
  }

  observedSpriteUrlSet.add(url);
  observedSpriteUrls.push({
    url,
    source: resource?.source || "unknown",
    timestamp: Number(resource?.timestamp) || Date.now(),
  });
}

function requestObservedSnapshot() {
  const requestId = `${Date.now()}-${++snapshotRequestId}`;

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("zalo-sticker-snapshot-response", handleSnapshotResponse);
      resolve([...observedSpriteUrls]);
    }, 500);

    function handleSnapshotResponse(event) {
      if (event.detail?.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeoutId);
      window.removeEventListener("zalo-sticker-snapshot-response", handleSnapshotResponse);

      const resources = Array.isArray(event.detail?.resources) ? event.detail.resources : [];
      for (const resource of resources) {
        mergeObservedResource(resource);
      }

      resolve([...observedSpriteUrls]);
    }

    window.addEventListener("zalo-sticker-snapshot-response", handleSnapshotResponse);
    window.dispatchEvent(
      new CustomEvent("zalo-sticker-snapshot-request", {
        detail: { requestId },
      }),
    );
  });
}

function getObservedSpritesSummary() {
  const bySource = {};

  for (const item of observedSpriteUrls) {
    const source = item.source || "unknown";
    bySource[source] = (bySource[source] || 0) + 1;
  }

  return {
    total: observedSpriteUrls.length,
    bySource,
    items: [...observedSpriteUrls],
  };
}

function getElementDimensions(element) {
  if (element instanceof HTMLImageElement) {
    return {
      width: element.naturalWidth || element.width || 0,
      height: element.naturalHeight || element.height || 0,
    };
  }

  const rect = element.getBoundingClientRect();
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function parseSpriteDimensionsFromUrl(url) {
  const match = url.match(/(?:^|[?&_/.-])(\d{2,5})x(\d{2,5})(?:$|[?&_/.-])/i);
  if (!match) {
    return { width: 0, height: 0 };
  }

  return {
    width: Number(match[1]) || 0,
    height: Number(match[2]) || 0,
  };
}

function looksLikeSpriteStrip(width, height) {
  if (!width || !height) {
    return false;
  }

  if (width <= height) {
    return false;
  }

  const ratio = width / height;
  if (ratio < 2) {
    return false;
  }

  return width % height === 0 || Math.abs(width / height - Math.round(width / height)) < 0.05;
}

function buildStickerNameFromUrl(url, fallbackIndex) {
  try {
    const pathname = new URL(url).pathname;
    const rawName = pathname.split("/").pop()?.split(".")[0];
    return rawName || `sticker_${fallbackIndex + 1}`;
  } catch {
    return `sticker_${fallbackIndex + 1}`;
  }
}

function extractObservedStickerName(url, fallbackIndex) {
  return buildStickerNameFromUrl(url, fallbackIndex);
}

function extractObservedPreviewUrl(url) {
  return url;
}

function extractObservedDimensions(url) {
  return parseSpriteDimensionsFromUrl(url);
}

function pushObservedSticker(stickerItems, seenUrls, url, previewUrl = url, fallbackName = null) {
  if (!isSpriteResourceUrl(url) || seenUrls.has(url)) {
    return;
  }

  const dimensions = extractObservedDimensions(url);
  if (dimensions.width && dimensions.height && !looksLikeSpriteStrip(dimensions.width, dimensions.height)) {
    return;
  }

  seenUrls.add(url);
  stickerItems.push({
    id: `${stickerItems.length}`,
    name: fallbackName || extractObservedStickerName(url, stickerItems.length),
    url,
    previewUrl,
    width: dimensions.width,
    height: dimensions.height,
  });
}

function collectObservedSprites(stickerItems, seenUrls, previewCandidates) {
  const fallbackPreview = previewCandidates[0] || null;

  for (const item of observedSpriteUrls) {
    const name = extractObservedStickerName(item.url, stickerItems.length);
    const preview = fallbackPreview?.previewUrl || extractObservedPreviewUrl(item.url);
    pushObservedSticker(stickerItems, seenUrls, item.url, preview, name);
  }
}

function pickFrameSizeFromSticker(sticker, fallbackFrameSize) {
  const numericFallback = Number(fallbackFrameSize) || 130;
  const candidates = [sticker?.height, sticker?.width]
    .map((value) => Number(value) || 0)
    .filter((value) => value > 0);

  for (const candidate of candidates) {
    if (candidate > 0) {
      return candidate;
    }
  }

  return numericFallback;
}

function enrichPreviewCandidates(stickerItems, previewCandidates) {
  if (!previewCandidates.length) {
    return stickerItems;
  }

  return stickerItems.map((sticker, index) => ({
    ...sticker,
    previewUrl: previewCandidates[index]?.previewUrl || sticker.previewUrl,
    displayName: previewCandidates[index]?.name || sticker.name,
  }));
}

function isFallbackStickerName(value) {
  return /^sticker_\d+$/i.test(String(value || ""));
}

function extractStickerEid(url) {
  try {
    return new URL(url, window.location.href).searchParams.get("eid") || "";
  } catch {
    return "";
  }
}

function isSpriteResourceUrl(url) {
  return /\/sprite\?/i.test(String(url || ""));
}

function choosePreferredSticker(items) {
  return (
    items.find((item) => isSpriteResourceUrl(item.url) && !isFallbackStickerName(item.displayName)) ||
    items.find((item) => isSpriteResourceUrl(item.url)) ||
    items.find((item) => !isFallbackStickerName(item.displayName)) ||
    items[items.length - 1]
  );
}

function dedupeStickerItems(stickerItems) {
  const grouped = new Map();

  for (const sticker of stickerItems) {
    const eid = extractStickerEid(sticker.url) || extractStickerEid(sticker.previewUrl);
    const key = eid || `${sticker.previewUrl || ""}::${sticker.url || ""}`;
    const items = grouped.get(key) || [];
    items.push(sticker);
    grouped.set(key, items);
  }

  const deduped = [];

  for (const items of grouped.values()) {
    deduped.push(choosePreferredSticker(items));
  }

  return deduped.map((sticker, index) => ({
    ...sticker,
    id: `${index}`,
  }));
}

function finalizeStickerItems(stickerItems, previewCandidates) {
  return dedupeStickerItems(enrichPreviewCandidates(stickerItems, previewCandidates)).map((sticker, index) => ({
    ...sticker,
    displayName: `sticker-${index + 1}`,
    frameSize: pickFrameSizeFromSticker(sticker, sticker.height || sticker.width || 130),
  }));
}

async function scanCurrentPack() {
  await requestObservedSnapshot();

  const candidates = Array.from(document.querySelectorAll("img, [style*='background-image']"));
  const stickerItems = [];
  const seenUrls = new Set();
  const previewCandidates = [];

  for (const element of candidates) {
    const url = extractAssetUrl(element);
    if (!url || !looksLikeStickerUrl(url)) {
      continue;
    }

    previewCandidates.push({
      name: extractStickerName(element, previewCandidates.length),
      previewUrl: url,
    });
  }

  collectObservedSprites(stickerItems, seenUrls, previewCandidates);

  if (!stickerItems.length) {
    for (const element of candidates) {
      const url = extractAssetUrl(element);
      if (!url || !looksLikeStickerUrl(url) || seenUrls.has(url)) {
        continue;
      }

      const dimensions = getElementDimensions(element);
      if (!looksLikeSpriteStrip(dimensions.width, dimensions.height)) {
        continue;
      }

      seenUrls.add(url);
      stickerItems.push({
        id: `${stickerItems.length}`,
        name: extractStickerName(element, stickerItems.length),
        displayName: extractStickerName(element, stickerItems.length),
        url,
        previewUrl: url,
        width: dimensions.width,
        height: dimensions.height,
      });
    }
  }

  return {
    packName: extractPackName(),
    stickers: finalizeStickerItems(stickerItems, previewCandidates),
  };
}

function extractAssetUrl(element) {
  if (element instanceof HTMLImageElement && element.currentSrc) {
    return element.currentSrc;
  }

  const style = window.getComputedStyle(element).backgroundImage;
  const match = style.match(/url\(["']?(.*?)["']?\)/);
  return match?.[1] || "";
}

function looksLikeStickerUrl(url) {
  return /api\/emoticon\/sticker\/sprite/i.test(String(url || "")) || /\/sprite\?/i.test(String(url || ""));
}

function extractStickerName(element, index) {
  const aria = element.getAttribute("aria-label");
  const alt = element.getAttribute("alt");
  const title = element.getAttribute("title");
  return aria || alt || title || `sticker_${index + 1}`;
}

function extractPackName() {
  const headings = Array.from(document.querySelectorAll("h1, h2, h3, [class*='title'], [class*='header']"));
  const nonEmpty = headings.map((node) => node.textContent?.trim()).filter(Boolean);
  return nonEmpty[0] || document.title || "zalo_sticker_pack";
}
