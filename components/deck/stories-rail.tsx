import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

// ⚠️ PLACEHOLDER — layout only.
// This reserves the horizontal band at the top of the Following tab so the deck below it
// sits where it will once stories exist. It deliberately builds NONE of the real feature:
// no capture, no viewing, no expiry, no viewer lists, no replies. To remove stories
// entirely, delete this file and the `<StoriesRail />` header passed in following.tsx —
// nothing else depends on it.

const PLACEHOLDER_COUNT = 8;

export function StoriesRail() {
  const theme = useTheme();
  return (
    <View style={[styles.container, { borderBottomColor: theme.border }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}>
        {Array.from({ length: PLACEHOLDER_COUNT }).map((_, i) => (
          <View key={i} style={styles.item}>
            <View style={[styles.ring, { borderColor: theme.border }]}>
              <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]} />
            </View>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              &nbsp;
            </ThemedText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const RING = 64;
const styles = StyleSheet.create({
  container: { borderBottomWidth: StyleSheet.hairlineWidth },
  content: { gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  item: { alignItems: 'center', width: RING, gap: 4 },
  ring: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: RING - 10, height: RING - 10, borderRadius: (RING - 10) / 2 },
});
