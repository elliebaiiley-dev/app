import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { ChevronLeft } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { useAuth } from "@/src/context/auth";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function Login() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    setLoading(true);
    try {
      await signIn(email.trim(), pw);
      router.replace("/");
    } catch (e: any) {
      setErr(e.message || "Could not sign in");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="login-back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={24} color={colors.onSurface} />
        </Pressable>
      </View>
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        bottomOffset={20}
      >
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.sub}>Sign in to manage your pet business.</Text>

        <View style={styles.form}>
          <Field
            testID="login-email"
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@business.com"
          />
          <Field
            testID="login-password"
            label="Password"
            value={pw}
            onChangeText={setPw}
            secureTextEntry
            autoComplete="password"
            placeholder="Your password"
          />
          {err ? <Text style={styles.err}>{err}</Text> : null}
        </View>

        <Button testID="login-submit" title="Sign in" fullWidth loading={loading} onPress={submit} />
        <Pressable testID="go-register" onPress={() => router.replace("/(auth)/register")} style={styles.alt}>
          <Text style={styles.altText}>New to PetAdmin? <Text style={styles.altLink}>Create an account</Text></Text>
        </Pressable>
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  scroll: { padding: spacing.xl, gap: spacing.lg },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: fontSize.lg, color: colors.muted, marginBottom: spacing.md },
  form: { gap: spacing.md },
  err: { color: colors.error, fontSize: fontSize.base },
  alt: { alignItems: "center", paddingVertical: spacing.md },
  altText: { color: colors.muted, fontSize: fontSize.base },
  altLink: { color: colors.brandPrimary, fontWeight: "700" },
}));
