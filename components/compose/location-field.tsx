import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';
import { coarseCell, getCurrentCoords, nearbyPlaces, type NearbyPlace } from '@/lib/location';

export type LocationValue = {
  attachLocation: boolean;
  locationCell: string | null;
  locationLabel: string | null;
};

/**
 * "Add location" for a post. Turning it on uses the photo's own GPS (if present) or the
 * device's current position to look up nearby public venues to tag — Instagram-style — and
 * stores only a coarse cell (never exact coordinates).
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
  const [options, setOptions] = useState<NearbyPlace[]>([]);
  const [showPicker, setShowPicker] = useState(false);

  const enable = async () => {
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
        onChange({ attachLocation: false, locationCell: null, locationLabel: null });
        return;
      }
      const places = await nearbyPlaces(coords.lat, coords.lon);
      setOptions(places);
      const top = places[0];
      onChange(
        top
          ? { attachLocation: true, locationCell: coarseCell(top.lat, top.lon), locationLabel: top.name }
          : { attachLocation: true, locationCell: coarseCell(coords.lat, coords.lon), locationLabel: 'Current area' },
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (v: boolean) => {
    if (v) {
      void enable();
    } else {
      setShowPicker(false);
      onChange({ attachLocation: false, locationCell: null, locationLabel: null });
    }
  };

  const pick = (p: NearbyPlace) => {
    onChange({ attachLocation: true, locationCell: coarseCell(p.lat, p.lon), locationLabel: p.name });
    setShowPicker(false);
  };

  return (
    <View style={[styles.card, { borderColor: theme.border }]}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <ThemedText type="default">Add location</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Shares only an approximate area, never your exact position.
          </ThemedText>
        </View>
        {busy ? (
          <ActivityIndicator color={theme.textSecondary} />
        ) : (
          <Switch value={attachLocation} onValueChange={toggle} trackColor={{ true: BRAND.accent }} />
        )}
      </View>

      {attachLocation && label ? (
        <Pressable
          style={[styles.selected, { borderTopColor: theme.border }]}
          onPress={() => options.length > 0 && setShowPicker((s) => !s)}
          accessibilityRole="button">
          <Ionicons name="location" size={16} color={BRAND.accent} />
          <ThemedText type="small" style={styles.selectedLabel} numberOfLines={1}>
            {label}
          </ThemedText>
          {options.length > 1 ? (
            <ThemedText type="small" style={{ color: BRAND.accent }}>
              {showPicker ? 'Close' : 'Change'}
            </ThemedText>
          ) : null}
        </Pressable>
      ) : null}

      {showPicker
        ? options.map((p) => (
            <Pressable
              key={`${p.name}-${p.lat}-${p.lon}`}
              onPress={() => pick(p)}
              style={[styles.option, { borderTopColor: theme.border }]}
              accessibilityRole="button">
              <Ionicons name="location-outline" size={16} color={theme.textSecondary} />
              <View style={styles.optionText}>
                <ThemedText type="small" numberOfLines={1}>
                  {p.name}
                </ThemedText>
                {p.address ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {p.address}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowText: { flex: 1, gap: 2 },
  selected: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  selectedLabel: { flex: 1, fontWeight: '600' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth },
  optionText: { flex: 1 },
});
