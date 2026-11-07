import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

export default function LoginPage() {
  const { login, error: authError, requestPasswordReset } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setLocalError(null);
    if (!email || !password) {
      setLocalError('Email and password are required');
      return;
    }
    setSubmitting(true);
    const ok = await login(email, password);
    setSubmitting(false);
    if (!ok && !authError) {
      setLocalError('Sign-in failed');
    }
  };

  const handleForgotPassword = async () => {
    if (resetting) return;
    if (!email) {
      setLocalError('Enter your email above, then click "Forgot Password?"');
      return;
    }
    setLocalError(null);
    setResetting(true);
    const res = await requestPasswordReset(email);
    setResetting(false);
    if (res.ok) {
      toast({
        title: 'Password reset email sent',
        description: `If ${email} is registered, a reset link has been sent.`,
      });
    } else {
      setLocalError(res.error ?? 'Failed to send reset email');
    }
  };

  const displayError = localError ?? authError;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="font-heading text-3xl font-bold text-primary">AIS PIP</h1>
          <p className="text-sm text-muted-foreground mt-1">Proposal Intelligence Platform</p>
          <p className="text-xs text-muted-foreground mt-0.5">Tower-CEO Technologies Pvt. Ltd.</p>
        </div>
        <Card className="enterprise-shadow-md">
          <CardHeader>
            <CardTitle className="font-heading text-xl">Sign In</CardTitle>
            <CardDescription>Access your proposal workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@towerceo.com"
                  autoComplete="email"
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  disabled={submitting}
                />
              </div>
              {displayError && <p className="text-sm text-destructive">{displayError}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign In'}
              </Button>
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resetting}
                className="text-sm text-primary hover:underline w-full text-center disabled:opacity-50"
              >
                {resetting ? 'Sending reset link…' : 'Forgot Password?'}
              </button>
            </form>
          </CardContent>
        </Card>
        <p className="text-xs text-center text-muted-foreground mt-6">© 2026 Tower-CEO Technologies Pvt. Ltd. All rights reserved.</p>
      </div>
    </div>
  );
}
