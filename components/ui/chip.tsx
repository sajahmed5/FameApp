import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress: () => void;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
};

/** Tappable pill used for tag selection. */
export function Chip({
  label,
  selected = false,
  onPress,
  leadingIcon,
  trailingIcon,
  disabled,
}: ChipProps) {
  const theme = useTheme();
  const fg = selected ? BRAND.onAccent : theme.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? BRAND.accent : theme.backgroundElement,
          borderColor: selected ? BRAND.accent : theme.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}>
      {leadingIcon ? <Ionicons name={leadingIcon} size={16} color={fg} /> : null}
      <ThemedText type="small" style={{ color: fg, fontWeight: '600' }}>
        {label}
      </ThemedText>
      {trailingIcon ? <Ionicons name={trailingIcon} size={16} color={fg} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
});
