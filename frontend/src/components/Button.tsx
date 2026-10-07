import { Pressable, Text, View, ActivityIndicator, type PressableProps } from "react-native";

import { makeStyles, radius, spacing, fontSize } from "@/src/theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";

type Props = Omit<PressableProps, "children" | "style"> & {
  title: string;
  variant?: Variant;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  testID?: string;
};

export function Button({ title, variant = "primary", loading, icon, fullWidth, disabled, ...rest }: Props) {
  const styles = useStyles();
  const containerStyle = [
    styles.base,
    variant === "primary" && styles.primary,
    variant === "secondary" && styles.secondary,
    variant === "ghost" && styles.ghost,
    variant === "danger" && styles.danger,
    fullWidth && styles.full,
    disabled && styles.disabled,
  ];
  const textStyle = [
    styles.text,
    variant === "primary" && styles.textPrimary,
    variant === "secondary" && styles.textSecondary,
    variant === "ghost" && styles.textGhost,
    variant === "danger" && styles.textDanger,
  ];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [...containerStyle, pressed && !disabled && styles.pressed]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#FFFFFF" : "#526A5A"} />
      ) : (
        <>
          {icon}
          <Text style={textStyle}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    gap: spacing.sm,
  },
  primary: { backgroundColor: colors.brandPrimary },
  secondary: { backgroundColor: colors.brandSecondary },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: colors.error },
  full: { alignSelf: "stretch" },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  text: { fontSize: fontSize.lg, fontWeight: "600" },
  textPrimary: { color: colors.onBrandPrimary },
  textSecondary: { color: colors.onBrandSecondary },
  textGhost: { color: colors.brandPrimary },
  textDanger: { color: colors.onError },
}));
