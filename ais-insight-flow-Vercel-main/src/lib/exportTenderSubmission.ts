/**
 * exportTenderSubmission.ts
 * ─────────────────────────────────────────────────────────────────
 * Exports the Tender Submission Package (covering letter + filled
 * annexures) as a single .docx file.
 *
 * Deliberately standalone from exportProposal.ts — Tender Engine
 * runs outside the regular proposal lifecycle, and keeping this
 * separate means zero risk of breaking the existing proposal export
 * pipeline while building this out.
 * ─────────────────────────────────────────────────────────────────
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak,
} from 'docx';
import { saveAs } from 'file-saver';
import type { TenderRecord, AnnexureItem } from '@/lib/tenderEngine';

const NAVY = '1F3864';
const ACCENT = '1F6DC1';
const LIGHT = 'D5E8F0';
const GRAY = '666666';
const FONT = 'Calibri';

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function dataRow(cells: [string, string], widths: [number, number]): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: widths[0], type: WidthType.DXA },
        borders: cellBorders,
        shading: { type: ShadingType.SOLID, color: LIGHT, fill: LIGHT },
        children: [new Paragraph({ children: [new TextRun({ text: cells[0], bold: true, size: 20, font: FONT })] })],
      }),
      new TableCell({
        width: { size: widths[1], type: WidthType.DXA },
        borders: cellBorders,
        children: [new Paragraph({ children: [new TextRun({ text: cells[1] || '—', size: 20, font: FONT })] })],
      }),
    ],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, bold: true, size: 28, font: FONT, color: NAVY })],
  });
}

function subheading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 24, font: FONT, color: ACCENT })],
  });
}

function bodyText(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: text || '—', size: 20, font: FONT })],
  });
}

const standardHeader = () => new Header({
  children: [
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: 'Abhiyanta India Solutions Pvt. Ltd.', size: 16, font: FONT, color: GRAY })],
    }),
  ],
});

const standardFooter = () => new Footer({
  children: [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'Page ', size: 16, font: FONT, color: GRAY }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, font: FONT, color: GRAY }),
        new TextRun({ text: ' of ', size: 16, font: FONT, color: GRAY }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, font: FONT, color: GRAY }),
      ],
    }),
  ],
});

function buildCoverLetterSection(tender: TenderRecord): Paragraph[] {
  const cl = tender.submission.coverLetter;
  return [
    heading('Covering Letter'),
    bodyText(`To,\nThe Tender Inviting Authority\n${tender.clientName}`),
    bodyText(`Subject: Submission of Bid — ${tender.title}`),
    bodyText('Dear Sir/Madam,'),
    bodyText(
      `We, ${cl.legalName}, a ${cl.corporateStructure}, having examined the tender document for the above-referenced tender, hereby submit our bid and confirm our willingness to execute the work in accordance with the terms, conditions, and specifications set out therein.`
    ),
    new Paragraph({ children: [new TextRun({ text: '', size: 20 })] }),
  ];
}

function buildDisclosureTable(tender: TenderRecord): Table {
  const cl = tender.submission.coverLetter;
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    rows: [
      dataRow(['Proposer Legal Name', cl.legalName], [3600, 5760]),
      dataRow(['Corporate Structure', cl.corporateStructure], [3600, 5760]),
      dataRow(['Primary Contact', `${cl.contactName}${cl.contactTitle ? ', ' + cl.contactTitle : ''}`], [3600, 5760]),
      dataRow(['Address', cl.contactAddress], [3600, 5760]),
      dataRow(['Phone', cl.contactPhone], [3600, 5760]),
      dataRow(['Email', cl.contactEmail], [3600, 5760]),
      dataRow(['Subcontractors', cl.hasSubcontractors === 'none' ? 'None — all work performed directly by AIS' : (cl.subcontractorDetails || 'See details below')], [3600, 5760]),
      dataRow(['Pending Litigation', cl.pendingLitigation === 'none' ? 'None' : (cl.litigationDetails || 'See disclosure attached')], [3600, 5760]),
      dataRow(['Bankruptcy / Insolvency (last 5 yrs)', cl.bankruptcyLast5Yrs === 'none' ? 'None' : (cl.bankruptcyDetails || 'See disclosure attached')], [3600, 5760]),
      dataRow(['Bid Validity', `This bid is valid for ${cl.validityDays ?? 90} days from the date of submission.`], [3600, 5760]),
    ],
  });
}

function buildSignatureBlock(tender: TenderRecord): Paragraph[] {
  const cl = tender.submission.coverLetter;
  return [
    new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: 'For and on behalf of:', size: 20, font: FONT })] }),
    new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: '_________________________', size: 20, font: FONT })] }),
    new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: cl.authorisedSignatory, bold: true, size: 20, font: FONT })] }),
    new Paragraph({ children: [new TextRun({ text: cl.signatoryTitle || 'Founder & CEO', size: 18, font: FONT, color: GRAY })] }),
    new Paragraph({ children: [new TextRun({ text: cl.legalName, size: 18, font: FONT, color: GRAY })] }),
  ];
}

const ANNEXURE_KIND_LABEL: Record<AnnexureItem['kind'], string> = {
  fill_form: 'Filled Format',
  data_table: 'Compiled Data Table',
  checklist_only: 'Supporting Document (attach separately)',
};

function buildAnnexureSection(annexures: AnnexureItem[]): (Paragraph | Table)[] {
  if (annexures.length === 0) {
    return [
      heading('Annexures'),
      bodyText('No annexures were identified in the tender document for this submission.'),
    ];
  }

  const blocks: (Paragraph | Table)[] = [heading('Annexures')];

  annexures.forEach((a, idx) => {
    blocks.push(new Paragraph({ children: [new PageBreak()] }));
    blocks.push(subheading(`${idx + 1}. ${a.name}`));
    blocks.push(bodyText(`Type: ${ANNEXURE_KIND_LABEL[a.kind]}`));

    if (a.kind === 'checklist_only') {
      blocks.push(bodyText('This is a supporting document to be attached separately (e.g. certificate, financial statement, registration copy). It is not drafted within this submission package.'));
      if (a.filledContent?.trim()) {
        blocks.push(bodyText(`Notes: ${a.filledContent.trim()}`));
      }
      return;
    }

    if (a.sourceFormat?.trim()) {
      blocks.push(new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: 'Source format (as per tender document):', bold: true, size: 18, font: FONT, color: GRAY })] }));
      blocks.push(bodyText(a.sourceFormat.trim()));
    }

    blocks.push(new Paragraph({ spacing: { before: 100 }, children: [new TextRun({ text: 'AIS submission:', bold: true, size: 18, font: FONT, color: GRAY })] }));
    blocks.push(bodyText(a.filledContent?.trim() || 'Not yet completed.'));
  });

  return blocks;
}

export async function exportTenderSubmissionToWord(tender: TenderRecord): Promise<void> {
  const children: (Paragraph | Table)[] = [
    ...buildCoverLetterSection(tender),
    buildDisclosureTable(tender),
    ...buildSignatureBlock(tender),
    new Paragraph({ children: [new PageBreak()] }),
    ...buildAnnexureSection(tender.submission.annexures),
  ];

  const doc = new Document({
    sections: [
      {
        headers: { default: standardHeader() },
        footers: { default: standardFooter() },
        properties: {},
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safeTitle = (tender.title || tender.id).replace(/[^\w\- ]+/g, '').trim() || tender.id;
  saveAs(blob, `${safeTitle} - Tender Submission Package.docx`);
}