/**
 * CoverLetterStep.tsx
 * ─────────────────────────────────────────────────────────────────
 * Step 1 in the New Proposal wizard — mandatory for all proposals.
 * Collects the formal cover letter fields required by most RFPs.
 * This is a FORM, not AI-generated — data is used directly in export.
 * ─────────────────────────────────────────────────────────────────
 */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, User, Building2, AlertTriangle, CheckCircle } from 'lucide-react';

export interface CoverLetterData {
  // Proposer identity (Tower-CEO — mostly fixed)
  legalName:            string;  // Tower-CEO Technologies Pvt. Ltd.
  corporateStructure:   string;  // Private Limited Company, India
  // Primary contact
  contactName:          string;
  contactTitle:         string;
  contactAddress:       string;
  contactPhone:         string;
  contactEmail:         string;
  // Subcontractors
  hasSubcontractors:    'none' | 'yes';
  subcontractorDetails: string;
  // Disclosures
  pendingLitigation:    'none' | 'disclose';
  litigationDetails:    string;
  bankruptcyLast5Yrs:   'none' | 'disclose';
  bankruptcyDetails:    string;
  // Validity & signatory
  validityDays:         number;
  authorisedSignatory:  string;
  signatoryTitle:       string;
  additionalNotes:      string;
}

export const DEFAULT_COVER_LETTER: CoverLetterData = {
  legalName:            'Tower-CEO Technologies Pvt. Ltd.',
  corporateStructure:   'Private Limited Company incorporated under the Companies Act, 2013, India',
  contactName:          '',
  contactTitle:         '',
  contactAddress:       '1st Floor, Lohia Jain IT Park, Paud Road, Kothrud, Pune 411038, Maharashtra, India',
  contactPhone:         '+91 90280 51760',
  contactEmail:         'sales@towerceo.com',
  hasSubcontractors:    'none',
  subcontractorDetails: '',
  pendingLitigation:    'none',
  litigationDetails:    '',
  bankruptcyLast5Yrs:   'none',
  bankruptcyDetails:    '',
  validityDays:         90,
  authorisedSignatory:  'Umesh Shinde',
  signatoryTitle:       'Founder & CEO',
  additionalNotes:      '',
};

interface Props {
  data: CoverLetterData;
  onChange: (data: CoverLetterData) => void;
}

export function CoverLetterStep({ data, onChange }: Props) {
  const upd = (field: keyof CoverLetterData, value: string | number) =>
    onChange({ ...data, [field]: value });

  const isComplete =
    data.contactName.trim().length > 0 &&
    data.contactEmail.trim().length > 0 &&
    data.contactPhone.trim().length > 0 &&
    data.authorisedSignatory.trim().length > 0;

  return (
    <div className="space-y-5">

      {/* Completion indicator */}
      <div className={`flex items-center gap-3 p-3 rounded-lg border text-sm ${isComplete ? 'bg-success/5 border-success/30' : 'bg-warning/5 border-warning/30'}`}>
        {isComplete
          ? <CheckCircle className="h-4 w-4 text-success shrink-0" />
          : <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
        <span className={isComplete ? 'text-success' : 'text-warning'}>
          {isComplete ? 'Cover letter complete — will be included in the exported proposal.' : 'Fill in contact name, email, phone, and authorised signatory to complete the cover letter.'}
        </span>
      </div>

      {/* Panel 1 — Proposer Identity */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Proposer Identity
          </CardTitle>
          <p className="text-xs text-muted-foreground">AIS legal entity details — pre-filled, edit only if this proposal is from a different entity.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Legal Name <span className="text-destructive">*</span></Label>
              <Input value={data.legalName} onChange={e => upd('legalName', e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Corporate Structure</Label>
              <Input value={data.corporateStructure} onChange={e => upd('corporateStructure', e.target.value)} className="text-sm" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Panel 2 — Primary Contact */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm flex items-center gap-2">
            <User className="h-4 w-4 text-primary" /> Primary Contact
          </CardTitle>
          <p className="text-xs text-muted-foreground">The person the client should contact for all RFP-related communications.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name <span className="text-destructive">*</span></Label>
              <Input value={data.contactName} onChange={e => upd('contactName', e.target.value)} placeholder="e.g. Neil Joglekar" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Title / Designation</Label>
              <Input value={data.contactTitle} onChange={e => upd('contactTitle', e.target.value)} placeholder="e.g. Pre-Sales Consultant" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={data.contactEmail} onChange={e => upd('contactEmail', e.target.value)} placeholder="name@towerceo.com" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Phone <span className="text-destructive">*</span></Label>
              <Input value={data.contactPhone} onChange={e => upd('contactPhone', e.target.value)} placeholder="+91 90280 51760" className="text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Address</Label>
            <Textarea value={data.contactAddress} onChange={e => upd('contactAddress', e.target.value)} className="text-sm min-h-[60px]" />
          </div>
        </CardContent>
      </Card>

      {/* Panel 3 — Subcontractors */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm">Subcontractors</CardTitle>
          <p className="text-xs text-muted-foreground">Many RFPs require disclosure of all subcontractors and their scope of work.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Does this proposal involve any subcontractors?</Label>
            <Select value={data.hasSubcontractors} onValueChange={v => upd('hasSubcontractors', v)}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No subcontractors — all work performed by AIS directly</SelectItem>
                <SelectItem value="yes">Yes — subcontractors involved (specify below)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {data.hasSubcontractors === 'yes' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Subcontractor details (name, scope of work, estimated % of contract value)</Label>
              <Textarea
                value={data.subcontractorDetails}
                onChange={e => upd('subcontractorDetails', e.target.value)}
                placeholder="e.g. XYZ Consulting Pvt. Ltd. — SAP SuccessFactors configuration support, approximately 20% of contract value"
                className="text-sm min-h-[80px]"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel 4 — Mandatory Disclosures */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Mandatory Disclosures
          </CardTitle>
          <p className="text-xs text-muted-foreground">Required by most formal RFPs. Select "None" if not applicable.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Pending litigation against AIS</Label>
            <Select value={data.pendingLitigation} onValueChange={v => upd('pendingLitigation', v)}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — AIS has no pending litigation</SelectItem>
                <SelectItem value="disclose">Disclose — provide details below</SelectItem>
              </SelectContent>
            </Select>
            {data.pendingLitigation === 'disclose' && (
              <Textarea value={data.litigationDetails} onChange={e => upd('litigationDetails', e.target.value)} placeholder="Describe the pending litigation…" className="text-sm min-h-[60px]" />
            )}
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Bankruptcy or insolvency proceedings in the last 5 years</Label>
            <Select value={data.bankruptcyLast5Yrs} onValueChange={v => upd('bankruptcyLast5Yrs', v)}>
              <SelectTrigger className="text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None — AIS has not been subject to any such proceedings</SelectItem>
                <SelectItem value="disclose">Disclose — provide details below</SelectItem>
              </SelectContent>
            </Select>
            {data.bankruptcyLast5Yrs === 'disclose' && (
              <Textarea value={data.bankruptcyDetails} onChange={e => upd('bankruptcyDetails', e.target.value)} placeholder="Describe the proceedings…" className="text-sm min-h-[60px]" />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Panel 5 — Validity & Signatory */}
      <Card className="enterprise-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="font-heading text-sm">Proposal Validity & Authorised Signatory</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Validity (days) <span className="text-destructive">*</span></Label>
              <Input
                type="number" min="30" max="365"
                value={data.validityDays}
                onChange={e => upd('validityDays', Number(e.target.value))}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">RFP may specify minimum (e.g. 60 days)</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Authorised Signatory Name <span className="text-destructive">*</span></Label>
              <Input value={data.authorisedSignatory} onChange={e => upd('authorisedSignatory', e.target.value)} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Signatory Title</Label>
              <Input value={data.signatoryTitle} onChange={e => upd('signatoryTitle', e.target.value)} className="text-sm" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Additional notes for cover letter (optional)</Label>
            <Textarea
              value={data.additionalNotes}
              onChange={e => upd('additionalNotes', e.target.value)}
              placeholder="Any specific statements required by this RFP that should appear in the cover letter…"
              className="text-sm min-h-[60px]"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}