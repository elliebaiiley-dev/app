import { useState, useMemo, useCallback } from "react";
import { View, Text, FlatList, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, ChevronRight, PawPrint } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { EmptyState } from "@/src/components/Card";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function CustomersScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [q, setQ] = useState("");

  const { data = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["customers"],
    queryFn: () => apiFetch("/customers"),
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const filtered = useMemo(() => {
    if (!q.trim()) return data;
    const needle = q.toLowerCase();
    return data.filter((c) =>
      [c.name, c.phone, c.email, ...(c.pets || []).map((p: any) => p.name)]
        .filter(Boolean).some((v: string) => v.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Customers</Text>
        <View style={styles.searchWrap}>
          <Search size={18} color={colors.muted} />
          <TextInput
            testID="customers-search"
            value={q}
            onChangeText={setQ}
            placeholder="Search customers or pets…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.brandPrimary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ padding: spacing.xl, flex: 1, justifyContent: "center" }}>
          <EmptyState title={q ? "No matches" : "No customers yet"} subtitle={q ? "Try a different search." : "Add your first customer with +"} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + 100 }}
          renderItem={({ item: c }) => (
            <Pressable
              testID={`customer-row-${c.id}`}
              onPress={() => router.push(`/customer/${c.id}`)}
              style={styles.row}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{(c.name || "?").slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{c.name}</Text>
                <Text style={styles.rowSub}>
                  {c.phone || c.email || "No contact"}
                </Text>
                {c.pets && c.pets.length ? (
                  <View style={styles.petsRow}>
                    <PawPrint size={11} color={colors.brandPrimary} />
                    <Text style={styles.petsText}>
                      {c.pets.map((p: any) => p.name).join(", ")}
                    </Text>
                  </View>
                ) : null}
              </View>
              <ChevronRight size={18} color={colors.muted} />
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="customers-add"
        onPress={() => router.push("/customer/new")}
        style={[styles.fab, { bottom: insets.bottom + 76 }]}
      >
        <Plus size={22} color={colors.onBrand} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  title: { color: colors.onSurface, fontSize: 26, fontWeight: "800" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 44,
  },
  searchInput: { flex: 1, color: colors.onSurface, fontSize: fontSize.base },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 72,
  },
  avatar: {
    width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.onBrandTertiary, fontSize: fontSize.lg, fontWeight: "700" },
  rowTitle: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
  petsRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  petsText: { color: colors.brandPrimary, fontSize: fontSize.sm, fontWeight: "600" },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
}));
