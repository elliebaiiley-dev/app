import { useMemo, useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { PetAvatar } from "@/src/components/PetAvatar";
import { StatusPill } from "@/src/components/StatusPill";
import { EmptyState } from "@/src/components/Card";
import { formatTime, money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

type View = "day" | "week";

export default function CalendarScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState(() => dayjs());
  const [mode, setMode] = useState<View>("day");

  const range = useMemo(() => {
    if (mode === "day") {
      return {
        from: anchor.startOf("day").toISOString(),
        to: anchor.endOf("day").toISOString(),
      };
    }
    const start = anchor.startOf("week");
    return { from: start.toISOString(), to: start.add(6, "day").endOf("day").toISOString() };
  }, [anchor, mode]);

  const { data: bookings = [], isLoading, refetch } = useQuery({
    queryKey: ["bookings", range.from, range.to],
    queryFn: () => apiFetch<any[]>(`/bookings?date_from=${encodeURIComponent(range.from)}&date_to=${encodeURIComponent(range.to)}`),
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const weekDays = useMemo(() => {
    const start = anchor.startOf("week");
    return Array.from({ length: 7 }).map((_, i) => start.add(i, "day"));
  }, [anchor]);

  const bookingsByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const b of bookings) {
      const k = dayjs(b.start_at).format("YYYY-MM-DD");
      (map[k] = map[k] || []).push(b);
    }
    return map;
  }, [bookings]);

  const title = mode === "day" ? anchor.format("ddd, D MMM YYYY") : `${weekDays[0].format("D MMM")} – ${weekDays[6].format("D MMM")}`;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Calendar</Text>
          <View style={styles.modeTabs}>
            <Pressable
              testID="cal-mode-day"
              onPress={() => setMode("day")}
              style={[styles.modeTab, mode === "day" && styles.modeTabActive]}
            >
              <Text style={[styles.modeText, mode === "day" && styles.modeTextActive]}>Day</Text>
            </Pressable>
            <Pressable
              testID="cal-mode-week"
              onPress={() => setMode("week")}
              style={[styles.modeTab, mode === "week" && styles.modeTabActive]}
            >
              <Text style={[styles.modeText, mode === "week" && styles.modeTextActive]}>Week</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.nav}>
          <Pressable
            testID="cal-prev"
            onPress={() => setAnchor((a) => a.subtract(1, mode === "day" ? "day" : "week"))}
            style={styles.navBtn} hitSlop={8}
          >
            <ChevronLeft size={20} color={colors.onSurface} />
          </Pressable>
          <Pressable testID="cal-today" onPress={() => setAnchor(dayjs())} style={styles.navCenter}>
            <Text style={styles.navTitle}>{title}</Text>
            <Text style={styles.navSub}>Tap for today</Text>
          </Pressable>
          <Pressable
            testID="cal-next"
            onPress={() => setAnchor((a) => a.add(1, mode === "day" ? "day" : "week"))}
            style={styles.navBtn} hitSlop={8}
          >
            <ChevronRight size={20} color={colors.onSurface} />
          </Pressable>
        </View>

        {mode === "week" ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm }}
          >
            {weekDays.map((d) => {
              const key = d.format("YYYY-MM-DD");
              const count = bookingsByDay[key]?.length || 0;
              const selected = d.isSame(anchor, "day");
              return (
                <Pressable
                  key={key}
                  testID={`cal-day-${key}`}
                  onPress={() => { setMode("day"); setAnchor(d); }}
                  style={[styles.dayChip, selected && styles.dayChipActive]}
                >
                  <Text style={[styles.dayLabel, selected && styles.dayLabelActive]}>{d.format("ddd")}</Text>
                  <Text style={[styles.dayNum, selected && styles.dayNumActive]}>{d.format("D")}</Text>
                  {count > 0 ? <View style={[styles.dot, selected && styles.dotActive]} /> : <View style={{ height: 6 }} />}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : bookings.length === 0 ? (
        <View style={{ flex: 1, padding: spacing.xl, justifyContent: "center" }}>
          <EmptyState title="No appointments" subtitle={mode === "day" ? "This day is free." : "This week is clear."} />
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + 100 }}
          renderItem={({ item: b }) => (
            <Pressable
              testID={`cal-booking-${b.id}`}
              onPress={() => router.push(`/booking/${b.id}`)}
              style={styles.booking}
            >
              <View style={styles.timeCol}>
                <Text style={styles.time}>{formatTime(b.start_at)}</Text>
                <Text style={styles.duration}>{b.duration_minutes}m</Text>
              </View>
              <View style={[styles.leftBar, { backgroundColor: statusBarColor(b.status, colors) }]} />
              <PetAvatar path={b.pet_photo_path} size={44} initials={b.pet_name?.slice(0, 1)} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{b.pet_name}</Text>
                <Text style={styles.rowSub}>{b.customer_name} • {b.service_name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 4 }}>
                  <StatusPill status={b.status} small />
                  <Text style={styles.price}>{money(b.price)}</Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="cal-add"
        onPress={() => router.push("/booking/new")}
        style={[styles.fab, { bottom: insets.bottom + 76 }]}
      >
        <Plus size={22} color={colors.onBrand} />
      </Pressable>
    </View>
  );
}

function statusBarColor(status: string, colors: any) {
  switch (status) {
    case "completed": return colors.success;
    case "cancelled": return colors.muted;
    case "no_show": return colors.error;
    default: return colors.brandPrimary;
  }
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  title: { fontSize: 26, fontWeight: "800", color: colors.onSurface },
  modeTabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    padding: 3,
  },
  modeTab: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill },
  modeTabActive: { backgroundColor: colors.surfaceSecondary },
  modeText: { color: colors.muted, fontWeight: "600", fontSize: fontSize.sm },
  modeTextActive: { color: colors.onSurface },

  nav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  navBtn: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  navCenter: { flex: 1, alignItems: "center" },
  navTitle: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },
  navSub: { color: colors.muted, fontSize: 11, marginTop: 2 },

  dayChip: {
    width: 56, paddingVertical: spacing.sm, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", borderWidth: 1, borderColor: colors.border,
    flexShrink: 0, gap: 2,
  },
  dayChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  dayLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  dayLabelActive: { color: "rgba(255,255,255,0.85)" },
  dayNum: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },
  dayNumActive: { color: colors.onBrand },
  dot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.brandPrimary, marginTop: 2 },
  dotActive: { backgroundColor: "#FFF" },

  booking: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 72,
  },
  leftBar: { width: 4, height: 40, borderRadius: 2 },
  timeCol: { width: 56, alignItems: "center" },
  time: { color: colors.onSurface, fontWeight: "800", fontSize: fontSize.base },
  duration: { color: colors.muted, fontSize: 11 },
  rowTitle: { color: colors.onSurface, fontWeight: "700", fontSize: fontSize.lg },
  rowSub: { color: colors.muted, fontSize: fontSize.sm },
  price: { color: colors.onSurface, fontWeight: "700", fontSize: fontSize.base },

  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
}));
