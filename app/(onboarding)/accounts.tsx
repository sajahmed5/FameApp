import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SuggestedAccountCard } from '@/components/suggested-account-card';
import { AuthScreen } from '@/components/ui/auth-screen';
import { Button } from '@/components/ui/button';
import { FormMessage } from '@/components/ui/form-message';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/hooks/use-theme';
import type { SuggestedAccount } from '@/types';

const SUGGESTION_LIMIT = 20;
const THUMBS_PER_ACCOUNT = 3;

export default function OnboardingAccountsScreen() {
  const theme = useTheme();
  const { user, reload } = useAuth();
  const uid = user?.id;

  const [accounts, setAccounts] = useState<SuggestedAccount[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.rpc('get_suggested_accounts', {
      _limit: SUGGESTION_LIMIT,
    });
    if (error) {
      setLoadError('Could not load suggestions. Check your connection and try again.');
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as SuggestedAccount[];
    setAccounts(rows);

    // Fetch a few recent public thumbnails per suggested account.
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
    // Data loader on mount; sets loading state internally (not a derived-state effect).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
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

    // optimistic update
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
        if (error) revert();
      } else {
        const { error } = await supabase
          .from('follows')
          .insert({ follower_id: uid, followee_id: account.id, status: nextStatus });
        if (error && error.code !== '23505') revert();
      }
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  }

  async function complete() {
    if (!uid || completing) return;
    setCompleting(true);
    setCompleteError(null);
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_complete: true })
      .eq('id', uid);
    if (error) {
      setCompleteError('Could not finish setup. Try again.');
      setCompleting(false);
      return;
    }
    reload(); // → status 'ready' → root guard routes to (tabs)
  }

  return (
    <AuthScreen
      title="People to follow"
      subtitle="Based on the interests you picked. Follow a few, or skip for now."
      footer={
        <>
          {completeError ? <FormMessage tone="error">{completeError}</FormMessage> : null}
          <Button title="Done" onPress={complete} loading={completing} />
          <Button
            title="Skip for now"
            variant="secondary"
            onPress={complete}
            disabled={completing}
          />
        </>
      }>
      {actionError ? <FormMessage tone="error">{actionError}</FormMessage> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : loadError ? (
        <View style={styles.section}>
          <FormMessage tone="error">{loadError}</FormMessage>
          <Button title="Retry" variant="secondary" onPress={load} />
        </View>
      ) : accounts.length === 0 ? (
        <FormMessage tone="info">
          No suggestions yet — as more people post with your tags, they&apos;ll show up here. You
          can skip this for now.
        </FormMessage>
      ) : (
        <View style={styles.list}>
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
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  list: { gap: 12 },
  center: { paddingVertical: 24, alignItems: 'center' },
});
