// Design tokens for PetAdmin. Values come from /app/design_guidelines.json.
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  // Surfaces
  surface: "#FDFBF7",
  onSurface: "#1A1D1A",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1A1D1A",
  surfaceTertiary: "#F2EFE9",
  onSurfaceTertiary: "#1A1D1A",
  surfaceInverse: "#262926",
  onSurfaceInverse: "#FDFBF7",
  muted: "#737974",

  // Brand (Sage green)
  brand: "#526A5A",
  onBrand: "#FFFFFF",
  brandPrimary: "#526A5A",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#E1E8E3",
  onBrandSecondary: "#2C3E32",
  brandTertiary: "#F0F4F1",
  onBrandTertiary: "#405547",

  // Status
  success: "#426B4E",
  onSuccess: "#FFFFFF",
  warning: "#B8860B",
  onWarning: "#FFFFFF",
  error: "#A84642",
  onError: "#FFFFFF",
  info: "#6B8E76",
  onInfo: "#FFFFFF",

  // Lines
  border: "#E6E3DB",
  borderStrong: "#CCC8BD",
  divider: "#E6E3DB",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
};

export const radius = {
  sm: 6,
  md: 12,
  lg: 20,
  pill: 999,
};

export const fontSize = {
  sm: 12,
  base: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
};

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

// Direct colors export for cases where a hook isn't appropriate (StyleSheet at module level).
// Prefer makeStyles/useTheme in components.
export const colors = light;
