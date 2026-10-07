import { View, Text } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function BillingCancelled() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.content}>
        <View style={styles.icon}>
          <X size={40} color={colors.onSurface} />
        </View>
        <Text style={styles.title}>Checkout cancelled</Text>
        <Text style={styles.sub}>No worries — you can start your free trial any time from the subscription screen.</Text>
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          testID="cancelled-back"
          title="Back to subscription"
          fullWidth
          variant="secondary"
          onPress={() => router.replace("/paywall")}
        />
        <Button
          testID="cancelled-skip"
          title="Keep using the trial"
          fullWidth
          variant="ghost"
          onPress={() => router.replace("/(tabs)")}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface, justifyContent: "space-between" },
  content: {
    flex: 1,
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  icon: {
    width: 88, height: 88, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  sub: { fontSize: fontSize.lg, color: colors.muted, textAlign: "center", lineHeight: 24 },
  footer: {
    padding: spacing.xl, gap: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
}));
