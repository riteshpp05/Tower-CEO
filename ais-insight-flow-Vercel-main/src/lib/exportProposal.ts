import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat, TabStopType, TabStopPosition,
  ImageRun, TextWrappingType, TextWrappingSide
} from 'docx';
import { saveAs } from 'file-saver';
import type { Proposal, LegalClause, RateCard } from '@/data/mockData';
import { PROPOSAL_ASSETS } from '@/lib/proposalAssets';

// ── Brand colours ──────────────────────────────────────────────────────────────
const NAVY   = '1F3864';
const ACCENT = '1F6DC1';
const LIGHT  = 'D5E8F0';
const GRAY   = '666666';
const FONT   = 'Calibri';

// ── Helpers: base64 → Uint8Array ───────────────────────────────────────────────
function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

const cellBorder  = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

export interface TeamMemberForExport {
  name: string; designation: string; billing_rate: number;
  cost_rate: number; cost_loading_percentage: number; availability: string;
}
interface BusinessRule { id: string; rule: string; value: string; status: string; }
interface CoverLetterData {
  legalName: string; corporateStructure: string;
  contactName: string; contactTitle: string; contactAddress: string;
  contactPhone: string; contactEmail: string;
  hasSubcontractors: string; subcontractorDetails: string;
  pendingLitigation: string; litigationDetails: string;
  bankruptcyLast5Yrs: string; bankruptcyDetails: string;
  validityDays: number; authorisedSignatory: string; signatoryTitle: string;
  additionalNotes: string;
}

interface ExportOptions {
  proposal: Proposal;
  sections: { name: string; content: string; status: string }[];
  includeAnnexures?: boolean; isInternal?: boolean;
  teamMembers?: TeamMemberForExport[]; legalClauses?: LegalClause[];
  rateCards?: RateCard[]; commercialRules?: BusinessRule[];
  coverLetter?: CoverLetterData;
  // FX rates for converting rate card native currency to proposal currency
  fxRates?: { USD: number; EUR: number; SGD: number; AUD: number; AED: number };
}

export async function exportProposalToWord({
  proposal, sections, includeAnnexures = true, isInternal = false,
  teamMembers = [], legalClauses = [], rateCards = [], commercialRules = [],
  fxRates = { USD: 84.0, EUR: 91.0, SGD: 63.0, AUD: 55.0, AED: 22.9 },
  coverLetter
}: ExportOptions) {

  // ── Currency conversion helper ─────────────────────────────────────────────
  // Converts a rate from its native currency to the proposal currency for display
  const convertRate = (rate: number, nativeCurrency: string): { amount: number; symbol: string } => {
    const proposalCurrency = proposal.currency || 'INR';
    const sym = (c: string) => c === 'INR' ? '₹' : c === 'EUR' ? '€' : c === 'SGD' ? 'S$' : c === 'AUD' ? 'A$' : c === 'AED' ? 'د.إ' : '$';
    if (nativeCurrency === proposalCurrency) return { amount: rate, symbol: sym(proposalCurrency) };
    // Convert: native → INR → proposal currency
    const toINR: Record<string, number> = { INR: 1, USD: fxRates.USD, EUR: fxRates.EUR, SGD: fxRates.SGD, AUD: fxRates.AUD, AED: fxRates.AED };
    const fromINR: Record<string, number> = { INR: 1, USD: 1/fxRates.USD, EUR: 1/fxRates.EUR, SGD: 1/fxRates.SGD, AUD: 1/fxRates.AUD, AED: 1/fxRates.AED };
    const inInr = rate * (toINR[nativeCurrency] ?? 1);
    const converted = Math.round(inInr * (fromINR[proposalCurrency] ?? 1));
    return { amount: converted, symbol: sym(proposalCurrency) };
  };

  // Decode image buffers
  const coverPanel    = b64ToUint8(PROPOSAL_ASSETS.coverPanel.data);
  const companyLogo = b64ToUint8(PROPOSAL_ASSETS.companyLogo.data);
  const sapGoldBadge  = b64ToUint8(PROPOSAL_ASSETS.sapGoldBadge.data);
  const riseWithSap   = b64ToUint8(PROPOSAL_ASSETS.riseWithSap.data);
  const growWithSap   = b64ToUint8(PROPOSAL_ASSETS.growWithSap.data);
  const headerLogo    = b64ToUint8(PROPOSAL_ASSETS.headerLogo.data);

  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 20 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: FONT, color: ACCENT },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 24, bold: true, font: FONT, color: ACCENT },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, font: FONT, color: ACCENT },
          paragraph: { spacing: { before: 140, after: 60 }, outlineLevel: 2 } },
      ]
    },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
      }]
    },
    sections: [
      // ─── Cover Page ──────────────────────────────────────────────────────────
      {
        properties: {
          page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 1440, bottom: 720, left: 1440 } }
        },
        children: [
          // Behind-text cover panel image (full page graphic)
          new Paragraph({
            children: [
              new ImageRun({
                data: coverPanel,
                transformation: { width: 595, height: 842 },
                type: 'jpg',
                floating: {
                  horizontalPosition: { offset: -457200 },  // -0.5 inch left to reach page edge
                  verticalPosition: { offset: -457200 },     // -0.5 inch up to reach page edge
                  wrap: { type: TextWrappingType.NONE, side: TextWrappingSide.BOTH_SIDES },
                  behindDocument: true,
                  allowOverlap: true,
                }
              })
            ]
          }),
          // Company logo — top right corner
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { before: 0, after: 80 },
            children: [
              new ImageRun({
                data: companyLogo,
                transformation: { width: 170, height: 50 },
                type: 'png',
              })
            ]
          }),
          // ISO cert text
          new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { after: 240 },
            children: [new TextRun({ text: 'ISO 9001:2015 & ISO/IEC 27001: 2022 CERTIFIED', size: 14, font: FONT, color: GRAY })]
          }),
          // Company name — large, bold, right-aligned
          new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { before: 600, after: 120 },
            children: [new TextRun({ text: 'TOWER-CEO', bold: true, size: 44, font: FONT, color: NAVY })]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { after: 120 },
            children: [new TextRun({ text: 'ENTERPRISE', bold: true, size: 44, font: FONT, color: NAVY })]
          }),
          // "Proposal for"
          new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { after: 120 },
            children: [new TextRun({ text: 'Proposal for', bold: true, size: 34, font: FONT, color: NAVY })]
          }),
          // Proposal title — large
          ...proposal.title.split(' ').reduce<string[][]>((acc, word) => {
            const last = acc[acc.length - 1];
            if (!last || last.join(' ').length + word.length > 22) acc.push([word]);
            else last.push(word);
            return acc;
          }, []).map(words => new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { after: 60 },
            children: [new TextRun({ text: words.join(' '), bold: true, size: 34, font: FONT, color: NAVY })]
          })),
          // Date section
          new Paragraph({ spacing: { before: 480 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '8B4513', space: 1 } }, children: [new TextRun({ text: '\t', size: 20 })] }),
          new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { before: 120, after: 60 },
            children: [new TextRun({ text: 'DATE:', bold: true, size: 28, font: FONT, color: NAVY })]
          }),
          new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { after: 600 },
            children: [new TextRun({ text: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), size: 26, font: FONT, color: NAVY })]
          }),
          // SAP logos row — bottom
          new Paragraph({
            alignment: AlignmentType.RIGHT, spacing: { before: 200 },
            children: [
              new ImageRun({ data: sapGoldBadge, transformation: { width: 70, height: 46 }, type: 'png' }),
              new TextRun({ text: '   ' }),
              new ImageRun({ data: riseWithSap, transformation: { width: 96, height: 64 }, type: 'png' }),
              new TextRun({ text: '   ' }),
              new ImageRun({ data: growWithSap, transformation: { width: 64, height: 64 }, type: 'jpg' }),
            ]
          }),
          ...(isInternal ? [
            new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: 'INTERNAL REVIEW COPY \u2014 CONFIDENTIAL', bold: true, size: 20, color: 'CC0000' })] }),
          ] : []),
        ]
      },

      // ─── Content Pages ───────────────────────────────────────────────────────
      {
        properties: {
          page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1080, left: 1440 } }
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 4 } },
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              children: [
                new ImageRun({ data: headerLogo, transformation: { width: 40, height: 36 }, type: 'jpg' }),
                new TextRun({ text: '  TOWER-CEO ENTERPRISE PVT. LTD.', bold: true, size: 18, font: FONT, color: NAVY }),
                new TextRun({ text: '\t', size: 18 }),
                new ImageRun({ data: sapGoldBadge, transformation: { width: 52, height: 34 }, type: 'png' }),
              ]
            }),
            new Paragraph({
              spacing: { after: 60 },
              children: [new TextRun({ text: '  ISO 9001:2015 & ISO/IEC 27001:2022 CERTIFIED', size: 14, font: FONT, color: GRAY })]
            })]
          })
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              border: { top: { style: BorderStyle.SINGLE, size: 6, color: ACCENT, space: 4 } },
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              children: [
                new TextRun({ text: 'Tower-CEO Technologies Pvt. Ltd. | Confidential', size: 16, font: FONT, color: GRAY }),
                new TextRun({ text: '\tPage ', size: 16, font: FONT, color: GRAY }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, font: FONT, color: GRAY }),
              ]
            })]
          })
        },
        children: [
          // ─── Document info table ─────────────────────────────────────────────
          new Table({
            width: { size: 9360, type: WidthType.DXA }, columnWidths: [2880, 6480],
            rows: [
              infoRow('Prepared for', proposal.clientName),
              infoRow('Prepared by', 'Tower-CEO Technologies Pvt. Ltd.\n1st Floor, Lohia Jain IT Park, Paud Road, Kothrud, Pune 411038, India'),
              infoRow('Engagement Model', proposal.dealType),
              infoRow('Document Version', `V1.0  |  Date: ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}  |  Valid for 90 days from issue`),
              infoRow('Classification', 'Confidential \u2014 for the addressee\'s evaluation use only'),
            ]
          }),
          new Paragraph({ children: [new PageBreak()] }),

          // ─── Cover Letter ─────────────────────────────────────────────────────
          ...(coverLetter ? [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Cover Letter')] }),
            new Table({
              width: { size: 9360, type: WidthType.DXA }, columnWidths: [3600, 5760],
              rows: [
                headerRow(['Field', 'Details'], [3600, 5760]),
                dataRow(['Proposer Legal Name', coverLetter.legalName], [3600, 5760]),
                dataRow(['Corporate Structure', coverLetter.corporateStructure], [3600, 5760]),
                dataRow(['Primary Contact', `${coverLetter.contactName}${coverLetter.contactTitle ? ', ' + coverLetter.contactTitle : ''}`], [3600, 5760]),
                dataRow(['Address', coverLetter.contactAddress], [3600, 5760]),
                dataRow(['Phone', coverLetter.contactPhone], [3600, 5760]),
                dataRow(['Email', coverLetter.contactEmail], [3600, 5760]),
                dataRow(['Subcontractors', coverLetter.hasSubcontractors === 'none' ? 'None — all work performed directly by AIS' : coverLetter.subcontractorDetails || 'See details below'], [3600, 5760]),
                dataRow(['Pending Litigation', coverLetter.pendingLitigation === 'none' ? 'None' : coverLetter.litigationDetails || 'See disclosure attached'], [3600, 5760]),
                dataRow(['Bankruptcy / Insolvency (last 5 yrs)', coverLetter.bankruptcyLast5Yrs === 'none' ? 'None' : coverLetter.bankruptcyDetails || 'See disclosure attached'], [3600, 5760]),
                dataRow(['Proposal Validity', `This proposal is valid for ${coverLetter.validityDays ?? 90} days from the date of submission.`], [3600, 5760]),
              ]
            }),
            new Paragraph({ spacing: { before: 320 }, children: [] }),
            new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 100 },
              children: [new TextRun({ text: 'The undersigned, being duly authorised to bind the Proposer to the provisions of this proposal and any contract awarded pursuant to it, hereby certifies that all information provided herein is accurate and complete to the best of their knowledge.', size: 20, font: FONT })] }),
            ...(coverLetter.additionalNotes ? [
              new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 100 },
                children: [new TextRun({ text: coverLetter.additionalNotes, size: 20, font: FONT })] }),
            ] : []),
            new Paragraph({ spacing: { before: 480 }, children: [] }),
            new Table({
              width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680],
              rows: [
                new TableRow({ children: [
                  new TableCell({ width: { size: 4680, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, children: [new Paragraph({ children: [new TextRun({ text: 'Authorised Signatory', bold: true, size: 20, font: FONT })] })] }),
                  new TableCell({ width: { size: 4680, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, children: [new Paragraph({ children: [new TextRun({ text: 'Date', bold: true, size: 20, font: FONT })] })] }),
                ]}),
                new TableRow({ children: [
                  new TableCell({ width: { size: 4680, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, margins: { top: 400 }, children: [
                    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GRAY } }, children: [new TextRun({ text: '' })] }),
                    new Paragraph({ spacing: { before: 80 }, children: [new TextRun({ text: `${coverLetter.authorisedSignatory}`, bold: true, size: 20, font: FONT })] }),
                    new Paragraph({ children: [new TextRun({ text: coverLetter.signatoryTitle || 'Founder & CEO', size: 18, font: FONT, color: GRAY })] }),
                    new Paragraph({ children: [new TextRun({ text: coverLetter.legalName, size: 18, font: FONT, color: GRAY })] }),
                  ]}),
                  new TableCell({ width: { size: 4680, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, margins: { top: 400 }, children: [
                    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: GRAY } }, children: [new TextRun({ text: '' })] }),
                  ]}),
                ]}),
              ]
            }),
            new Paragraph({ children: [new PageBreak()] }),
          ] : []),

          // ─── Table of Contents ────────────────────────────────────────────────
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Table of Contents')] }),
          (() => {
            const filledSections = sections.filter(s => s.content != null && String(s.content).trim().length > 20);
            const allSections = [
              ...filledSections.map((s, i) => `${i + 1}. ${s.name}`),
              `${filledSections.length + 1}. Commercial Overview`,
              ...(teamMembers.length > 0 ? [`${filledSections.length + 2}. Team Composition`] : []),
              ...(legalClauses.length > 0 ? [`${filledSections.length + (teamMembers.length > 0 ? 3 : 2)}. Legal Terms`] : []),
              'Out of Scope',
              'Annexures',
              'Acceptance & Sign-off',
            ];
            return new Table({
              width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
              rows: allSections.map(entry => new TableRow({ children: [
                new TableCell({
                  width: { size: 9360, type: WidthType.DXA },
                  borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
                  margins: { top: 60, bottom: 60, left: 160, right: 160 },
                  children: [new Paragraph({
                    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                    children: [new TextRun({ text: entry, size: 20, font: FONT, color: '1F6DC1' })]
                  })]
                })
              ]}))
            });
          })(),
          new Paragraph({ children: [new PageBreak()] }),

          // ─── AI-generated sections — only render sections with actual content ────
          ...sections
            .filter(s => s.content != null && String(s.content).trim().length > 20)
            .flatMap((section, i) => [
              ...(i > 0 ? [new Paragraph({ spacing: { before: 60 }, children: [] })] : []),
              new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`${i + 1}. ${section.name}`)] }),
              ...(isInternal ? [
                new Paragraph({ spacing: { after: 80 },
                  children: [new TextRun({ text: `Status: ${section.status}`, italics: true, size: 18, color: section.status === 'approved' ? '2E7D32' : section.status === 'AI-generated' ? '1565C0' : GRAY })],
                }),
              ] : []),
              ...(() => {
                const content = String(section.content);
                // Detect SLA section — render as structured table
                const slaName = section.name.toLowerCase();
                if (slaName.includes('sla') || slaName.includes('service level')) {
                  const slaTable = buildSLATable(content);
                  if (slaTable.length > 0) return slaTable;
                }
                // Otherwise render as clean paragraphs — strip all Markdown
                return content.split('\n')
                  .map(p => stripMarkdown(p.trim()))
                  .filter(p => p.length > 0 && p !== '###' && p !== '---' && p !== '***')
                  .map(para =>
                    new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 100, line: 276 },
                      children: [new TextRun({ text: para, size: 20, font: FONT })] })
                  );
              })(),
            ]),

          // ─── Commercial Overview ──────────────────────────────────────────────
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`${sections.filter(s => s.content != null && String(s.content).trim().length > 20).length + 1}. Commercial Overview`)] }),
          (() => {
            const commercialRows = [
              proposal.dealType ? dataRow(['Deal Type', proposal.dealType], [4680, 4680]) : null,
              proposal.currency ? dataRow(['Currency', proposal.currency], [4680, 4680]) : null,
              proposal.expectedDuration ? dataRow(['Expected Duration', proposal.expectedDuration], [4680, 4680]) : null,
              proposal.expectedRevenue >= 0 ? dataRow(['Expected Revenue', (() => {
                const rev = proposal.expectedRevenue;
                if (proposal.currency !== 'INR') {
                  const sym = proposal.currency === 'EUR' ? '\u20AC' : proposal.currency === 'SGD' ? 'S$' : proposal.currency === 'AUD' ? 'A$' : proposal.currency === 'AED' ? '\u062F.\u0625' : '$';
                  return rev >= 1000000 ? `${sym}${(rev/1000000).toFixed(2)}M` : rev >= 1000 ? `${sym}${(rev/1000).toFixed(1)}K` : `${sym}${rev.toLocaleString('en-IN')}`;
                }
                return `\u20B9${rev.toLocaleString('en-IN')}`;
              })()], [4680, 4680]) : null,
              proposal.grossMargin > 0 ? dataRow(['Gross Margin', `${proposal.grossMargin}%`], [4680, 4680]) : null,
              proposal.discount > 0 ? dataRow(['Discount', `${proposal.discount}%`], [4680, 4680]) : null,
              proposal.modules?.length > 0 ? dataRow(['Modules', proposal.modules.join(', ')], [4680, 4680]) : null,
            ].filter(Boolean) as ReturnType<typeof dataRow>[];
            return new Table({
              width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680],
              rows: [headerRow(['Parameter', 'Value'], [4680, 4680]), ...commercialRows]
            });
          })(),

          // ─── Commercial Rules — INTERNAL ONLY ──────────────────────────────────
          ...(isInternal && commercialRules.length > 0 ? [
            new Paragraph({ spacing: { before: 320 }, children: [] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Commercial Business Rules')] }),
            new Table({
              width: { size: 9360, type: WidthType.DXA }, columnWidths: [4000, 3360, 2000],
              rows: [
                headerRow(['Rule', 'Value / Threshold', 'Status'], [4000, 3360, 2000]),
                ...commercialRules.map(r => dataRow([r.rule, r.value, r.status], [4000, 3360, 2000]))
              ]
            }),
          ] : []),

          // ─── Rate Cards ───────────────────────────────────────────────────────
          ...(rateCards.length > 0 ? [
            new Paragraph({ spacing: { before: 320 }, children: [] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Resource Rate Cards')] }),
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: isInternal ? [2200, 1400, 1400, 1500, 1280, 1080] : [3200, 1800, 1600, 2760],
              rows: [
                isInternal
                  ? headerRow(['Role / Skill', 'Level', 'Location', 'Billing Rate', 'Cost Rate', 'Margin'], [2200, 1400, 1400, 1500, 1280, 1080])
                  : headerRow(['Role / Skill', 'Level', 'Location', 'Billing Rate'], [3200, 1800, 1600, 2760]),
                ...rateCards.map(r => {
                  const bill = convertRate(r.billingRate, r.currency);
                  const cost = convertRate(r.costRate, r.currency);
                  return isInternal
                    ? dataRow([r.skill, r.roleLevel, r.locationType, `${bill.symbol}${bill.amount.toLocaleString('en-IN')}/hr`, `${cost.symbol}${cost.amount.toLocaleString('en-IN')}/hr`, `${r.marginalMargin}%`], [2200, 1400, 1400, 1500, 1280, 1080])
                    : dataRow([r.skill, r.roleLevel, r.locationType, `${bill.symbol}${bill.amount.toLocaleString('en-IN')}/hr`], [3200, 1800, 1600, 2760]);
                })
              ]
            }),
          ] : []),

          // ─── Team ─────────────────────────────────────────────────────────────
          ...(teamMembers.length > 0 ? [
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`${sections.filter(s => s.content != null && String(s.content).trim().length > 20).length + 2}. Team Composition`)] }),
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: isInternal ? [2400, 2200, 1300, 1300, 1160] : [2800, 3000, 1800, 1760],
              rows: [
                isInternal
                  ? headerRow(['Name', 'Designation', 'Billing Rate', 'Cost Rate', 'Availability'], [2400, 2200, 1300, 1300, 1160])
                  : headerRow(['Name', 'Designation', 'Billing Rate', 'Availability'], [2800, 3000, 1800, 1760]),
                ...teamMembers.map(m => {
                  const sym = proposal.currency === 'INR' ? '\u20B9' : proposal.currency === 'EUR' ? '\u20AC' : proposal.currency === 'SGD' ? 'S$' : proposal.currency === 'AUD' ? 'A$' : proposal.currency === 'AED' ? '\u062F.\u0625' : '$';
                  return isInternal
                    ? dataRow([m.name, m.designation, `${sym}${m.billing_rate.toLocaleString('en-IN')}/hr`, `${sym}${m.cost_rate.toLocaleString('en-IN')}/hr`, m.availability], [2400, 2200, 1300, 1300, 1160])
                    : dataRow([m.name, m.designation, `${sym}${m.billing_rate.toLocaleString('en-IN')}/hr`, m.availability], [2800, 3000, 1800, 1760]);
                })
              ]
            }),
          ] : []),

          // ─── Legal Clauses ────────────────────────────────────────────────────
          ...(legalClauses.length > 0 ? [
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ heading: HeadingLevel.HEADING_1,
              children: [new TextRun(`${sections.filter(s => s.content != null && String(s.content).trim().length > 20).length + (teamMembers.length > 0 ? 3 : 2)}. Legal Terms`)] }),
            ...legalClauses.flatMap(clause => [
              new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(clause.title)] }),
              new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 100, line: 276 },
                children: [new TextRun({ text: clause.standardText, size: 20, font: FONT })] }),
            ]),
          ] : []),

          // ─── Standard Out of Scope — proposal-type-aware ─────────────────────
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Out of Scope')] }),
          new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 100, line: 276 },
            children: [new TextRun({ text: 'The following items are explicitly excluded from this engagement unless separately agreed via a change request:', size: 20, font: FONT })] }),
          ...(() => {
            const lob = (proposal.lob || proposal.opportunityType || '').toLowerCase();
            const isAMS  = lob.includes('ams') || lob.includes('application management');
            const isRA   = lob.includes('resource aug') || lob.includes('augmentation');
            if (isAMS) return buildBulletList([
              'New SAP module implementations or system conversions.',
              'SAP license procurement, sizing, or renewal.',
              'Infrastructure upgrades, server procurement, or network configuration.',
              'Custom development or ABAP enhancements beyond agreed change request budget.',
              'Third-party application integration not listed in the agreed scope.',
              'End-user training beyond agreed sessions in the SOW.',
              'Regulatory or statutory changes requiring rework after design sign-off.',
              'Data migration, archiving, or master data cleansing.',
            ]);
            if (isRA) return buildBulletList([
              'Recruitment or permanent placement of resources.',
              'Management of client projects or delivery responsibility.',
              'Hardware, software licenses, or infrastructure.',
              'Training or upskilling of resources beyond standard onboarding.',
              'Travel and accommodation unless separately agreed.',
            ]);
            return buildBulletList([
              'Hardware procurement, infrastructure setup, or network configuration.',
              'Third-party software licensing, SAP license procurement or sizing.',
              'Master data cleansing, deduplication, or remediation in source systems.',
              'Any scope not explicitly mentioned in the Scope of Work section.',
              'End-user training beyond the agreed number of sessions in the SOW.',
              'Ongoing application support post-hypercare (covered under a separate AMS agreement).',
              'Regulatory or statutory changes requiring rework after design sign-off.',
            ]);
          })(),

          // ─── Annexures ────────────────────────────────────────────────────────
          ...(includeAnnexures ? [
            new Paragraph({ children: [new PageBreak()] }),
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Annexures')] }),
            ...buildBulletList([
              'Annexure A: Team Structure & CV Annexures',
              'Annexure B: Detailed Commercial Breakdown',
              'Annexure C: Legal Terms & Conditions (executed copy)',
              'Annexure D: Project Plan & Milestones',
              'Annexure E: Company Credentials & Certifications',
            ]),
          ] : []),

          // ─── Acceptance & Sign-off ────────────────────────────────────────────
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Acceptance & Sign-off')] }),
          new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 240, line: 276 },
            children: [new TextRun({ text: `${coverLetter ? `This proposal is valid for ${coverLetter.validityDays ?? 90} calendar days from the date of issue.` : 'This proposal is valid for ninety (90) calendar days from the date of issue.'} Acceptance is recorded by signature below; the parties will subsequently execute a detailed Statement of Work incorporating the terms of this proposal.`, size: 20, font: FONT })] }),
          new Table({
            width: { size: 9360, type: WidthType.DXA }, columnWidths: [4680, 4680],
            rows: [
              headerRow([`For and on behalf of ${proposal.clientName}`, 'For and on behalf of Tower-CEO Technologies Pvt. Ltd.'], [4680, 4680]),
              new TableRow({ children: [ signCell('Name & Designation:'), signCell('Umesh Shinde | Founder & CEO') ] }),
              new TableRow({ children: [ signCell('Signature:'), signCell('') ] }),
              new TableRow({ children: [ signCell('Date:'), signCell('') ] }),
            ]
          }),
          new Paragraph({ spacing: { before: 400 }, children: [] }),
          // Contact box
          new Table({
            width: { size: 6000, type: WidthType.DXA }, columnWidths: [6000],
            rows: [new TableRow({ children: [new TableCell({
              width: { size: 6000, type: WidthType.DXA }, borders: cellBorders,
              shading: { fill: 'F5F7FA', type: ShadingType.CLEAR },
              margins: { top: 120, bottom: 120, left: 180, right: 180 },
              children: [
                new Paragraph({ children: [new TextRun({ text: 'Engagement Contact', bold: true, size: 22, font: FONT, color: NAVY })] }),
                new Paragraph({ children: [new TextRun({ text: 'Umesh Shinde  |  Founder & CEO', bold: true, size: 20, font: FONT })] }),
                new Paragraph({ children: [new TextRun({ text: 'Tower-CEO Technologies Pvt. Ltd.', size: 20, font: FONT })] }),
                new Paragraph({ children: [new TextRun({ text: '1st Floor, Lohia Jain IT Park, Paud Road, Kothrud, Pune 411038, India', size: 18, font: FONT, color: GRAY })] }),
                new Paragraph({ children: [new TextRun({ text: 'contact@towerceo.com  |  www.towerceo.com', size: 18, font: FONT, color: ACCENT })] }),
                new Paragraph({ children: [new TextRun({ text: 'Offices: Pune (HQ)  |  Dubai  |  Singapore', italics: true, size: 18, font: FONT, color: GRAY })] }),
              ]
            })]})],
          }),
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const filename = `${proposal.id}_${proposal.clientName.replace(/[^a-zA-Z0-9]/g, '_')}${isInternal ? '_INTERNAL' : ''}.docx`;
  saveAs(blob, filename);
  return filename;
}

// ── Table helper functions ────────────────────────────────────────────────────

// ── Markdown cleaner — strips ### ** __ - bullet syntax from Qwen output ───────
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s*/gm, '')           // ### headings
    .replace(/\*\*([^*]+)\*\*/g, '$1')     // **bold**
    .replace(/\*([^*]+)\*/g, '$1')         // *italic*
    .replace(/__([^_]+)__/g, '$1')         // __bold__
    .replace(/^[-*•]\s+/gm, '')            // - bullet or * bullet
    .replace(/^\d+\.\s+/gm, '')            // 1. numbered list
    .replace(/`([^`]+)`/g, '$1')           // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url)
    .trim();
}

// ── SLA table detector — converts P1/P2/P3/P4 text blocks to a Word table ────
function buildSLATable(content: string): (Paragraph | Table)[] {
  const priorities = ['P1', 'P2', 'P3', 'P4'];
  const hasSLA = priorities.every(p => content.includes(p));
  if (!hasSLA) return [];

  const rows: string[][] = [];
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
  let current: string[] = [];

  // Parse P1-P4 blocks from content
  lines.forEach(line => {
    const clean = stripMarkdown(line);
    if (!clean) return;
    const pMatch = clean.match(/^(P[1-4])\s*(Critical|High|Medium|Low|:|-)?/i);
    if (pMatch) {
      if (current.length) rows.push(current);
      current = [clean];
    } else if (current.length) {
      current.push(clean);
    }
  });
  if (current.length) rows.push(current);
  if (rows.length < 4) return [];

  const NAVY = '1F3864', FONT = 'Calibri';
  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
  const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  return [
    new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [1200, 2400, 1800, 1800, 2160],
      rows: [
        new TableRow({ children: ['Priority','Definition','Response','Resolution','Escalation'].map((h, i) =>
          new TableCell({
            width: { size: [1200,2400,1800,1800,2160][i], type: WidthType.DXA },
            borders, shading: { fill: NAVY, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18, font: FONT, color: 'FFFFFF' })] })]
          })
        )}),
        ...rows.map(row => {
          const text = row.join(' ');
          const lvl    = (text.match(/P[1-4]/i)?.[0] ?? '').toUpperCase();
          const defn   = text.match(/[Dd]efinition[:\s]+([^.]+)/)?.[1]?.trim() ?? '';
          const resp   = text.match(/[Rr]esponse[:\s]+([^.]+)/)?.[1]?.trim() ?? '';
          const resol  = text.match(/[Rr]esolution[:\s]+([^.]+)/)?.[1]?.trim() ?? '';
          const escal  = text.match(/[Ee]scalation[:\s]+([^.]+)/)?.[1]?.trim() ?? '';
          const color  = lvl === 'P1' ? 'CC0000' : lvl === 'P2' ? 'E65C00' : lvl === 'P3' ? 'B8860B' : '2E7D32';
          return new TableRow({ children: [lvl, defn, resp, resol, escal].map((cell, i) =>
            new TableCell({
              width: { size: [1200,2400,1800,1800,2160][i], type: WidthType.DXA },
              borders, margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: cell, size: 18, font: FONT, bold: i === 0, color: i === 0 ? color : '000000' })] })]
            })
          )});
        })
      ]
    })
  ];
}

function buildBulletList(items: string[]): Paragraph[] {
  return items.map(text => new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 60, line: 276 },
    children: [new TextRun({ text, size: 20, font: FONT })],
  }));
}

function infoRow(label: string, value: string) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 2880, type: WidthType.DXA }, borders: cellBorders,
        shading: { fill: NAVY, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: FONT, color: 'FFFFFF' })] })]
      }),
      new TableCell({
        width: { size: 6480, type: WidthType.DXA }, borders: cellBorders,
        margins: { top: 100, bottom: 100, left: 160, right: 160 },
        children: value.split('\n').map(line =>
          new Paragraph({ children: [new TextRun({ text: line, size: 20, font: FONT })] })
        )
      }),
    ]
  });
}

function headerRow(cells: string[], widths: number[]) {
  return new TableRow({
    children: cells.map((text, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA }, borders: cellBorders,
      shading: { fill: NAVY, type: ShadingType.CLEAR },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20, font: FONT, color: 'FFFFFF' })] })]
    }))
  });
}

function dataRow(cells: string[], widths: number[]) {
  return new TableRow({
    children: cells.map((text, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA }, borders: cellBorders,
      margins: { top: 80, bottom: 80, left: 160, right: 160 },
      children: [new Paragraph({
        children: [new TextRun({ text, size: 20, font: FONT, color: i === 0 ? ACCENT : '000000', bold: i === 0 })]
      })]
    }))
  });
}

function signCell(text: string) {
  return new TableCell({
    width: { size: 4680, type: WidthType.DXA }, borders: cellBorders,
    margins: { top: 200, bottom: 200, left: 160, right: 160 },
    children: [new Paragraph({ children: [new TextRun({ text, size: 20, font: FONT, color: GRAY })] })]
  });
}