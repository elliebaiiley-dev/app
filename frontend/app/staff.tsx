import { useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, UserPlus, Trash2, RotateCcw, Mail, Copy } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { Field } from "@/src/components/Field";
import { Card, EmptyState, SectionHeader } from "@/src/components/Card";
import { apiFetch } from "@/src/api/client";
import { useAuth } from "@/src/context/auth";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

type StaffList = {
  members: {
    membership_id: string;
    user_id: string;
    email: string;
    name: string;
    role: string;
    status: string;
    joined_at?: string;
    is_you: boolean;
  }[];
  invites: {
    invite_id: string;
    email: string;
    role: string;
    status: string;
    invited_at: string;
  }[];
};

export default function Staff() {
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";

  const { data, isLoading, refetch } = useQuery<StaffList>({
    queryKey: ["staff"],
    queryFn: () => apiFetch("/staff"),
  });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [err, setErr] = useState("");

  const sendInvite = async () => {
    setErr("");
    if (!email.trim()) { setErr("Enter an email"); return; }
    setInviting(true);
    try {
      const res = await apiFetch<{ invite_link: string }>("/staff/invite", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), role }),
      });
      setInviteLink(res.invite_link);
      setEmail("");
      refetch();
    } catch (e: any) {
      setErr(e.message || "Could not send invite");
    } finally {
      setInviting(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    try {
      if (typeof navigator !== "undefined" && (navigator as any).clipboard) {
        await (navigator as any).clipboard.writeText(inviteLink);
        if (typeof window !== "undefined") window.alert("Invite link copied to clipboard");
      }
    } catch {}
  };

  const deactivate = async (id: string) => {
    await apiFetch(`/staff/${id}/deactivate`, { method: "POST" });
    refetch();
  };
  const reactivate = async (id: string) => {
    await apiFetch(`/staff/${id}/reactivate`, { method: "POST" });
    refetch();
  };
  const remove = async (id: string) => {
    await apiFetch(`/staff/${id}`, { method: "DELETE" });
    refetch();
  };
  const cancelInvite = async (id: string) => {
    await apiFetch(`/invites/${id}`, { method: "DELETE" });
    refetch();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable testID="back" onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Staff</Text>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + 100 }}
        bottomOffset={30}
      >
        {isOwner ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Invite a staff member</Text>
            <Text style={styles.cardSub}>Everyone on your team can share your subscription — one £12.99/month covers unlimited staff.</Text>
            <Field
              testID="staff-invite-email"
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="colleague@example.com"
            />
            <View>
              <Text style={styles.label}>Role</Text>
              <View style={styles.chipWrap}>
                {(["staff", "admin"] as const).map((r) => (
                  <Pressable
                    key={r}
                    testID={`staff-role-${r}`}
                    onPress={() => setRole(r)}
                    style={[styles.chip, role === r && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, role === r && styles.chipTextSelected]}>
                      {r === "staff" ? "Staff" : "Admin"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {err ? <Text style={styles.err}>{err}</Text> : null}
            <Button testID="staff-invite-send" title="Send invite" fullWidth loading={inviting} onPress={sendInvite} icon={<UserPlus size={18} color={colors.onBrand} />} />
            {inviteLink ? (
              <View style={styles.linkCard}>
                <Text style={styles.linkTitle}>Invite link ready — share this with them</Text>
                <Text style={styles.linkText} selectable numberOfLines={2}>{inviteLink}</Text>
                <Button testID="staff-copy-link" title="Copy link" variant="secondary" onPress={copyLink} icon={<Copy size={16} color={colors.brandPrimary} />} />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Team access</Text>
            <Text style={styles.cardSub}>Only the business owner can invite or remove staff.</Text>
          </View>
        )}

        <View>
          <SectionHeader title="Team members" />
          {isLoading || !data ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : data.members.length === 0 ? (
            <Card><EmptyState title="No members yet" /></Card>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {data.members.map((m) => (
                <View key={m.membership_id} style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{(m.name || m.email).slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {m.name || m.email}
                      {m.is_you ? <Text style={styles.youTag}>  (you)</Text> : null}
                    </Text>
                    <Text style={styles.rowSub}>{m.email}</Text>
                    <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 6 }}>
                      <Badge label={m.role.toUpperCase()} tone={m.role === "owner" ? "brand" : "muted"} />
                      {m.status !== "active" ? <Badge label={m.status.toUpperCase()} tone="warning" /> : null}
                    </View>
                  </View>
                  {isOwner && !m.is_you && m.role !== "owner" ? (
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      {m.status === "active" ? (
                        <Pressable testID={`staff-deact-${m.membership_id}`} onPress={() => deactivate(m.membership_id)} hitSlop={8} style={styles.iconBtn}>
                          <Trash2 size={16} color={colors.warning} />
                        </Pressable>
                      ) : (
                        <Pressable testID={`staff-react-${m.membership_id}`} onPress={() => reactivate(m.membership_id)} hitSlop={8} style={styles.iconBtn}>
                          <RotateCcw size={16} color={colors.brandPrimary} />
                        </Pressable>
                      )}
                      <Pressable testID={`staff-remove-${m.membership_id}`} onPress={() => remove(m.membership_id)} hitSlop={8} style={styles.iconBtn}>
                        <Trash2 size={16} color={colors.error} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>

        {data && data.invites.length > 0 ? (
          <View>
            <SectionHeader title="Pending invites" />
            <View style={{ gap: spacing.sm }}>
              {data.invites.map((i) => (
                <View key={i.invite_id} style={styles.row}>
                  <View style={[styles.avatar, { backgroundColor: colors.surfaceTertiary }]}>
                    <Mail size={18} color={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{i.email}</Text>
                    <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: 4 }}>
                      <Badge label={i.role.toUpperCase()} tone="muted" />
                      <Badge label="INVITED" tone="warning" />
                    </View>
                  </View>
                  {isOwner ? (
                    <Pressable testID={`invite-cancel-${i.invite_id}`} onPress={() => cancelInvite(i.invite_id)} hitSlop={8} style={styles.iconBtn}>
                      <Trash2 size={16} color={colors.error} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: "brand" | "muted" | "warning" }) {
  const styles = useStyles();
  return (
    <View style={[styles.badge, tone === "brand" && styles.badgeBrand, tone === "warning" && styles.badgeWarning]}>
      <Text style={[styles.badgeText, tone === "brand" && styles.badgeTextBrand]}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg },
  back: { width: 40, height: 40, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },

  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.onSurface, fontSize: fontSize.xl, fontWeight: "800" },
  cardSub: { color: colors.muted, fontSize: fontSize.sm },

  label: { color: colors.onSurface, fontSize: fontSize.base, fontWeight: "600", marginBottom: spacing.sm },
  chipWrap: { flexDirection: "row", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.brandSecondary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurface, fontWeight: "600" },
  chipTextSelected: { color: colors.onBrandSecondary, fontWeight: "700" },

  linkCard: {
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  linkTitle: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: fontSize.sm },
  linkText: { color: colors.onBrandTertiary, fontSize: fontSize.sm },

  err: { color: colors.error, fontSize: fontSize.sm },

  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.md, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, minHeight: 72,
  },
  avatar: {
    width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: colors.onBrandTertiary, fontSize: fontSize.lg, fontWeight: "700" },
  rowTitle: { color: colors.onSurface, fontSize: fontSize.lg, fontWeight: "700" },
  rowSub: { color: colors.muted, fontSize: fontSize.sm },
  youTag: { color: colors.muted, fontSize: fontSize.sm, fontWeight: "500" },
  iconBtn: {
    width: 36, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },

  badge: {
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
  },
  badgeBrand: { backgroundColor: colors.brandSecondary },
  badgeWarning: { backgroundColor: "#FBECD1" },
  badgeText: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  badgeTextBrand: { color: colors.onBrandSecondary },
}));
