// Dates for the sales portal, the same on the server and in the browser (India time).
const TZ = "Asia/Kolkata";
export const fmtDay = (x: unknown) => (x ? new Date(String(x)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : "");
export const fmtWhen = (x: unknown) => (x ? new Date(String(x)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ }) : "");
