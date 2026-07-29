import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LEGAL_DOCS, type LegalDocId } from '@/constants/legal';

/** Renders a legal document (terms / privacy / guidelines) from constants/legal.ts. */
export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const entry = LEGAL_DOCS[doc as LegalDocId] ?? LEGAL_DOCS.terms;

  return (
    <ThemedView style={styles.fill}>
      <Stack.Screen options={{ headerShown: true, title: entry.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">{entry.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Version {entry.updated}
        </ThemedText>
        <ThemedText type="default" style={styles.body}>
          {entry.body}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 20, gap: 10 },
  body: { lineHeight: 22, marginTop: 8 },
});
