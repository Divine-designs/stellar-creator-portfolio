import { RouteSkeleton, CreatorGridSkeleton } from '@/components/ui/skeleton-group';

export default function CreatorsLoading() {
  return (
    <RouteSkeleton label="Loading creators">
      <CreatorGridSkeleton />
    </RouteSkeleton>
  );
}
