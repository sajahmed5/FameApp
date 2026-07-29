import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraTabButton } from '@/components/camera-tab-button';
import { HeaderSearchButton } from '@/components/header-search-button';
import { NotificationBellButton } from '@/components/notification-bell-button';
import { SettingsGearButton } from '@/components/settings-gear-button';
import { BRAND, TAB_BAR } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: BRAND.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        // Icons-only, like Instagram's nav — the pill stays compact and labels never clip.
        tabBarShowLabel: false,
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text },
        headerShadowVisible: false,
        // Instagram-style: a rounded pill floating above the bottom edge, so the feed
        // flows under it. Screens that scroll pad their content by TAB_BAR_CLEARANCE.
        tabBarStyle: {
          position: 'absolute',
          left: TAB_BAR.side,
          right: TAB_BAR.side,
          bottom: insets.bottom + TAB_BAR.bottom,
          height: TAB_BAR.height,
          borderRadius: TAB_BAR.height / 2,
          backgroundColor: theme.backgroundElement,
          borderTopWidth: 0,
          paddingHorizontal: 6,
          ...Platform.select({
            web: { boxShadow: '0px 6px 20px rgba(0,0,0,0.18)' },
            default: {
              shadowColor: '#000',
              shadowOpacity: 0.16,
              shadowRadius: 14,
              shadowOffset: { width: 0, height: 5 },
              elevation: 10,
            },
          }),
        },
        tabBarItemStyle: { height: TAB_BAR.height, paddingVertical: 8 },
      }}>
      {/* 1. Home — worldwide feed */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
          headerRight: () => <HeaderSearchButton />,
        }}
      />

      {/* 2. Following — following feed */}
      <Tabs.Screen
        name="following"
        options={{
          title: 'Following',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'people' : 'people-outline'} size={size} color={color} />
          ),
          headerRight: () => <HeaderSearchButton />,
        }}
      />

      {/* 3. Camera — centre position, visually emphasised */}
      <Tabs.Screen
        name="camera"
        options={{
          title: 'Camera',
          tabBarLabel: () => null,
          tabBarButton: (props) => <CameraTabButton {...props} />,
          // Immersive capture: no header, no tab bar — the camera UI has its own controls
          // (close, flash, flip) and fills the screen. Exit via the in-screen X button.
          headerShown: false,
          tabBarStyle: { display: 'none' },
        }}
      />

      {/* 4. Messages — stub ("Coming soon") */}
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'chatbubble' : 'chatbubble-outline'}
              size={size}
              color={color}
            />
          ),
        }}
      />

      {/* 5. Profile — own profile */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
          ),
          headerLeft: () => <NotificationBellButton />,
          headerRight: () => <SettingsGearButton />,
        }}
      />
    </Tabs>
  );
}
