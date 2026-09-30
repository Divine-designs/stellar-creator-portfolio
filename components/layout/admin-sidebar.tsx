'use client';

import {
  Briefcase,
  BarChart2,
  Flag,
  Gavel,
  ScrollText,
  ToggleRight,
  Users,
} from 'lucide-react';
import { ResponsiveSidebar, type SidebarItem } from '@/components/sidebar';

// Only routes that exist under app/admin.
const navItems: SidebarItem[] = [
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/bounties', label: 'Bounties', icon: Briefcase },
  { href: '/admin/disputes', label: 'Disputes', icon: Gavel },
  { href: '/admin/reports', label: 'Reports', icon: Flag },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart2 },
  { href: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  { href: '/admin/feature-flags', label: 'Feature Flags', icon: ToggleRight },
];

export function AdminSidebar() {
  return <ResponsiveSidebar title="Admin Panel" items={navItems} />;
}
