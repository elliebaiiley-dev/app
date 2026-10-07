import { useCallback, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator, Share, Platform } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, Trash2, Phone, MessageCircle, Calendar as CalIcon, Weight, HeartPulse, AlertTriangle, Syringe, ChevronRight } from "lucide-react-native";

import { AuthImage } from "@/src/components/AuthImage";
import { Card, EmptyState, SectionHeader } from "@/src/components/Card";
import { StatusPill } from "@/src/components/StatusPill";
import { Button } from "@/src/components/Button";
import { ShareSheet } from "@/src/components/ShareSheet";
import { apiFetch } from "@/src/api/client";
import { ageFromDob, formatDateFull, money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function PetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data: pet, isLoading, refetch } = useQuery<any>({
    queryKey: ["pet", id],
    queryFn: () => apiFetch(`/pets/${id}`),
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const [generating, setGenerating] = useState(false);
  const [sheet, setSheet] = useState<{ message: string; phone: string } | null>(null);

  const generateMessage = async () => {
    setGenerating(true);
    try {
      const res = await apiFetch<{ message: string; customer_phone: string }>(`/rebooking/message?pet_id=${id}`);
      setSheet({ message: res.message, phone: res.customer_phone || "" });
    } catch (e) {
      console.error("rebooking message failed", e);
    } finally {
      setGenerating(false);
    }
  };

  const removePet = async () => {
    await apiFetch(`/pets/${id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["pets"] });
    router.back();
  };

  if (isLoading || !pet) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  const bookings = (pet.bookings || []).slice(0, 10);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <AuthImage path={pet.photo_path} style={styles.heroImage} initials={pet.name?.slice(0, 1)} />
          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(38,41,38,0.4)", "rgba(38,41,38,0.9)"]}
            style={styles.scrim}
            locations={[0, 0.5, 1]}
          />
          <View style={[styles.heroHeader, { paddingTop: insets.top }]}>
            <Pressable testID="pet-back" onPress={() => router.back()} style={styles.circleBtn} hitSlop={10}>
              <ChevronLeft size={22} color="#FFF" />
            </Pressable>
            <Pressable testID="pet-delete" onPress={removePet} style={styles.circleBtn} hitSlop={10}>
              <Trash2 size={18} color="#FFF" />
            </Pressable>
          </View>
          <View style={styles.heroBottom}>
            <Text style={styles.petName}>{pet.name}</Text>
            <Text style={styles.petBreed}>{[pet.breed, pet.species].filter(Boolean).join(" • ")}</Text>
          </View>
        </View>

        <View style={styles.body}>
          {/* Stats */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsScroll}>
            <Stat icon={<CalIcon size={18} color={colors.brandPrimary} />} label="Age" value={ageFromDob(pet.date_of_birth)} />
            <Stat icon={<Weight size={18} color={colors.brandPrimary} />} label="Weight" value={pet.weight || "—"} />
            <Stat icon={<HeartPulse size={18} color={colors.brandPrimary} />} label="Species" value={pet.species || "Pet"} />
          </ScrollView>

          {/* Owner */}
          {pet.customer ? (
            <Pressable testID="pet-owner" onPress={() => router.push(`/customer/${pet.customer.id}`)} style={styles.ownerCard}>
              <View style={styles.ownerAvatar}>
                <Text style={styles.ownerInitial}>{pet.customer.name?.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.ownerLabel}>Owner</Text>
                <Text style={styles.ownerName}>{pet.customer.name}</Text>
                {pet.customer.phone ? <Text style={styles.ownerSub}>{pet.customer.phone}</Text> : null}
              </View>
              <ChevronRight size={18} color={colors.muted} />
            </Pressable>
          ) : null}

          {/* Rebooking CTA */}
          <View style={styles.rebookCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rebookTitle}>Rebooking</Text>
              <Text style={styles.rebookSub}>
                {pet.next_recommended_at ? `Next due ${formatDateFull(pet.next_recommended_at)}` : "No next appointment set"}
              </Text>
            </View>
            <View>
              <Button testID="pet-generate-msg" title="Message" variant="secondary" onPress={generateMessage} loading={generating} />
            </View>
          </View>

          {/* Info cards */}
          <InfoCard icon={<AlertTriangle size={16} color={colors.warning} />} title="Allergies" body={pet.allergies} empty="None noted" />
          <InfoCard icon={<HeartPulse size={16} color={colors.error} />} title="Medical notes" body={pet.medical_notes} empty="No medical notes" />
          <InfoCard icon={<Syringe size={16} color={colors.success} />} title="Vaccinations" body={pet.vaccinations} empty="No vaccination record" />
          <InfoCard icon={<HeartPulse size={16} color={colors.brandPrimary} />} title="Behaviour" body={pet.behaviour_notes} empty="No behaviour notes" />
          {pet.special_requirements ? (
            <InfoCard icon={<AlertTriangle size={16} color={colors.brandPrimary} />} title="Special requirements" body={pet.special_requirements} empty="" />
          ) : null}

          {/* History */}
          <View>
            <SectionHeader title="Appointment history" />
            {bookings.length === 0 ? (
              <Card><EmptyState title="No bookings yet" subtitle="Create the first appointment." /></Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {bookings.map((b: any) => (
                  <Pressable key={b.id} testID={`pet-booking-${b.id}`} onPress={() => router.push(`/booking/${b.id}`)} style={styles.tlRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tlTitle}>{formatDateFull(b.start_at)}</Text>
                      <Text style={styles.tlSub}>{money(b.price)}</Text>
                    </View>
                    <StatusPill status={b.status} small />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <Button
            testID="pet-add-booking"
            title="New booking"
            fullWidth
            onPress={() => router.push({ pathname: "/booking/new", params: { pet_id: pet.id, customer_id: pet.customer_id } })}
          />
        </View>
      </ScrollView>
      <ShareSheet
        visible={!!sheet}
        title="Rebooking message"
        message={sheet?.message ?? ""}
        phone={sheet?.phone}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function InfoCard({ icon, title, body, empty }: { icon: React.ReactNode; title: string; body: string; empty: string }) {
  const styles = useStyles();
  return (
    <View style={styles.infoCard}>
      <View style={styles.infoHeader}>
        {icon}
        <Text style={styles.infoTitle}>{title}</Text>
      </View>
      <Text style={styles.infoBody}>{body || empty}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 360, backgroundColor: colors.brandTertiary },
  heroImage: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  circleBtn: {
    width: 40, height: 40, borderRadius: radius.pill,
    backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center",
  },
  heroBottom: { position: "absolute", bottom: spacing.xl, left: spacing.lg, right: spacing.lg },
  petName: { color: "#FFF", fontSize: 36, fontWeight: "800" },
  petBreed: { color: "rgba(255,255,255,0.9)", fontSize: fontSize.lg, marginTop: 4 },

  body: { padding: spacing.lg, gap: spacing.lg, marginTop: -spacing.lg },

  statsScroll: { gap: spacing.sm, paddingVertical: spacing.sm },
  stat: {
    minWidth: 110,
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    gap: 4,
    flexShrink: 0,
  },
  statIcon: {
    width: 32, height: 32, borderRadius: radius.pill, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  statLabel: { color: colors.muted, fontSize: fontSize.sm, marginTop: 4 },
  statValue: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },

  ownerCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  ownerAvatar: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  ownerInitial: { color: colors.onBrandTertiary, fontSize: fontSize.lg, fontWeight: "700" },
  ownerLabel: { color: colors.muted, fontSize: fontSize.sm },
  ownerName: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },
  ownerSub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },

  rebookCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg,
  },
  rebookTitle: { color: colors.onBrandTertiary, fontSize: fontSize.lg, fontWeight: "800" },
  rebookSub: { color: colors.onBrandTertiary, fontSize: fontSize.sm, marginTop: 2 },

  infoCard: {
    backgroundColor: colors.surfaceSecondary,
    padding: spacing.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    gap: spacing.sm,
  },
  infoHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  infoTitle: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "700" },
  infoBody: { color: colors.onSurface, fontSize: fontSize.base, lineHeight: 20 },

  tlRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  tlTitle: { color: colors.onSurface, fontWeight: "700", fontSize: fontSize.base },
  tlSub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
}));
