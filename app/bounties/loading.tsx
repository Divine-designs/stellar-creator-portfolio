import { RouteSkeleton, BountiesStatsSkeleton, BountiesPageSkeleton } from '@/components/ui/skeleton-group';

export default function BountiesLoading() {
  return (
    <RouteSkeleton label="Loading bounties">
      <div className="page-container pt-6">
        <BountiesStatsSkeleton />
      </div>
      <BountiesPageSkeleton />
    </RouteSkeleton>
  );
}
