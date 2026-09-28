import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { StatusBadge } from '@/components/StatusBadge';
import { useKnowledge } from '@/contexts/KnowledgeContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  Users, GitBranch, FileText, Database,
  Plus, Edit, Trash2, Save, X, Check, XCircle,
  Loader2, KeyRound, Eye, EyeOff, Mail
} from 'lucide-react';

interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  status: string;
  sort_order: number;
}

interface WorkflowStage {
  id: string;
  stage: string;
  approver: string;
  required_roles: string[];
  mandatory: boolean;
  sort_order: number;
}

interface TemplateConfig {
  id: string;
  name: string;
  version: string;
  updated_at: string;
  status: string;
}

const roles = ['Admin', 'Sales', 'Pre-Sales', 'Delivery', 'Finance', 'Legal', 'Director'];
const approverOptions = ['Auto', 'Solution Architect', 'Delivery Head', 'CFO Office', 'Legal Team', 'Admin / PMO', 'Sales Head'];

export default function AdminSettingsPage() {
  const { toast } = useToast();
  const { items: knowledgeItems, approveItem, rejectItem } = useKnowledge();

  // --- Loading ---
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingWorkflow, setLoadingWorkflow] = useState(true);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // --- Users state ---
  const [users, setUsers] = useState<AppUser[]>([]);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [userForm, setUserForm] = useState({
    name: '', email: '', roles: ['Sales'] as string[], status: 'Active', password: '', confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [sendingReset, setSendingReset] = useState(false);

  // --- Workflow state ---
  const [workflow, setWorkflow] = useState<WorkflowStage[]>([]);
  const [stageDialogOpen, setStageDialogOpen] = useState(false);
  const [editingStage, setEditingStage] = useState<WorkflowStage | null>(null);
  const [stageForm, setStageForm] = useState({ stage: '', approver: 'Auto', required_roles: [] as string[], mandatory: false });

  // --- Templates state ---
  const [templates, setTemplates] = useState<TemplateConfig[]>([]);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateConfig | null>(null);
  const [templateForm, setTemplateForm] = useState({ name: '', status: 'Active' });

  // =================== FETCH DATA ===================
  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from('admin_users').select('*').order('sort_order');
    if (data) setUsers(data.map((u: never) => ({ ...(u as object), roles: ((u as { roles?: string[] }).roles || [(u as { role?: string }).role || 'Sales']) })) as AppUser[]);
    setLoadingUsers(false);
  }, []);

  const fetchWorkflow = useCallback(async () => {
    const { data } = await supabase.from('workflow_stages').select('*').order('sort_order');
    if (data) setWorkflow(data.map((s: never) => ({ ...(s as object), required_roles: ((s as { required_roles?: string[] }).required_roles || []) })) as WorkflowStage[]);
    setLoadingWorkflow(false);
  }, []);

  const fetchTemplates = useCallback(async () => {
    const { data } = await supabase.from('proposal_templates')
      .select('id, name, version, updated_at, status').order('created_at');
    if (data) setTemplates(data as TemplateConfig[]);
    setLoadingTemplates(false);
  }, []);

  useEffect(() => {
    fetchUsers();
    fetchWorkflow();
    fetchTemplates();
  }, [fetchUsers, fetchWorkflow, fetchTemplates]);

  // =================== USER HANDLERS ===================
  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ name: '', email: '', roles: ['Sales'], status: 'Active', password: '', confirmPassword: '' });
    setShowPassword(false);
    setUserDialogOpen(true);
  };

  const openEditUser = (u: AppUser) => {
    setEditingUser(u);
    setUserForm({ name: u.name, email: u.email, roles: u.roles?.length ? u.roles : [u.role || 'Sales'], status: u.status, password: '', confirmPassword: '' });
    setShowPassword(false);
    setUserDialogOpen(true);
  };

  const saveUser = async () => {
    if (!userForm.name || !userForm.email) {
      toast({ title: 'Validation Error', description: 'Name and email are required.', variant: 'destructive' });
      return;
    }

    // Password validation for new users
    if (!editingUser) {
      if (!userForm.password || userForm.password.length < 8) {
        toast({ title: 'Validation Error', description: 'Password must be at least 8 characters.', variant: 'destructive' });
        return;
      }
      if (userForm.password !== userForm.confirmPassword) {
        toast({ title: 'Validation Error', description: 'Passwords do not match.', variant: 'destructive' });
        return;
      }
    }

    setSavingUser(true);

    if (editingUser) {
      // Update existing user profile only (no password change here — use Reset Password)
      const { error } = await (supabase.from('admin_users') as never as { update: (v: object) => { eq: (a: string, b: string) => Promise<{ error: Error | null }> } }).update({
        name: userForm.name,
        email: userForm.email,
        role: userForm.roles[0] || 'Sales',
        roles: userForm.roles,
        status: userForm.status,
      }).eq('id', editingUser.id);

      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        setSavingUser(false);
        return;
      }
      toast({ title: 'User Updated', description: `${userForm.name} has been updated.` });

    } else {
      // ── Step 1: Create auth user via signUp ──────────────────────────────
      // signUp() works even when called by an already-authenticated admin.
      // If email confirmation is ON in Supabase, the new user gets a
      // confirmation email — they cannot log in until they click it.
      // If email confirmation is OFF, they can log in immediately.
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: userForm.email,
        password: userForm.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: {
            full_name: userForm.name,
            role: userForm.roles[0] || 'Sales',
            roles: userForm.roles,
          },
        },
      });

      // Detect "already registered" — Supabase returns a fake user object
      // with an empty identities array when the email is already taken.
      if (signUpData.user && (signUpData.user.identities?.length ?? 0) === 0) {
        toast({
          title: 'Email Already Registered',
          description: `An account for ${userForm.email} already exists. Use "Reset Password" if they need access.`,
          variant: 'destructive',
        });
        setSavingUser(false);
        return;
      }

      if (signUpError) {
        toast({ title: 'Error Creating User', description: signUpError.message, variant: 'destructive' });
        setSavingUser(false);
        return;
      }

      if (!signUpData.user) {
        toast({
          title: 'User Creation Failed',
          description: 'Supabase did not return a user object. Please check your Supabase project settings.',
          variant: 'destructive',
        });
        setSavingUser(false);
        return;
      }

      // ── Step 2: Insert profile row into admin_users ───────────────────────
      const { error: profileError } = await (supabase.from('admin_users') as never as { insert: (v: object) => Promise<{ error: Error | null }> }).insert({
        id: signUpData.user.id,
        name: userForm.name,
        email: userForm.email,
        role: userForm.roles[0] || 'Sales',
        roles: userForm.roles,
        status: 'Active',
      });

      if (profileError) {
        // Auth user created but profile insert failed.
        // Most common cause: Row Level Security blocking the insert.
        // The user CAN still log in — their metadata has name + role.
        toast({
          title: 'User Created — Profile Sync Failed',
          description: `Auth account created but admin_users insert failed: ${profileError.message}. Check RLS policies on admin_users.`,
          variant: 'destructive',
        });
        setSavingUser(false);
        setUserDialogOpen(false);
        fetchUsers();
        return;
      }

      // Determine if they need email confirmation
      const needsConfirmation = !signUpData.user.email_confirmed_at;
      toast({
        title: needsConfirmation ? 'User Created — Confirmation Pending' : 'User Created ✅',
        description: needsConfirmation
          ? `${userForm.name} will receive a confirmation email at ${userForm.email}. They must click the link before logging in.`
          : `${userForm.name} can now log in with their email and password.`,
      });
    }

    setSavingUser(false);
    setUserDialogOpen(false);
    fetchUsers();
  };

  const deleteUser = async (id: string) => {
    const u = users.find(x => x.id === id);
    await supabase.from('admin_users').delete().eq('id', id);
    setDeleteConfirmId(null);
    toast({ title: 'User Removed', description: `${u?.name} has been removed.` });
    fetchUsers();
  };

  const toggleUserStatus = async (id: string) => {
    const u = users.find(x => x.id === id);
    if (!u) return;
    const newStatus = u.status === 'Active' ? 'Inactive' : 'Active';
    await supabase.from('admin_users').update({ status: newStatus }).eq('id', id);
    fetchUsers();
  };

  // Send password reset email
  const sendPasswordReset = async (email: string) => {
    setSendingReset(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setSendingReset(false);
    setResetPasswordId(null);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({
        title: 'Password Reset Email Sent 📧',
        description: `A reset link has been sent to ${email}.`,
      });
    }
  };

  // =================== WORKFLOW HANDLERS ===================
  const openAddStage = () => {
    setEditingStage(null);
    setStageForm({ stage: '', approver: 'Auto', required_roles: [], mandatory: false });
    setStageDialogOpen(true);
  };
  const openEditStage = (s: WorkflowStage) => {
    setEditingStage(s);
    setStageForm({ stage: s.stage, approver: s.approver, required_roles: s.required_roles || [], mandatory: s.mandatory });
    setStageDialogOpen(true);
  };
  const saveStage = async () => {
    if (!stageForm.stage) {
      toast({ title: 'Validation Error', description: 'Stage name is required.', variant: 'destructive' });
      return;
    }
    if (editingStage) {
      const { error } = await (supabase.from('workflow_stages') as never as { update: (v: object) => { eq: (a: string, b: string) => Promise<{ error: Error | null }> } }).update({
        stage: stageForm.stage, approver: stageForm.approver,
        required_roles: stageForm.required_roles, mandatory: stageForm.mandatory
      }).eq('id', editingStage.id);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Stage Updated', description: `"${stageForm.stage}" has been updated.` });
    } else {
      const { error } = await (supabase.from('workflow_stages') as never as { insert: (v: object) => Promise<{ error: Error | null }> }).insert({
        stage: stageForm.stage, approver: stageForm.approver,
        required_roles: stageForm.required_roles, mandatory: stageForm.mandatory,
        sort_order: workflow.length
      });
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Stage Added', description: `"${stageForm.stage}" has been added to the workflow.` });
    }
    setStageDialogOpen(false);
    fetchWorkflow();
  };
  const deleteStage = async (id: string) => {
    await supabase.from('workflow_stages').delete().eq('id', id);
    toast({ title: 'Stage Removed' });
    fetchWorkflow();
  };
  const moveStage = async (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= workflow.length) return;
    const a = workflow[index];
    const b = workflow[next];
    await Promise.all([
      supabase.from('workflow_stages').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('workflow_stages').update({ sort_order: a.sort_order }).eq('id', b.id),
    ]);
    fetchWorkflow();
  };

  // =================== TEMPLATE HANDLERS ===================
  const openAddTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: '', status: 'Active' });
    setTemplateDialogOpen(true);
  };
  const openEditTemplate = (t: TemplateConfig) => {
    setEditingTemplate(t);
    setTemplateForm({ name: t.name, status: t.status });
    setTemplateDialogOpen(true);
  };
  const saveTemplate = async () => {
    if (!templateForm.name) {
      toast({ title: 'Validation Error', description: 'Template name is required.', variant: 'destructive' });
      return;
    }
    if (editingTemplate) {
      const { error } = await supabase.from('proposal_templates').update({
        name: templateForm.name, status: templateForm.status
      }).eq('id', editingTemplate.id);
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Template Updated', description: `"${templateForm.name}" has been updated.` });
    } else {
      const { error } = await supabase.from('proposal_templates').insert({
        name: templateForm.name, status: templateForm.status, sections: []
      });
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
      toast({ title: 'Template Added', description: `"${templateForm.name}" has been created.` });
    }
    setTemplateDialogOpen(false);
    fetchTemplates();
  };
  const deleteTemplate = async (id: string) => {
    await supabase.from('proposal_templates').delete().eq('id', id);
    toast({ title: 'Template Removed' });
    fetchTemplates();
  };

  // =================== KNOWLEDGE HANDLERS ===================
  const pendingKnowledge = knowledgeItems.filter(k => k.approvalStatus === 'Pending');
  const handleApproveKnowledge = (id: string, title: string) => {
    approveItem(id);
    toast({ title: 'Approved', description: `"${title}" has been approved.` });
  };
  const handleRejectKnowledge = (id: string, title: string) => {
    rejectItem(id);
    toast({ title: 'Rejected', description: `"${title}" has been rejected and sent back.` });
  };

  const LoadingSpinner = () => (
    <div className="flex justify-center py-8">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold font-heading">Admin Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration and management</p>
      </div>

      <Tabs defaultValue="users">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="users"><Users className="h-3 w-3 mr-1" /> Users & Roles</TabsTrigger>
          <TabsTrigger value="workflow"><GitBranch className="h-3 w-3 mr-1" /> Workflow</TabsTrigger>
          <TabsTrigger value="templates"><FileText className="h-3 w-3 mr-1" /> Templates</TabsTrigger>
          <TabsTrigger value="knowledge"><Database className="h-3 w-3 mr-1" /> Knowledge Approval</TabsTrigger>
        </TabsList>

        {/* =================== USERS TAB =================== */}
        <TabsContent value="users" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="font-heading font-semibold">User Management</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Create accounts with email & password. Users log in at your website URL.
              </p>
            </div>
            <Button size="sm" onClick={openAddUser}>
              <Plus className="h-3 w-3 mr-1" /> Add User
            </Button>
          </div>

          <Card className="enterprise-shadow">
            <CardContent className="pt-4">
              {loadingUsers ? <LoadingSpinner /> : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-3 font-medium text-muted-foreground">Name</th>
                      <th className="pb-3 font-medium text-muted-foreground">Email</th>
                      <th className="pb-3 font-medium text-muted-foreground">Role</th>
                      <th className="pb-3 font-medium text-muted-foreground">Status</th>
                      <th className="pb-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id} className="border-b last:border-0">
                        <td className="py-3 font-medium">{u.name}</td>
                        <td className="py-3 text-muted-foreground">{u.email}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {(u.roles?.length ? u.roles : [u.role]).map(r => (
                              <StatusBadge key={r} status={r} />
                            ))}
                          </div>
                        </td>
                        <td className="py-3">
                          <button onClick={() => toggleUserStatus(u.id)} className="cursor-pointer" title="Click to toggle">
                            <StatusBadge status={u.status} />
                          </button>
                        </td>
                        <td className="py-3">
                          <div className="flex gap-1 flex-wrap">
                            {/* Edit profile */}
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit user" onClick={() => openEditUser(u)}>
                              <Edit className="h-3 w-3" />
                            </Button>

                            {/* Reset password */}
                            {resetPasswordId === u.id ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">Send reset email?</span>
                                <Button
                                  variant="ghost" size="icon" className="h-7 w-7 text-primary"
                                  disabled={sendingReset}
                                  onClick={() => sendPasswordReset(u.email)}
                                >
                                  {sendingReset ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setResetPasswordId(null)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-blue-500"
                                title="Send password reset email"
                                onClick={() => setResetPasswordId(u.id)}
                              >
                                <KeyRound className="h-3 w-3" />
                              </Button>
                            )}

                            {/* Delete */}
                            {deleteConfirmId === u.id ? (
                              <>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteUser(u.id)}>
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDeleteConfirmId(null)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete user" onClick={() => setDeleteConfirmId(u.id)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground text-sm">
                          No users yet. Click "Add User" to create the first account.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Edit className="h-3 w-3" /> Edit name / role</span>
            <span className="flex items-center gap-1"><KeyRound className="h-3 w-3 text-blue-500" /> Send password reset email</span>
            <span className="flex items-center gap-1"><Trash2 className="h-3 w-3 text-destructive" /> Remove user</span>
          </div>
        </TabsContent>

        {/* =================== WORKFLOW TAB =================== */}
        <TabsContent value="workflow" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-heading font-semibold">Approval Workflow Configuration</h2>
            <Button size="sm" onClick={openAddStage}><Plus className="h-3 w-3 mr-1" /> Add Stage</Button>
          </div>
          <Card className="enterprise-shadow">
            <CardContent className="pt-4">
              {loadingWorkflow ? <LoadingSpinner /> : (
                <div className="space-y-2">
                  {workflow.map((s, i) => (
                    <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-0.5">
                          <button disabled={i === 0} onClick={() => moveStage(i, -1)} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30">▲</button>
                          <button disabled={i === workflow.length - 1} onClick={() => moveStage(i, 1)} className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30">▼</button>
                        </div>
                        <span className="h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="font-medium text-sm">{s.stage}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{s.approver}</span>
                        {s.required_roles?.length > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            {s.required_roles.map(r => (
                              <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{r}</span>
                            ))}
                          </div>
                        )}
                        {s.mandatory && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">Mandatory</span>}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditStage(s)}><Edit className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteStage(s.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* =================== TEMPLATES TAB =================== */}
        <TabsContent value="templates" className="mt-4 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="font-heading font-semibold">Template Management</h2>
            <Button size="sm" onClick={openAddTemplate}><Plus className="h-3 w-3 mr-1" /> Add Template</Button>
          </div>
          {loadingTemplates ? <LoadingSpinner /> : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {templates.map(t => (
                <Card key={t.id} className="enterprise-shadow hover:enterprise-shadow-md transition-shadow">
                  <CardContent className="pt-4 text-center relative">
                    <div className="absolute top-2 right-2 flex gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditTemplate(t)}><Edit className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => deleteTemplate(t.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                    <FileText className="h-8 w-8 mx-auto mb-2 text-primary" />
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">v{t.version} · {t.updated_at?.slice(0, 10)}</p>
                    <StatusBadge status={t.status} />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* =================== KNOWLEDGE TAB =================== */}
        <TabsContent value="knowledge" className="mt-4 space-y-4">
          <h2 className="font-heading font-semibold">Knowledge Approval Queue ({pendingKnowledge.length} pending)</h2>
          <Card className="enterprise-shadow">
            <CardContent className="pt-4">
              {pendingKnowledge.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No items pending approval.</p>
              ) : (
                <div className="space-y-3">
                  {pendingKnowledge.map(k => (
                    <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{k.title}</p>
                        <p className="text-xs text-muted-foreground">{k.type} · {k.lob} · v{k.version}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={k.approvalStatus} />
                        <Button size="sm" variant="outline" className="text-green-600 border-green-300 hover:bg-green-50"
                          onClick={() => handleApproveKnowledge(k.id, k.title)}>
                          <Check className="h-3 w-3 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5"
                          onClick={() => handleRejectKnowledge(k.id, k.title)}>
                          <XCircle className="h-3 w-3 mr-1" /> Reject
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* =================== ADD / EDIT USER DIALOG =================== */}
      <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Create New User'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <Label>Full Name *</Label>
              <Input
                value={userForm.name}
                onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Rajesh Sharma"
              />
            </div>

            {/* Email */}
            <div>
              <Label>Work Email *</Label>
              <Input
                type="email"
                value={userForm.email}
                onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                placeholder="rajesh@yourcompany.com"
              />
            </div>

            {/* Password — only for new users */}
            {!editingUser && (
              <>
                <div>
                  <Label>Password *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={userForm.password}
                      onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Min 8 characters"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      onClick={() => setShowPassword(v => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Share this password with the user privately after creating their account.
                  </p>
                </div>

                <div>
                  <Label>Confirm Password *</Label>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    value={userForm.confirmPassword}
                    onChange={e => setUserForm(f => ({ ...f, confirmPassword: e.target.value }))}
                    placeholder="Re-enter password"
                  />
                  {userForm.confirmPassword && userForm.password !== userForm.confirmPassword && (
                    <p className="text-xs text-destructive mt-1">Passwords do not match</p>
                  )}
                  {userForm.confirmPassword && userForm.password === userForm.confirmPassword && userForm.password.length >= 8 && (
                    <p className="text-xs text-green-600 mt-1">✓ Passwords match</p>
                  )}
                </div>
              </>
            )}

            {/* Roles — multi-select */}
            <div>
              <Label>Roles * (select one or more)</Label>
              <div className="grid grid-cols-2 gap-2 mt-2 p-3 border rounded-lg">
                {roles.map(r => (
                  <label key={r} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={userForm.roles.includes(r)}
                      onChange={e => setUserForm(f => ({
                        ...f,
                        roles: e.target.checked ? [...f.roles, r] : f.roles.filter(x => x !== r)
                      }))}
                      className="rounded"
                    />
                    <span className="text-sm">{r}</span>
                  </label>
                ))}
              </div>
              {userForm.roles.length === 0 && (
                <p className="text-xs text-destructive mt-1">Select at least one role.</p>
              )}
            </div>

            {/* Status */}
            <div className="flex items-center gap-3 p-3 rounded-lg border">
              <div className="flex-1">
                <p className="text-sm font-medium">Account Active</p>
                <p className="text-xs text-muted-foreground">Inactive users cannot log in.</p>
              </div>
              <Switch
                checked={userForm.status === 'Active'}
                onCheckedChange={c => setUserForm(f => ({ ...f, status: c ? 'Active' : 'Inactive' }))}
              />
            </div>

            {/* Edit mode — password reset note */}
            {editingUser && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
                <Mail className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  To change this user's password, close this dialog and click the <strong>🔑 key icon</strong> next to their name. A password reset email will be sent to them.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUserDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveUser} disabled={savingUser}>
              {savingUser
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Saving...</>
                : <><Save className="h-3 w-3 mr-1" /> {editingUser ? 'Update User' : 'Create User'}</>
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =================== WORKFLOW DIALOG =================== */}
      <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingStage ? 'Edit Stage' : 'Add Stage'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Stage Name</Label>
              <Input value={stageForm.stage} onChange={e => setStageForm(f => ({ ...f, stage: e.target.value }))} placeholder="e.g. Technical Review" />
            </div>
            <div>
              <Label>Approver</Label>
              <Select value={stageForm.approver} onValueChange={v => setStageForm(f => ({ ...f, approver: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{approverOptions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Roles that can approve this stage</Label>
              <div className="grid grid-cols-2 gap-2 mt-2 p-3 border rounded-lg">
                {roles.map(r => (
                  <label key={r} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stageForm.required_roles.includes(r)}
                      onChange={e => setStageForm(f => ({
                        ...f,
                        required_roles: e.target.checked ? [...f.required_roles, r] : f.required_roles.filter(x => x !== r)
                      }))}
                      className="rounded"
                    />
                    <span className="text-sm">{r}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Label>Mandatory</Label>
              <Switch checked={stageForm.mandatory} onCheckedChange={c => setStageForm(f => ({ ...f, mandatory: c }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStageDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveStage}><Save className="h-3 w-3 mr-1" /> {editingStage ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* =================== TEMPLATE DIALOG =================== */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Edit Template' : 'Add Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input value={templateForm.name} onChange={e => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. SOW Template" />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={templateForm.status} onValueChange={v => setTemplateForm(f => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Draft">Draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveTemplate}><Save className="h-3 w-3 mr-1" /> {editingTemplate ? 'Update' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}