import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BountiesStatsSkeleton,
  CreatorHeroSkeleton,
  CreatorProjectsSkeleton,
  CreatorProfileSkeleton,
  BountiesPageSkeleton,
  LinkCardSkeleton,
  RouteSkeleton,
  CreatorGridSkeleton,
} from '@/components/ui/skeleton-group';

describe('Suspense skeleton variants', () => {
  it('announce themselves as busy regions to assistive tech', () => {
    render(
      <>
        <BountiesStatsSkeleton />
        <CreatorHeroSkeleton />
        <CreatorProjectsSkeleton />
        <CreatorProfileSkeleton />
        <BountiesPageSkeleton />
        <LinkCardSkeleton />
      </>,
    );
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(6);
    regions.forEach((el) => expect(el).toHaveAttribute('aria-busy', 'true'));
  });

  it('BountiesStatsSkeleton keeps the 3-tile grid of the real stats section', () => {
    const { container } = render(<BountiesStatsSkeleton />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid).toHaveClass('grid', 'grid-cols-3', 'gap-4', 'mb-8');
    expect(grid.children).toHaveLength(3);
  });

  it('CreatorProjectsSkeleton mirrors the responsive project grid and count', () => {
    const { container } = render(<CreatorProjectsSkeleton count={4} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid).toHaveClass('grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3');
    expect(grid.children).toHaveLength(4);
  });

  it('RouteSkeleton wraps a route body under a header placeholder', () => {
    render(
      <RouteSkeleton label="Loading creators">
        <CreatorGridSkeleton count={2} />
      </RouteSkeleton>,
    );
    const route = screen.getByRole('status', { name: 'Loading creators' });
    expect(route).toHaveAttribute('aria-busy', 'true');
    expect(route.querySelector('main')).not.toBeNull();
  });
});
