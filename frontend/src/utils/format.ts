import dayjs from "dayjs";

export const CURRENCY = "£";

export function money(amount: number | string | null | undefined): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount ?? 0;
  if (Number.isNaN(n as number)) return `${CURRENCY}0.00`;
  return `${CURRENCY}${(n as number).toFixed(2)}`;
}

export function formatTime(iso: string): string {
  if (!iso) return "";
  return dayjs(iso).format("HH:mm");
}

export function formatDate(iso: string): string {
  if (!iso) return "";
  return dayjs(iso).format("ddd, D MMM");
}

export function formatDateFull(iso: string): string {
  if (!iso) return "";
  return dayjs(iso).format("ddd, D MMM YYYY");
}

export function formatDateTime(iso: string): string {
  if (!iso) return "";
  return dayjs(iso).format("D MMM • HH:mm");
}

export function ageFromDob(dob?: string): string {
  if (!dob) return "—";
  const d = dayjs(dob);
  if (!d.isValid()) return "—";
  const years = dayjs().diff(d, "year");
  if (years < 1) {
    const months = dayjs().diff(d, "month");
    return `${months} mo`;
  }
  return `${years} yr`;
}

export function statusColor(status: string, colors: any): string {
  switch (status) {
    case "completed":
      return colors.success;
    case "cancelled":
      return colors.muted;
    case "no_show":
      return colors.error;
    case "confirmed":
    default:
      return colors.brandPrimary;
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "no_show":
      return "No-show";
    case "confirmed":
      return "Confirmed";
    default:
      return status;
  }
}
