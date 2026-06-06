export type TimeTheme = "day" | "dusk" | "night";

export function getTimeTheme(date = new Date()): TimeTheme {
  const hour = date.getHours();

  if (hour >= 6 && hour < 17) {
    return "day";
  }

  if (hour >= 17 && hour < 20) {
    return "dusk";
  }

  return "night";
}

export function themeLabel(theme: TimeTheme) {
  if (theme === "day") {
    return "晨光 · 灵感醒来了";
  }
  if (theme === "dusk") {
    return "晚樱 · 想法变柔软";
  }
  return "星语 · 灵感在发亮";
}
