import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/context/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/(auth)/welcome");
    } else if (!user.onboarded) {
      router.replace("/onboarding");
    } else {
      router.replace("/(tabs)");
    }
  }, [user, loading]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
      <ActivityIndicator color={colors.brandPrimary} size="large" />
    </View>
  );
}
