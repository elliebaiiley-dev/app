import { useCallback } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Clock, AlertCircle, TrendingUp, Bell, ChevronRight } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { PetAvatar } from "@/src/components/PetAvatar";
import { StatusPill } from "@/src/components/StatusPill";
import { Card, EmptyState, SectionHeader } from "@/src/components/Card";
import { formatTime, money, formatDateFull } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

type DashboardData = {
  today_appointments: any[];
  today_revenue: number;
  upcoming_appointments: any[];
  outstanding_total: number;
  outstanding_count: number;
  pets_due: any[];
};

export default function Dashboard() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, refetch, isRefetching } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: () => apiFetch<DashboardData>("/dashboard"),
  });

  useFocusEffect(
    useCallback(() => {
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }, [qc]),
  );

  const greeting = greet();
  const today = formatDateFull(new Date().toISOString());

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>{greeting}</Text>
            <Text style={styles.date}>{today}</Text>
          </View>
        </View>

        {isLoading ? (
          <View style={{ paddingVertical: spacing["3xl"], alignItems: "center" }}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
          </View>
        ) : (
          <>
            {/* Summary cards */}
            <View style={styles.summary}>
              <Pressable
                testID="dash-revenue-card"
                style={[styles.summaryCard, { backgroundColor: colors.brandPrimary }]}
                onPress={() => router.push("/(tabs)/calendar")}
              >
                <View style={styles.summaryIcon}>
                  <TrendingUp size={18} color={colors.onBrand} />
                </View>
                <Text style={[styles.summaryLabel, { color: "rgba(255,255,255,0.75)" }]}>Today's revenue</Text>
                <Text style={[styles.summaryValue, { color: colors.onBrand }]}>{money(data?.today_revenue || 0)}</Text>
                <Text style={[styles.summarySub, { color: "rgba(255,255,255,0.75)" }]}>
                  {data?.today_appointments.length || 0} appointment{(data?.today_appointments.length || 0) === 1 ? "" : "s"}
                </Text>
              </Pressable>
              <Pressable
                testID="dash-outstanding-card"
                style={[styles.summaryCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => router.push("/payments")}
              >
                <View style={[styles.summaryIcon, { backgroundColor: colors.brandTertiary }]}>
                  <AlertCircle size={18} color={colors.warning} />
                </View>
                <Text style={styles.summaryLabel}>Outstanding</Text>
                <Text style={styles.summaryValue}>{money(data?.outstanding_total || 0)}</Text>
                <Text style={styles.summarySub}>
                  {data?.outstanding_count || 0} unpaid
                </Text>
              </Pressable>
            </View>

            {/* Today */}
            <View style={styles.section}>
              <SectionHeader title="Today's appointments" />
              {(!data?.today_appointments || data.today_appointments.length === 0) ? (
                <Card>
                  <EmptyState title="No appointments today" subtitle="Enjoy a quiet day — or tap + to add one." />
                </Card>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {data.today_appointments.map((b) => (
                    <AppointmentRow key={b.id} b={b} onPress={() => router.push(`/booking/${b.id}`)} />
                  ))}
                </View>
              )}
            </View>

            {/* Pets due */}
            {data?.pets_due && data.pets_due.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="Pets due for rebooking" />
                <View style={{ gap: spacing.sm }}>
                  {data.pets_due.slice(0, 5).map((p) => (
                    <Pressable
                      key={p.id}
                      testID={`pet-due-${p.id}`}
                      onPress={() => router.push(`/pet/${p.id}`)}
                      style={styles.row}
                    >
                      <PetAvatar path={p.photo_path} size={44} initials={p.name?.slice(0, 1)} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{p.name}</Text>
                        <Text style={styles.rowSub}>{p.customer_name} • {p.breed || p.species}</Text>
                      </View>
                      <View style={styles.dueBadge}>
                        <Bell size={12} color={colors.warning} />
                        <Text style={styles.dueText}>Due</Text>
                      </View>
                      <ChevronRight size={18} color={colors.muted} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Upcoming */}
            <View style={styles.section}>
              <SectionHeader
                title="Upcoming this week"
                action={{ label: "See all", onPress: () => router.push("/(tabs)/calendar") }}
              />
              {(!data?.upcoming_appointments || data.upcoming_appointments.length === 0) ? (
                <Card>
                  <EmptyState title="Nothing scheduled yet" subtitle="Your week is clear." />
                </Card>
              ) : (
                <View style={{ gap: spacing.sm }}>
                  {data.upcoming_appointments.slice(0, 5).map((b) => (
                    <AppointmentRow key={b.id} b={b} onPress={() => router.push(`/booking/${b.id}`)} showDate />
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <Pressable
        testID="dash-add-booking"
        onPress={() => router.push("/booking/new")}
        style={[styles.fab, { bottom: insets.bottom + 76 }]}
        accessibilityRole="button"
      >
        <Plus size={22} color={colors.onBrand} />
        <Text style={styles.fabText}>Add Booking</Text>
      </Pressable>
    </View>
  );
}

function AppointmentRow({ b, onPress, showDate }: { b: any; onPress: () => void; showDate?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={`appt-row-${b.id}`} onPress={onPress} style={styles.row}>
      <PetAvatar path={b.pet_photo_path} size={44} initials={b.pet_name?.slice(0, 1)} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{b.pet_name} <Text style={styles.rowSubInline}>· {b.customer_name}</Text></Text>
        <Text style={styles.rowSub}>
          {showDate ? `${formatDateFull(b.start_at)} • ` : ""}{formatTime(b.start_at)} • {b.service_name} • {money(b.price)}
        </Text>
      </View>
      <StatusPill status={b.status} small />
    </Pressable>
  );
}

function greet() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: spacing.sm,
  },
  hello: { color: colors.onSurface, fontSize: 28, fontWeight: "800" },
  date: { color: colors.muted, fontSize: fontSize.base, marginTop: 2 },

  summary: { flexDirection: "row", gap: spacing.md },
  summaryCard: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.xs,
    minHeight: 128,
  },
  summaryIcon: {
    width: 32, height: 32, borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
    marginBottom: spacing.sm,
  },
  summaryLabel: { color: colors.muted, fontSize: fontSize.sm, fontWeight: "600" },
  summaryValue: { color: colors.onSurface, fontSize: fontSize["2xl"], fontWeight: "800" },
  summarySub: { color: colors.muted, fontSize: fontSize.sm },

  section: { gap: spacing.sm },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 64,
  },
  rowTitle: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },
  rowSubInline: { color: colors.muted, fontWeight: "500", fontSize: fontSize.base },
  rowSub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },

  dueBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceTertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  dueText: { color: colors.warning, fontSize: fontSize.sm, fontWeight: "700" },

  fab: {
    position: "absolute",
    right: spacing.lg,
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 6,
  },
  fabText: { color: colors.onBrand, fontWeight: "700", fontSize: fontSize.base },
}));
