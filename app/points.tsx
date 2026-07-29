import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';

/**
 * Points explainer — plain language, reachable from Profile and Analytics.
 *
 * Deliberately contains NO formulas and NO specific numbers (point values and the
 * distribution weighting are all still being tuned — see spec §8 "[OPEN] Tuning").
 * Hard-coding "a swipe is worth 1 point" here would go stale the moment those change.
 */
const EARNERS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'albums-outline', text: 'Swiping through the deck — liking or skipping both count.' },
  { icon: 'chatbubble-outline', text: 'Commenting on posts and replying to other people.' },
  { icon: 'happy-outline', text: 'Reacting to comments.' },
  { icon: 'arrow-redo-outline', text: 'Sharing posts you think others should see.' },
  { icon: 'heart-outline', text: 'Getting comments on the posts you make.' },
];

export default function PointsExplainerScreen() {
  const theme = useTheme();
  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: 'How points work' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">Points are how your posts travel further.</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          Fame rewards taking part. The more you join in, the wider your own posts reach. Here&apos;s
          the whole idea, in plain English.
        </ThemedText>

        <Section title="What earns points">
          <View style={styles.earners}>
            {EARNERS.map((e) => (
              <View key={e.text} style={styles.earner}>
                <View style={[styles.iconWrap, { backgroundColor: theme.backgroundSelected }]}>
                  <Ionicons name={e.icon} size={18} color={BRAND.accent} />
                </View>
                <ThemedText type="default" style={styles.earnerText}>
                  {e.text}
                </ThemedText>
              </View>
            ))}
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
            Real participation is what counts — rattling through cards as fast as possible
            won&apos;t earn you more.
          </ThemedText>
        </Section>

        <Section title="Points never expire">
          <ThemedText type="default" themeColor="textSecondary">
            Everything you earn is yours to keep. Your balance only ever goes up as you take part —
            it never decays and it never resets.
          </ThemedText>
        </Section>

        <Section title="How your balance helps you">
          <ThemedText type="default" themeColor="textSecondary">
            A higher balance nudges your posts in front of more people. It&apos;s one of several
            signals — how well your post matches someone&apos;s interests and how fresh it is matter
            too — so points give you a lift rather than a guarantee. Keep taking part and your reach
            grows over time.
          </ThemedText>
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="subtitle">{title}</ThemedText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 20, gap: 24 },
  section: { gap: 10 },
  earners: { gap: 14 },
  earner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  earnerText: { flex: 1 },
  note: { marginTop: 4 },
});
