import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { toIsoDate } from '@/lib/validation';
import type { DateOfBirthFieldProps } from '@/components/date-of-birth-field';

/** Web DOB field — a native browser date input (works in the dev browser). */
export function DateOfBirthField({
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  maximumDate,
}: DateOfBirthFieldProps) {
  const theme = useTheme();
  const borderColor = error ? theme.danger : theme.border;

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" style={styles.label}>
        {label}
      </ThemedText>
      <input
        aria-label={label}
        type="date"
        value={value ? toIsoDate(value) : ''}
        max={maximumDate ? toIsoDate(maximumDate) : undefined}
        onChange={(e) => {
          const v = e.target.value;
          if (v) onChange(new Date(`${v}T00:00:00`));
        }}
        onBlur={onBlur}
        style={{
          border: `1px solid ${borderColor}`,
          borderRadius: 12,
          padding: 14,
          fontSize: 16,
          background: theme.background,
          color: theme.text,
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          width: '100%',
        }}
      />
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
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  label: { marginLeft: 2 },
  helper: { marginLeft: 2 },
});
