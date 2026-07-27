import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

type FormMessageProps = {
  tone: 'error' | 'success' | 'info';
  children: string;
};

/** Inline banner for network/auth results — so failures are never silent. */
export function FormMessage({ tone, children }: FormMessageProps) {
  const theme = useTheme();
  const color =
    tone === 'error' ? theme.danger : tone === 'success' ? theme.success : theme.textSecondary;

  return (
    <View
      accessibilityLiveRegion="polite"
      role="alert"
      style={[styles.container, { borderColor: color, backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" style={{ color }}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
});
