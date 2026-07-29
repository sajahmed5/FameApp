import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';

import { LocationPicker } from '@/components/compose/location-picker';
import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { coarseCell, getCurrentCoords, type NearbyPlace } from '@/lib/location';

export type LocationValue = {
  attachLocation: boolean;
  locationCell: string | null;
  locationLabel: string | null;
};

/**
 * "Add location" for a post (Instagram-style). Tapping it uses the photo's GPS or the
 * device's position as the origin, then opens a searchable picker of nearby/queried places
 * (shop, restaurant, city, country). Only a coarse cell is ever stored — never exact coords.
 */
export function LocationField({
  attachLocation,
  label,
  mediaGps,
  onChange,
}: {
  attachLocation: boolean;
  label: string | null;
  mediaGps: { latitude: number; longitude: number } | null;
  onChange: (v: LocationValue) => void;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState<{ lat: number; lon: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openPicker = async () => {
    setBusy(true);
    try {
      const coords = mediaGps
        ? { lat: mediaGps.latitude, lon: mediaGps.longitude }
        : await getCurrentCoords();
      if (!coords) {
        Alert.alert(
          'Location unavailable',
          "We couldn't get your location. Allow location access and try again.",
        );
        return;
      }
      setOrigin(coords);
      setPickerOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const select = (p: NearbyPlace) => {
    onChange({ attachLocation: true, locationCell: coarseCell(p.lat, p.lon), locationLabel: p.name });
    setPickerOpen(false);
  };

  const remove = () => onChange({ attachLocation: false, locationCell: null, locationLabel: null });

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      {attachLocation && label ? (
        <View style={styles.row}>
          <Ionicons name="location" size={20} color={BRAND.accent} />
          <View style={styles.rowText}>
            <ThemedText type="default" numberOfLines={1}>
              {label}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Shares only an approximate area, never your exact position.
            </ThemedText>
          </View>
          <Pressable onPress={openPicker} hitSlop={8} accessibilityRole="button">
            <ThemedText type="small" style={{ color: BRAND.accent, fontWeight: '600' }}>
              Change
            </ThemedText>
          </Pressable>
          <Pressable onPress={remove} hitSlop={8} accessibilityRole="button" accessibilityLabel="Remove location">
            <Ionicons name="close-circle" size={20} color={theme.textSecondary} />
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={styles.row}
          onPress={openPicker}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Add location">
          <Ionicons name="location-outline" size={20} color={theme.text} />
          <View style={styles.rowText}>
            <ThemedText type="default">Add location</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Shares only an approximate area, never your exact position.
            </ThemedText>
          </View>
          {busy ? (
            <ActivityIndicator color={theme.textSecondary} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          )}
        </Pressable>
      )}

      <LocationPicker
        visible={pickerOpen}
        origin={origin}
        onClose={() => setPickerOpen(false)}
        onSelect={select}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowText: { flex: 1, gap: 2 },
});
