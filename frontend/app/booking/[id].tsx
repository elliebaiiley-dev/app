import { useState, useCallback, useMemo } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Share, Platform } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Check, X, UserX, Trash2, CalendarClock } from "lucide-react-native";

import { PetAvatar } from "@/src/components/PetAvatar";
import { StatusPill } from "@/src/components/StatusPill";
import { SectionHeader } from "@/src/components/Card";
import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { apiFetch } from "@/src/api/client";
import { formatDateFull, formatTime, formatDateTime, money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data: b, refetch, isLoading } = useQuery<any>({
    queryKey: ["booking", id],
    queryFn: () => apiFetch(`/bookings/${id}`),
    enabled: !!id,
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const [payAmount, setPayAmount] = useState<string>("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "bank" | "other">("cash");
  const [savingPay, setSavingPay] = useState(false);
  const [payErr, setPayErr] = useState("");

  const outstanding = b?.outstanding ?? 0;
  const total = b?.price ?? 0;
  const paid = b?.paid_total ?? 0;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["booking", id] });
    qc.invalidateQueries({ queryKey: ["bookings"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["payments"] });
    if (b?.customer_id) qc.invalidateQueries({ queryKey: ["customer", b.customer_id] });
    if (b?.pet_id) qc.invalidateQueries({ queryKey: ["pet", b.pet_id] });
  };

  const setStatus = async (status: string) => {
    if (!b || b.status === status) return;
    try {
      await apiFetch(`/bookings/${b.id}/status`, { method: "POST", body: JSON.stringify({ status }) });
      invalidateAll();
      refetch();
    } catch {}
  };

  const addPayment = async () => {
    if (!b) return;
    const amt = parseFloat(payAmount || "0");
    if (!amt || amt <= 0) { setPayErr("Enter a valid amount"); return; }
    setPayErr("");
    setSavingPay(true);
    try {
      await apiFetch("/payments", {
        method: "POST",
        body: JSON.stringify({ booking_id: b.id, amount: amt, method: payMethod }),
      });
      setPayAmount("");
      invalidateAll();
      refetch();
    } catch (e: any) {
      setPayErr(e.message || "Could not record payment");
    } finally {
      setSavingPay(false);
    }
  };

  const remove = async () => {
    if (!b) return;
    await apiFetch(`/bookings/${b.id}`, { method: "DELETE" });
    invalidateAll();
    router.back();
  };

  const generateRebooking = async () => {
    if (!b) return;
    try {
      const res = await apiFetch<{ message: string }>(`/rebooking/message?pet_id=${b.pet_id}`);
      if (Platform.OS === "web") {
        try {
          if (typeof navigator !== "undefined" && (navigator as any).clipboard) {
            await (navigator as any).clipboard.writeText(res.message);
          }
        } catch {
          // Clipboard write can fail in insecure contexts — ignore and still show the alert.
        }
        if (typeof window !== "undefined") window.alert(`Rebooking message copied:\n\n${res.message}`);
      } else {
        await Share.share({ message: res.message });
      }
    } catch (e) {
      console.error("rebooking message failed", e);
    }
  };

  if (isLoading || !b) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  const isPaid = outstanding <= 0.01 && total > 0;

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
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <StatusPill status={b.status} small />
              {isPaid ? (
                <View style={styles.paidPill}>
                  <Check size={11} color={colors.onSuccess} />
                  <Text style={styles.paidPillText}>Paid</Text>
                </View>
              ) : null}
            </View>
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
          <Text style={styles.statusHint}>You control the status — PetAdmin never changes it automatically.</Text>
          <View style={styles.statusGrid}>
            <StatusBtn testID="status-confirmed" label="Confirmed" active={b.status === "confirmed"} onPress={() => setStatus("confirmed")} icon={<CalendarClock size={16} color={b.status === "confirmed" ? colors.onBrand : colors.onSurface} />} />
            <StatusBtn testID="status-completed" label="Completed" active={b.status === "completed"} onPress={() => setStatus("completed")} icon={<Check size={16} color={b.status === "completed" ? colors.onBrand : colors.onSurface} />} />
            <StatusBtn testID="status-cancelled" label="Cancelled" active={b.status === "cancelled"} onPress={() => setStatus("cancelled")} icon={<X size={16} color={b.status === "cancelled" ? colors.onBrand : colors.onSurface} />} />
            <StatusBtn testID="status-no_show" label="No-show" active={b.status === "no_show"} onPress={() => setStatus("no_show")} icon={<UserX size={16} color={b.status === "no_show" ? colors.onBrand : colors.onSurface} />} />
          </View>
        </View>

        <View>
          <SectionHeader title="Payment" />
          <View style={styles.payCard}>
            <View style={styles.balanceRow}>
              <Balance label="Total" value={money(total)} />
              <Balance label="Paid" value={money(paid)} tone="success" />
              <Balance label="Outstanding" value={money(outstanding)} tone={outstanding > 0.01 ? "warning" : "muted"} />
            </View>

            {outstanding > 0.01 ? (
              <>
                <Field
                  testID="pay-amount"
                  label="Record payment (£)"
                  value={payAmount}
                  onChangeText={(v) => { setPayAmount(v); if (payErr) setPayErr(""); }}
                  keyboardType="decimal-pad"
                  placeholder={outstanding.toFixed(2)}
                />
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
                {payErr ? <Text style={styles.err}>{payErr}</Text> : null}
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      testID="pay-full"
                      title="Pay in full"
                      variant="secondary"
                      fullWidth
                      onPress={() => setPayAmount(outstanding.toFixed(2))}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button testID="pay-add" title="Record payment" fullWidth loading={savingPay} onPress={addPayment} />
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.fullyPaid}>Fully paid — nothing outstanding.</Text>
            )}

            {b.payments && b.payments.length > 0 ? (
              <View style={styles.payHistory}>
                <Text style={styles.payHistoryTitle}>Payment history</Text>
                {b.payments.map((p: any) => (
                  <View key={p.id} testID={`pay-item-${p.id}`} style={styles.payItem}>
                    <View style={styles.payItemDot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payItemAmount}>{money(p.amount)}</Text>
                      <Text style={styles.payItemMeta}>{formatDateTime(p.paid_at)} • {p.method}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        <Button testID="bk-rebook-msg" title="Generate rebooking message" variant="secondary" onPress={generateRebooking} />
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

function Balance({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "muted" }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const color = tone === "success" ? colors.success : tone === "warning" ? colors.warning : tone === "muted" ? colors.muted : colors.onSurface;
  return (
    <View style={styles.balance}>
      <Text style={styles.balanceLabel}>{label}</Text>
      <Text style={[styles.balanceValue, { color }]}>{value}</Text>
    </View>
  );
}

function StatusBtn({ label, active, onPress, icon, testID }: { label: string; active: boolean; onPress: () => void; icon: React.ReactNode; testID: string }) {
  const styles = useStyles();
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.statusBtn, active && styles.statusBtnActive]}>
      {icon}
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

  paidPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.success, paddingHorizontal: spacing.sm, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  paidPillText: { color: colors.onSuccess, fontSize: 11, fontWeight: "700" },

  detailsCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.lg },
  detailLabel: { color: colors.muted, fontSize: fontSize.base },
  detailValue: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "600", flex: 1, textAlign: "right" },

  statusHint: { color: colors.muted, fontSize: fontSize.sm, marginBottom: spacing.sm, fontStyle: "italic" },
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
  balanceRow: { flexDirection: "row", gap: spacing.sm },
  balance: {
    flex: 1, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary, alignItems: "flex-start", gap: 2,
  },
  balanceLabel: { color: colors.muted, fontSize: fontSize.sm, fontWeight: "600" },
  balanceValue: { fontSize: fontSize.lg, fontWeight: "800" },

  methodRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  methodChip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  methodChipSelected: { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary },
  methodText: { color: colors.onSurface, fontWeight: "500" },
  methodTextSelected: { color: colors.onBrandSecondary, fontWeight: "700" },

  fullyPaid: {
    color: colors.success, fontSize: fontSize.base, fontWeight: "600",
    textAlign: "center", paddingVertical: spacing.md,
  },

  payHistory: { gap: spacing.sm, marginTop: spacing.sm },
  payHistoryTitle: { color: colors.muted, fontSize: fontSize.sm, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  payItem: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.sm, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
  },
  payItemDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.success },
  payItemAmount: { color: colors.onSurface, fontWeight: "700", fontSize: fontSize.base },
  payItemMeta: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },

  err: { color: colors.error, fontSize: fontSize.sm },
}));
