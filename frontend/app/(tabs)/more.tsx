import { View, Text, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Scissors, CreditCard, Sparkles, LogOut, ChevronRight, Store, Users } from "lucide-react-native";
import dayjs from "dayjs";

import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

type BillingStatus = {
  status: string;
  entitled: boolean;
  trial_ends_at?: string;
  trial_days_left: number;
  cancel_at_period_end: boolean;
  current_period_end?: number;
  has_stripe_customer: boolean;
};

export default function More() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { colors } = useTheme();

  const { data: profile } = useQuery<any>({
    queryKey: ["profile"],
    queryFn: () => apiFetch("/profile"),
  });
  const { data: billing } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: () => apiFetch("/billing/status"),
  });

  const isOwner = user?.role === "owner";
  const items: { icon: any; label: string; onPress: () => void; testID: string }[] = [
    { icon: Scissors, label: "Services", onPress: () => router.push("/services"), testID: "more-services" },
    { icon: CreditCard, label: "Payments", onPress: () => router.push("/payments"), testID: "more-payments" },
    { icon: Users, label: "Staff & invites", onPress: () => router.push("/staff"), testID: "more-staff" },
    { icon: Store, label: "Business profile", onPress: () => router.push("/profile"), testID: "more-profile" },
    ...(isOwner ? [{ icon: Sparkles, label: "Subscription", onPress: () => router.push("/paywall"), testID: "more-subscription" } as const] : []),
  ];

  const openPortal = async () => {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const res = await apiFetch<{ url: string }>("/billing/portal", {
        method: "POST",
        body: JSON.stringify({ origin }),
      });
      if (typeof window !== "undefined") window.location.assign(res.url);
    } catch (e: any) {
      if (typeof window !== "undefined") window.alert(e.message || "Portal is unavailable right now.");
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + 100 }}
      >
        <Text style={styles.title}>More</Text>

        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileInitial}>{(profile?.business_name || user?.email || "?").slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bizName}>{profile?.business_name || "Your business"}</Text>
            <Text style={styles.bizSub}>{profile?.owner_name || user?.email}</Text>
            {user?.role ? (
              <View style={styles.rolePill}>
                <Text style={styles.rolePillText}>{user.role.toUpperCase()}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <BillingCard billing={billing} isOwner={isOwner} onSubscribe={() => router.push("/paywall")} onManage={openPortal} />

        <View style={styles.list}>
          {items.map(({ icon: Icon, label, onPress, testID }) => (
            <Pressable key={label} testID={testID} onPress={onPress} style={styles.item}>
              <View style={styles.itemIcon}>
                <Icon size={18} color={colors.brandPrimary} />
              </View>
              <Text style={styles.itemLabel}>{label}</Text>
              <ChevronRight size={18} color={colors.muted} />
            </Pressable>
          ))}
        </View>

        <Pressable testID="more-signout" onPress={signOut} style={styles.signoutBtn}>
          <LogOut size={18} color={colors.error} />
          <Text style={styles.signoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.version}>PetAdmin • v1.0</Text>
      </ScrollView>
    </View>
  );
}

function BillingCard({ billing, isOwner, onSubscribe, onManage }: { billing?: BillingStatus; isOwner: boolean; onSubscribe: () => void; onManage: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!billing) {
    return (
      <View style={[styles.billingCard, { alignItems: "center" }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  const status = billing.status;
  const isTrialing = status === "trialing";
  const isActive = status === "active";
  const isPaidPlan = isTrialing || isActive;

  if (!isPaidPlan) {
    const daysLeft = billing.trial_days_left;
    return (
      <Pressable
        testID="billing-card"
        onPress={isOwner ? onSubscribe : undefined}
        style={styles.billingCard}
        disabled={!isOwner}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.billingTitle}>
            {daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} of trial left` : "Trial ended"}
          </Text>
          <Text style={styles.billingSub}>
            {isOwner
              ? (daysLeft > 0 ? "Add a card to keep PetAdmin after your trial." : "Subscribe to keep using PetAdmin.")
              : "Only the business owner can manage billing."}
          </Text>
        </View>
        {isOwner ? (
          <View style={styles.billingCta}>
            <Text style={styles.billingCtaText}>{daysLeft > 0 ? "Upgrade" : "Subscribe"}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }

  const label = isTrialing ? "Pro — in free trial" : "Pro — active";
  const sub = billing.cancel_at_period_end
    ? "Cancels at the end of this period"
    : isTrialing
      ? `${billing.trial_days_left} day${billing.trial_days_left === 1 ? "" : "s"} left in your trial`
      : "£12.99 / month";

  return (
    <View style={[styles.billingCard, { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.billingTitle, { color: colors.onBrand }]}>{label}</Text>
        <Text style={[styles.billingSub, { color: "rgba(255,255,255,0.8)" }]}>{sub}</Text>
      </View>
      <Pressable testID="billing-manage" onPress={isOwner ? onManage : undefined} disabled={!isOwner} style={[styles.manageBtn, !isOwner && { opacity: 0.5 }]}>
        <Text style={styles.manageText}>{isOwner ? "Manage" : "Owner only"}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "800" },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
  },
  profileAvatar: {
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
  },
  profileInitial: { color: colors.onBrand, fontSize: 24, fontWeight: "800" },
  bizName: { color: colors.onSurface, fontSize: fontSize.xl, fontWeight: "800" },
  bizSub: { color: colors.onBrandTertiary, fontSize: fontSize.sm, marginTop: 2 },
  rolePill: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
  },
  rolePillText: { color: colors.onBrand, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  billingCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  billingTitle: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "800" },
  billingSub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  billingCta: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  billingCtaText: { color: colors.onBrand, fontWeight: "700", fontSize: fontSize.base },
  manageBtn: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  manageText: { color: colors.onBrand, fontWeight: "700", fontSize: fontSize.sm },

  list: { gap: spacing.sm },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 56,
  },
  itemIcon: {
    width: 36, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  itemLabel: { flex: 1, color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "600" },

  signoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  signoutText: { color: colors.error, fontSize: fontSize.lg, fontWeight: "700" },
  version: { color: colors.muted, fontSize: fontSize.sm, textAlign: "center", marginTop: spacing.lg },
}));
