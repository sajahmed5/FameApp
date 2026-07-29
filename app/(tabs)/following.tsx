import { ErrorBoundary } from '@/components/error-boundary';
import { FollowingFeed } from '@/components/deck/following-feed';
import { ThemedView } from '@/components/themed-view';

/**
 * Following — a persistent, Instagram/TikTok-style feed of recent posts from accounts you
 * follow. Unlike the Home swipe deck, posts aren't consumed by swiping, so the feed doesn't
 * empty out; you scroll, like, comment and share. The stories rail sits on top.
 */
export default function FollowingScreen() {
  return (
    <ThemedView style={{ flex: 1 }}>
      <ErrorBoundary label="The feed">
        <FollowingFeed />
      </ErrorBoundary>
    </ThemedView>
  );
}
