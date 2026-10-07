import { View, Text, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Settings, Scissors, CreditCard, Sparkles, LogOut, ChevronRight, Store, HelpCircle } from "lucide-react-native";
import dayjs from "dayjs";

import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { Card } from "@/src/components/Card";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

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

  const daysLeft = user?.trial_ends_at ? Math.max(0, dayjs(user.trial_ends_at).diff(dayjs(), "day")) : 0;

  const items: { icon: any; label: string; onPress: () => void; testID: string }[] = [
    { icon: Scissors, label: "Services", onPress: () => router.push("/services"), testID: "more-services" },
    { icon: CreditCard, label: "Payments", onPress: () => router.push("/payments"), testID: "more-payments" },
    { icon: Store, label: "Business profile", onPress: () => router.push("/profile"), testID: "more-profile" },
    { icon: Sparkles, label: "Subscription", onPress: () => router.push("/paywall"), testID: "more-subscription" },
  ];

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
            {daysLeft > 0 ? (
              <View style={styles.trialPill}>
                <Text style={styles.trialPillText}>{daysLeft} day{daysLeft === 1 ? "" : "s"} left in trial</Text>
              </View>
            ) : null}
          </View>
        </View>

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
  trialPill: {
    alignSelf: "flex-start",
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  trialPillText: { color: colors.onBrand, fontSize: 11, fontWeight: "700" },

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
