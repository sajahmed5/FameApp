import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';

type ButtonVariant = 'primary' | 'secondary' | 'outline';

export type ButtonProps = Omit<PressableProps, 'children'> & {
  title: string;
  loading?: boolean;
  variant?: ButtonVariant;
};

/** Primary/secondary button with a built-in loading spinner and disabled state. */
export function Button({
  title,
  loading = false,
  variant = 'primary',
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const isDisabled = disabled || loading;

  // primary = filled accent · secondary = filled neutral · outline = accent border, transparent
  const backgroundColor =
    variant === 'primary' ? BRAND.accent : variant === 'outline' ? 'transparent' : theme.backgroundElement;
  const textColor =
    variant === 'primary' ? BRAND.onAccent : variant === 'outline' ? BRAND.accent : theme.text;
  const border =
    variant === 'outline'
      ? { borderWidth: 1.5, borderColor: BRAND.accent }
      : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      style={(state) => [
        styles.button,
        border,
        { backgroundColor, opacity: isDisabled ? 0.5 : state.pressed ? 0.85 : 1 },
        typeof style === 'function' ? style(state) : style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <ThemedText type="default" style={[styles.label, { color: textColor }]}>
          {title}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  label: {
    fontWeight: '700',
  },
});
