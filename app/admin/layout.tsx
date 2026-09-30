import type { Metadata } from 'next';
import { AdminSidebar } from '@/components/layout/admin-sidebar';
import { SidebarLayout } from '@/components/sidebar';

export const metadata: Metadata = {
  title: 'Admin',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <SidebarLayout sidebar={<AdminSidebar />}>{children}</SidebarLayout>;
}
