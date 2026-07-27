import { StyleSheet, Text, View } from 'react-native';

/** The LIKE / SKIP / SHARE stamp that fades in with drag distance. */
export function SwipeStamp({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.stamp, { borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stamp: {
    borderWidth: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  text: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 2,
  },
});
