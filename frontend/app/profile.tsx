import { useState, useEffect } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { apiFetch } from "@/src/api/client";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function Profile() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<any>({
    queryKey: ["profile"],
    queryFn: () => apiFetch("/profile"),
  });

  const [businessName, setBusinessName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setBusinessName(data.business_name || "");
      setOwnerName(data.owner_name || "");
      setPhone(data.phone || "");
      setBusinessType(data.business_type || "");
    }
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/onboarding", {
        method: "POST",
        body: JSON.stringify({
          business_name: businessName,
          business_type: businessType,
          owner_name: ownerName,
          phone,
          opening_hours: {},
          services: [],
          seed_demo: false,
        }),
      });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
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
        <Text style={styles.title}>Business profile</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
      ) : (
        <KeyboardAwareScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 120 }}
          bottomOffset={20}
        >
          <Field testID="pr-biz-name" label="Business name" value={businessName} onChangeText={setBusinessName} />
          <Field testID="pr-biz-type" label="Business type" value={businessType} onChangeText={setBusinessType} />
          <Field testID="pr-owner" label="Owner name" value={ownerName} onChangeText={setOwnerName} />
          <Field testID="pr-phone" label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <Button testID="pr-save" title={saved ? "Saved ✓" : "Save changes"} fullWidth loading={saving} onPress={save} />
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
}));
