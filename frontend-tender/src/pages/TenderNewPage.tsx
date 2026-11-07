import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { indexRfpDocument } from '@/lib/llmClient';
import { parseTenderFiles, isSupportedTenderFile, SUPPORTED_EXTENSIONS } from '@/lib/parseTenderFiles';
import { extractTenderBrief, extractQualificationCriteria, attachCompanyEvidence } from '@/lib/extractTenderData';
import { extractAnnexures } from '@/lib/extractAnnexures';
import { generateTenderId, newTenderRecord, saveTender } from '@/lib/tenderEngine';
import { supabase } from '@/integrations/supabase/client';
import { Upload, Loader2, FileText, FileSpreadsheet, ArrowLeft, X } from 'lucide-react';

const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls']);

interface CompanyProfileShape {
  legalName?: string;
  foundedYear?: string;
  sapPartnerTier?: string;
  isoCertifications?: string;
  offices?: string;
  teamSize?: string;
  revenueRange?: string;
  aboutUs?: string;
}

async function loadCompanyProfile(): Promise<CompanyProfileShape | null> {
  try {
    const { data } = await supabase
      .from('app_config' as never)
      .select('value')
      .eq('key', 'company_profile')
      .maybeSingle();
    if (!data) return null;
    const raw = (data as { value?: unknown }).value;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed?.profile ?? null;
  } catch {
    return null;
  }
}

function fileIcon(fileName: string) {
  const ext = fileName.toLowerCase().split('.').pop() || '';
  return SPREADSHEET_EXTENSIONS.has(ext) ? FileSpreadsheet : FileText;
}

export default function TenderNewPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [clientName, setClientName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<'idle' | 'reading' | 'indexing' | 'extracting' | 'error'>('idle');
  const [readProgress, setReadProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const busy = stage === 'reading' || stage === 'indexing' || stage === 'extracting';

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;

    const valid: File[] = [];
    const rejected: string[] = [];
    for (const f of selected) {
      if (isSupportedTenderFile(f.name)) {
        valid.push(f);
      } else {
        rejected.push(f.name);
      }
    }

    if (rejected.length > 0) {
      toast({
        title: rejected.length === 1 ? 'Unsupported file skipped' : `${rejected.length} unsupported files skipped`,
        description: `${rejected.join(', ')} — use .docx, .pdf, .jpg, .jpeg, .png, .tiff, .xlsx, or .xls`,
        variant: 'destructive',
      });
    }

    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name));
      const merged = [...prev, ...valid.filter(f => !existingNames.has(f.name))];
      return merged;
    });

    if (!title && valid.length > 0) {
      setTitle(valid[0].name.replace(/\.[^.]+$/, ''));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name));
  };

  const handleSubmit = async () => {
    if (files.length === 0) {
      toast({ title: 'Please select at least one tender document to upload', variant: 'destructive' });
      return;
    }
    if (!clientName.trim()) {
      toast({ title: 'Please enter the client / tender-issuing authority name', variant: 'destructive' });
      return;
    }

    setErrorMsg('');
    try {
      // 1. Parse all files (docx/pdf/image via APNJ-LLM-Studio, xlsx/xls client-side)
      setStage('reading');
      const outcome = await parseTenderFiles(files, (current, total, fileName) => {
        setReadProgress(total > 1 ? `Reading file ${current} of ${total}: ${fileName}…` : `Reading ${fileName}…`);
      });
      setReadProgress('');

      if (outcome.results.length === 0) {
        throw new Error(`None of the uploaded files could be read. ${outcome.failNames.join('; ')}`);
      }

      const rfpRawText = outcome.consolidatedRawText;

      if (outcome.failNames.length > 0) {
        toast({
          title: `${outcome.successNames.length} parsed, ${outcome.failNames.length} failed`,
          description: outcome.failNames.join('; '),
        });
      }

      // 2. Index document-type files (docx/pdf/image) into RAG for follow-up queries.
      //    Spreadsheets are skipped here - their content is already folded into
      //    rfpRawText as Markdown tables, and the index-rfp endpoint isn't built
      //    for spreadsheet parsing.
      setStage('indexing');
      const rfpSessionId = crypto.randomUUID();
      const docFiles = files.filter(f => {
        const ext = f.name.toLowerCase().split('.').pop() || '';
        return outcome.successNames.includes(f.name) && !SPREADSHEET_EXTENSIONS.has(ext);
      });
      for (const docFile of docFiles) {
        try {
          await indexRfpDocument(docFile, rfpSessionId);
        } catch {
          // Indexing failure is non-fatal - extraction below works directly off rfpRawText.
        }
      }

      // 3. Create the record up front (status: extracting) so nothing is lost if a later step fails
      const id = await generateTenderId();
      const record = newTenderRecord({
        id,
        title: title.trim() || outcome.successNames[0].replace(/\.[^.]+$/, ''),
        clientName: clientName.trim(),
        owner: user?.name ?? 'Unknown',
        rfpRawText,
        rfpSessionId,
        rfpFiles: outcome.successNames,
      });
      await saveTender(record);

      // 4. Run extraction pipelines
      setStage('extracting');
      const [brief, qualification, annexures, companyProfile] = await Promise.all([
        extractTenderBrief(rfpRawText),
        extractQualificationCriteria(rfpRawText),
        extractAnnexures(rfpRawText),
        loadCompanyProfile(),
      ]);

      const qualificationWithEvidence = {
        ...qualification,
        general: attachCompanyEvidence(qualification.general, companyProfile),
        technical: attachCompanyEvidence(qualification.technical, companyProfile),
      };

      const completed = {
        ...record,
        status: 'extracted' as const,
        extractedAt: new Date().toISOString(),
        brief,
        qualification: qualificationWithEvidence,
        submission: {
          ...record.submission,
          annexures,
        },
      };
      await saveTender(completed);

      toast({ title: 'Tender extracted', description: 'Review the bid brief, then move on to qualification criteria.' });
      navigate(`/tender/${id}/brief`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during extraction.';
      setErrorMsg(message);
      setStage('error');
      toast({ title: 'Extraction failed', description: message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/tender')} className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Tender Engine
      </Button>

      <div>
        <h1 className="text-2xl font-bold font-heading">New Tender</h1>
        <p className="text-sm text-muted-foreground">
          Upload the tender/RFP document and any supporting files (e.g. BoQ or pricing-format spreadsheets). We'll extract the bid brief, qualification criteria, and detect required annexures — every field will be backed by a verbatim quote from the document, or marked as not found.
        </p>
      </div>

      <Card className="enterprise-shadow">
        <CardHeader>
          <CardTitle className="font-heading text-base">Tender Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tender-title">Tender Title</Label>
            <Input
              id="tender-title"
              placeholder="e.g. NIC SAP Implementation Tender"
              value={title}
              onChange={e => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tender-client">Client / Tender-Issuing Authority</Label>
            <Input
              id="tender-client"
              placeholder="e.g. National Informatics Centre"
              value={clientName}
              onChange={e => setClientName(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label>Tender Documents</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_EXTENSIONS.map(ext => `.${ext}`).join(',')}
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4 mr-2" />
              {files.length > 0 ? 'Add more files' : 'Choose tender documents (.docx, .pdf, image, .xlsx, .xls)'}
            </Button>

            {files.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {files.map(f => {
                  const Icon = fileIcon(f.name);
                  return (
                    <div key={f.name} className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                      <span className="flex items-center gap-2 text-sm truncate">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="truncate">{f.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(f.name)}
                        disabled={busy}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-40 shrink-0"
                        aria-label={`Remove ${f.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {readProgress && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> {readProgress}
            </p>
          )}

          {stage === 'error' && (
            <p className="text-sm text-destructive">{errorMsg}</p>
          )}

          <Button onClick={handleSubmit} disabled={busy || files.length === 0} className="w-full">
            {stage === 'reading' && <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reading documents…</>}
            {stage === 'indexing' && <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Indexing documents…</>}
            {stage === 'extracting' && <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Extracting brief, qualification criteria & annexures…</>}
            {(stage === 'idle' || stage === 'error') && <>Extract Tender</>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}