export const ALLOWED_TAGS = [
  "수강",
  "졸업",
  "학사",
  "일반",
  "대학원",
  "취업",
  "공모전",
  "교내활동",
  "대외활동",
  "지원금",
  "장학금",
] as const;

export type AllowedTag = typeof ALLOWED_TAGS[number];

export const TAG_COLORS: Record<string, { bg: string; text: string; border?: string }> = {
  "수강": { bg: "#E3F2FD", text: "#1976D2", border: "#BBDEFB" },
  "졸업": { bg: "#F3E5F5", text: "#7B1FA2", border: "#CE93D8" },
  "학사": { bg: "#E8F5E9", text: "#388E3C", border: "#A5D6A7" },
  "일반": { bg: "#FAFAFA", text: "#616161", border: "#E0E0E0" },
  "대학원": { bg: "#FFF3E0", text: "#E65100", border: "#FFCC80" },
  "취업": { bg: "#FFEBEE", text: "#C62828", border: "#EF9A9A" },
  "공모전": { bg: "#E1F5FE", text: "#0277BD", border: "#81D4FA" },
  "교내활동": { bg: "#FCE4EC", text: "#C2185B", border: "#F48FB1" },
  "대외활동": { bg: "#E0F2F1", text: "#00695C", border: "#80CBC4" },
  "지원금": { bg: "#FFF8E1", text: "#F57F17", border: "#FFE082" },
  "장학금": { bg: "#EDE7F6", text: "#512DA8", border: "#B39DDB" },
};
