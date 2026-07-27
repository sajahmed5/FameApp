import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  /** Shown in red beneath the field when present. */
  error?: string | null;
  /** Neutral helper text (hidden while an error is showing). */
  hint?: string | null;
  /** Element rendered inside the field on the right (e.g. availability status). */
  accessoryRight?: React.ReactNode;
};

/**
 * Labelled text input with error / hint slots. Validation is driven by the parent
 * (typically on blur) — this component only renders state.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, accessoryRight, style, ...inputProps },
  ref,
) {
  const theme = useTheme();
  const borderColor = error ? theme.danger : theme.border;

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" style={styles.label}>
        {label}
      </ThemedText>
      <View style={[styles.inputRow, { borderColor, backgroundColor: theme.background }]}>
        <TextInput
          ref={ref}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text }, style]}
          {...inputProps}
        />
        {accessoryRight ? <View style={styles.accessory}>{accessoryRight}</View> : null}
      </View>
      {error ? (
        <ThemedText type="small" style={[styles.helper, { color: theme.danger }]}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.helper}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    marginLeft: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
  },
  accessory: {
    marginLeft: 8,
  },
  helper: {
    marginLeft: 2,
  },
});
