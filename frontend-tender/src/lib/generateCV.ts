/**
 * generateCV.ts
 * ─────────────────────────────────────────────────────────────────
 * AIS-branded CV generator for consultant profiles.
 * Qwen writes the Professional Summary from DB data.
 * Generated CV stored in Supabase (resource_cvs table or app_config).
 * ─────────────────────────────────────────────────────────────────
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  Header, Footer, PageNumber,
} from 'docx';
import { saveAs } from 'file-saver';
import type { DbResource } from '@/hooks/useResources';
import { callLLM } from '@/lib/llmClient';
import { supabase } from '@/integrations/supabase/client';

// ── AIS brand colours ─────────────────────────────────────────────
const NAVY   = '1B4F72';
const BLUE   = '2E75B6';
const GRAY   = '888888';
const LIGHT  = 'EBF5FB';
const WHITE  = 'FFFFFF';
const FONT   = 'Calibri';

const borderNone = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: 'D5D8DC' };
const borders    = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const noBorders  = { top: borderNone, bottom: borderNone, left: borderNone, right: borderNone };

// ── Qwen generates professional summary ───────────────────────────
async function generateSummary(r: DbResource): Promise<string> {
  if (r.profile_summary && r.profile_summary.trim().length > 50) {
    return r.profile_summary.trim();
  }
  try {
    const prompt = `Write a 3-sentence professional summary for a CV for this SAP consultant:
Name: ${r.name}
Designation: ${r.designation}
Experience: ${r.years_of_experience} years
SAP Modules: ${(r.sap_modules ?? []).join(', ')}
Skills: ${(r.skills ?? []).join(', ')}
Certifications: ${(r.certifications ?? []).join(', ')}
Key Projects: ${(r.key_projects ?? []).slice(0, 3).join('; ')}

Write in third person, formal business tone. No markdown. No bullet points. Plain prose only.`;

    const { content } = await callLLM(
      [{ role: 'user', content: prompt }],
      { temperature: 0.3, max_tokens: 300 }
    );
    return content.replace(/```/g, '').trim();
  } catch {
    return `${r.name} is an experienced SAP consultant with ${r.years_of_experience} years of expertise in ${(r.sap_modules ?? []).slice(0, 4).join(', ')}. ${r.designation} with a proven track record of delivering SAP solutions for clients across industries. Available for ${r.availability.toLowerCase()} engagements.`;
  }
}

// ── Helper rows ───────────────────────────────────────────────────
function infoRow(label: string, value: string) {
  return new TableRow({ children: [
    new TableCell({
      width: { size: 2800, type: WidthType.DXA }, borders,
      shading: { fill: LIGHT, type: ShadingType.CLEAR },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: FONT, color: NAVY })] })],
    }),
    new TableCell({
      width: { size: 6560, type: WidthType.DXA }, borders,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: value || '—', size: 20, font: FONT })] })],
    }),
  ]});
}

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 280, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 4 } },
    children: [new TextRun({ text, bold: true, size: 24, font: FONT, color: NAVY })],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    indent: { left: 360 },
    children: [new TextRun({ text: `\u2022  ${text}`, size: 20, font: FONT })],
  });
}

// ── Main CV export ────────────────────────────────────────────────
export async function generateCV(resource: DbResource, isClientFacing = true): Promise<void> {
  const summary = await generateSummary(resource);

  // Currency symbol
  const sym = (resource.currency ?? 'INR') === 'INR' ? '\u20B9'
    : (resource.currency ?? '') === 'EUR' ? '\u20AC'
    : (resource.currency ?? '') === 'AED' ? '\u062F.\u0625'
    : '$';

  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1000, right: 1200, bottom: 1000, left: 1200 },
        },
      },

      // ── AIS branded header ─────────────────────────────────────
      headers: {
        default: new Header({
          children: [
            new Table({
              width: { size: 9840, type: WidthType.DXA },
              columnWidths: [6000, 3840],
              rows: [new TableRow({ children: [
                new TableCell({
                  width: { size: 6000, type: WidthType.DXA }, borders: noBorders,
                  shading: { fill: NAVY, type: ShadingType.CLEAR },
                  margins: { top: 120, bottom: 120, left: 200, right: 0 },
                  children: [
                    new Paragraph({ children: [new TextRun({ text: 'TOWER-CEO TECHNOLOGIES', bold: true, size: 22, font: FONT, color: WHITE })] }),
                    new Paragraph({ children: [new TextRun({ text: 'SAP Gold Partner  |  ISO 9001:2015  |  ISO/IEC 27001:2022', size: 16, font: FONT, color: 'BDC3C7' })] }),
                  ],
                }),
                new TableCell({
                  width: { size: 3840, type: WidthType.DXA }, borders: noBorders,
                  shading: { fill: NAVY, type: ShadingType.CLEAR },
                  margins: { top: 120, bottom: 120, left: 0, right: 200 },
                  children: [
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Consultant Profile', size: 18, font: FONT, color: 'BDC3C7', italics: true })] }),
                    new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'CONFIDENTIAL', size: 16, font: FONT, color: 'E74C3C', bold: true })] }),
                  ],
                }),
              ]})],
            }),
          ],
        }),
      },

      // ── Footer ────────────────────────────────────────────────
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 4 } },
            children: [
              new TextRun({ text: 'Tower-CEO Technologies Pvt. Ltd.  |  Pune, India  |  contact@towerceo.com  |  Page ', size: 16, color: GRAY, font: FONT }),
              new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GRAY, font: FONT }),
            ],
          })],
        }),
      },

      children: [
        // ── Name & designation banner ─────────────────────────────
        new Paragraph({ spacing: { before: 320, after: 60 }, children: [new TextRun({ text: resource.name, bold: true, size: 44, font: FONT, color: NAVY })] }),
        new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: resource.designation, size: 28, font: FONT, color: BLUE })] }),
        new Paragraph({ spacing: { after: 60 }, children: [
          new TextRun({ text: `${resource.years_of_experience} years experience  |  ${resource.geography}  |  ${resource.availability}`, size: 20, font: FONT, color: GRAY }),
        ]}),
        new Paragraph({ spacing: { after: 20 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 4 } }, children: [] }),

        // ── Professional Summary ──────────────────────────────────
        sectionHeading('Professional Summary'),
        new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 120 }, children: [new TextRun({ text: summary, size: 20, font: FONT })] }),

        // ── Key Details table ─────────────────────────────────────
        sectionHeading('Key Details'),
        new Table({
          width: { size: 9360, type: WidthType.DXA }, columnWidths: [2800, 6560],
          rows: [
            infoRow('Languages', (resource.languages ?? ['English']).join(', ')),
            infoRow('Employment Type', resource.employment_type),
            ...(resource.email ? [infoRow('Email', resource.email)] : []),
          ],
        }),

        // ── SAP Expertise ─────────────────────────────────────────
        sectionHeading('SAP Expertise'),
        ...((resource.sap_modules ?? []).length > 0 ? [
          new Paragraph({ spacing: { after: 60 }, children: [
            new TextRun({ text: 'SAP Modules:  ', bold: true, size: 20, font: FONT, color: NAVY }),
            new TextRun({ text: (resource.sap_modules ?? []).join('   |   '), size: 20, font: FONT }),
          ]}),
        ] : []),
        ...((resource.skills ?? []).length > 0 ? [
          new Paragraph({ spacing: { after: 60 }, children: [
            new TextRun({ text: 'Technical Skills:  ', bold: true, size: 20, font: FONT, color: NAVY }),
            new TextRun({ text: (resource.skills ?? []).join(', '), size: 20, font: FONT }),
          ]}),
        ] : []),

        // ── Certifications ────────────────────────────────────────
        ...((resource.certifications ?? []).length > 0 ? [
          sectionHeading('Certifications'),
          ...(resource.certifications ?? []).map(c => bullet(c)),
        ] : []),

        // ── Key Projects ──────────────────────────────────────────
        ...((resource.key_projects ?? []).length > 0 ? [
          sectionHeading('Key Project Experience'),
          ...(resource.key_projects ?? []).map(p => bullet(p)),
        ] : []),

        // ── Bio ───────────────────────────────────────────────────
        ...(resource.bio && resource.bio.trim() ? [
          sectionHeading('Additional Background'),
          new Paragraph({ alignment: AlignmentType.BOTH, spacing: { after: 120 }, children: [new TextRun({ text: resource.bio, size: 20, font: FONT })] }),
        ] : []),

        // ── Rate (internal only) ──────────────────────────────────
        ...(!isClientFacing ? [
          sectionHeading('Rate Information (Internal — Do Not Distribute)'),
          new Table({
            width: { size: 9360, type: WidthType.DXA }, columnWidths: [2800, 6560],
            rows: [
              infoRow('Billing Rate', `${sym}${resource.billing_rate.toLocaleString('en-IN')}/hr`),
              infoRow('Cost Rate', `${sym}${resource.cost_rate.toLocaleString('en-IN')}/hr`),
              infoRow('Cost Loading', `${resource.cost_loading_percentage}%`),
            ],
          }),
        ] : []),
      ],
    }],
  });

  const buffer = await Packer.toBlob(doc);

  // ── Save to Supabase for future reuse ─────────────────────────
  try {
    await supabase.from('app_config' as never).upsert({
      key: `cv_${resource.id}`,
      value: JSON.stringify({
        resourceId:    resource.id,
        resourceName:  resource.name,
        generatedAt:   new Date().toISOString(),
        summaryUsed:   summary,
        isClientFacing,
      }),
    } as never, { onConflict: 'key' });
  } catch { /* non-critical — CV still downloads */ }

  saveAs(buffer, `AIS_CV_${resource.name.replace(/\s+/g, '_')}_${isClientFacing ? 'Client' : 'Internal'}.docx`);
}

// ── Check if CV was recently generated ───────────────────────────
export async function getCVLastGenerated(resourceId: string): Promise<string | null> {
  try {
    const { data } = await supabase.from('app_config' as never).select('value').eq('key', `cv_${resourceId}`).maybeSingle();
    if (!data) return null;
    const parsed = typeof (data as any).value === 'string' ? JSON.parse((data as any).value) : (data as any).value;
    return parsed?.generatedAt ?? null;
  } catch { return null; }
}