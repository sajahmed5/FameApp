import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { estimatePasswordStrength } from '@/lib/validation';

/** Advisory strength feedback — four segments + a label. Never blocks submission. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const theme = useTheme();
  if (!password) return null;

  const { score, label } = estimatePasswordStrength(password);
  const color =
    score <= 1 ? theme.danger : score === 2 ? '#C99A2E' : score === 3 ? theme.tint : theme.success;

  return (
    <View style={styles.container}>
      <View style={styles.bars}>
        {[1, 2, 3, 4].map((seg) => (
          <View
            key={seg}
            style={[
              styles.bar,
              { backgroundColor: seg <= score ? color : theme.backgroundSelected },
            ]}
          />
        ))}
      </View>
      <ThemedText type="small" style={{ color }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  bars: {
    flexDirection: 'row',
    gap: 6,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
});
