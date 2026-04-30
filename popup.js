const scanBtn = document.getElementById("scanBtn");
const downloadAllBtn = document.getElementById("downloadAllBtn");
const durationInput = document.getElementById("durationInput");
const frameSizeInput = document.getElementById("frameSizeInput");
const packNameEl = document.getElementById("packName");
const statusEl = document.getElementById("status");
const selectionRowEl = document.getElementById("selectionRow");
const selectAllCheckboxEl = document.getElementById("selectAllCheckbox");
const filterAllBtn = document.getElementById("filterAllBtn");
const filterAnimatedBtn = document.getElementById("filterAnimatedBtn");
const filterStaticBtn = document.getElementById("filterStaticBtn");
const selectedCountEl = document.getElementById("selectedCount");
const resultsEl = document.getElementById("results");
const debugMetaEl = document.getElementById("debugMeta");
const debugListEl = document.getElementById("debugList");

let currentScanResult = null;
let selectedStickerKeys = new Set();
let currentFilter = "all";

scanBtn.addEventListener("click", handleScan);
downloadAllBtn.addEventListener("click", handleDownloadAll);
selectAllCheckboxEl.addEventListener("change", handleToggleSelectAll);
filterAllBtn.addEventListener("click", () => applyFilter("all"));
filterAnimatedBtn.addEventListener("click", () => applyFilter("animated"));
filterStaticBtn.addEventListener("click", () => applyFilter("static"));

function matchesCurrentFilter(sticker) {
  if (currentFilter === "animated") {
    return isAnimatedSticker(sticker);
  }

  if (currentFilter === "static") {
    return !isAnimatedSticker(sticker);
  }

  return true;
}

function getVisibleStickers() {
  return (currentScanResult?.stickers || []).filter((sticker) => matchesCurrentFilter(sticker));
}

function updateFilterButtons() {
  filterAllBtn.classList.toggle("active", currentFilter === "all");
  filterAnimatedBtn.classList.toggle("active", currentFilter === "animated");
  filterStaticBtn.classList.toggle("active", currentFilter === "static");
}

function applyFilter(filter) {
  currentFilter = filter;

  if (currentScanResult) {
    selectFilteredStickers();
    renderScanResult(currentScanResult);
  }

  updateFilterButtons();
  syncSelectedCount();
}

function selectVisibleStickers() {
  for (const sticker of getVisibleStickers()) {
    selectedStickerKeys.add(getStickerKey(sticker));
  }
}

function clearVisibleStickers() {
  const visibleKeys = new Set(getVisibleStickers().map((sticker) => getStickerKey(sticker)));
  selectedStickerKeys = new Set([...selectedStickerKeys].filter((key) => !visibleKeys.has(key)));
}

function updateSelectedSummary(selected, total, visibleSelected, visibleTotal) {
  if (visibleTotal !== total) {
    selectedCountEl.textContent = `Đã chọn ${visibleSelected}/${visibleTotal} (hiển thị) • Tổng ${selected}/${total}`;
    return;
  }

  selectedCountEl.textContent = `Đã chọn ${selected}/${total}`;
}

updateFilterButtons();

function getStickerKey(sticker) {
  return sticker?.id || sticker?.url || "";
}

function syncSelectedCount() {
  const stickers = currentScanResult?.stickers || [];
  const visibleStickers = getVisibleStickers();
  const total = stickers.length;
  const selected = stickers.filter((sticker) => selectedStickerKeys.has(getStickerKey(sticker))).length;
  const visibleTotal = visibleStickers.length;
  const visibleSelected = visibleStickers.filter((sticker) => selectedStickerKeys.has(getStickerKey(sticker))).length;

  selectionRowEl.classList.toggle("visible", total > 0);
  updateSelectedSummary(selected, total, visibleSelected, visibleTotal);

  if (!visibleTotal) {
    selectAllCheckboxEl.checked = false;
    selectAllCheckboxEl.indeterminate = false;
    return;
  }

  selectAllCheckboxEl.checked = visibleSelected === visibleTotal;
  selectAllCheckboxEl.indeterminate = visibleSelected > 0 && visibleSelected < visibleTotal;
}

function selectAllStickers() {
  selectedStickerKeys = new Set((currentScanResult?.stickers || []).map((sticker) => getStickerKey(sticker)));
  syncSelectedCount();
}

function selectFilteredStickers() {
  selectedStickerKeys.clear();
  selectVisibleStickers();
  syncSelectedCount();
}

function resetFilter() {
  currentFilter = "all";
  updateFilterButtons();
}
function handleToggleSelectAll() {
  if (!currentScanResult?.stickers?.length) {
    return;
  }

  if (selectAllCheckboxEl.checked) {
    selectVisibleStickers();
  } else {
    clearVisibleStickers();
  }

  syncSelectedCount();
  renderScanResult(currentScanResult);
}

function getSelectedStickers() {
  return (currentScanResult?.stickers || []).filter((sticker) => selectedStickerKeys.has(getStickerKey(sticker)));
}

function resetSelection() {
  selectedStickerKeys.clear();
  selectionRowEl.classList.remove("visible");
  syncSelectedCount();
}

function toggleStickerSelection(sticker, isSelected) {
  const key = getStickerKey(sticker);
  if (!key) {
    return;
  }

  if (isSelected) {
    selectedStickerKeys.add(key);
  } else {
    selectedStickerKeys.delete(key);
  }

  syncSelectedCount();
}

async function handleScan() {
  setBusy(true);
  setStatus("Đang quét pack sticker hiện tại và bắt thêm sticker động...");

  try {
    const tab = await getActiveTab();
    const response = await sendMessageToZaloTab(tab.id, { type: "scan-current-pack" });
    const observedResponse = await sendMessageToZaloTab(tab.id, { type: "get-observed-sprites" });

    if (!response?.ok) {
      throw new Error(response?.error || "Không quét được pack sticker.");
    }

    currentScanResult = response.result;
    resetFilter();
    selectAllStickers();
    renderScanResult(currentScanResult);
    renderDebug(observedResponse?.result || { total: 0, bySource: {}, items: [] });
    setStatus(`Tìm thấy ${currentScanResult.stickers.length} sticker.`);
    syncSelectedCount();
  } catch (error) {
    currentScanResult = null;
    resultsEl.innerHTML = "";
    packNameEl.textContent = "Chưa quét pack";
    resetSelection();
    renderDebug({ total: 0, bySource: {}, items: [] });
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function handleDownloadAll() {
  if (!currentScanResult?.stickers?.length) {
    setStatus("Bạn cần quét pack trước khi tải.");
    return;
  }

  const selectedStickers = getSelectedStickers();
  if (!selectedStickers.length) {
    setStatus("Bạn cần chọn ít nhất một sticker để tải.");
    return;
  }

  setBusy(true);
  setStatus(`Đang tải ${selectedStickers.length} sticker đã chọn...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "download-pack",
      payload: {
        packName: currentScanResult.packName,
        stickers: selectedStickers,
        duration: Number(durationInput.value) || 100,
        fallbackFrameSize: Number(frameSizeInput.value) || 130,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Tải sticker đã chọn thất bại.");
    }

    const successCount = response.result.filter((item) => item.success).length;
    if (successCount === response.result.length) {
      setStatus(`Đã tải thành công ${successCount} sticker.`);
    } else {
      setStatus(`Đã tải thành công ${successCount}/${response.result.length} sticker.`);
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function renderScanResult(scanResult) {
  packNameEl.textContent = scanResult.packName || "zalo_sticker_pack";
  resultsEl.innerHTML = "";

  for (const sticker of scanResult.stickers) {
    const item = document.createElement("div");
    item.className = "item";
    item.classList.toggle("hidden", !matchesCurrentFilter(sticker));

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "item-checkbox";
    checkbox.checked = selectedStickerKeys.has(getStickerKey(sticker));
    checkbox.addEventListener("change", () => {
      toggleStickerSelection(sticker, checkbox.checked);
    });

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";

    const thumb = document.createElement("img");
    thumb.className = "thumb preview-image cover visible";
    thumb.src = sticker.previewUrl || sticker.url;
    thumb.alt = sticker.name;

    thumbWrap.appendChild(thumb);

    if (isAnimatedSticker(sticker)) {
      thumbWrap.classList.add("is-sprite");
      thumb.classList.add("sprite-fallback");

      const canvas = document.createElement("canvas");
      canvas.className = "thumb-canvas";
      canvas.width = 72;
      canvas.height = 72;
      thumbWrap.appendChild(canvas);
      renderSpritePreview(canvas, thumbWrap, sticker).catch(() => {
        thumbWrap.classList.remove("sprite-ready");
      });
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const kindLabel = isAnimatedSticker(sticker) ? "Sticker động" : "Sticker tĩnh";
    const kindClass = isAnimatedSticker(sticker) ? "animated" : "static";
    meta.innerHTML = `<strong>${escapeHtml(sticker.displayName || sticker.name)}</strong><span>${escapeHtml(sticker.url)}</span><span class="item-kind ${kindClass}">${kindLabel}</span>`;

    const button = document.createElement("button");
    button.className = "inline-btn secondary";
    button.type = "button";
    button.textContent = isAnimatedSticker(sticker) ? "Tải GIF" : "Tải PNG";
    button.addEventListener("click", () => handleDownloadOne(sticker));

    item.append(checkbox, thumbWrap, meta, button);
    resultsEl.appendChild(item);
  }
}

function isAnimatedSticker(sticker) {
  return sticker?.kind === "animated" || String(sticker?.url || "").includes("/sprite?");
}

async function renderSpritePreview(canvas, thumbWrap, sticker) {
  const response = await fetch(sticker.url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Preview sprite thất bại: ${response.status}`);
  }

  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const frameSize = Number(sticker.frameSize) || Number(sticker.height) || 130;
  const context = canvas.getContext("2d");

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;

  const scale = Math.min(canvas.width / frameSize, canvas.height / frameSize);
  const targetWidth = frameSize * scale;
  const targetHeight = frameSize * scale;
  const left = (canvas.width - targetWidth) / 2;
  const top = (canvas.height - targetHeight) / 2;

  context.drawImage(bitmap, 0, 0, frameSize, frameSize, left, top, targetWidth, targetHeight);
  thumbWrap.classList.add("sprite-ready");
}

async function handleDownloadOne(sticker) {
  setBusy(true);
  setStatus(`Đang tải ${sticker.name}...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "download-sticker",
      payload: {
        packName: currentScanResult?.packName || "zalo_sticker_pack",
        sticker,
        duration: Number(durationInput.value) || 100,
        fallbackFrameSize: Number(frameSizeInput.value) || 130,
      },
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Tạo GIF thất bại.");
    }

    setStatus(`Tải thành công ${response.result.fileName}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy) {
  scanBtn.disabled = isBusy;
  downloadAllBtn.disabled = isBusy;
}

function setStatus(message) {
  statusEl.textContent = message;
}

function renderDebug(summary) {
  if (!debugMetaEl || !debugListEl) {
    return;
  }

  const entries = Array.isArray(summary) ? summary : summary?.items || [];
  const bySource = Array.isArray(summary) ? {} : summary?.bySource || {};
  const total = Array.isArray(summary) ? entries.length : Number(summary?.total) || entries.length;

  debugListEl.innerHTML = "";
  debugMetaEl.textContent = buildDebugMeta(total, bySource);

  for (const entry of entries.slice(0, 10)) {
    const item = document.createElement("div");
    item.className = "debug-item";
    item.textContent = `[${entry.source || "unknown"}] ${entry.url || entry}`;
    debugListEl.appendChild(item);
  }

  if (!entries.length) {
    const item = document.createElement("div");
    item.className = "debug-item";
    item.textContent = "Chưa bắt được URL nào từ page bridge. Hãy mở pack sticker rồi quét lại.";
    debugListEl.appendChild(item);
  }
}

function buildDebugMeta(total, bySource) {
  const sourceParts = Object.entries(bySource)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([source, count]) => `${source}: ${count}`);

  if (!sourceParts.length) {
    return `Debug: bridge bắt được ${total} URL.`;
  }

  return `Debug: bridge bắt được ${total} URL. ${sourceParts.join(" | ")}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("Không tìm thấy tab đang mở.");
  }
  return tab;
}

async function sendMessageToZaloTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!String(error?.message || "").includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    return chrome.tabs.sendMessage(tabId, message);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
