const observedStickerUrls = [];
const observedStickerUrlSet = new Set();
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

  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.getURL) {
    return;
  }

  bridgeInjected = true;
  const script = document.createElement("script");
  script.src = runtime.getURL("page-bridge.js");
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
  if (!url || !isStickerResourceUrl(url) || observedStickerUrlSet.has(url)) {
    return;
  }

  observedStickerUrlSet.add(url);
  observedStickerUrls.push({
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
      resolve([...observedStickerUrls]);
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

      resolve([...observedStickerUrls]);
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

  for (const item of observedStickerUrls) {
    const source = item.source || "unknown";
    bySource[source] = (bySource[source] || 0) + 1;
  }

  return {
    total: observedStickerUrls.length,
    bySource,
    items: [...observedStickerUrls],
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

function isStaticStickerResourceUrl(url) {
  return /\/webpc\?/i.test(String(url || ""));
}

function isStickerResourceUrl(url) {
  return isSpriteResourceUrl(url) || isStaticStickerResourceUrl(url);
}

function getStickerKindFromUrl(url) {
  if (isSpriteResourceUrl(url)) {
    return "animated";
  }

  if (isStaticStickerResourceUrl(url)) {
    return "static";
  }

  return "unknown";
}

function pushObservedSticker(stickerItems, seenUrls, url, previewUrl = url, fallbackName = null) {
  if (!isStickerResourceUrl(url) || seenUrls.has(url)) {
    return;
  }

  const kind = getStickerKindFromUrl(url);
  const dimensions = extractObservedDimensions(url);
  if (kind === "animated" && dimensions.width && dimensions.height && !looksLikeSpriteStrip(dimensions.width, dimensions.height)) {
    return;
  }

  seenUrls.add(url);
  stickerItems.push({
    id: `${stickerItems.length}`,
    name: fallbackName || extractObservedStickerName(url, stickerItems.length),
    url,
    previewUrl,
    kind,
    width: dimensions.width,
    height: dimensions.height,
  });
}

function collectObservedSprites(stickerItems, seenUrls, previewCandidates) {
  const fallbackPreview = previewCandidates[0] || null;
  const allowedEids = new Set(
    previewCandidates
      .map((candidate) => extractStickerEid(candidate.previewUrl))
      .filter(Boolean),
  );
  const allowedPreviewUrls = new Set(previewCandidates.map((candidate) => candidate.previewUrl).filter(Boolean));

  for (const item of observedStickerUrls) {
    const observedEid = extractStickerEid(item.url);
    const matchesCurrentPack =
      (observedEid && allowedEids.has(observedEid)) ||
      allowedPreviewUrls.has(item.url);

    if (allowedEids.size && allowedPreviewUrls.size && !matchesCurrentPack) {
      continue;
    }

    const name = extractObservedStickerName(item.url, stickerItems.length);
    const preview =
      previewCandidates.find((candidate) => extractStickerEid(candidate.previewUrl) === observedEid)?.previewUrl ||
      fallbackPreview?.previewUrl ||
      extractObservedPreviewUrl(item.url);
    pushObservedSticker(stickerItems, seenUrls, item.url, preview, name);
  }
}

function shouldIncludeDomSticker(url, dimensions) {
  const kind = getStickerKindFromUrl(url);
  if (kind === "animated") {
    return looksLikeSpriteStrip(dimensions.width, dimensions.height);
  }

  return kind === "static";
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

  const previewByEid = new Map(
    previewCandidates
      .map((candidate) => {
        const eid = extractStickerEid(candidate.previewUrl);
        return eid ? [eid, candidate] : null;
      })
      .filter(Boolean),
  );

  return stickerItems.map((sticker) => {
    const eid = extractStickerEid(sticker.url) || extractStickerEid(sticker.previewUrl);
    const matchedPreview = eid ? previewByEid.get(eid) : null;

    return {
      ...sticker,
      previewUrl: matchedPreview?.previewUrl || sticker.previewUrl,
      displayName: matchedPreview?.name || sticker.displayName || sticker.name,
    };
  });
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
  return /api\/emoticon\/sticker\/sprite/i.test(String(url || "")) || /\/sprite\?/i.test(String(url || ""));
}

function choosePreferredSticker(items) {
  return (
    items.find((item) => item.kind === "animated" && !isFallbackStickerName(item.displayName)) ||
    items.find((item) => item.kind === "animated") ||
    items.find((item) => item.kind === "static" && !isFallbackStickerName(item.displayName)) ||
    items.find((item) => item.kind === "static") ||
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
    kind: sticker.kind || getStickerKindFromUrl(sticker.url),
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
  let domAddedCount = 0;

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
  const observedAddedCount = stickerItems.length;

  for (const element of candidates) {
    const url = extractAssetUrl(element);
    if (!url || !looksLikeStickerUrl(url) || seenUrls.has(url)) {
      continue;
    }

    const dimensions = getElementDimensions(element);
    if (!shouldIncludeDomSticker(url, dimensions)) {
      continue;
    }

    seenUrls.add(url);
    domAddedCount += 1;
    stickerItems.push({
      id: `${stickerItems.length}`,
      name: extractStickerName(element, stickerItems.length),
      displayName: extractStickerName(element, stickerItems.length),
      url,
      previewUrl: url,
      kind: getStickerKindFromUrl(url),
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  const finalizedStickers = finalizeStickerItems(stickerItems, previewCandidates);
  const staticPreviewUrls = previewCandidates
    .map((item) => item.previewUrl)
    .filter((url) => getStickerKindFromUrl(url) === "static");

  const observedUrls = observedStickerUrls.map((item) => item.url);
  const observedSpriteUrlsOnly = observedUrls.filter((url) => getStickerKindFromUrl(url) === "animated");
  const previewEids = previewCandidates
    .map((item) => extractStickerEid(item.previewUrl))
    .filter(Boolean);
  const observedAnimatedEids = observedSpriteUrlsOnly
    .map((url) => extractStickerEid(url))
    .filter(Boolean);
  const missingAnimatedPreviewEids = [...new Set(previewEids.filter((eid) => !observedAnimatedEids.includes(eid)))];

  const scanDebug = {
    candidateCount: candidates.length,
    previewCandidateCount: previewCandidates.length,
    staticPreviewCandidateCount: staticPreviewUrls.length,
    observedResourceCount: observedStickerUrls.length,
    observedAddedCount,
    domAddedCount,
    rawStickerCount: stickerItems.length,
    finalStickerCount: finalizedStickers.length,
    finalStaticCount: finalizedStickers.filter((item) => item.kind === "static").length,
    observedUrls,
    observedSpriteUrlsOnly,
    previewEids,
    observedAnimatedEids,
    missingAnimatedPreviewEids,
    sampleStaticPreviewUrls: staticPreviewUrls.slice(0, 5),
    sampleFinalStickers: finalizedStickers.slice(0, 5).map((item) => ({
      kind: item.kind,
      url: item.url,
      previewUrl: item.previewUrl,
      width: item.width,
      height: item.height,
    })),
    finalStickersSummary: finalizedStickers.map((item) => ({
      kind: item.kind,
      url: item.url,
      previewUrl: item.previewUrl,
      eidFromUrl: extractStickerEid(item.url),
      eidFromPreview: extractStickerEid(item.previewUrl),
    })),
  };
  console.log("[zalo-sticker-missing-animated-eids]", missingAnimatedPreviewEids);
  console.log("[zalo-sticker-observed-animated-eids]", observedAnimatedEids);
  console.log("[zalo-sticker-preview-eids]", previewEids);
  window.__zaloStickerLastScanDebug = scanDebug;
  console.log("[zalo-sticker-scan]", scanDebug);

  return {
    packName: extractPackName(),
    stickers: finalizedStickers,
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

function isCompactStickerTile(element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return rect.width <= 220 && rect.height <= 220;
}

function findHoverTarget(element) {
  if (!(element instanceof Element)) {
    return null;
  }

  let current = element;
  while (current && current !== document.body) {
    if (
      current instanceof HTMLElement &&
      (
        current.matches("button, [role='button'], [tabindex], a") ||
        (isCompactStickerTile(current) && current.className?.toString().includes("sticker"))
      )
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return element instanceof HTMLElement ? element : null;
}

function collectPreviewCandidates(elements) {
  const previewCandidates = [];
  const seenPreviewUrls = new Set();

  for (const element of elements) {
    const url = extractAssetUrl(element);
    if (!url || !looksLikeStickerUrl(url) || seenPreviewUrls.has(url)) {
      continue;
    }

    seenPreviewUrls.add(url);
    previewCandidates.push({
      name: extractStickerName(element, previewCandidates.length),
      previewUrl: url,
      eid: extractStickerEid(url),
      previewElement: element,
      hoverTarget: findHoverTarget(element),
    });
  }

  return previewCandidates;
}

function waitForDelay(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function dispatchHoverSequence(target) {
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const events = ["pointerover", "mouseover", "mouseenter", "pointermove", "mousemove"];
  for (const eventName of events) {
    target.dispatchEvent(
      new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      }),
    );
  }

  if (typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
}

async function collectHoverObservedResources(previewCandidates) {
  const focusBeforeScan = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  for (let index = 0; index < previewCandidates.length; index += 1) {
    const candidate = previewCandidates[index];
    const target = candidate.hoverTarget;
    if (!(target instanceof HTMLElement)) {
      continue;
    }

    if (!isElementFullyVisible(target)) {
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
      await waitForDelay(50);
    }

    dispatchHoverSequence(target);
    await waitForDelay(180);
    await requestObservedSnapshot();
  }

  if (focusBeforeScan && typeof focusBeforeScan.focus === "function") {
    focusBeforeScan.focus({ preventScroll: true });
  }
}

function isElementFullyVisible(element) {
  const rect = element.getBoundingClientRect();
  return rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
}

function buildDomStickerItems(elements, seenUrls, existingCount = 0) {
  const stickerItems = [];

  for (const element of elements) {
    const url = extractAssetUrl(element);
    if (!url || !looksLikeStickerUrl(url) || seenUrls.has(url)) {
      continue;
    }

    const dimensions = getElementDimensions(element);
    if (!shouldIncludeDomSticker(url, dimensions)) {
      continue;
    }

    seenUrls.add(url);
    stickerItems.push({
      id: `${existingCount + stickerItems.length}`,
      name: extractStickerName(element, existingCount + stickerItems.length),
      displayName: extractStickerName(element, existingCount + stickerItems.length),
      url,
      previewUrl: url,
      kind: getStickerKindFromUrl(url),
      width: dimensions.width,
      height: dimensions.height,
    });
  }

  return stickerItems;
}

function mergeStickerItemsByEid(primaryItems, secondaryItems) {
  const grouped = new Map();

  for (const item of [...primaryItems, ...secondaryItems]) {
    const eid = extractStickerEid(item.url) || extractStickerEid(item.previewUrl);
    const key = eid || `${item.previewUrl || ""}::${item.url || ""}`;
    const items = grouped.get(key) || [];
    items.push(item);
    grouped.set(key, items);
  }

  return Array.from(grouped.values()).map((items) => choosePreferredSticker(items));
}

function getAnimatedObservedEids(resources) {
  return resources
    .map((item) => item?.url || item)
    .filter((url) => getStickerKindFromUrl(url) === "animated")
    .map((url) => extractStickerEid(url))
    .filter(Boolean);
}

function getMissingAnimatedPreviewEids(previewCandidates, resources) {
  const previewEids = previewCandidates.map((item) => item.eid).filter(Boolean);
  const observedAnimatedEids = getAnimatedObservedEids(resources);
  return [...new Set(previewEids.filter((eid) => !observedAnimatedEids.includes(eid)))];
}

async function upgradeAnimatedByHover(previewCandidates) {
  const initialSnapshot = await requestObservedSnapshot();
  const initialMissingAnimatedEids = getMissingAnimatedPreviewEids(previewCandidates, initialSnapshot);

  if (!initialMissingAnimatedEids.length) {
    return {
      initialSnapshot,
      finalSnapshot: initialSnapshot,
      initialMissingAnimatedEids,
      finalMissingAnimatedEids: initialMissingAnimatedEids,
    };
  }

  const hoverCandidates = previewCandidates.filter((candidate) => initialMissingAnimatedEids.includes(candidate.eid));
  await collectHoverObservedResources(hoverCandidates);
  const finalSnapshot = await requestObservedSnapshot();
  const finalMissingAnimatedEids = getMissingAnimatedPreviewEids(previewCandidates, finalSnapshot);

  return {
    initialSnapshot,
    finalSnapshot,
    initialMissingAnimatedEids,
    finalMissingAnimatedEids,
  };
}

async function scanCurrentPack() {
  const candidates = Array.from(document.querySelectorAll("img, [style*='background-image']"));
  const previewCandidates = collectPreviewCandidates(candidates);
  await upgradeAnimatedByHover(previewCandidates);

  const stickerItems = [];
  const seenUrls = new Set();
  collectObservedSprites(stickerItems, seenUrls, previewCandidates);

  const domStickerItems = buildDomStickerItems(candidates, seenUrls, stickerItems.length);
  const mergedStickerItems = mergeStickerItemsByEid(stickerItems, domStickerItems);
  const finalizedStickers = finalizeStickerItems(mergedStickerItems, previewCandidates);

  return {
    packName: extractPackName(),
    stickers: finalizedStickers,
  };
}

function looksLikeStickerUrl(url) {
  return isStickerResourceUrl(url);
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
