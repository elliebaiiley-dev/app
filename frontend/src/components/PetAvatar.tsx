import { View, Text, Pressable } from "react-native";
import { PawPrint } from "lucide-react-native";

import { AuthImage } from "@/src/components/AuthImage";
import { makeStyles, radius, useTheme } from "@/src/theme";

type Props = {
  path?: string | null;
  size?: number;
  onPress?: () => void;
  initials?: string;
};

export function PetAvatar({ path, size = 48, onPress, initials }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const style = { width: size, height: size, borderRadius: radius.pill };
  const content = (
    <AuthImage
      path={path}
      style={style}
      fallback={
        initials ? (
          <Text style={{ color: colors.onBrandTertiary, fontWeight: "700", fontSize: size * 0.42 }}>{initials}</Text>
        ) : (
          <PawPrint color={colors.onBrandTertiary} size={Math.round(size * 0.5)} />
        )
      }
    />
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={styles.wrap}>
        {content}
      </Pressable>
    );
  }
  return <View>{content}</View>;
}

const useStyles = makeStyles(() => ({
  wrap: {},
}));
