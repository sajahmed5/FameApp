import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

type ScreenPlaceholderProps = {
  title: string;
  subtitle?: string;
};

/**
 * Generic centered placeholder used by every scaffold screen. Replace per-screen with
 * real feature UI as it gets built.
 */
export function ScreenPlaceholder({ title, subtitle }: ScreenPlaceholderProps) {
  return (
    <ThemedView style={styles.container}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {subtitle ? (
        <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
          {subtitle}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  subtitle: {
    textAlign: 'center',
  },
});
