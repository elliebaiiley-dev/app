import { View, Text, TextInput, type TextInputProps } from "react-native";

import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

type Props = TextInputProps & {
  label?: string;
  error?: string;
  containerStyle?: any;
};

export function Field({ label, error, containerStyle, ...rest }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        {...rest}
        style={[styles.input, rest.multiline && styles.multiline, rest.style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: spacing.xs },
  label: {
    color: colors.onSurface,
    fontSize: fontSize.base,
    fontWeight: "600",
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    color: colors.onSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.lg,
    minHeight: 48,
  },
  multiline: {
    minHeight: 90,
    textAlignVertical: "top",
    paddingTop: spacing.md,
  },
  error: { color: colors.error, fontSize: fontSize.sm },
}));
