(() => {
  if (window.__zaloStickerBridgeInstalled) {
    return;
  }

  window.__zaloStickerBridgeInstalled = true;
  window.__zaloStickerResources = window.__zaloStickerResources || [];

  const seenUrls = new Set(window.__zaloStickerResources.map((item) => item.url));
  const originalFetch = window.fetch;
  const originalXhrOpen = XMLHttpRequest.prototype.open;

  function isStickerSpriteUrl(url) {
    try {
      const parsedUrl = new URL(url, window.location.href);
      return parsedUrl.hostname === "zalo-api.zadn.vn" && /api\/emoticon/i.test(parsedUrl.pathname);
    } catch {
      return false;
    }
  }

  function pushResource(resource) {
    window.__zaloStickerResources.push(resource);
    window.dispatchEvent(
      new CustomEvent("zalo-sticker-sprite", {
        detail: resource,
      }),
    );
  }

  function emitSpriteUrl(url, source = "unknown") {
    if (!url || seenUrls.has(url)) {
      return;
    }

    if (!isStickerSpriteUrl(url)) {
      return;
    }

    seenUrls.add(url);
    pushResource({ url, source, timestamp: Date.now() });
  }

  function scanExistingResources() {
    const entries = performance.getEntriesByType("resource");
    for (const entry of entries) {
      emitSpriteUrl(entry.name, "performance");
    }
  }

  function observeNewResources() {
    if (typeof PerformanceObserver !== "function") {
      return;
    }

    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          emitSpriteUrl(entry.name, "performance-observer");
        }
      });

      observer.observe({ type: "resource", buffered: true });
    } catch {
      // Ignore observer failures in unsupported browsers.
    }
  }

  function respondWithSnapshot(event) {
    window.dispatchEvent(
      new CustomEvent("zalo-sticker-snapshot-response", {
        detail: {
          requestId: event?.detail?.requestId || null,
          resources: [...window.__zaloStickerResources],
          timestamp: Date.now(),
        },
      }),
    );
  }

  window.addEventListener("zalo-sticker-snapshot-request", respondWithSnapshot);

  scanExistingResources();
  observeNewResources();
  respondWithSnapshot();

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    emitSpriteUrl(url || response.url, "fetch");
    return response;
  };

  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    emitSpriteUrl(typeof url === "string" ? url : "", "xhr");
    return originalXhrOpen.call(this, method, url, ...rest);
  };
})();
