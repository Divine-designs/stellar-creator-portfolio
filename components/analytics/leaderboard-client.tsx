'use client';

import React, { useMemo, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Star, Award, Trophy, Sparkles, TrendingUp, Compass } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getAvatarInitials } from '@/lib/utils';

export interface CreatorLeaderboardItem {
  id: string;
  userId: string;
  displayName: string;
  avatar: string | null;
  discipline: string | null;
  skills: string[];
  rating: number;
  completedProjects: number;
  /**
   * Server-computed earnings bucket label (e.g. "<1k", "1k–5k", "5k–10k", "10k+").
   * Exact earnings are never sent to the client; the server buckets them.
   */
  earningsBucket: string;
  /**
   * Server-computed sort rank for earnings. Used only for ordering the
   * "Top Earners" tab so the client never needs the exact amount.
   */
  earningsRank: number;
  createdAt: string;
}

interface LeaderboardClientProps {
  creators: CreatorLeaderboardItem[];
  currentUserId: string | null;
}

/** Human-readable label for a server-provided earnings bucket. */
const EARNINGS_BUCKET_LABELS: Record<string, string> = {
  '<1k': 'Under $1,000 earned',
  '1k–5k': '$1,000 - $5,000 earned',
  '5k–10k': '$5,000 - $10,000 earned',
  '10k+': '$10,000+ earned',
};

function formatEarningsBucket(bucket: string | null | undefined): string {
  if (!bucket) return 'Earnings unavailable';
  return EARNINGS_BUCKET_LABELS[bucket] ?? 'Earnings unavailable';
}

export function LeaderboardClient({ creators, currentUserId }: LeaderboardClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Persist sort and discipline selection in the URL so navigating away and
  // back restores the last-used state (closes #1215).
  const VALID_TABS = ['discipline', 'earnings', 'rising_stars'] as const;
  const rawTab = searchParams.get('sort') ?? 'discipline';
  const activeTab = (VALID_TABS as readonly string[]).includes(rawTab)
    ? (rawTab as 'discipline' | 'earnings' | 'rising_stars')
    : 'discipline';
  const selectedDiscipline = searchParams.get('discipline') ?? 'all';

  /** Push a new URL with updated query params, preserving any others. */
  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === 'all' || value === 'discipline') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Get unique disciplines
  const disciplines = useMemo(() => {
    const list = new Set(creators.map(c => c.discipline).filter(Boolean) as string[]);
    return ['all', ...Array.from(list)];
  }, [creators]);

  // Compute lists and ranks
  const processedLists = useMemo(() => {
    // 1. Discipline List (sorted by rating desc, then projects completed desc)
    let disciplineList = [...creators];
    if (selectedDiscipline !== 'all') {
      disciplineList = disciplineList.filter(c => c.discipline?.toLowerCase() === selectedDiscipline.toLowerCase());
    }
    disciplineList.sort((a, b) => b.rating - a.rating || b.completedProjects - a.completedProjects);

    // 2. Earnings List (sorted by server-provided earnings rank)
    const earningsList = [...creators].sort((a, b) => a.earningsRank - b.earningsRank);

    // 3. Rising Stars List (created within last 90 days, sorted by rating desc)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const risingStarsList = creators
      .filter(c => new Date(c.createdAt) >= ninetyDaysAgo)
      .sort((a, b) => b.rating - a.rating || b.completedProjects - a.completedProjects);

    return {
      discipline: disciplineList,
      earnings: earningsList,
      rising_stars: risingStarsList,
    };
  }, [creators, selectedDiscipline]);

  const currentList = processedLists[activeTab];
  const top20 = currentList.slice(0, 20);

  // Find current user's rank
  const ownRankInfo = useMemo(() => {
    if (!currentUserId) return null;
    const index = currentList.findIndex(c => c.userId === currentUserId);
    if (index === -1) return null;
    return {
      rank: index + 1,
      creator: currentList[index],
      inTop20: index < 20,
    };
  }, [currentList, currentUserId]);

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-amber-400" />;
    if (rank === 2) return <Award className="h-5 w-5 text-slate-300" />;
    if (rank === 3) return <Award className="h-5 w-5 text-amber-700" />;
    return <span className="text-muted-foreground font-mono text-sm">{rank}</span>;
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4 py-8">
      <div className="text-center space-y-2 mb-8">
        <Badge variant="outline" className="px-3 py-1 border-indigo-500/30 text-indigo-400 gap-1 bg-indigo-500/5">
          <Sparkles className="h-3.5 w-3.5" /> Recognition System
        </Badge>
        <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent sm:text-5xl">
          Creator Leaderboards
        </h1>
        <p className="text-muted-foreground max-w-lg mx-auto text-sm">
          Discover top-performing talent, rising stars, and proven industry experts on the network.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <Tabs value={activeTab} onValueChange={(val) => updateParams({ sort: val, discipline: null })} className="w-full sm:w-auto">
          <TabsList className="bg-muted/50 border border-border/50">
            <TabsTrigger value="discipline" className="gap-1.5">
              <Compass className="h-4 w-4" /> Top by Discipline
            </TabsTrigger>
            <TabsTrigger value="earnings" className="gap-1.5">
              <TrendingUp className="h-4 w-4" /> Top Earners
            </TabsTrigger>
            <TabsTrigger value="rising_stars" className="gap-1.5">
              <Sparkles className="h-4 w-4" /> Rising Stars
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === 'discipline' && (
          <div className="flex items-center gap-1.5 overflow-x-auto py-1">
            {disciplines.map((d) => (
              <button
                key={d}
                onClick={() => updateParams({ discipline: d })}
                className={`px-3 py-1 text-xs font-semibold rounded-full border transition-all whitespace-nowrap capitalize ${
                  selectedDiscipline === d
                    ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {d === 'all' ? 'All Disciplines' : d}
              </button>
            ))}
          </div>
        )}
      </div>

      <Card className="bg-card/30 backdrop-blur-xl border border-border/50 shadow-xl overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-16 text-center">Rank</TableHead>
                <TableHead>Creator</TableHead>
                <TableHead>Discipline</TableHead>
                <TableHead className="text-center">Projects Completed</TableHead>
                <TableHead className="text-center">Rating</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top20.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    No creators to display yet.
                  </TableCell>
                </TableRow>
              ) : (
                top20.map((creator, idx) => {
                  const rank = idx + 1;
                  const isCurrentUser = currentUserId === creator.userId;
                  return (
                    <TableRow
                      key={creator.id}
                      className={isCurrentUser ? 'bg-indigo-500/5' : undefined}
                    >
                      <TableCell className="text-center">{getRankBadge(rank)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {creator.avatar ? (
                              <AvatarImage src={creator.avatar} alt={creator.displayName} />
                            ) : null}
                            <AvatarFallback>{getAvatarInitials(creator.displayName)}</AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{creator.displayName}</span>
                            {creator.skills.length > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {creator.skills.slice(0, 3).join(' · ')}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="capitalize text-sm text-muted-foreground">
                        {creator.discipline ?? '—'}
                      </TableCell>
                      <TableCell className="text-center text-sm">{creator.completedProjects}</TableCell>
                      <TableCell className="text-center text-sm">
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                          {creator.rating.toFixed(1)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatEarningsBucket(creator.earningsBucket)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {ownRankInfo && !ownRankInfo.inTop20 && (
        <Card className="bg-indigo-500/5 border border-indigo-500/30">
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-muted-foreground">#{ownRankInfo.rank}</span>
              <Avatar className="h-8 w-8">
                {ownRankInfo.creator.avatar ? (
                  <AvatarImage src={ownRankInfo.creator.avatar} alt={ownRankInfo.creator.displayName} />
                ) : null}
                <AvatarFallback>{getAvatarInitials(ownRankInfo.creator.displayName)}</AvatarFallback>
              </Avatar>
              <span className="font-medium text-sm">You</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {formatEarningsBucket(ownRankInfo.creator.earningsBucket)}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
