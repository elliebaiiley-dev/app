import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { PawPrint, Sparkles, Calendar, Heart } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { RemoteImage } from "@/src/components/AuthImage";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1633722715463-d30f4f325e24?crop=entropy&cs=srgb&fm=jpg&w=1080&q=80";

export default function Welcome() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <RemoteImage uri={HERO} style={styles.heroImage} />
        <LinearGradient
          colors={["transparent", "rgba(38,41,38,0.6)", "rgba(38,41,38,0.95)"]}
          style={styles.scrim}
          locations={[0, 0.55, 1]}
        />
        <View style={[styles.heroContent, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.badge}>
            <PawPrint color={colors.onBrand} size={16} />
            <Text style={styles.badgeText}>PetAdmin</Text>
          </View>
          <Text style={styles.heroTitle}>Everything you need to run your pet business.</Text>
          <Text style={styles.heroSub}>Built for groomers, walkers, sitters and boarders. Simple, friendly, professional.</Text>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.features}>
          <Feature icon={<Calendar size={18} color={colors.brandPrimary} />} label="Bookings & calendar" />
          <Feature icon={<Heart size={18} color={colors.brandPrimary} />} label="Rich pet profiles" />
          <Feature icon={<Sparkles size={18} color={colors.brandPrimary} />} label="14-day free trial" />
        </View>
        <Button
          testID="welcome-create-account"
          title="Create account"
          fullWidth
          onPress={() => router.push("/(auth)/register")}
        />
        <Pressable
          testID="welcome-sign-in"
          onPress={() => router.push("/(auth)/login")}
          style={styles.signIn}
          hitSlop={8}
        >
          <Text style={styles.signInText}>I already have an account</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>{icon}</View>
      <Text style={styles.featureText}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { flex: 1, minHeight: 360 },
  heroImage: { ...StyleSheetAbs("absolute") },
  scrim: { ...StyleSheetAbs("absolute") },
  heroContent: {
    flex: 1,
    justifyContent: "flex-end",
    padding: spacing.xl,
    gap: spacing.sm,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  badgeText: { color: colors.onBrand, fontWeight: "700", fontSize: fontSize.sm, letterSpacing: 0.5 },
  heroTitle: { color: colors.onBrand, fontSize: 34, fontWeight: "800", lineHeight: 38 },
  heroSub: { color: "rgba(253,251,247,0.85)", fontSize: fontSize.lg, marginTop: spacing.xs },
  bottom: {
    padding: spacing.xl,
    gap: spacing.lg,
    backgroundColor: colors.surface,
  },
  features: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.sm },
  feature: { flex: 1, alignItems: "center", gap: 6 },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { color: colors.onSurface, fontSize: fontSize.sm, textAlign: "center" },
  signIn: { alignItems: "center", paddingVertical: spacing.sm },
  signInText: { color: colors.brandPrimary, fontWeight: "600", fontSize: fontSize.base },
}));

function StyleSheetAbs(position: "absolute"): any {
  return { position, left: 0, right: 0, top: 0, bottom: 0 };
}
