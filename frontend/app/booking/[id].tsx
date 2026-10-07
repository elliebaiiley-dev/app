import { useState, useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Share, Platform } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Check, X, UserX, Trash2, CalendarClock } from "lucide-react-native";

import { PetAvatar } from "@/src/components/PetAvatar";
import { StatusPill } from "@/src/components/StatusPill";
import { Card, SectionHeader } from "@/src/components/Card";
import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { apiFetch } from "@/src/api/client";
import { formatDateFull, formatTime, money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data: bookings = [], refetch } = useQuery<any[]>({
    queryKey: ["bookings-all"],
    queryFn: () => apiFetch("/bookings"),
  });
  const b = bookings.find((x) => x.id === id);
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "bank" | "other">("cash");
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingPay, setSavingPay] = useState(false);

  const setStatus = async (status: string) => {
    if (!b) return;
    setSavingStatus(true);
    try {
      await apiFetch(`/bookings/${b.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      qc.invalidateQueries({ queryKey: ["bookings-all"] });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      refetch();
    } finally {
      setSavingStatus(false);
    }
  };

  const addPayment = async () => {
    if (!b) return;
    const amt = parseFloat(payAmount || "0");
    if (!amt || amt <= 0) return;
    setSavingPay(true);
    try {
      await apiFetch("/payments", {
        method: "POST",
        body: JSON.stringify({ booking_id: b.id, amount: amt, method: payMethod }),
      });
      setPayAmount("");
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } finally {
      setSavingPay(false);
    }
  };

  const remove = async () => {
    if (!b) return;
    await apiFetch(`/bookings/${b.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["bookings-all"] });
    qc.invalidateQueries({ queryKey: ["bookings"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    router.back();
  };

  const generateRebooking = async () => {
    if (!b) return;
    try {
      const res = await apiFetch<{ message: string }>(`/rebooking/message?pet_id=${b.pet_id}`);
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && (navigator as any).clipboard) {
          await (navigator as any).clipboard.writeText(res.message);
        }
        window.alert(`Rebooking message copied:\n\n${res.message}`);
      } else {
        await Share.share({ message: res.message });
      }
    } catch {}
  };

  if (!b) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Booking</Text>
        <Pressable testID="bk-delete" onPress={remove} hitSlop={10} style={styles.back}>
          <Trash2 size={20} color={colors.error} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + 100 }}>
        <View style={styles.heroCard}>
          <PetAvatar path={b.pet_photo_path} size={64} initials={b.pet_name?.slice(0, 1)} onPress={() => router.push(`/pet/${b.pet_id}`)} />
          <View style={{ flex: 1 }}>
            <Text style={styles.petName}>{b.pet_name}</Text>
            <Text style={styles.customer}>{b.customer_name}</Text>
            <StatusPill status={b.status} small />
          </View>
        </View>

        <View style={styles.detailsCard}>
          <DetailRow label="Date" value={formatDateFull(b.start_at)} />
          <DetailRow label="Time" value={`${formatTime(b.start_at)} • ${b.duration_minutes}m`} />
          <DetailRow label="Service" value={b.service_name} />
          <DetailRow label="Price" value={money(b.price)} />
          {b.notes ? <DetailRow label="Notes" value={b.notes} /> : null}
        </View>

        <View>
          <SectionHeader title="Status" />
          <View style={styles.statusGrid}>
            <StatusBtn testID="status-confirmed" label="Confirmed" active={b.status === "confirmed"} onPress={() => setStatus("confirmed")} icon={<CalendarClock size={16} />} />
            <StatusBtn testID="status-completed" label="Completed" active={b.status === "completed"} onPress={() => setStatus("completed")} icon={<Check size={16} />} />
            <StatusBtn testID="status-cancelled" label="Cancelled" active={b.status === "cancelled"} onPress={() => setStatus("cancelled")} icon={<X size={16} />} />
            <StatusBtn testID="status-no_show" label="No-show" active={b.status === "no_show"} onPress={() => setStatus("no_show")} icon={<UserX size={16} />} />
          </View>
        </View>

        <View>
          <SectionHeader title="Payment" />
          <View style={styles.payCard}>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Field
                  testID="pay-amount"
                  label="Amount (£)"
                  value={payAmount}
                  onChangeText={setPayAmount}
                  keyboardType="decimal-pad"
                  placeholder={String(b.price)}
                />
              </View>
            </View>
            <View style={styles.methodRow}>
              {(["cash", "card", "bank", "other"] as const).map((m) => (
                <Pressable
                  key={m}
                  testID={`pay-method-${m}`}
                  onPress={() => setPayMethod(m)}
                  style={[styles.methodChip, payMethod === m && styles.methodChipSelected]}
                >
                  <Text style={[styles.methodText, payMethod === m && styles.methodTextSelected]}>{m.charAt(0).toUpperCase() + m.slice(1)}</Text>
                </Pressable>
              ))}
            </View>
            <Button testID="pay-add" title="Record payment" variant="secondary" loading={savingPay} onPress={addPayment} />
          </View>
        </View>

        {b.status === "completed" ? (
          <Button testID="bk-rebook-msg" title="Generate rebooking message" variant="secondary" onPress={generateRebooking} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function StatusBtn({ label, active, onPress, icon, testID }: { label: string; active: boolean; onPress: () => void; icon: React.ReactNode; testID: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.statusBtn, active && styles.statusBtnActive]}>
      {/* icon wrapper for color */}
      <View style={{ opacity: active ? 1 : 0.6 }}>
        {icon}
      </View>
      <Text style={[styles.statusBtnText, active && styles.statusBtnTextActive]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", flex: 1 },

  heroCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
  },
  petName: { color: colors.onSurface, fontSize: fontSize.xl, fontWeight: "800" },
  customer: { color: colors.onBrandTertiary, fontSize: fontSize.base, marginBottom: spacing.sm },

  detailsCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border,
    gap: spacing.sm,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.lg },
  detailLabel: { color: colors.muted, fontSize: fontSize.base },
  detailValue: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "600", flex: 1, textAlign: "right" },

  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statusBtn: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border,
  },
  statusBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  statusBtnText: { color: colors.onSurface, fontWeight: "600" },
  statusBtnTextActive: { color: colors.onBrand },

  payCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
  methodRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  methodChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  methodChipSelected: { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary },
  methodText: { color: colors.onSurface, fontWeight: "500" },
  methodTextSelected: { color: colors.onBrandSecondary, fontWeight: "700" },
}));
