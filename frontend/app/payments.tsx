import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react-native";

import { EmptyState } from "@/src/components/Card";
import { apiFetch } from "@/src/api/client";
import { formatDateTime, money } from "@/src/utils/format";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function Payments() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const { data = [], isLoading } = useQuery<any[]>({
    queryKey: ["payments"],
    queryFn: () => apiFetch("/payments"),
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Payments</Text>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : data.length === 0 ? (
        <View style={{ padding: spacing.xl, flex: 1, justifyContent: "center" }}>
          <EmptyState title="No payments yet" subtitle="Payments recorded against bookings will appear here." />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, paddingBottom: insets.bottom + 40 }}
          renderItem={({ item: p }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.amount}>{money(p.amount)}</Text>
                <Text style={styles.meta}>{formatDateTime(p.paid_at)} • {p.method}</Text>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  row: {
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
  },
  amount: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: fontSize.sm, marginTop: 2 },
}));
