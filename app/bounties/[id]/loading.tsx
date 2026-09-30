import { RouteSkeleton, BountyDetailSkeleton } from '@/components/ui/skeleton-group';

export default function BountyDetailLoading() {
  return (
    <RouteSkeleton label="Loading bounty">
      <BountyDetailSkeleton />
    </RouteSkeleton>
  );
}
