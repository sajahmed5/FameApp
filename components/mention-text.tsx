import { router } from 'expo-router';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

// Matches the profiles handle format (^[a-z0-9_]{3,30}$), case-insensitively so
// "@Maz" still resolves; navigation lowercases before routing.
const MENTION_RE = /(@[a-zA-Z0-9_]{3,30})/g;

/**
 * Body text with tappable @mentions: each @handle becomes an accent-coloured link
 * to that profile. Used for post captions and comment bodies. Plain text renders
 * exactly as before (single ThemedText).
 */
export function MentionText({
  children: text,
  type = 'default',
  style,
  numberOfLines,
}: {
  children: string;
  type?: React.ComponentProps<typeof ThemedText>['type'];
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const theme = useTheme();
  const parts = text.split(MENTION_RE);
  if (parts.length === 1) {
    return (
      <ThemedText type={type} style={style} numberOfLines={numberOfLines}>
        {text}
      </ThemedText>
    );
  }
  return (
    <ThemedText type={type} style={style} numberOfLines={numberOfLines}>
      {/* split() on a capture group puts the captured mentions at odd indices */}
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text
            key={i}
            style={{ color: theme.tint, fontWeight: '600' }}
            accessibilityRole="link"
            onPress={() => router.push(`/u/${part.slice(1).toLowerCase()}`)}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </ThemedText>
  );
}
