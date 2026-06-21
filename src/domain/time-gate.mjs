export const COMCARE_TIME_ZONE = "Asia/Singapore";
export const HOTLINE_NUMBER = "1800-222-0000";

export function singaporeHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: COMCARE_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  return Number(parts.find((part) => part.type === "hour")?.value);
}

export function getTimeGate(date = new Date()) {
  const hour = singaporeHour(date);
  const isOpen = hour >= 7;

  return {
    mode: isOpen ? "open" : "after-hours",
    singaporeHour: hour,
    timeZone: COMCARE_TIME_ZONE,
    hotlineNumber: HOTLINE_NUMBER,
    canRecord: !isOpen
  };
}

export function dateFromDemoHour(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  const now = new Date();
  const singaporeOffsetMs = 8 * 60 * 60 * 1000;
  const singaporeNow = new Date(now.getTime() + singaporeOffsetMs);
  singaporeNow.setUTCHours(hour, 0, 0, 0);
  return new Date(singaporeNow.getTime() - singaporeOffsetMs);
}
