import { ReactNode } from 'react';
import { AppSidebar } from '@/components/AppSidebar';
import { Search } from 'lucide-react';
import { NotificationBell } from '@/components/NotificationBell';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';

export function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0 enterprise-shadow">
          <div className="flex items-center gap-3 flex-1 max-w-md">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search proposals, clients, documents..." className="h-8 border-0 bg-muted/50 text-sm" />
          </div>
          <div className="flex items-center gap-4">
            <button className="relative text-muted-foreground hover:text-foreground">
<NotificationBell />
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-destructive rounded-full text-[10px] text-destructive-foreground flex items-center justify-center font-bold">3</span>
            </button>
            <div className="text-right">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.role}</p>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6 bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}