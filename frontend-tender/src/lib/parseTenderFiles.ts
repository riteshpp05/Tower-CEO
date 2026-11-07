/**
 * parseTenderFiles.ts
 * -----------------------------------------------------------------
 * Parses one or more uploaded tender documents into a single
 * consolidated raw-text blob for extraction.
 *
 * Two parsing paths:
 *   - .docx, .pdf, .jpg/.jpeg/.png/.tiff/.tif -> extractDocxText()
 *     (APNJ-LLM-Studio -- tables preserved as Markdown)
 *   - .xlsx, .xls -> parsed entirely client-side with SheetJS (the
 *     same `xlsx` package already used in ResourcesPage.tsx). No
 *     server round-trip needed; every sheet is converted to a
 *     Markdown-pipe table so the extraction prompts see it the same
 *     way they see a Markdown table from a .docx.
 * -----------------------------------------------------------------
 */

import * as XLSX from 'xlsx';
import { extractDocxText } from '@/lib/llmClient';

export const SUPPORTED_EXTENSIONS = ['docx', 'pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif', 'xlsx', 'xls'];

const DOCUMENT_EXTENSIONS = new Set(['docx', 'pdf', 'jpg', 'jpeg', 'png', 'tiff', 'tif']);
const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls']);

export function isSupportedTenderFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  return SUPPORTED_EXTENSIONS.includes(ext);
}

function getExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() || '';
}

/**
 * Converts every sheet in a workbook into a Markdown-pipe table block.
 * Empty sheets are skipped. Cell values are stringified defensively --
 * SheetJS can return numbers, dates, or booleans depending on cell type.
 */
function workbookToMarkdown(workbook: XLSX.WorkBook): string {
  const blocks: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    const nonEmptyRows = rows.filter(row => row.some(cell => String(cell ?? '').trim().length > 0));
    if (nonEmptyRows.length === 0) continue;

    const lines: string[] = [`### Sheet: ${sheetName}`, ''];

    const headerRow = nonEmptyRows[0].map(cell => String(cell ?? '').trim() || ' ');
    lines.push(`| ${headerRow.join(' | ')} |`);
    lines.push(`| ${headerRow.map(() => '---').join(' | ')} |`);

    for (let i = 1; i < nonEmptyRows.length; i++) {
      const row = nonEmptyRows[i].map(cell => String(cell ?? '').trim().replace(/\|/g, '\\|') || ' ');
      // Pad/truncate to header width so the table stays well-formed
      while (row.length < headerRow.length) row.push(' ');
      lines.push(`| ${row.slice(0, headerRow.length).join(' | ')} |`);
    }

    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
}

async function parseSpreadsheet(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const markdown = workbookToMarkdown(workbook);
  if (!markdown.trim()) {
    throw new Error(`"${file.name}" contains no readable data.`);
  }
  return markdown;
}

export interface ParsedFileResult {
  fileName: string;
  rawText: string;
}

export interface ParseFilesOutcome {
  results: ParsedFileResult[];
  successNames: string[];
  failNames: string[];
  /** All successful results joined with "=== filename ===" delimiters, ready for extraction prompts. */
  consolidatedRawText: string;
}

/**
 * Parses a single file, routing by extension. Throws on failure -- caller
 * (parseFiles) catches per-file so one bad file doesn't abort the batch.
 */
export async function parseSingleTenderFile(file: File): Promise<ParsedFileResult> {
  const ext = getExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`"${file.name}" is not supported. Use .docx, .pdf, .jpg, .jpeg, .png, .tiff, .xlsx, or .xls`);
  }

  let rawText: string;
  if (SPREADSHEET_EXTENSIONS.has(ext)) {
    rawText = await parseSpreadsheet(file);
  } else if (DOCUMENT_EXTENSIONS.has(ext)) {
    rawText = await extractDocxText(file);
  } else {
    // Should be unreachable given the SUPPORTED_EXTENSIONS check above.
    throw new Error(`"${file.name}" has an unrecognised extension.`);
  }

  if (!rawText || rawText.trim().length < 30) {
    throw new Error(`"${file.name}" appears to be empty or unreadable.`);
  }

  return { fileName: file.name, rawText };
}

/**
 * Parses a batch of files sequentially (so we don't overwhelm the local
 * LLM with concurrent extraction calls), consolidating all successful
 * results into one raw-text blob. Mirrors the multi-file pattern used in
 * NewProposalPage.tsx's handleRfpUpload.
 */
export async function parseTenderFiles(
  files: File[],
  onProgress?: (current: number, total: number, fileName: string) => void
): Promise<ParseFilesOutcome> {
  const results: ParsedFileResult[] = [];
  const successNames: string[] = [];
  const failNames: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length, file.name);
    try {
      const result = await parseSingleTenderFile(file);
      results.push(result);
      successNames.push(file.name);
    } catch (err) {
      failNames.push(`${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  const consolidatedRawText = results
    .map(r => `=== ${r.fileName} ===\n${r.rawText}`)
    .join('\n\n');

  return { results, successNames, failNames, consolidatedRawText };
}