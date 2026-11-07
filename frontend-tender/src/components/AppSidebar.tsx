import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LayoutDashboard, TrendingUp, FileText, Database, DollarSign, Scale, Users, ClipboardCheck, CheckCircle, BarChart3, Settings, LayoutTemplate, ChevronDown, ChevronRight, LogOut } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';

const navGroups = [
  {
    items: [
      { title: 'Dashboard', path: '/', icon: LayoutDashboard },
    ]
  },
  {
    label: 'Proposals',
    items: [
      { title: 'All Proposals', path: '/proposals', icon: FileText },
      { title: 'New Proposal', path: '/proposals/new', icon: FileText },
      { title: 'Pending My Action', path: '/proposals?filter=pending', icon: FileText },
    ]
  },
  {
    label: 'Modules',
    items: [
      { title: 'Knowledge Base', path: '/knowledge', icon: Database },
      { title: 'Templates', path: '/templates', icon: LayoutTemplate },
      { title: 'Commercial Rules', path: '/commercial', icon: DollarSign },
      { title: 'Pricing Strategy', path: '/pricing', icon: TrendingUp },
      { title: 'Legal Library', path: '/legal', icon: Scale },
      { title: 'Resource & CV Builder', path: '/resources', icon: Users },
      { title: 'Tender Engine', path: '/tender', icon: ClipboardCheck },
    ]
  },
  {
    label: 'Governance',
    items: [
      { title: 'Approvals', path: '/approvals', icon: CheckCircle },
      { title: 'Reports', path: '/reports', icon: BarChart3 },
      { title: 'Admin Settings', path: '/admin', icon: Settings },
    ]
  },
];

export function AppSidebar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const currentRoute = `${location.pathname}${location.search}`;

  const toggleGroup = (label: string) => {
    setCollapsed(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const isItemActive = (path: string) => {
    const [itemPath, itemQuery] = path.split('?');

    if (itemQuery) {
      return currentRoute === path;
    }

    if (itemPath === '/') {
      return location.pathname === '/';
    }

    if (itemPath === '/proposals') {
      return (location.pathname === '/proposals' && !location.search) || (location.pathname.startsWith('/proposals/') && location.pathname !== '/proposals/new');
    }

    return location.pathname === itemPath;
  };

  return (
    <aside className="w-64 min-h-screen bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border shrink-0">
      <div className="p-5 border-b border-sidebar-border">
        <h1 className="font-heading font-bold text-lg text-sidebar-primary">AIS PIP</h1>
        <p className="text-xs text-sidebar-muted mt-0.5">Proposal Intelligence Platform</p>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {navGroups.map((group, gi) => (
          <div key={gi} className="mb-1">
            {group.label && (
              <button
                onClick={() => toggleGroup(group.label!)}
                className="flex items-center justify-between w-full px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-muted hover:text-sidebar-foreground"
              >
                {group.label}
                {collapsed[group.label!] ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            {!collapsed[group.label || ''] && group.items.map(item => {
              // Hide Admin Settings for non-Admin users
              if (item.path === '/admin' && user?.role !== 'Admin') return null;
              const isActive = isItemActive(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-3 px-5 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.title}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-sidebar-primary flex items-center justify-center text-xs font-bold text-sidebar-primary-foreground">
            {user?.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-xs text-sidebar-muted">{user?.role}</p>
          </div>
          <button onClick={logout} className="text-sidebar-muted hover:text-sidebar-foreground">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}