import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, PawPrint, X } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { apiFetch } from "@/src/api/client";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

const FEATURES = [
  "Unlimited customers",
  "Unlimited pets",
  "Booking calendar (day & week views)",
  "Rich pet profiles",
  "Customer records & history",
  "Payment tracking",
  "Appointment reminders",
  "Rebooking suggestions",
];

export default function Paywall() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const startSubscription = async () => {
    setErr("");
    setLoading(true);
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const res = await apiFetch<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ origin }),
      });
      if (typeof window !== "undefined") {
        window.location.assign(res.url);
      }
    } catch (e: any) {
      setErr(e.message || "Could not start checkout");
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.md }]}>
      <Pressable testID="paywall-close" onPress={() => router.replace("/(tabs)")} style={styles.close} hitSlop={10}>
        <X size={22} color={colors.onSurface} />
      </Pressable>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}>
        <View style={styles.iconWrap}>
          <PawPrint size={34} color={colors.onBrand} />
        </View>
        <Text style={styles.title}>Everything you need to manage your pet business in one place.</Text>
        <Text style={styles.sub}>Start with a 14-day free trial. Cancel anytime.</Text>

        <View style={styles.card}>
          <View style={styles.priceRow}>
            <Text style={styles.price}>£12.99</Text>
            <Text style={styles.pricePer}>/month</Text>
          </View>
          <View style={styles.trialBadge}>
            <Text style={styles.trialText}>14-day free trial • Cancel anytime</Text>
          </View>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <View style={styles.checkCircle}>
                  <Check size={14} color={colors.onBrand} />
                </View>
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.secure}>
          Payments securely handled by Stripe. We never store your card details.
        </Text>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          testID="paywall-start-trial"
          title="Start 14-day free trial"
          fullWidth
          loading={loading}
          onPress={startSubscription}
        />
        <Pressable
          testID="paywall-skip"
          onPress={() => router.replace("/(tabs)")}
          style={styles.skip}
          hitSlop={8}
          disabled={loading}
        >
          <Text style={styles.skipText}>Maybe later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  close: {
    position: "absolute",
    top: 20,
    right: spacing.lg,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  scroll: { padding: spacing.xl, gap: spacing.lg, alignItems: "stretch" },
  iconWrap: {
    width: 64, height: 64, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: spacing.lg,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, lineHeight: 34 },
  sub: { fontSize: fontSize.lg, color: colors.muted },
  card: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.lg,
    borderWidth: 1, borderColor: colors.brandSecondary,
  },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  price: { fontSize: 48, fontWeight: "800", color: colors.onBrandTertiary },
  pricePer: { fontSize: fontSize.lg, color: colors.onBrandTertiary, fontWeight: "600" },
  trialBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  trialText: { color: colors.onBrand, fontSize: fontSize.sm, fontWeight: "700" },
  features: { gap: spacing.md },
  featureRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  checkCircle: {
    width: 24, height: 24, borderRadius: radius.pill, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  featureText: { color: colors.onSurface, fontSize: fontSize.lg, flex: 1 },
  secure: { color: colors.muted, fontSize: fontSize.sm, textAlign: "center", lineHeight: 18 },
  err: { color: colors.error, fontSize: fontSize.base, textAlign: "center" },
  footer: {
    padding: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  skip: { alignItems: "center", paddingVertical: spacing.sm },
  skipText: { color: colors.muted, fontSize: fontSize.base, fontWeight: "500" },
}));
