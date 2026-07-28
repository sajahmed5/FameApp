import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { CameraTabButton } from '@/components/camera-tab-button';
import { HeaderSearchButton } from '@/components/header-search-button';
import { NotificationBellButton } from '@/components/notification-bell-button';
import { SettingsGearButton } from '@/components/settings-gear-button';
import { BRAND } from '@/constants/config';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: BRAND.accent,
        tabBarInactiveTintColor: theme.textSecondary,
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: theme.background },
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
