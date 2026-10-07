import { useState } from "react";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { apiFetch } from "@/src/api/client";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function NewCustomer() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    if (!name.trim()) { setErr("Name is required"); return; }
    setErr("");
    setSaving(true);
    try {
      const c = await apiFetch<any>("/customers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), phone, email, address, notes }),
      });
      qc.invalidateQueries({ queryKey: ["customers"] });
      router.replace(`/customer/${c.id}`);
    } catch (e: any) {
      setErr(e.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New customer</Text>
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Field testID="cust-name" label="Name *" value={name} onChangeText={setName} placeholder="e.g. Sarah Thompson" />
        <Field testID="cust-phone" label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="07700 900000" />
        <Field testID="cust-email" label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="name@example.com" />
        <Field testID="cust-address" label="Address" value={address} onChangeText={setAddress} placeholder="12 Oak Lane, Bristol" />
        <Field testID="cust-notes" label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Any preferences or notes" />
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </KeyboardAwareScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="cust-save" title="Save customer" fullWidth loading={saving} onPress={save} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  err: { color: colors.error, fontSize: fontSize.base },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
}));
