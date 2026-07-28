import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';

export type ActionOption = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

/** Bottom-anchored action sheet overlay. Render at the top of a screen/sheet. */
export function ActionMenu({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title?: string;
  options: ActionOption[];
  onClose: () => void;
}) {
  const theme = useTheme();
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss menu" />
      <ThemedView style={[styles.menu, { borderColor: theme.border }]}>
        {title ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.title}>
            {title}
          </ThemedText>
        ) : null}
        {options.map((o, i) => (
          <Pressable
            key={o.label}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              o.onPress();
            }}
            style={({ pressed }) => [
              styles.option,
              i > 0 && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth },
              pressed && { backgroundColor: theme.backgroundElement },
            ]}>
            <ThemedText type="default" style={{ color: o.destructive ? theme.danger : theme.text }}>
              {o.label}
            </ThemedText>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [
            styles.cancel,
            { backgroundColor: theme.backgroundElement },
            pressed && { opacity: 0.8 },
          ]}>
          <ThemedText type="default" style={{ fontWeight: '700' }}>
            Cancel
          </ThemedText>
        </Pressable>
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 50,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  menu: {
    padding: 8,
    gap: 4,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { textAlign: 'center', paddingVertical: 8 },
  option: { paddingVertical: 16, alignItems: 'center' },
  cancel: { marginTop: 6, paddingVertical: 16, alignItems: 'center', borderRadius: 12 },
});
