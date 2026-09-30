import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import {
  CreatorProfileSkeleton,
  CreatorHeroSkeleton,
  CreatorBioSkeleton,
  CreatorProjectsSkeleton,
  CreatorCtaSkeleton,
} from '@/components/ui/skeleton-group';
import { CreatorHeroSection, CreatorCtaSection } from '@/components/streaming/creator-hero-section';
import { CreatorBioSection } from '@/components/streaming/creator-bio-section';
import { CreatorProjectsSection } from '@/components/streaming/creator-projects-section';
import { fetchCreatorCore } from '@/lib/streaming/chunk-data';
import { getCreatorById } from '@/lib/services/creators-data';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const creator = getCreatorById(id);

  if (!creator) {
    return { title: 'Creator Not Found' };
  }

  return {
    title: `${creator.name} — ${creator.title}`,
    description: creator.bio || `View ${creator.name}'s portfolio, projects, and skills on Tamgora.`,
    openGraph: {
      title: `${creator.name} — ${creator.title} | Tamgora`,
      description: creator.bio,
      images: creator.avatar
        ? [{ url: creator.avatar, width: 400, height: 400, alt: creator.name }]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${creator.name} — ${creator.title} | Tamgora`,
      description: creator.bio,
    },
  };
}

/**
 * Streaming map for this route. The shell only awaits the cheap core lookup
 * (needed to return a real 404); everything heavier streams behind its own
 * boundary, each with a skeleton that matches the section it replaces:
 *   CreatorHeroSection     -> fetchCreatorCore + fetchCreatorSocial   (CreatorHeroSkeleton)
 *   CreatorBioSection      -> fetchCreatorBio                         (CreatorBioSkeleton)
 *   CreatorProjectsSection -> fetchCreatorProjects                    (CreatorProjectsSkeleton)
 *   CreatorCtaSection      -> fetchCreatorSocial                      (CreatorCtaSkeleton)
 */
async function CreatorProfileShell({ id }: { id: string }) {
  const creator = await fetchCreatorCore(id);
  if (!creator) notFound();

  return (
    <>
      <Suspense fallback={<CreatorHeroSkeleton />}>
        <CreatorHeroSection id={id} />
      </Suspense>

      <div className="page-container pb-24">
        <Suspense fallback={<CreatorBioSkeleton />}>
          <CreatorBioSection id={id} />
        </Suspense>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-6">Projects</h2>
          <Suspense fallback={<CreatorProjectsSkeleton />}>
            <CreatorProjectsSection id={id} />
          </Suspense>
        </section>

        <Suspense fallback={<CreatorCtaSkeleton />}>
          <CreatorCtaSection id={id} />
        </Suspense>
      </div>
    </>
  );
}

export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-grow">
        <Suspense fallback={<CreatorProfileSkeleton />}>
          <CreatorProfileShell id={id} />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
