// Display helpers shared by the pages. Pure functions, safe on client and server.

const DATE_OPTIONS = { day: "numeric", month: "short", year: "numeric" };
const DATE_TIME_OPTIONS = { ...DATE_OPTIONS, hour: "2-digit", minute: "2-digit" };

// "2026-10-23" -> "23 Oct 2026". "-" when empty; the raw value when it isn't a date.
export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", DATE_OPTIONS);
}

// A timestamp as "23 Oct 2026, 04:30 pm" in Indian format. "-" when empty.
export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", DATE_TIME_OPTIONS);
}

// "male" -> "Male". "-" when empty.
export function capitalize(value) {
  if (!value) return "-";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// "Asha Rao" -> "AR". Used for the avatar placeholder.
export function getInitials(name) {
  if (!name) return "";
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
