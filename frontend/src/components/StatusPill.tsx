import { View, Text } from "react-native";

import { makeStyles, radius, spacing, fontSize } from "@/src/theme";
import { statusLabel } from "@/src/utils/format";

type Props = {
  status: string;
  small?: boolean;
};

export function StatusPill({ status, small }: Props) {
  const styles = useStyles();
  const style = [styles.base, styles[`${status}`] ?? styles.default, small && styles.small];
  const textStyle = [styles.text, styles[`t_${status}`] ?? styles.t_default, small && styles.textSmall];
  return (
    <View style={style}>
      <Text style={textStyle}>{statusLabel(status)}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  base: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  small: { paddingHorizontal: spacing.sm, paddingVertical: 2 },
  text: { fontSize: fontSize.sm, fontWeight: "600" },
  textSmall: { fontSize: 11 },
  default: { backgroundColor: colors.brandTertiary },
  t_default: { color: colors.onBrandTertiary },
  confirmed: { backgroundColor: colors.brandSecondary },
  t_confirmed: { color: colors.onBrandSecondary },
  completed: { backgroundColor: "#D7EAD9" },
  t_completed: { color: colors.success },
  cancelled: { backgroundColor: colors.surfaceTertiary },
  t_cancelled: { color: colors.muted },
  no_show: { backgroundColor: "#F6DBD9" },
  t_no_show: { color: colors.error },
}));
