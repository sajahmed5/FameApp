import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Sentry } from '@/lib/sentry';

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

/**
 * Catches render errors in its subtree so one broken component can't white-screen the app.
 * Reports to Sentry (scrubbed) and shows a small, self-contained fallback with a Try-again
 * that clears the error and re-renders the children. Class component because React error
 * boundaries have no hook equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    Sentry.captureException(error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          {this.props.label ? `${this.props.label} couldn't load.` : "This part of the app couldn't load."}
        </Text>
        <Pressable onPress={this.reset} style={styles.btn} accessibilityRole="button">
          <Text style={styles.btnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  title: { fontSize: 17, fontWeight: '700', color: '#888' },
  body: { color: '#888', textAlign: 'center' },
  btn: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, backgroundColor: '#208AEF' },
  btnText: { color: '#fff', fontWeight: '600' },
});
