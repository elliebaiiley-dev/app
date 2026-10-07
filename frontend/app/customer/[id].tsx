import { useCallback } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Phone, Mail, MapPin, Plus, Trash2 } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { PetAvatar } from "@/src/components/PetAvatar";
import { StatusPill } from "@/src/components/StatusPill";
import { Card, EmptyState, SectionHeader } from "@/src/components/Card";
import { formatDateTime, formatDateFull, money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const qc = useQueryClient();

  const { data, isLoading, refetch } = useQuery<any>({
    queryKey: ["customer", id],
    queryFn: () => apiFetch(`/customers/${id}`),
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const timeline = buildTimeline(data);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{data?.name || "Customer"}</Text>
        <Pressable testID="cust-delete" onPress={async () => {
          await apiFetch(`/customers/${id}`, { method: "DELETE" });
          qc.invalidateQueries({ queryKey: ["customers"] });
          router.back();
        }} hitSlop={10} style={styles.back}>
          <Trash2 size={20} color={colors.error} />
        </Pressable>
      </View>

      {isLoading || !data ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + 100 }}>
          <Card>
            {data.phone ? <ContactRow icon={<Phone size={16} color={colors.brandPrimary} />} text={data.phone} /> : null}
            {data.email ? <ContactRow icon={<Mail size={16} color={colors.brandPrimary} />} text={data.email} /> : null}
            {data.address ? <ContactRow icon={<MapPin size={16} color={colors.brandPrimary} />} text={data.address} /> : null}
            {data.notes ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notes}>{data.notes}</Text>
              </View>
            ) : null}
          </Card>

          <View>
            <SectionHeader title="Pets" action={{ label: "+ Add pet", onPress: () => router.push({ pathname: "/pet/new", params: { customer_id: id } }) }} />
            {data.pets.length === 0 ? (
              <Card><EmptyState title="No pets yet" subtitle="Add this customer's first pet." /></Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {data.pets.map((p: any) => (
                  <Pressable key={p.id} testID={`pet-${p.id}`} onPress={() => router.push(`/pet/${p.id}`)} style={styles.petRow}>
                    <PetAvatar path={p.photo_path} size={44} initials={(p.name || "?").slice(0, 1)} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.petName}>{p.name}</Text>
                      <Text style={styles.petSub}>{p.breed || p.species || "Pet"}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <View>
            <SectionHeader title="History" />
            {timeline.length === 0 ? (
              <Card><EmptyState title="No history yet" subtitle="Bookings and payments will appear here." /></Card>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {timeline.map((item) => (
                  <View key={item.id} style={styles.tlRow}>
                    <View style={[styles.tlDot, { backgroundColor: item.kind === "payment" ? colors.success : colors.brandPrimary }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tlTitle}>{item.title}</Text>
                      <Text style={styles.tlSub}>{formatDateFull(item.at)}</Text>
                    </View>
                    {item.right}
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function ContactRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.contactRow}>
      {icon}
      <Text style={styles.contactText}>{text}</Text>
    </View>
  );
}

function buildTimeline(data: any): { id: string; title: string; at: string; kind: string; right?: React.ReactNode }[] {
  if (!data) return [];
  const items: any[] = [];
  for (const b of data.bookings || []) {
    items.push({
      id: `b_${b.id}`,
      title: `Booking • ${b.pet_name || ""}`,
      at: b.start_at,
      kind: "booking",
      right: <StatusPill status={b.status} small />,
    });
  }
  for (const p of data.payments || []) {
    items.push({
      id: `p_${p.id}`,
      title: `Payment received • ${money(p.amount)}`,
      at: p.paid_at,
      kind: "payment",
    });
  }
  items.sort((a, b) => (b.at > a.at ? 1 : -1));
  return items;
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", padding: spacing.lg, gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800", flex: 1 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  contactText: { color: colors.onSurface, fontSize: fontSize.base },
  notesLabel: { color: colors.muted, fontSize: fontSize.sm, fontWeight: "600", marginBottom: 4 },
  notes: { color: colors.onSurface, fontSize: fontSize.base, lineHeight: 20 },

  petRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  petName: { color: colors.onSurface, fontWeight: "700", fontSize: fontSize.lg },
  petSub: { color: colors.muted, fontSize: fontSize.sm },

  tlRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
  },
  tlDot: { width: 10, height: 10, borderRadius: radius.pill },
  tlTitle: { color: colors.onSurface, fontWeight: "600", fontSize: fontSize.base },
  tlSub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
}));
