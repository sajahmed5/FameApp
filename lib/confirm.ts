import { Alert, Platform } from 'react-native';

/** Cross-platform yes/no confirm. Resolves true if the user confirms. */
export function confirm(title: string, message?: string, confirmLabel = 'OK'): Promise<boolean> {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(message ?? title));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
