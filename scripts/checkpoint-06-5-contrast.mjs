function channel(hex) {
  const value = Number.parseInt(hex, 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const raw = hex.replace("#", "");
  const r = channel(raw.slice(0, 2));
  const g = channel(raw.slice(2, 4));
  const b = channel(raw.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}
const pairs = [
  ["Deep Ocean Ink on Paper", "#10283F", "#F7F8F6"],
  ["Deep Sea on Paper", "#163A50", "#F7F8F6"],
  ["Port Teal on Paper", "#087F77", "#F7F8F6"],
  ["White on Port Teal", "#FFFFFF", "#087F77"],
  ["Slate on Paper", "#627586", "#F7F8F6"],
  ["Brass on Paper", "#C38A37", "#F7F8F6"],
  ["White on Brass", "#FFFFFF", "#C38A37"],
  ["Danger on Paper", "#B44343", "#F7F8F6"],
  ["White on Danger", "#FFFFFF", "#B44343"],
  ["Ink on Sea Glass", "#10283F", "#D7F0E9"],
  ["Current ink on paper", "#241910", "#F4EAD8"],
  ["Current muted on paper", "#6B5348", "#F4EAD8"],
  ["White on current accent", "#FFFFFF", "#0F6E6A"],
];
console.log(JSON.stringify(pairs.map(([name, fg, bg]) => ({ name, fg, bg, ratio: ratio(fg, bg), aaNormal: ratio(fg, bg) >= 4.5, aaLarge: ratio(fg, bg) >= 3 })), null, 2));
