import { useState, useEffect, useMemo } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react-native";
import dayjs from "dayjs";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { apiFetch } from "@/src/api/client";
import { money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

const TIME_SLOTS = [
  "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
  "16:00", "16:30", "17:00", "17:30", "18:00", "18:30",
];

export default function NewBooking() {
  const { pet_id, customer_id } = useLocalSearchParams<{ pet_id?: string; customer_id?: string }>();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["customers"],
    queryFn: () => apiFetch("/customers"),
  });
  const { data: services = [] } = useQuery<any[]>({
    queryKey: ["services"],
    queryFn: () => apiFetch("/services"),
  });

  const [custId, setCustId] = useState<string>(customer_id || "");
  const [petId, setPetId] = useState<string>(pet_id || "");
  const [serviceId, setServiceId] = useState<string>("");
  const [date, setDate] = useState<string>(dayjs().format("YYYY-MM-DD"));
  const [time, setTime] = useState<string>("09:00");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!custId && customers.length) setCustId(customers[0].id);
  }, [customers, custId]);
  useEffect(() => {
    if (!serviceId && services.length) setServiceId(services[0].id);
  }, [services, serviceId]);

  const availablePets = useMemo(() => {
    const c = customers.find((c) => c.id === custId);
    return c?.pets || [];
  }, [customers, custId]);

  useEffect(() => {
    if (availablePets.length && !availablePets.find((p: any) => p.id === petId)) {
      setPetId(availablePets[0].id);
    }
  }, [availablePets, petId]);

  const service = services.find((s) => s.id === serviceId);

  const save = async () => {
    if (!custId || !petId || !serviceId) { setErr("Pick customer, pet and service"); return; }
    setErr("");
    setSaving(true);
    try {
      const start = `${date}T${time}:00`;
      await apiFetch("/bookings", {
        method: "POST",
        body: JSON.stringify({
          customer_id: custId,
          pet_id: petId,
          service_id: serviceId,
          start_at: start,
          notes,
          status: "confirmed",
        }),
      });
      qc.invalidateQueries({ queryKey: ["bookings"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      router.back();
    } catch (e: any) {
      setErr(e.message || "Could not save booking");
    } finally {
      setSaving(false);
    }
  };

  const nextDays = useMemo(() => Array.from({ length: 14 }).map((_, i) => dayjs().add(i, "day")), []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New booking</Text>
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <View>
          <Text style={styles.label}>Customer</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {customers.map((c) => (
              <Pressable key={c.id} testID={`bk-cust-${c.id}`} onPress={() => setCustId(c.id)} style={[styles.chip, custId === c.id && styles.chipSelected]}>
                <Text style={[styles.chipText, custId === c.id && styles.chipTextSelected]}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View>
          <Text style={styles.label}>Pet</Text>
          {availablePets.length === 0 ? (
            <Text style={{ color: colors.muted }}>No pets for this customer yet.</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
              {availablePets.map((p: any) => (
                <Pressable key={p.id} testID={`bk-pet-${p.id}`} onPress={() => setPetId(p.id)} style={[styles.chip, petId === p.id && styles.chipSelected]}>
                  <Text style={[styles.chipText, petId === p.id && styles.chipTextSelected]}>{p.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        <View>
          <Text style={styles.label}>Service</Text>
          <View style={styles.svcList}>
            {services.map((s) => (
              <Pressable
                key={s.id}
                testID={`bk-svc-${s.id}`}
                onPress={() => setServiceId(s.id)}
                style={[styles.svcRow, serviceId === s.id && styles.svcRowSelected]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.svcName}>{s.name}</Text>
                  <Text style={styles.svcMeta}>{s.duration_minutes} min</Text>
                </View>
                <Text style={styles.svcPrice}>{money(s.price)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View>
          <Text style={styles.label}>Date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {nextDays.map((d) => {
              const key = d.format("YYYY-MM-DD");
              const sel = date === key;
              return (
                <Pressable
                  key={key}
                  testID={`bk-date-${key}`}
                  onPress={() => setDate(key)}
                  style={[styles.dateChip, sel && styles.dateChipSelected]}
                >
                  <Text style={[styles.dateLabel, sel && styles.dateLabelSelected]}>{d.format("ddd")}</Text>
                  <Text style={[styles.dateNum, sel && styles.dateNumSelected]}>{d.format("D")}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View>
          <Text style={styles.label}>Time</Text>
          <View style={styles.timeGrid}>
            {TIME_SLOTS.map((t) => (
              <Pressable
                key={t}
                testID={`bk-time-${t}`}
                onPress={() => setTime(t)}
                style={[styles.timeChip, time === t && styles.timeChipSelected]}
              >
                <Text style={[styles.timeText, time === t && styles.timeTextSelected]}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Field testID="bk-notes" label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Anything the groomer should know…" />
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </KeyboardAwareScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={{ flex: 1 }}>
          {service ? (
            <>
              <Text style={styles.summary}>{service.name} • {service.duration_minutes}m</Text>
              <Text style={styles.summaryPrice}>{money(service.price)}</Text>
            </>
          ) : null}
        </View>
        <Button testID="bk-save" title="Save booking" loading={saving} onPress={save} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  label: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "600", marginBottom: spacing.sm },
  chipsRow: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, flexShrink: 0,
  },
  chipSelected: { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: fontSize.base },
  chipTextSelected: { color: colors.onBrandSecondary, fontWeight: "700" },

  svcList: { gap: spacing.sm },
  svcRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  svcRowSelected: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  svcName: { color: colors.onSurface, fontWeight: "700", fontSize: fontSize.base },
  svcMeta: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  svcPrice: { color: colors.onSurface, fontWeight: "800", fontSize: fontSize.lg },

  dateChip: {
    width: 56, paddingVertical: spacing.sm, borderRadius: radius.lg,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", flexShrink: 0, gap: 2,
  },
  dateChipSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  dateLabel: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  dateLabelSelected: { color: "rgba(255,255,255,0.9)" },
  dateNum: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },
  dateNumSelected: { color: colors.onBrand },

  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  timeChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, minWidth: 68, alignItems: "center",
  },
  timeChipSelected: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  timeText: { color: colors.onSurface, fontWeight: "600" },
  timeTextSelected: { color: colors.onBrand },

  err: { color: colors.error, fontSize: fontSize.base },
  footer: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface,
  },
  summary: { color: colors.muted, fontSize: fontSize.sm },
  summaryPrice: { color: colors.onSurface, fontSize: fontSize.xl, fontWeight: "800" },
}));
