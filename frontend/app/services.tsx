import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Plus, Trash2 } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { EmptyState } from "@/src/components/Card";
import { apiFetch } from "@/src/api/client";
import { money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function Services() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["services"],
    queryFn: () => apiFetch("/services"),
  });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiFetch("/services", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          price: parseFloat(price || "0") || 0,
          duration_minutes: parseInt(duration || "60", 10) || 60,
        }),
      });
      setName(""); setPrice(""); setDuration("");
      setAdding(false);
      refetch();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    await apiFetch(`/services/${id}`, { method: "DELETE" });
    refetch();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Services</Text>
        <Pressable testID="svc-toggle-add" onPress={() => setAdding((v) => !v)} hitSlop={10} style={styles.back}>
          <Plus size={22} color={colors.brandPrimary} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 100 }}>
        {adding ? (
          <View style={styles.card}>
            <Field testID="svc-name" label="Service name" value={name} onChangeText={setName} placeholder="e.g. Full Groom" />
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <Field testID="svc-price" label="Price (£)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <Field testID="svc-duration" label="Duration (min)" value={duration} onChangeText={setDuration} keyboardType="number-pad" />
              </View>
            </View>
            <Button testID="svc-save" title="Add service" fullWidth loading={saving} onPress={add} />
          </View>
        ) : null}

        {isLoading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : data.length === 0 ? (
          <EmptyState title="No services yet" subtitle="Add your first service." />
        ) : (
          data.map((s) => (
            <View key={s.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{s.name}</Text>
                <Text style={styles.meta}>{s.duration_minutes} min</Text>
              </View>
              <Text style={styles.price}>{money(s.price)}</Text>
              <Pressable testID={`svc-del-${s.id}`} onPress={() => remove(s.id)} hitSlop={8}>
                <Trash2 size={18} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", flex: 1 },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg,
    gap: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  name: { color: colors.onSurface, fontWeight: "700", fontSize: fontSize.lg },
  meta: { color: colors.muted, fontSize: fontSize.sm },
  price: { color: colors.onSurface, fontWeight: "800", fontSize: fontSize.lg },
}));
