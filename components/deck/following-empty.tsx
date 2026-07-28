import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';

import { SuggestedAccountCard } from '@/components/suggested-account-card';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getFollowingSummary } from '@/lib/deck';
import { supabase } from '@/lib/supabase';
import type { SuggestedAccount } from '@/types';

const SUGGESTION_LIMIT = 20;
const THUMBS_PER_ACCOUNT = 3;

type Props = {
  /** Reload the deck — called after the user follows someone so their posts appear. */
  onReload: () => void;
};

/**
 * The Following tab's empty state. Reads `get_following_summary` to pick between three
 * genuinely different situations:
 *   A. You follow nobody          → find people (search + inline suggestions).
 *   B. You follow people, but none has posted → distinct message, still offer discovery.
 *   C. You've swiped everything    → "all caught up", nudge toward Home.
 * A and B share the same discovery UI (search + suggested accounts, reusing onboarding's
 * `get_suggested_accounts`); only the headline differs.
 */
export function FollowingEmpty({ onReload }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  const uid = user?.id;

  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [postableCount, setPostableCount] = useState<number>(0);
  const [summaryError, setSummaryError] = useState(false);

  const loadSummary = useCallback(async () => {
    setSummaryError(false);
    try {
      const s = await getFollowingSummary();
      setFollowingCount(s.following_count);
      setPostableCount(s.postable_count);
    } catch {
      setSummaryError(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSummary();
  }, [loadSummary]);

  // When a follow adds postable content, re-check and reload the deck.
  const afterFollowChange = useCallback(async () => {
    const s = await getFollowingSummary().catch(() => null);
    if (!s) return;
    setFollowingCount(s.following_count);
    setPostableCount(s.postable_count);
    if (s.postable_count > 0) onReload();
  }, [onReload]);

  if (summaryError) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={44} color={theme.textSecondary} />
        <ThemedText type="subtitle" style={styles.center}>
          Couldn&apos;t load your following feed
        </ThemedText>
        <Button title="Retry" onPress={loadSummary} />
      </View>
    );
  }

  if (followingCount === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }

  // C. Caught up — they follow people who have postable content, just nothing unseen left.
  if (followingCount > 0 && postableCount > 0) {
    return (
      <View style={styles.centered}>
        <Ionicons name="checkmark-done-outline" size={44} color={theme.textSecondary} />
        <ThemedText type="subtitle" style={styles.center}>
          You&apos;re all caught up
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          You&apos;ve seen everything the people you follow have posted. Head to Home to discover
          something new.
        </ThemedText>
        <Button title="Go to Home" onPress={() => router.navigate('/')} />
        <Button title="Check again" variant="secondary" onPress={onReload} />
      </View>
    );
  }

  // A. Follow nobody  |  B. Follow people, none has posted — both offer discovery.
  const isNobody = followingCount === 0;
  return (
    <FindPeople
      uid={uid}
      title={isNobody ? 'Find people to follow' : 'Nobody you follow has posted yet'}
      subtitle={
        isNobody
          ? 'Your Following feed fills up with posts from people you follow. Search for someone, or follow a few suggestions to get started.'
          : 'The accounts you follow haven’t shared anything yet. Follow a few more people, or check Home in the meantime.'
      }
      onSearch={() => router.push('/search')}
      onFollowChange={afterFollowChange}
    />
  );
}

/** Search CTA + inline suggested accounts (shared by the "nobody" and "no posts" states). */
function FindPeople({
  uid,
  title,
  subtitle,
  onSearch,
  onFollowChange,
}: {
  uid: string | undefined;
  title: string;
  subtitle: string;
  onSearch: () => void;
  onFollowChange: () => void;
}) {
  const theme = useTheme();
  const [accounts, setAccounts] = useState<SuggestedAccount[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('get_suggested_accounts', {
      _limit: SUGGESTION_LIMIT,
    });
    if (error) {
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as SuggestedAccount[];
    setAccounts(rows);
    if (rows.length) {
      const ids = rows.map((r) => r.id);
      const { data: posts } = await supabase
        .from('posts')
        .select('user_id, thumbnail_url, created_at')
        .in('user_id', ids)
        .eq('visibility', 'public')
        .eq('moderation_status', 'approved')
        .order('created_at', { ascending: false });
      const byUser: Record<string, string[]> = {};
      for (const p of (posts ?? []) as { user_id: string; thumbnail_url: string }[]) {
        const list = (byUser[p.user_id] ??= []);
        if (list.length < THUMBS_PER_ACCOUNT) list.push(p.thumbnail_url);
      }
      setThumbs(byUser);
    } else {
      setThumbs({});
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggleFollow(account: SuggestedAccount) {
    if (!uid) return;
    setActionError(null);
    const following = account.follow_status !== null;
    const nextStatus: SuggestedAccount['follow_status'] = following
      ? null
      : account.is_private
        ? 'pending'
        : 'accepted';

    setAccounts((prev) =>
      prev.map((a) => (a.id === account.id ? { ...a, follow_status: nextStatus } : a)),
    );
    setBusyIds((prev) => new Set(prev).add(account.id));

    const revert = () => {
      setAccounts((prev) =>
        prev.map((a) => (a.id === account.id ? { ...a, follow_status: account.follow_status } : a)),
      );
      setActionError('Could not update follow. Try again.');
    };

    try {
      if (following) {
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', uid)
          .eq('followee_id', account.id);
        if (error) {
          revert();
          return;
        }
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({ follower_id: uid, followee_id: account.id, status: nextStatus });
        if (error && error.code !== '23505') {
          revert();
          return;
        }
      }
      // Accepting a public follow can immediately surface postable content → reload.
      onFollowChange();
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.findContent}>
      <View style={styles.findHeader}>
        <Ionicons name="people-outline" size={40} color={theme.textSecondary} />
        <ThemedText type="subtitle" style={styles.center}>
          {title}
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.center}>
          {subtitle}
        </ThemedText>
        <Button title="Search for people" onPress={onSearch} style={styles.searchButton} />
      </View>

      {actionError ? <FormMessage tone="error">{actionError}</FormMessage> : null}

      {loading ? (
        <View style={styles.spinner}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : accounts.length > 0 ? (
        <View style={styles.list}>
          <ThemedText type="smallBold">Suggested for you</ThemedText>
          {accounts.map((account) => (
            <SuggestedAccountCard
              key={account.id}
              account={account}
              thumbnails={thumbs[account.id] ?? []}
              busy={busyIds.has(account.id)}
              onToggleFollow={() => toggleFollow(account)}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  center: { textAlign: 'center' },
  findContent: { padding: 20, gap: 20 },
  findHeader: { alignItems: 'center', gap: 12, paddingTop: 24 },
  spinner: { alignItems: 'center', paddingVertical: 24 },
  searchButton: { alignSelf: 'stretch', marginTop: 4 },
  list: { gap: 12 },
});
