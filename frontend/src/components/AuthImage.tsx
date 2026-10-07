import { useEffect, useState } from "react";
import { Image, View, ActivityIndicator } from "react-native";
import { Image as ExpoImage } from "expo-image";

import { fileUrl } from "@/src/api/client";
import { useTheme } from "@/src/theme";

type Props = {
  path?: string | null;
  style?: any;
  contentFit?: "cover" | "contain";
  fallback?: React.ReactNode;
};

// Resolves an authenticated token URL and renders either an expo-image (native)
// or a plain Image via <ExpoImage>. On web ExpoImage renders an <img>, which cannot
// send Authorization headers, so we rely on ?token= query-string auth.
export function AuthImage({ path, style, contentFit = "cover", fallback }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { colors } = useTheme();

  useEffect(() => {
    let active = true;
    if (!path) {
      setUri(null);
      setLoading(false);
      return;
    }
    (async () => {
      const url = await fileUrl(path);
      if (active) {
        setUri(url);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [path]);

  if (!path) {
    return <View style={[style, { backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }]}>{fallback}</View>;
  }
  if (loading || !uri) {
    return (
      <View style={[style, { backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }]}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  return <ExpoImage source={{ uri }} style={style} contentFit={contentFit} transition={200} />;
}

// Simple remote image for Unsplash/sample URLs.
export function RemoteImage({ uri, style, contentFit = "cover" }: { uri: string; style?: any; contentFit?: "cover" | "contain" }) {
  return <ExpoImage source={{ uri }} style={style} contentFit={contentFit} transition={200} />;
}
