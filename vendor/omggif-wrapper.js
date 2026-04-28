import "./omggif.js";

let GifWriterRef = null;

if (typeof exports !== "undefined" && exports?.GifWriter) {
  GifWriterRef = exports.GifWriter;
}

if (!GifWriterRef && typeof module !== "undefined" && module?.exports?.GifWriter) {
  GifWriterRef = module.exports.GifWriter;
}

if (!GifWriterRef && globalThis?.GifWriter) {
  GifWriterRef = globalThis.GifWriter;
}

export const GifWriter = GifWriterRef;
