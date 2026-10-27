import { extendTheme } from "@chakra-ui/react";

export const ui = {
  ink: "#151820",
  muted: "#667080",
  quiet: "#6a7385",
  page: "#f1f2f6",
  panel: "#ffffff",
  soft: "#f7f8fa",
  line: "#dfe2e8",
  lineDark: "#cbd0d9",
  nav: "#080a12",
  violet: "#6056e8",
  red: "#f44754",
  amber: "#f4a51c",
  green: "#45ad7a",
  steel: "#8ea1b7",
  teal: "#9bc8be",
};

export const theme = extendTheme({
  config: { initialColorMode: "light", useSystemColorMode: false },
  colors: { brand: { 500: ui.violet }, danger: { 500: ui.red } },
  fonts: {
    heading: "Graphik, 'Segoe UI', sans-serif",
    body: "Graphik, 'Segoe UI', sans-serif",
    mono: "'SFMono-Regular', Consolas, monospace",
    condensed: "'Review Condensed', 'Arial Narrow', sans-serif",
  },
  fontSizes: { xs: "11px", sm: "12px", md: "13px", lg: "15px" },
  styles: {
    global: {
      "html, body, #root": { minH: "100%", bg: ui.page },
      body: { color: ui.ink, fontSize: "13px", lineHeight: 1.5 },
      "*": { borderColor: ui.line },
      "::selection": { bg: "#dcd9ff", color: ui.ink },
    },
  },
  components: {
    Button: {
      baseStyle: { borderRadius: "4px", fontWeight: 600, fontSize: "11px", transition: "all .16s ease" },
      sizes: { sm: { h: "34px", px: "13px" } },
      variants: {
        solid: { bg: ui.nav, color: "white", _hover: { bg: "#272a35" } },
        outline: {
          borderColor: ui.lineDark,
          color: ui.ink,
          bg: "white",
          _hover: { bg: ui.soft },
        },
        ghost: { color: ui.muted, _hover: { bg: "#edeef3", color: ui.ink } },
      },
      defaultProps: { size: "sm" },
    },
    Input: {
      sizes: {
        sm: { field: { h: "34px", fontSize: "11px", borderRadius: "4px" } },
      },
      defaultProps: { size: "sm" },
    },
    Select: {
      sizes: {
        sm: { field: { h: "34px", fontSize: "11px", borderRadius: "4px" } },
      },
      defaultProps: { size: "sm" },
    },
    Badge: {
      baseStyle: {
        borderRadius: "8px",
        px: "6px",
        py: "2px",
        fontSize: "9px",
        lineHeight: 1,
        fontWeight: 700,
      },
    },
  },
});
