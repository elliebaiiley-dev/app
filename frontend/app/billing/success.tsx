import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, PawPrint } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { apiFetch } from "@/src/api/client";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

type VerifyResult = {
  status: string;
  entitled: boolean;
  trial_ends_at?: string;
  trial_days_left: number;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  has_stripe_customer: boolean;
};

export default function BillingSuccess() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { session_id } = useLocalSearchParams<{ session_id?: string }>();

  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!session_id) {
        setErr("Missing session id");
        setLoading(false);
        return;
      }
      try {
        const r = await apiFetch<VerifyResult>(`/billing/verify?session_id=${encodeURIComponent(session_id)}`);
        setResult(r);
      } catch (e: any) {
        setErr(e.message || "Could not verify subscription");
      } finally {
        setLoading(false);
      }
    })();
  }, [session_id]);

  const subscribed = result?.entitled || result?.status === "trialing" || result?.status === "active";

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.content}>
        {loading ? (
          <>
            <ActivityIndicator size="large" color={colors.brandPrimary} />
            <Text style={styles.title}>Confirming your subscription…</Text>
            <Text style={styles.sub}>Hang tight, this takes a moment.</Text>
          </>
        ) : subscribed ? (
          <>
            <View style={styles.icon}>
              <Check size={40} color={colors.onBrand} />
            </View>
            <Text style={styles.title}>You're all set 🎉</Text>
            <Text style={styles.sub}>
              {result?.status === "trialing"
                ? `Your 14-day free trial has started. You won't be charged until it ends.`
                : `Your PetAdmin Pro subscription is active.`}
            </Text>
          </>
        ) : (
          <>
            <View style={[styles.icon, { backgroundColor: colors.warning }]}>
              <PawPrint size={40} color={colors.onBrand} />
            </View>
            <Text style={styles.title}>Almost there</Text>
            <Text style={styles.sub}>
              {err || "Your checkout didn't complete. You can try again from the subscription screen."}
            </Text>
          </>
        )}
      </View>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          testID="success-continue"
          title={subscribed ? "Continue to dashboard" : "Try again"}
          fullWidth
          onPress={() => router.replace(subscribed ? "/(tabs)" : "/paywall")}
          disabled={loading}
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
    backgroundColor: colors.success,
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface, textAlign: "center" },
  sub: { fontSize: fontSize.lg, color: colors.muted, textAlign: "center", lineHeight: 24 },
  footer: {
    padding: spacing.xl,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
}));
