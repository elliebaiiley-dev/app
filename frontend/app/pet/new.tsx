import { useState, useEffect } from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { ChevronLeft, Camera } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { PetAvatar } from "@/src/components/PetAvatar";
import { apiFetch, uploadFile } from "@/src/api/client";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function NewPet() {
  const { customer_id: preCustomerId } = useLocalSearchParams<{ customer_id?: string }>();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data: customers = [] } = useQuery<any[]>({
    queryKey: ["customers"],
    queryFn: () => apiFetch("/customers"),
  });

  const [customerId, setCustomerId] = useState<string>(preCustomerId || "");
  const [name, setName] = useState("");
  const [species, setSpecies] = useState("Dog");
  const [breed, setBreed] = useState("");
  const [dob, setDob] = useState("");
  const [weight, setWeight] = useState("");
  const [allergies, setAllergies] = useState("");
  const [medical, setMedical] = useState("");
  const [behaviour, setBehaviour] = useState("");
  const [special, setSpecial] = useState("");
  const [vacc, setVacc] = useState("");
  const [photoPath, setPhotoPath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!customerId && customers.length > 0) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  const pickPhoto = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setErr("Photo library permission required");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setUploading(true);
      const filename = asset.fileName || `pet.${(asset.mimeType || "image/jpeg").split("/")[1] || "jpg"}`;
      const type = asset.mimeType || "image/jpeg";
      const result = await uploadFile(asset.uri, filename, type);
      setPhotoPath(result.path);
    } catch (e: any) {
      setErr(e.message || "Could not upload photo");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) { setErr("Pet name is required"); return; }
    if (!customerId) { setErr("Please choose a customer"); return; }
    setErr("");
    setSaving(true);
    try {
      const pet = await apiFetch<any>("/pets", {
        method: "POST",
        body: JSON.stringify({
          customer_id: customerId,
          name: name.trim(),
          species,
          breed,
          date_of_birth: dob,
          weight,
          allergies,
          medical_notes: medical,
          behaviour_notes: behaviour,
          special_requirements: special,
          vaccinations: vacc,
          photo_path: photoPath,
          next_recommended_at: "",
        }),
      });
      qc.invalidateQueries({ queryKey: ["pets"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      router.replace(`/pet/${pet.id}`);
    } catch (e: any) {
      setErr(e.message || "Could not save pet");
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
        <Text style={styles.title}>New pet</Text>
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <View style={styles.photoRow}>
          <PetAvatar path={photoPath} size={88} initials={name.slice(0, 1) || "?"} />
          <Pressable testID="pet-upload-photo" onPress={pickPhoto} style={styles.uploadBtn} disabled={uploading}>
            <Camera size={18} color={colors.brandPrimary} />
            <Text style={styles.uploadText}>{uploading ? "Uploading…" : photoPath ? "Change photo" : "Add photo"}</Text>
          </Pressable>
        </View>

        <View>
          <Text style={styles.label}>Owner *</Text>
          <View style={styles.customerPicker}>
            {customers.length === 0 ? (
              <Text style={{ color: colors.muted }}>No customers yet. Add one first.</Text>
            ) : (
              <View style={styles.chipWrap}>
                {customers.map((c) => (
                  <Pressable
                    key={c.id}
                    testID={`cust-pick-${c.id}`}
                    onPress={() => setCustomerId(c.id)}
                    style={[styles.chip, customerId === c.id && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, customerId === c.id && styles.chipTextSelected]}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>

        <Field testID="pet-name" label="Name *" value={name} onChangeText={setName} placeholder="e.g. Fozzie" />
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Field testID="pet-species" label="Species" value={species} onChangeText={setSpecies} placeholder="Dog" />
          </View>
          <View style={{ flex: 1 }}>
            <Field testID="pet-breed" label="Breed" value={breed} onChangeText={setBreed} placeholder="Golden Retriever" />
          </View>
        </View>
        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <Field testID="pet-dob" label="DOB (YYYY-MM-DD)" value={dob} onChangeText={setDob} placeholder="2022-05-14" />
          </View>
          <View style={{ flex: 1 }}>
            <Field testID="pet-weight" label="Weight" value={weight} onChangeText={setWeight} placeholder="12kg" />
          </View>
        </View>
        <Field testID="pet-allergies" label="Allergies" value={allergies} onChangeText={setAllergies} multiline placeholder="Chicken, grain…" />
        <Field testID="pet-medical" label="Medical notes" value={medical} onChangeText={setMedical} multiline />
        <Field testID="pet-behaviour" label="Behaviour notes" value={behaviour} onChangeText={setBehaviour} multiline />
        <Field testID="pet-special" label="Special requirements" value={special} onChangeText={setSpecial} multiline />
        <Field testID="pet-vacc" label="Vaccinations" value={vacc} onChangeText={setVacc} multiline />
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </KeyboardAwareScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="pet-save" title="Save pet" fullWidth loading={saving} onPress={save} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, paddingVertical: spacing.sm },
  uploadBtn: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.pill, backgroundColor: colors.brandTertiary,
  },
  uploadText: { color: colors.brandPrimary, fontWeight: "700", fontSize: fontSize.base },
  label: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "600", marginBottom: spacing.sm },
  customerPicker: {},
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontSize: fontSize.base },
  chipTextSelected: { color: colors.onBrandSecondary, fontWeight: "700" },
  row2: { flexDirection: "row", gap: spacing.md },
  err: { color: colors.error, fontSize: fontSize.base },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
}));
