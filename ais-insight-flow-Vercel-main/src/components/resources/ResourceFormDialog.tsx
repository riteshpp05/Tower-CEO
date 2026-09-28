import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DbResource } from '@/hooks/useResources';

const SAP_MODULES = ['FI', 'CO', 'MM', 'SD', 'PP', 'QM', 'PM', 'ABAP', 'BASIS', 'BTP', 'Fiori', 'Ariba'];
const GEOGRAPHIES = ['India', 'USA', 'UK', 'Singapore', 'Middle East', 'Europe'];
const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'SGD', 'AED'];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource?: DbResource | null;
  onSave: (data: Omit<DbResource, 'id' | 'created_at' | 'updated_at'>) => void;
  saving?: boolean;
}

export function ResourceFormDialog({ open, onOpenChange, resource, onSave, saving }: Props) {
  const [form, setForm] = useState({
    name: '', designation: '', skills: '', sap_modules: [] as string[],
    years_of_experience: 0, certifications: '', geography: 'India',
    availability: 'Available', languages: 'English', employment_type: 'Full-Time',
    cost_rate: 0, billing_rate: 0, cost_loading_percentage: 0, currency: 'USD',
    email: '', phone: '', bio: '', profile_summary: '', key_projects: '',
  });

  useEffect(() => {
    if (resource) {
      setForm({
        name: resource.name, designation: resource.designation,
        skills: resource.skills.join(', '), sap_modules: resource.sap_modules,
        years_of_experience: resource.years_of_experience,
        certifications: resource.certifications.join(', '),
        geography: resource.geography, availability: resource.availability,
        languages: resource.languages.join(', '), employment_type: resource.employment_type,
        cost_rate: resource.cost_rate, billing_rate: resource.billing_rate,
        cost_loading_percentage: resource.cost_loading_percentage, currency: resource.currency,
        email: resource.email || '', phone: resource.phone || '',
        bio: resource.bio || '', profile_summary: resource.profile_summary || '',
        key_projects: resource.key_projects.join(', '),
      });
    } else {
      setForm({
        name: '', designation: '', skills: '', sap_modules: [],
        years_of_experience: 0, certifications: '', geography: 'India',
        availability: 'Available', languages: 'English', employment_type: 'Full-Time',
        cost_rate: 0, billing_rate: 0, cost_loading_percentage: 0, currency: 'USD',
        email: '', phone: '', bio: '', profile_summary: '', key_projects: '',
      });
    }
  }, [resource, open]);

  const toArr = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  const margin = form.billing_rate > 0 ? ((form.billing_rate - form.cost_rate * (1 + form.cost_loading_percentage / 100)) / form.billing_rate * 100).toFixed(1) : '0';
  const loadedCost = (form.cost_rate * (1 + form.cost_loading_percentage / 100)).toFixed(2);

  const toggleModule = (m: string) => {
    setForm(f => ({
      ...f,
      sap_modules: f.sap_modules.includes(m) ? f.sap_modules.filter(x => x !== m) : [...f.sap_modules, m],
    }));
  };

  const handleSubmit = () => {
    onSave({
      name: form.name, designation: form.designation,
      skills: toArr(form.skills), sap_modules: form.sap_modules,
      years_of_experience: form.years_of_experience, certifications: toArr(form.certifications),
      geography: form.geography, availability: form.availability,
      languages: toArr(form.languages), employment_type: form.employment_type,
      cost_rate: form.cost_rate, billing_rate: form.billing_rate,
      cost_loading_percentage: form.cost_loading_percentage, currency: form.currency,
      email: form.email, phone: form.phone, bio: form.bio,
      profile_summary: form.profile_summary, key_projects: toArr(form.key_projects),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{resource ? 'Edit Resource' : 'Add New Resource'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Full Name *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Vikram Singh" />
          </div>
          <div className="space-y-1.5">
            <Label>Designation *</Label>
            <Input value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} placeholder="e.g. SAP FI/CO Lead Consultant" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Years of Experience</Label>
            <Input type="number" value={form.years_of_experience} onChange={e => setForm(f => ({ ...f, years_of_experience: parseInt(e.target.value) || 0 }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Geography</Label>
            <Select value={form.geography} onValueChange={v => setForm(f => ({ ...f, geography: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{GEOGRAPHIES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Availability</Label>
            <Select value={form.availability} onValueChange={v => setForm(f => ({ ...f, availability: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Available">Available</SelectItem>
                <SelectItem value="Partially Available">Partially Available</SelectItem>
                <SelectItem value="Engaged">Engaged</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Employment Type</Label>
            <Select value={form.employment_type} onValueChange={v => setForm(f => ({ ...f, employment_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Full-Time">Full-Time</SelectItem>
                <SelectItem value="Contractor">Contractor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>SAP Modules</Label>
            <div className="flex flex-wrap gap-2">
              {SAP_MODULES.map(m => (
                <button key={m} type="button" onClick={() => toggleModule(m)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.sap_modules.includes(m) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-input hover:bg-accent'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Skills (comma-separated)</Label>
            <Input value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))} placeholder="SAP FI, SAP CO, S/4HANA Finance" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Certifications (comma-separated)</Label>
            <Input value={form.certifications} onChange={e => setForm(f => ({ ...f, certifications: e.target.value }))} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Languages (comma-separated)</Label>
            <Input value={form.languages} onChange={e => setForm(f => ({ ...f, languages: e.target.value }))} placeholder="English, Hindi" />
          </div>

          {/* Cost & Rate section */}
          <div className="col-span-2 border-t pt-4 mt-2">
            <h3 className="text-sm font-semibold mb-3">Cost & Rate Information</h3>
            <div className="grid grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Base Cost Rate (/hr)</Label>
                <Input type="number" value={form.cost_rate} onChange={e => setForm(f => ({ ...f, cost_rate: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Loading %</Label>
                <Input type="number" value={form.cost_loading_percentage} onChange={e => setForm(f => ({ ...f, cost_loading_percentage: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Billing Rate (/hr)</Label>
                <Input type="number" value={form.billing_rate} onChange={e => setForm(f => ({ ...f, billing_rate: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="flex gap-6 mt-2 text-xs text-muted-foreground">
              <span>Loaded Cost: <strong className="text-foreground">{form.currency} {loadedCost}/hr</strong></span>
              <span>Effective Margin: <strong className={`${parseFloat(margin) >= 30 ? 'text-green-600' : parseFloat(margin) >= 15 ? 'text-amber-600' : 'text-red-600'}`}>{margin}%</strong></span>
            </div>
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label>Profile Summary</Label>
            <Textarea value={form.profile_summary} onChange={e => setForm(f => ({ ...f, profile_summary: e.target.value }))} rows={3} placeholder="Brief professional summary for CV..." />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Key Projects (comma-separated)</Label>
            <Input value={form.key_projects} onChange={e => setForm(f => ({ ...f, key_projects: e.target.value }))} placeholder="Project A, Project B" />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label>Bio / Notes</Label>
            <Textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} rows={2} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!form.name || saving}>{saving ? 'Saving...' : resource ? 'Update' : 'Create'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
