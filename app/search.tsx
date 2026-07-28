import { useLocalSearchParams } from 'expo-router';

import { ScreenPlaceholder } from '@/components/screen-placeholder';

/**
 * Search route. Presented modally from the root Stack; reached via the header search icon
 * on Home / Following / Profile, and from tapping a tag on a deck card.
 *
 * The full search UI (query box + Tags/People toggles + results) is a later milestone.
 * This screen already accepts and surfaces the deck's tag hand-off — `?tag=<name>&mode=tags`
 * — so that wiring is real now: when the search UI lands it reads the same params to
 * pre-fill the query and activate the Tags filter.
 */
export default function SearchScreen() {
  const { tag, mode } = useLocalSearchParams<{ tag?: string; mode?: string }>();

  if (tag) {
    return (
      <ScreenPlaceholder
        title={`#${tag}`}
        subtitle={`Pre-filled from a card tag${mode === 'tags' ? ' · Tags filter active' : ''}. Search UI is wired up in a later task — the tag and filter are passed through and ready to consume.`}
      />
    );
  }
  return <ScreenPlaceholder title="Search" subtitle="Placeholder — search wired up later." />;
}
