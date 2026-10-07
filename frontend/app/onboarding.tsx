import { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { ChevronRight, Check } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

const BUSINESS_TYPES = ["Dog Groomer", "Dog Walker", "Pet Sitter", "Pet Boarder", "Mobile Groomer", "Other"];

const DEFAULT_SERVICES: { name: string; price: string; duration_minutes: string }[] = [
  { name: "Full Groom", price: "55", duration_minutes: "120" },
  { name: "Bath & Brush", price: "30", duration_minutes: "60" },
  { name: "Nail Trim", price: "10", duration_minutes: "15" },
];

export default function Onboarding() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh } = useAuth();
  const { colors } = useTheme();

  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessType, setBusinessType] = useState("Dog Groomer");
  const [services, setServices] = useState(DEFAULT_SERVICES);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const updateService = (i: number, key: "name" | "price" | "duration_minutes", val: string) => {
    setServices((prev) => prev.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)));
  };
  const addService = () => setServices((prev) => [...prev, { name: "", price: "", duration_minutes: "60" }]);
  const removeService = (i: number) => setServices((prev) => prev.filter((_, idx) => idx !== i));

  const submit = async () => {
    setErr("");
    setSaving(true);
    try {
      const payload = {
        business_name: businessName.trim(),
        business_type: businessType,
        owner_name: ownerName.trim(),
        phone: phone.trim(),
        opening_hours: {},
        services: services
          .filter((s) => s.name.trim())
          .map((s) => ({
            name: s.name.trim(),
            price: parseFloat(s.price || "0") || 0,
            duration_minutes: parseInt(s.duration_minutes || "60", 10) || 60,
          })),
        seed_demo: true,
      };
      await apiFetch("/onboarding", { method: "POST", body: JSON.stringify(payload) });
      await refresh();
      router.replace("/paywall");
    } catch (e: any) {
      setErr(e.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const canContinue = step === 0 ? businessName.trim() && ownerName.trim() : true;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.progress}>
          <View style={[styles.progressBar, { width: step === 0 ? "50%" : "100%" }]} />
        </View>
        <Text style={styles.stepLabel}>Step {step + 1} of 2</Text>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={30}
      >
        {step === 0 ? (
          <>
            <Text style={styles.title}>Tell us about your business</Text>
            <Text style={styles.sub}>We'll personalise your dashboard with this.</Text>

            <View style={styles.form}>
              <Field
                testID="onb-business-name"
                label="Business name"
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="Happy Tails Grooming"
              />
              <Field
                testID="onb-owner-name"
                label="Owner name"
                value={ownerName}
                onChangeText={setOwnerName}
                placeholder="Alex"
              />
              <Field
                testID="onb-phone"
                label="Phone (optional)"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="07700 900000"
              />

              <View>
                <Text style={styles.label}>Business type</Text>
                <View style={styles.chipWrap}>
                  {BUSINESS_TYPES.map((t) => {
                    const selected = businessType === t;
                    return (
                      <Pressable
                        key={t}
                        testID={`onb-type-${t}`}
                        onPress={() => setBusinessType(t)}
                        style={[styles.chip, selected && styles.chipSelected]}
                      >
                        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>Your services</Text>
            <Text style={styles.sub}>Add the services you offer. You can edit these later.</Text>

            <View style={{ gap: spacing.md }}>
              {services.map((s, i) => (
                <View key={i} style={styles.svcCard}>
                  <Field
                    label="Service name"
                    value={s.name}
                    onChangeText={(v) => updateService(i, "name", v)}
                    placeholder="e.g. Full Groom"
                  />
                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Price (£)"
                        value={s.price}
                        onChangeText={(v) => updateService(i, "price", v)}
                        keyboardType="decimal-pad"
                        placeholder="55"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Duration (min)"
                        value={s.duration_minutes}
                        onChangeText={(v) => updateService(i, "duration_minutes", v)}
                        keyboardType="number-pad"
                        placeholder="60"
                      />
                    </View>
                  </View>
                  {services.length > 1 ? (
                    <Pressable onPress={() => removeService(i)} hitSlop={8} style={styles.removeBtn}>
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <Pressable onPress={addService} testID="onb-add-service" style={styles.addBtn}>
                <Text style={styles.addText}>+ Add another service</Text>
              </Pressable>
            </View>
            {err ? <Text style={styles.err}>{err}</Text> : null}
          </>
        )}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        {step === 0 ? (
          <Button
            testID="onb-continue"
            title="Continue"
            fullWidth
            onPress={() => setStep(1)}
            disabled={!canContinue}
          />
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Button testID="onb-finish" title="Finish setup" fullWidth loading={saving} onPress={submit} />
            <Pressable onPress={() => setStep(0)} hitSlop={8} style={{ alignItems: "center", paddingVertical: spacing.sm }}>
              <Text style={{ color: colors.muted, fontSize: fontSize.base }}>Back</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.sm },
  progress: {
    height: 6,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  progressBar: { height: "100%", backgroundColor: colors.brandPrimary, borderRadius: radius.pill },
  stepLabel: { color: colors.muted, fontSize: fontSize.sm, fontWeight: "600" },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: fontSize.lg, color: colors.muted },
  form: { gap: spacing.md },
  label: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "600", marginBottom: spacing.sm },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "500" },
  chipTextSelected: { color: colors.onBrandSecondary, fontWeight: "700" },
  svcCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row2: { flexDirection: "row", gap: spacing.md },
  addBtn: {
    paddingVertical: spacing.lg,
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.surfaceSecondary,
  },
  addText: { color: colors.brandPrimary, fontWeight: "600", fontSize: fontSize.base },
  removeBtn: { alignSelf: "flex-start" },
  removeText: { color: colors.error, fontSize: fontSize.sm, fontWeight: "600" },
  footer: {
    padding: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  err: { color: colors.error, fontSize: fontSize.base },
}));
