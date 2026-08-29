import { BadRequestException, Injectable, Logger } from '@nestjs/common';
// Type-only import: `mupdf`'s package is pure ESM with top-level await, so a
// static value import compiles to a `require('mupdf')` in this project's
// CommonJS build output, which throws `ERR_REQUIRE_ASYNC_MODULE` the moment
// this module loads — crashing the whole process before it can bind to its
// port. A dynamic `import()` (see `loadMupdf` below) is the one form Node's
// CJS/ESM interop allows for an async ESM graph; the type-only import here
// is erased at compile time and never reaches `require`.
import type * as MupdfModule from 'mupdf';

let mupdfPromise: Promise<typeof MupdfModule> | undefined;
function loadMupdf(): Promise<typeof MupdfModule> {
  mupdfPromise ??= import('mupdf');
  return mupdfPromise;
}

/**
 * Rasterizes PDF pages to PNG images — the "slides as images" alternative
 * to `AiService.generateBlocksFromText` for presentation-style uploads,
 * where a teacher wants each slide to become its own image block verbatim
 * (see `POST /lessons/:id/blocks/generate-from-file-as-slides`), not
 * AI-reinterpreted text.
 *
 * Uses `mupdf` — WASM, no native compilation — so this runs unmodified in
 * the same Cloud Run/App Hosting buildpack environment as the rest of the
 * API, unlike a canvas-based renderer (`pdfjs-dist` + `node-canvas`), which
 * would need native system libraries the buildpack doesn't provide.
 */
@Injectable()
export class PdfSlidesService {
  private readonly logger = new Logger(PdfSlidesService.name);

  /** Hard cap on rendered pages — protects against a pathological upload
   * (e.g. a 500-page PDF) turning into hundreds of image blocks. A PDF
   * over this cap is rejected outright rather than silently truncated,
   * so a teacher never gets a partial deck without knowing it. */
  private readonly maxPages = 60;

  /** Render scale — 2x gives crisp text on a typical display without
   * producing an oversized PNG per slide. */
  private readonly renderScale = 2;

  /** Render every page of a PDF to a PNG buffer, in order. Rejects PDFs
   * over `maxPages` and PDFs with zero pages. Yields to the event loop
   * between pages (this process also hosts the Socket.IO live-session
   * gateway, and mupdf rendering is fully synchronous) and destroys each
   * WASM page/pixmap as it's consumed to avoid leaking WASM heap memory. */
  async renderPages(buffer: Buffer): Promise<Buffer[]> {
    const mupdf = await loadMupdf();
    let doc: MupdfModule.Document;
    try {
      doc = mupdf.Document.openDocument(buffer, 'application/pdf');
    } catch (err) {
      this.logger.error(
        `PDF open failed: ${err instanceof Error ? err.message : err}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new BadRequestException('file_could_not_be_read');
    }

    try {
      const totalPages = doc.countPages();
      if (totalPages === 0) {
        throw new BadRequestException('file_has_no_pages');
      }
      if (totalPages > this.maxPages) {
        throw new BadRequestException('file_has_too_many_pages');
      }

      const images: Buffer[] = [];
      for (let i = 0; i < totalPages; i++) {
        let page: MupdfModule.Page | undefined;
        let pixmap: MupdfModule.Pixmap | undefined;
        try {
          page = doc.loadPage(i);
          pixmap = page.toPixmap(
            mupdf.Matrix.scale(this.renderScale, this.renderScale),
            mupdf.ColorSpace.DeviceRGB,
            false,
            true,
          );
          images.push(Buffer.from(pixmap.asPNG()));
        } catch (err) {
          this.logger.error(
            `PDF page ${i} render failed: ${err instanceof Error ? err.message : err}`,
            err instanceof Error ? err.stack : undefined,
          );
          throw new BadRequestException('file_could_not_be_read');
        } finally {
          pixmap?.destroy();
          page?.destroy();
        }
        // Yield to the event loop between pages so a large deck doesn't
        // starve concurrent I/O (Socket.IO live sessions, other requests).
        await new Promise((resolve) => setImmediate(resolve));
      }
      return images;
    } finally {
      doc.destroy();
    }
  }
}
