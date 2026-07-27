import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

type AuthScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Show a back chevron top-left. */
  onBack?: () => void;
  /** Sticky footer content (e.g. primary button + links). */
  footer?: ReactNode;
};

/** Consistent scaffold for auth screens: safe area, keyboard avoidance, title block. */
export function AuthScreen({ title, subtitle, children, onBack, footer }: AuthScreenProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  return (
    <ThemedView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 12, paddingBottom: 24 },
          ]}
          keyboardShouldPersistTaps="handled">
          {onBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={onBack}
              hitSlop={10}
              style={styles.back}>
              <Ionicons name="chevron-back" size={26} color={theme.text} />
            </Pressable>
          ) : null}

          <View style={styles.header}>
            <ThemedText type="subtitle">{title}</ThemedText>
            {subtitle ? (
              <ThemedText type="default" themeColor="textSecondary">
                {subtitle}
              </ThemedText>
            ) : null}
          </View>

          <View style={styles.body}>{children}</View>
        </ScrollView>

        {footer ? (
          <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: 24,
    gap: 24,
    flexGrow: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  back: { alignSelf: 'flex-start', marginBottom: -8, marginLeft: -6 },
  header: { gap: 6 },
  body: { gap: 18 },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    gap: 12,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
});
