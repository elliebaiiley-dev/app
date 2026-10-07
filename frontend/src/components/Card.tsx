import { View, Text, Pressable } from "react-native";

import { makeStyles, radius, spacing, fontSize } from "@/src/theme";

export function Card({ children, style }: { children: React.ReactNode; style?: any }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const styles = useStyles();
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8}>
          <Text style={styles.action}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: fontSize.xl, fontWeight: "700" },
  action: { color: colors.brandPrimary, fontSize: fontSize.base, fontWeight: "600" },
  empty: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  emptyTitle: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "600" },
  emptySub: { color: colors.muted, fontSize: fontSize.base, marginTop: spacing.xs, textAlign: "center" },
}));
