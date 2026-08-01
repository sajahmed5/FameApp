import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { notify } from '@/lib/confirm';
import { fetchDiscover, type DeckCard } from '@/lib/deck';
import { resolveDeckMedia } from '@/lib/media';
import {
  ACCOUNTS_PAGE,
  PAGE,
  addRecentSearch,
  clearRecentSearches,
  followAccount,
  geocodePlaces,
  getRecentSearches,
  getSearchSettings,
  resetSearchCenter,
  searchAccounts,
  searchPosts,
  searchTags,
  setSearchCenter,
  setSearchLocationFromDevice,
  setSearchRadius,
  trendingTags,
  unfollowAccount,
  type AccountHit,
  type GeoPlace,
  type RecentSearch,
  type SearchMode,
  type SearchPost,
  type SearchSettings,
  type TagHit,
} from '@/lib/search';

const MODES: { key: SearchMode; label: string }[] = [
  { key: 'worldwide', label: 'Worldwide' },
  { key: 'local', label: 'Local' },
  { key: 'tags', label: 'Tags' },
  { key: 'accounts', label: 'Accounts' },
];
const RADII = [1, 5, 10, 25, 50];

export default function SearchScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<SearchMode>('worldwide');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const [posts, setPosts] = useState<SearchPost[]>([]);
  const [accounts, setAccounts] = useState<AccountHit[]>([]);
  const [related, setRelated] = useState<AccountHit[]>([]); // "related accounts" above worldwide grid
  const [tags, setTags] = useState<TagHit[]>([]);
  const [recents, setRecents] = useState<RecentSearch[]>([]);
  const [settings, setSettings] = useState<SearchSettings | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [relocating, setRelocating] = useState(false);

  const runId = useRef(0); // guards against out-of-order (cancels stale responses)
  const offset = useRef(0);

  // Debounce the query (300ms).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Load recents once; trending is fetched by the tags view itself when empty.
  useEffect(() => {
    void getRecentSearches().then(setRecents);
  }, []);
  useEffect(() => {
    if (mode === 'local' && !settings) void getSearchSettings().then(setSettings).catch(() => {});
  }, [mode, settings]);

  // #30: opening Local points the search at where you actually are — iOS asks for
  // permission the first time, then this refreshes silently on each visit. A denial
  // just leaves "No location set" with the retry button below.
  useEffect(() => {
    if (mode !== 'local') return;
    let alive = true;
    void setSearchLocationFromDevice()
      .then(async (ok) => {
        if (ok && alive) setSettings(await getSearchSettings());
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode]);

  const applyMyLocation = useCallback(async () => {
    const ok = await setSearchLocationFromDevice().catch(() => false);
    if (ok) setSettings(await getSearchSettings().catch(() => null));
    else notify('Location permission needed', 'Allow location for Phixr in iOS Settings, then try again.');
  }, []);

  const q = debounced;
  const empty = q.length === 0;

  // Run the active search whenever mode or query changes.
  const runSearch = useCallback(async () => {
    const id = ++runId.current;
    offset.current = 0;
    setError(false);
    if (mode === 'tags') {
      // Tags: trending when empty, autocomplete otherwise. Always instant-ish.
      setLoading(true);
      try {
        const rows = empty ? await trendingTags(30) : await searchTags(q, 30);
        if (id === runId.current) setTags(rows);
      } catch {
        if (id === runId.current) setError(true);
      } finally {
        if (id === runId.current) setLoading(false);
      }
      return;
    }
    if (empty) {
      // Worldwide/Local/Accounts show recents (not results) on an empty field.
      setPosts([]);
      setAccounts([]);
      setRelated([]);
      setHasMore(false);
      return;
    }
    setLoading(true);
    try {
      if (mode === 'accounts') {
        const rows = await searchAccounts(q, 0);
        if (id !== runId.current) return;
        setAccounts(rows);
        setHasMore(rows.length === ACCOUNTS_PAGE);
      } else {
        const [rows, rel] = await Promise.all([
          searchPosts(mode, q, 0),
          mode === 'worldwide' ? searchAccounts(q, 0, 4) : Promise.resolve([] as AccountHit[]),
        ]);
        if (id !== runId.current) return;
        setPosts(rows);
        setRelated(rel);
        setHasMore(rows.length === PAGE);
      }
    } catch {
      if (id === runId.current) setError(true);
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, [mode, q, empty]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-loader; runSearch sets loading/results internally
    void runSearch();
  }, [runSearch]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || empty || mode === 'tags') return;
    const id = runId.current;
    setLoadingMore(true);
    offset.current += mode === 'accounts' ? ACCOUNTS_PAGE : PAGE;
    try {
      if (mode === 'accounts') {
        const rows = await searchAccounts(q, offset.current);
        if (id !== runId.current) return;
        setAccounts((prev) => [...prev, ...rows]);
        setHasMore(rows.length === ACCOUNTS_PAGE);
      } else {
        const rows = await searchPosts(mode, q, offset.current);
        if (id !== runId.current) return;
        setPosts((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE);
      }
    } catch {
      /* keep what we have */
    } finally {
      if (id === runId.current) setLoadingMore(false);
    }
  }, [loadingMore, hasMore, empty, mode, q]);

  const remember = useCallback(() => {
    if (q.length >= 2) {
      const entry = { term: q, mode };
      void addRecentSearch(entry);
      setRecents((prev) => [entry, ...prev.filter((r) => !(r.term === q && r.mode === mode))].slice(0, 12));
    }
  }, [q, mode]);

  const openDeck = useCallback(
    (start: number) => {
      remember();
      router.push({ pathname: '/deck', params: { mode, q, start: String(start) } });
    },
    [mode, q, remember],
  );

  // ---- render helpers -------------------------------------------------------
  const showRecents = empty && mode !== 'tags' && recents.length > 0;

  return (
    <ThemedView style={{ flex: 1 }}>
      {/* Search field */}
      <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Ionicons name="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={remember}
          placeholder={placeholderFor(mode)}
          placeholderTextColor={theme.textSecondary}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={[styles.input, { color: theme.text }]}
          // No autoFocus: land on the trending grid; the keyboard only comes up when
          // the search bar is tapped. (The relocation sheet keeps its autoFocus — there
          // typing is the only thing to do.)
        />
        {query.length > 0 ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>

      {/* Mode toggles */}
      <View style={styles.toggles}>
        {MODES.map((m) => {
          const active = m.key === mode;
          return (
            <Pressable
              key={m.key}
              onPress={() => setMode(m.key)}
              style={[
                styles.toggle,
                { borderColor: theme.border },
                active && { backgroundColor: theme.tint, borderColor: theme.tint },
              ]}>
              <ThemedText type="small" style={{ color: active ? '#fff' : theme.textSecondary, fontWeight: '700' }}>
                {m.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {/* Local relocation bar */}
      {mode === 'local' ? (
        <RelocationBar
          settings={settings}
          onOpen={() => setRelocating(true)}
          onReset={async () => {
            await resetSearchCenter();
            const s = await getSearchSettings();
            setSettings(s);
            void runSearch();
          }}
          onRadius={async (miles) => {
            await setSearchRadius(miles);
            setSettings((s) => (s ? { ...s, radius_miles: miles } : s));
            void runSearch();
          }}
          onUseMine={() => void applyMyLocation().then(() => void runSearch())}
        />
      ) : null}

      {/* Body */}
      {showRecents ? (
        <RecentList
          recents={recents}
          onPick={(r) => {
            setMode(r.mode);
            setQuery(r.term);
          }}
          onClear={async () => {
            await clearRecentSearches();
            setRecents([]);
          }}
        />
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.textSecondary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <ThemedText type="default" themeColor="textSecondary">
            Something went wrong.
          </ThemedText>
          <Pressable onPress={() => void runSearch()} hitSlop={8}>
            <ThemedText type="linkPrimary">Retry</ThemedText>
          </Pressable>
        </View>
      ) : mode === 'accounts' ? (
        <AccountsList
          data={accounts}
          empty={empty}
          onEndReached={loadMore}
          loadingMore={loadingMore}
          bottomInset={insets.bottom}
          onOpen={(a) => {
            remember();
            router.push({ pathname: '/u/[handle]', params: { handle: a.handle } });
          }}
        />
      ) : mode === 'tags' ? (
        <TagsList
          data={tags}
          empty={empty}
          bottomInset={insets.bottom}
          onOpen={(name) => {
            remember();
            router.push({ pathname: '/tag/[name]', params: { name } });
          }}
        />
      ) : (
        <PostsGrid
          data={posts}
          related={mode === 'worldwide' ? related : []}
          empty={empty}
          mode={mode}
          localReady={mode !== 'local' || !!(settings && (settings.center_label || settings.has_actual_location))}
          onOpen={openDeck}
          onOpenAccount={(a) => router.push({ pathname: '/u/[handle]', params: { handle: a.handle } })}
          onEndReached={loadMore}
          loadingMore={loadingMore}
          bottomInset={insets.bottom}
        />
      )}

      {relocating ? (
        <PlaceSearchSheet
          onClose={() => setRelocating(false)}
          onPick={async (p) => {
            await setSearchCenter(p.lat, p.lon, p.label);
            const s = await getSearchSettings();
            setSettings(s);
            setRelocating(false);
            void runSearch();
          }}
        />
      ) : null}
    </ThemedView>
  );
}

function placeholderFor(mode: SearchMode) {
  switch (mode) {
    case 'accounts':
      return 'Search people';
    case 'tags':
      return 'Search tags';
    case 'local':
      return 'Search nearby';
    default:
      return 'Search Phixr';
  }
}

// ---------------------------------------------------------------------------
function RelocationBar({
  settings,
  onOpen,
  onReset,
  onRadius,
  onUseMine,
}: {
  settings: SearchSettings | null;
  onOpen: () => void;
  onReset: () => void;
  onRadius: (miles: number) => void;
  onUseMine: () => void;
}) {
  const theme = useTheme();
  const relocated = !!settings?.center_label;
  const where = relocated ? settings!.center_label! : settings?.has_actual_location ? 'Your location' : 'No location set';
  return (
    <View style={[styles.reloc, { borderColor: theme.border }]}>
      <View style={styles.relocRow}>
        <Ionicons name="location" size={15} color={theme.tint} />
        <ThemedText type="small" numberOfLines={1} style={{ flex: 1 }}>
          Searching: <ThemedText type="smallBold">{where}</ThemedText>
        </ThemedText>
        <Pressable onPress={onOpen} hitSlop={6}>
          <ThemedText type="small" style={{ color: theme.tint, fontWeight: '700' }}>
            Change
          </ThemedText>
        </Pressable>
        {relocated ? (
          <Pressable onPress={onReset} hitSlop={6}>
            <ThemedText type="small" style={{ color: theme.textSecondary }}>
              Reset
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {/* Only reachable when auto-capture failed (permission denied) — the retry path. */}
      {!relocated && !settings?.has_actual_location ? (
        <Pressable onPress={onUseMine} hitSlop={6} style={{ marginTop: 6 }}>
          <ThemedText type="small" style={{ color: theme.tint, fontWeight: '700' }}>
            Use current location
          </ThemedText>
        </Pressable>
      ) : null}
      <View style={styles.radii}>
        {RADII.map((r) => {
          const active = settings?.radius_miles === r;
          return (
            <Pressable
              key={r}
              onPress={() => onRadius(r)}
              style={[styles.chip, { borderColor: theme.border }, active && { backgroundColor: theme.tint, borderColor: theme.tint }]}>
              <ThemedText type="small" style={{ color: active ? '#fff' : theme.textSecondary }}>
                {r} mi
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RecentList({
  recents,
  onPick,
  onClear,
}: {
  recents: RecentSearch[];
  onPick: (r: RecentSearch) => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.sectionHead}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          RECENT
        </ThemedText>
        <Pressable onPress={onClear} hitSlop={6}>
          <ThemedText type="small" style={{ color: theme.tint }}>
            Clear
          </ThemedText>
        </Pressable>
      </View>
      <FlatList
        data={recents}
        keyExtractor={(r, i) => `${r.mode}:${r.term}:${i}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <Pressable onPress={() => onPick(item)} style={[styles.recentRow, { borderColor: theme.border }]}>
            <Ionicons name="time-outline" size={18} color={theme.textSecondary} />
            <ThemedText type="default" style={{ flex: 1 }}>
              {item.term}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {item.mode}
            </ThemedText>
          </Pressable>
        )}
      />
    </View>
  );
}

function AccountsList({
  data,
  empty,
  onOpen,
  onEndReached,
  loadingMore,
  bottomInset,
}: {
  data: AccountHit[];
  empty: boolean;
  onOpen: (a: AccountHit) => void;
  onEndReached: () => void;
  loadingMore: boolean;
  bottomInset: number;
}) {
  if (empty) return <EmptyState icon="people-outline" text="Search by handle or name." />;
  if (data.length === 0) return <EmptyState icon="sad-outline" text="No accounts match that." />;
  return (
    <FlatList
      data={data}
      keyExtractor={(a) => a.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
      renderItem={({ item }) => <AccountRow account={item} onOpen={onOpen} />}
      onEndReachedThreshold={0.5}
      onEndReached={onEndReached}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 16 }} /> : null}
    />
  );
}

function AccountRow({ account, onOpen }: { account: AccountHit; onOpen: (a: AccountHit) => void }) {
  const theme = useTheme();
  const [status, setStatus] = useState(account.follow_status);
  const [busy, setBusy] = useState(false);
  const label = status === 'accepted' ? 'Following' : status === 'pending' ? 'Requested' : account.is_private ? 'Request' : 'Follow';
  const filled = status === null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const prev = status;
    try {
      if (status === null) setStatus(await followAccount(account.id, account.is_private));
      else {
        await unfollowAccount(account.id);
        setStatus(null);
      }
    } catch {
      setStatus(prev);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable onPress={() => onOpen(account)} style={[styles.acctRow, { borderColor: theme.border }]}>
      {account.avatar_url ? (
        <Image source={{ uri: account.avatar_url }} style={styles.acctAvatar} contentFit="cover" />
      ) : (
        <View style={[styles.acctAvatar, styles.avatarFallback, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold">{(account.display_name || account.handle).slice(0, 1).toUpperCase()}</ThemedText>
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {account.display_name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          @{account.handle} · {account.follower_count} {account.follower_count === 1 ? 'follower' : 'followers'}
        </ThemedText>
      </View>
      <Pressable
        onPress={toggle}
        disabled={busy}
        style={[
          styles.followBtn,
          filled ? { backgroundColor: theme.tint, borderColor: theme.tint } : { borderColor: theme.border },
        ]}>
        <ThemedText type="small" style={{ color: filled ? '#fff' : theme.text, fontWeight: '700' }}>
          {label}
        </ThemedText>
      </Pressable>
    </Pressable>
  );
}

function TagsList({
  data,
  empty,
  onOpen,
  bottomInset,
}: {
  data: TagHit[];
  empty: boolean;
  onOpen: (name: string) => void;
  bottomInset: number;
}) {
  if (data.length === 0) return <EmptyState icon="pricetag-outline" text={empty ? 'No trending tags yet.' : 'No tags match that.'} />;
  return (
    <FlatList
      data={data}
      keyExtractor={(t) => t.name}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
      ListHeaderComponent={
        empty ? (
          <View style={styles.sectionHead}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              TRENDING
            </ThemedText>
          </View>
        ) : null
      }
      renderItem={({ item }) => <TagRow tag={item} onOpen={onOpen} />}
    />
  );
}

function TagRow({ tag, onOpen }: { tag: TagHit; onOpen: (name: string) => void }) {
  const theme = useTheme();
  // Tags aren't "followed" — tapping a tag opens its posts (then tap a post to swipe).
  return (
    <Pressable onPress={() => onOpen(tag.name)} style={[styles.tagRow, { borderColor: theme.border }]}>
      <View style={[styles.tagIcon, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText type="smallBold" style={{ color: theme.tint }}>
          #
        </ThemedText>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText type="smallBold" numberOfLines={1}>
          #{tag.name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {tag.usage_count} {tag.usage_count === 1 ? 'post' : 'posts'}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

function PostsGrid({
  data,
  related,
  empty,
  mode,
  localReady,
  onOpen,
  onOpenAccount,
  onEndReached,
  loadingMore,
  bottomInset,
}: {
  data: SearchPost[];
  related: AccountHit[];
  empty: boolean;
  mode: SearchMode;
  localReady: boolean;
  onOpen: (start: number) => void;
  onOpenAccount: (a: AccountHit) => void;
  onEndReached: () => void;
  loadingMore: boolean;
  bottomInset: number;
}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 4) / 3);

  if (mode === 'local' && !localReady) {
    return <EmptyState icon="location-outline" text="Set a place to search nearby — tap Change above." />;
  }
  if (empty) {
    // No query → a "discover" grid of popular posts (ranked by your tag interests +
    // recent popularity), so Worldwide/Local aren't blank before you type.
    return <DiscoverGrid bottomInset={bottomInset} />;
  }
  if (data.length === 0) {
    return <EmptyState icon="sad-outline" text="No posts match that." />;
  }

  return (
    <FlatList
      data={data}
      key="grid"
      numColumns={3}
      keyExtractor={(p) => p.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
      ListHeaderComponent={
        related.length > 0 ? (
          <View style={styles.related}>
            <View style={styles.sectionHead}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                ACCOUNTS
              </ThemedText>
            </View>
            {related.map((a) => (
              <AccountRow key={a.id} account={a} onOpen={onOpenAccount} />
            ))}
            <View style={styles.sectionHead}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                POSTS
              </ThemedText>
            </View>
          </View>
        ) : null
      }
      renderItem={({ item, index }) => (
        <Pressable onPress={() => onOpen(index)} style={{ width: cell, height: cell, padding: 1 }}>
          <Image source={{ uri: item.thumbnail_url }} style={styles.gridImg} contentFit="cover" recyclingKey={item.id} />
          {item.media_type === 'video' ? (
            <View style={styles.playBadge}>
              <Ionicons name="play" size={12} color="#fff" />
            </View>
          ) : null}
        </Pressable>
      )}
      onEndReachedThreshold={0.5}
      onEndReached={onEndReached}
      ListFooterComponent={loadingMore ? <ActivityIndicator style={{ padding: 16 }} color={theme.textSecondary} /> : null}
    />
  );
}

function PlaceSearchSheet({ onClose, onPick }: { onClose: () => void; onPick: (p: GeoPlace) => void }) {
  const theme = useTheme();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const rid = useRef(0);

  useEffect(() => {
    const t = setTimeout(async () => {
      const term = q.trim();
      if (term.length < 2) {
        setResults([]);
        return;
      }
      const id = ++rid.current;
      setLoading(true);
      try {
        const r = await geocodePlaces(term);
        if (id === rid.current) setResults(r);
      } catch {
        if (id === rid.current) setResults([]);
      } finally {
        if (id === rid.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <View style={styles.sheetOverlay}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close" />
      {/* #31: the input autofocuses, so without this the keyboard slid straight over
          the bottom-anchored sheet and you typed blind. */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ThemedView style={[styles.sheet, { borderColor: theme.border }]}>
        <View style={styles.sheetHead}>
          <ThemedText type="subtitle">Search a place</ThemedText>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={22} color={theme.text} />
          </Pressable>
        </View>
        <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: 8 }}>
          Search somewhere you&apos;re not — a city or area. Your location permission isn&apos;t needed.
        </ThemedText>
        <View style={[styles.searchBar, { backgroundColor: theme.backgroundElement, borderColor: theme.border, marginHorizontal: 0 }]}>
          <Ionicons name="location-outline" size={18} color={theme.textSecondary} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="e.g. Barcelona"
            placeholderTextColor={theme.textSecondary}
            autoFocus
            autoCorrect={false}
            style={[styles.input, { color: theme.text }]}
          />
        </View>
        {loading ? (
          <ActivityIndicator style={{ padding: 16 }} color={theme.textSecondary} />
        ) : (
          <FlatList
            data={results}
            keyExtractor={(p, i) => `${p.label}:${i}`}
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: 320 }}
            renderItem={({ item }) => (
              <Pressable onPress={() => onPick(item)} style={[styles.placeRow, { borderColor: theme.border }]}>
                <Ionicons name="pin-outline" size={16} color={theme.textSecondary} />
                <ThemedText type="default" numberOfLines={1} style={{ flex: 1 }}>
                  {item.label}
                </ThemedText>
              </Pressable>
            )}
            ListEmptyComponent={
              q.trim().length >= 2 ? (
                <ThemedText type="small" themeColor="textSecondary" style={{ padding: 12 }}>
                  No places found.
                </ThemedText>
              ) : null
            }
          />
        )}
      </ThemedView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Default Worldwide view (no query): a grid of popular posts to browse. Fed by get_deck,
 * so it's ranked by the viewer's top tags and automatically broadened (via the explore
 * pool) toward fresh/unrelated content when there's little tag-matched material.
 */
function DiscoverGrid({ bottomInset }: { bottomInset: number }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - 4) / 3);
  const [items, setItems] = useState<DeckCard[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const batch = await resolveDeckMedia(await fetchDiscover(30));
        if (active) setItems(batch);
      } catch {
        if (active) setItems([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (items === null) {
    return (
      <View style={styles.discoverLoading}>
        <ActivityIndicator color={theme.textSecondary} />
      </View>
    );
  }
  if (items.length === 0) {
    return <EmptyState icon="images-outline" text="Nothing to discover yet — be the first to post!" />;
  }

  return (
    <FlatList
      data={items}
      key="discover"
      numColumns={3}
      keyExtractor={(p) => p.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottomInset + 16 }}
      ListHeaderComponent={
        <View style={styles.sectionHead}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            POPULAR RIGHT NOW
          </ThemedText>
        </View>
      }
      renderItem={({ item }) => (
        <Pressable onPress={() => router.push(`/post/${item.id}`)} style={{ width: cell, height: cell, padding: 1 }}>
          <Image source={{ uri: item.thumbnail_url }} style={styles.gridImg} contentFit="cover" recyclingKey={item.id} />
          {item.media_type === 'video' ? (
            <View style={styles.playBadge}>
              <Ionicons name="play" size={12} color="#fff" />
            </View>
          ) : null}
        </Pressable>
      )}
    />
  );
}

function EmptyState({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const theme = useTheme();
  return (
    <View style={styles.center}>
      <Ionicons name={icon} size={40} color={theme.textSecondary} />
      <ThemedText type="default" themeColor="textSecondary" style={{ textAlign: 'center', paddingHorizontal: 32 }}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: 0 },
  toggles: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginBottom: 8 },
  toggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  acctRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  acctAvatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  followBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, minWidth: 84, alignItems: 'center' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  tagIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  discoverLoading: { padding: 48, alignItems: 'center' },
  gridImg: { flex: 1, borderRadius: 2, backgroundColor: '#222' },
  playBadge: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: 3 },
  related: {},
  reloc: { marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: 10, borderWidth: 1, gap: 8 },
  relocRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  radii: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  sheetOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, padding: 16, paddingBottom: 28 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
