import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { toIsoDate } from '@/lib/validation';

export type DateOfBirthFieldProps = {
  label: string;
  value: Date | null;
  onChange: (date: Date) => void;
  onBlur?: () => void;
  error?: string | null;
  hint?: string | null;
  maximumDate?: Date;
};

/** Native DOB picker (iOS spinner / Android dialog). Web uses `.web.tsx`. */
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
  const [show, setShow] = useState(false);
  const borderColor = error ? theme.danger : theme.border;

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== 'ios') setShow(false); // Android dialog closes itself
    if (event.type === 'set' && date) onChange(date);
    onBlur?.();
  };

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold" style={styles.label}>
        {label}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setShow(true)}
        style={[styles.field, { borderColor, backgroundColor: theme.background }]}>
        <ThemedText type="default" style={{ color: value ? theme.text : theme.textSecondary }}>
          {value ? toIsoDate(value) : 'YYYY-MM-DD'}
        </ThemedText>
      </Pressable>
      {show ? (
        <DateTimePicker
          value={value ?? maximumDate ?? new Date(2000, 0, 1)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={maximumDate}
          onChange={handleChange}
        />
      ) : null}
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
  field: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  helper: { marginLeft: 2 },
});
