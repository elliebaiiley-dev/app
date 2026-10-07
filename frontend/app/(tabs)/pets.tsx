import { useState, useMemo, useCallback } from "react";
import { View, Text, FlatList, Pressable, TextInput, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { PetAvatar } from "@/src/components/PetAvatar";
import { EmptyState } from "@/src/components/Card";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function PetsScreen() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [q, setQ] = useState("");

  const { data = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["pets"],
    queryFn: () => apiFetch("/pets"),
  });

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const filtered = useMemo(() => {
    if (!q.trim()) return data;
    const needle = q.toLowerCase();
    return data.filter((p) =>
      [p.name, p.breed, p.customer_name].filter(Boolean).some((v: string) => v.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Pets</Text>
        <View style={styles.searchWrap}>
          <Search size={18} color={colors.muted} />
          <TextInput
            testID="pets-search"
            value={q}
            onChangeText={setQ}
            placeholder="Search pets by name or breed…"
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
          <EmptyState title={q ? "No matches" : "No pets yet"} subtitle={q ? "Try a different search." : "Add a customer first, then their pets."} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          numColumns={2}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + 100 }}
          renderItem={({ item: p }) => (
            <Pressable
              testID={`pet-card-${p.id}`}
              onPress={() => router.push(`/pet/${p.id}`)}
              style={styles.card}
            >
              <PetAvatar path={p.photo_path} size={80} initials={(p.name || "?").slice(0, 1)} />
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{p.breed || p.species || "Pet"}</Text>
              <Text style={styles.owner} numberOfLines={1}>{p.customer_name}</Text>
            </Pressable>
          )}
        />
      )}

      <Pressable
        testID="pets-add"
        onPress={() => router.push("/pet/new")}
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
  card: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 170,
  },
  name: { color: colors.onSurface, fontWeight: "800", fontSize: fontSize.lg, marginTop: spacing.sm },
  sub: { color: colors.muted, fontSize: fontSize.sm },
  owner: { color: colors.brandPrimary, fontSize: fontSize.sm, fontWeight: "600", marginTop: 2 },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
}));
