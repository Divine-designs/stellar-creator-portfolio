import { RouteSkeleton, CreatorGridSkeleton } from '@/components/ui/skeleton-group';

export default function FreelancersLoading() {
  return (
    <RouteSkeleton label="Loading freelancers">
      <CreatorGridSkeleton />
    </RouteSkeleton>
  );
}
