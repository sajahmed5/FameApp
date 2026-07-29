import { Image, type ImageStyle } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { initialsFor } from '@/lib/format';

/**
 * Consistent avatar: shows the image when set, otherwise a coloured circle with the user's
 * initials — so a missing `avatar_url` never renders a blank/broken circle. expo-image
 * gives caching + a fade-in for free.
 */
export function Avatar({
  uri,
  name,
  handle,
  size = 40,
  style,
}: {
  uri?: string | null;
  name?: string | null;
  handle?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const radius = size / 2;
  const label = `${name || handle || 'user'}'s profile picture`;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[{ width: size, height: size, borderRadius: radius }, style as StyleProp<ImageStyle>]}
        contentFit="cover"
        transition={150}
        accessibilityRole="image"
        accessibilityLabel={label}
      />
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius, backgroundColor: theme.backgroundSelected },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel={label}>
      <Text style={{ color: theme.textSecondary, fontSize: size * 0.4, fontWeight: '600' }}>
        {initialsFor(name, handle)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
