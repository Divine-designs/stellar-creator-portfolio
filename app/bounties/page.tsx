import { Suspense } from 'react';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { BountiesPageSkeleton, BountiesStatsSkeleton } from '@/components/ui/skeleton-group';
import { BountiesStatsSection } from '@/components/streaming/bounties-stats-section';
import { fetchBountiesList } from '@/lib/streaming/chunk-data';
import BountiesWithProvider from './BountiesWithProvider';

/**
 * Streaming map for this route. Each block owns its data and its own Suspense
 * boundary, so the slow list never holds back the stats (or the static shell):
 *   BountiesStatsSection -> fetchBountiesStats()  (BountiesStatsSkeleton)
 *   BountiesListSection  -> fetchBountiesList()   (BountiesPageSkeleton)
 */
async function BountiesListSection() {
  const bounties = await fetchBountiesList();
  return <BountiesWithProvider bounties={bounties} />;
}

export default function BountiesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow">
        <div className="page-container pt-6">
          <Suspense fallback={<BountiesStatsSkeleton />}>
            <BountiesStatsSection />
          </Suspense>
        </div>

        <Suspense fallback={<BountiesPageSkeleton />}>
          <BountiesListSection />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
