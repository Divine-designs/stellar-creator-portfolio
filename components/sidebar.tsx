'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Menu, X } from 'lucide-react';
import { useIsMobile } from '@/components/ui/use-mobile';
import { cn } from '@/lib/utils';

export interface SidebarItem {
  href: string;
  label: string;
  icon?: LucideIcon;
  /** Match the pathname exactly instead of by prefix. */
  exact?: boolean;
}

interface ResponsiveSidebarProps {
  title: string;
  items: SidebarItem[];
}

/**
 * Navigation sidebar that is a normal grid column from `md` up and a sliding
 * off-canvas drawer below it. Render it as a direct child of `SidebarLayout`
 * (or any element using the `app-shell` grid utility).
 *
 * Below `md` the component renders a slim sticky top bar with the menu button;
 * the drawer slides in from the left, traps scroll, closes on Escape, on
 * backdrop click and after navigation, and is `inert` while closed so its links
 * are not tabbable off-screen.
 */
export function ResponsiveSidebar({ title, items }: ResponsiveSidebarProps) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);

  // Close the drawer after a navigation (adjust state during render, not in an effect).
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const drawerOpen = isMobile && open;

  return (
    <>
      {/* Mobile top bar (hidden from md) */}
      <div className="md:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${title} menu`}
          aria-expanded={drawerOpen}
          aria-controls={panelId}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>

      {/* Backdrop */}
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className={cn(
          'fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 motion-reduce:transition-none md:hidden',
          drawerOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      {/* Drawer on mobile, sticky grid column from md */}
      <aside
        id={panelId}
        aria-label={title}
        inert={isMobile && !open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card px-3 pb-8 pt-6',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          'md:sticky md:top-0 md:z-auto md:h-dvh md:w-auto md:max-w-none md:translate-x-0 md:overflow-y-auto',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-4 flex items-center justify-between px-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-secondary md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <nav aria-label={title} className="flex flex-col gap-1">
          {items.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:min-h-0',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
              >
                {Icon && <Icon size={16} aria-hidden />}
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

/**
 * CSS-grid page shell: one column on mobile, `sidebar | content` from `md`.
 * `min-w-0` on the content cell lets wide tables / code scroll inside the
 * column instead of stretching the page.
 */
export function SidebarLayout({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="app-shell bg-background">
      {sidebar}
      <div className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
    </div>
  );
}
