import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let mockPathname = '/admin/users';
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/contexts/WalletContext', () => ({
  useWallet: () => ({
    address: null, network: 'unknown', isConnected: false, isLoading: false, connect: vi.fn(), disconnect: vi.fn(),
  }),
}));
vi.mock('@/backend/services/notifications/notification-center', () => ({ NotificationCenter: () => null }));
vi.mock('@/components/streaming/deferred-swap-launcher', () => ({ DeferredSwapLauncher: () => null }));
vi.mock('@/components/connect-wallet-button', () => ({
  ConnectWalletButton: () => null,
  formatAccount: (a: string) => a,
}));

import { ResponsiveSidebar, SidebarLayout } from '@/components/sidebar';
import { AdminSidebar } from '@/components/layout/admin-sidebar';
import { Header } from '@/components/header';

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // framer-motion's reduced-motion check still uses the legacy API
    addListener: () => undefined,
    removeListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const items = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/audit', label: 'Audit Log' },
];

beforeEach(() => {
  mockPathname = '/admin/users';
  document.body.style.overflow = '';
});

describe('ResponsiveSidebar', () => {
  it('is an off-canvas drawer on mobile: inert until opened, closes on Escape and backdrop', () => {
    setViewport(390);
    const { container } = render(<ResponsiveSidebar title="Admin Panel" items={items} />);
    const drawer = container.querySelector('aside') as HTMLElement;

    expect(drawer).toHaveAttribute('inert');
    expect(drawer.className).toContain('-translate-x-full');

    const trigger = screen.getByRole('button', { name: /open admin panel menu/i });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    expect(drawer).not.toHaveAttribute('inert');
    expect(drawer.className).toContain('translate-x-0');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(drawer).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(trigger);
    fireEvent.click(container.querySelector('[aria-hidden="true"].fixed') as HTMLElement);
    expect(drawer).toHaveAttribute('inert');
  });

  it('closes after navigating to another route', () => {
    setViewport(390);
    const { container, rerender } = render(<ResponsiveSidebar title="Admin Panel" items={items} />);
    fireEvent.click(screen.getByRole('button', { name: /open admin panel menu/i }));
    expect(container.querySelector('aside')).not.toHaveAttribute('inert');

    mockPathname = '/admin/audit';
    rerender(<ResponsiveSidebar title="Admin Panel" items={items} />);
    expect(container.querySelector('aside')).toHaveAttribute('inert');
  });

  it('stays a normal, focusable grid column on desktop and marks the active route', () => {
    setViewport(1440);
    const { container } = render(<ResponsiveSidebar title="Admin Panel" items={items} />);
    expect(container.querySelector('aside')).not.toHaveAttribute('inert');
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Audit Log' })).not.toHaveAttribute('aria-current');
  });
});

describe('SidebarLayout / AdminSidebar', () => {
  it('lays out sidebar and content in the app-shell grid', () => {
    setViewport(1440);
    const { container } = render(
      <SidebarLayout sidebar={<AdminSidebar />}><h1>Page</h1></SidebarLayout>,
    );
    expect(container.firstElementChild).toHaveClass('app-shell');
    expect(screen.getByRole('link', { name: 'Disputes' })).toHaveAttribute('href', '/admin/disputes');
    expect(screen.getByRole('heading', { name: 'Page' }).parentElement).toHaveClass('min-w-0');
  });
});

describe('Header mobile navigation', () => {
  it('opens the sliding off-canvas menu instead of an inline dropdown', () => {
    setViewport(390);
    render(<Header />);
    const dialog = document.getElementById('main-mobile-nav-panel') as HTMLElement;
    expect(dialog).toHaveClass('translate-x-full');
    expect(document.getElementById('mobile-menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    expect(dialog).toHaveClass('translate-x-0');
    expect(dialog.closest('header')).toBeNull(); // rendered outside the blurred header
  });
});
