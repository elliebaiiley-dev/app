import { View, Text, Pressable, Modal, Platform, Linking, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Copy, MessageSquare, X } from "lucide-react-native";

import { Button } from "@/src/components/Button";
import { makeStyles, radius, spacing, fontSize, useTheme } from "@/src/theme";

type Props = {
  visible: boolean;
  title: string;
  message: string;
  phone?: string;
  onClose: () => void;
};

async function openSMS(phone: string, message: string) {
  const encoded = encodeURIComponent(message);
  // iOS, Android, desktop — the "&body" syntax works on iOS 10+; "?body" works on Android.
  const android = `sms:${phone}?body=${encoded}`;
  const ios = `sms:${phone}&body=${encoded}`;
  const url = Platform.OS === "ios" ? ios : android;
  try {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      // On desktop browsers this opens the default SMS handler if one is set; on mobile Safari/Chrome
      // it opens the Messages / SMS app. Open in same tab so the OS handoff can happen.
      window.location.href = url;
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

async function copyText(text: string): Promise<boolean> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && (navigator as any).clipboard) {
    try {
      await (navigator as any).clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function ShareSheet({ visible, title, message, phone, onClose }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const sendSms = async () => {
    if (!phone) return;
    await openSMS(phone, message);
    onClose();
  };

  const copy = async () => {
    const ok = await copyText(message);
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(ok ? "Copied to clipboard" : "Could not copy — select the text above instead.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable testID="share-sheet-backdrop" onPress={onClose} style={styles.backdrop}>
        <Pressable onPress={() => {}} style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable testID="share-sheet-close" onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <X size={20} color={colors.onSurface} />
            </Pressable>
          </View>
          <ScrollView style={styles.preview} contentContainerStyle={{ padding: spacing.md }}>
            <Text style={styles.previewText} selectable>{message}</Text>
          </ScrollView>
          <View style={{ gap: spacing.sm }}>
            {phone ? (
              <Button
                testID="share-sheet-sms"
                title={`Text to ${phone}`}
                fullWidth
                icon={<MessageSquare size={18} color={colors.onBrand} />}
                onPress={sendSms}
              />
            ) : null}
            <Button
              testID="share-sheet-copy"
              title="Copy message"
              variant="secondary"
              fullWidth
              icon={<Copy size={16} color={colors.brandPrimary} />}
              onPress={copy}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(26,29,26,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: colors.onSurface, fontSize: fontSize.xl, fontWeight: "800" },
  closeBtn: {
    width: 36, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  preview: {
    maxHeight: 180,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
  },
  previewText: {
    color: colors.onBrandTertiary,
    fontSize: fontSize.base,
    lineHeight: 22,
  },
}));
