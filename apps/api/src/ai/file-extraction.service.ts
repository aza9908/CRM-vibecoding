import { BadRequestException, Injectable } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

/**
 * Extracts plain text from a teacher-uploaded material so it can be fed to
 * `AiService.generateBlocksFromText`. Kept separate from `AiService` so the
 * AI module never touches raw bytes / file parsing directly — this is the
 * only place that does.
 *
 * v1 scope: PDF, DOCX, and plain text/Markdown. Other types (notably PPTX,
 * which has no good pure-JS parser) are rejected with a clear error rather
 * than silently producing garbage blocks.
 */
@Injectable()
export class FileExtractionService {
  async extractText(buffer: Buffer, contentType: string): Promise<string> {
    const type = contentType.toLowerCase();

    if (type.includes('pdf')) {
      const { text } = await pdfParse(buffer);
      return this.assertNonEmpty(text);
    }

    if (
      type.includes('officedocument.wordprocessingml') || // .docx
      type === 'application/msword'
    ) {
      const { value } = await mammoth.extractRawText({ buffer });
      return this.assertNonEmpty(value);
    }

    if (type.startsWith('text/') || type === 'application/octet-stream') {
      return this.assertNonEmpty(buffer.toString('utf8'));
    }

    throw new BadRequestException('unsupported_file_type');
  }

  private assertNonEmpty(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new BadRequestException('file_has_no_extractable_text');
    }
    return trimmed;
  }
}
