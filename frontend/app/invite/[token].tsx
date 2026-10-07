import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { PawPrint } from "lucide-react-native";

import { apiFetch } from "@/src/api/client";
import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { useAuth } from "@/src/context/auth";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

export default function AcceptInvite() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { acceptInvite } = useAuth();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [invite, setInvite] = useState<{ email: string; business_name: string; role: string } | null>(null);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) { setErr("Missing invite token"); setLoading(false); return; }
      try {
        const i = await apiFetch<any>(`/invites/${token}`);
        setInvite(i);
      } catch (e: any) {
        setErr(e.message || "Invite not found or expired");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const submit = async () => {
    setErr("");
    if (pw.length < 6) { setErr("Password must be at least 6 characters"); return; }
    setSubmitting(true);
    try {
      await acceptInvite(String(token), pw, name);
      router.replace("/(tabs)");
    } catch (e: any) {
      setErr(e.message || "Could not accept invite");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.lg }]}>
      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: insets.bottom + 100 }}
        bottomOffset={20}
      >
        <View style={styles.icon}>
          <PawPrint size={30} color={colors.onBrand} />
        </View>
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : err && !invite ? (
          <>
            <Text style={styles.title}>Invite not available</Text>
            <Text style={styles.sub}>{err}</Text>
            <Button testID="invite-back" title="Back to sign in" fullWidth onPress={() => router.replace("/(auth)/welcome")} />
          </>
        ) : invite ? (
          <>
            <Text style={styles.title}>Join {invite.business_name}</Text>
            <Text style={styles.sub}>
              You've been invited as {invite.role === "admin" ? "an admin" : "a staff member"}. Create your password to join.
            </Text>
            <Field testID="invite-email" label="Email" value={invite.email} editable={false} />
            <Field testID="invite-name" label="Your name" value={name} onChangeText={setName} placeholder="Alex" />
            <Field testID="invite-password" label="Password" value={pw} onChangeText={setPw} secureTextEntry placeholder="At least 6 characters" />
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button testID="invite-accept" title="Join team" fullWidth loading={submitting} onPress={submit} />
            <Pressable onPress={() => router.replace("/(auth)/welcome")} style={{ alignItems: "center", paddingVertical: spacing.sm }}>
              <Text style={styles.altText}>Not you? <Text style={styles.altLink}>Sign in with a different account</Text></Text>
            </Pressable>
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  icon: {
    width: 56, height: 56, borderRadius: radius.pill,
    backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.onSurface },
  sub: { fontSize: fontSize.lg, color: colors.muted, lineHeight: 24 },
  err: { color: colors.error, fontSize: fontSize.base },
  altText: { color: colors.muted, fontSize: fontSize.base },
  altLink: { color: colors.brandPrimary, fontWeight: "700" },
}));
