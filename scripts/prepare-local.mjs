import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(root, ".env");
let source = readFileSync(
  existsSync(path) ? path : resolve(root, ".env.example"),
  "utf8",
);
// Carry forward only booking integration settings; database/auth settings belong to Compose.
const legacyBooking = resolve(root, "bms-booking-service", ".env");
if (existsSync(legacyBooking)) {
  const legacy = readFileSync(legacyBooking, "utf8");
  for (const name of [
    "BMS_WELINC_BOOKING_WEBHOOK_SECRET",
    "BMS_WELINC_WEBHOOK_API_KEY",
    "GOOGLE_MAPS_API_KEY",
    "GOOGLE_GEOCODING_API_KEY",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "CUSTOMER_SUPPORT_EMAIL",
    "CUSTOMER_SUPPORT_PHONE",
  ]) {
    const pattern = new RegExp(`^${name}=(.*)$`, "m");
    const current = source.match(pattern);
    const previous = legacy.match(pattern);
    if (current?.[1].trim() || !previous?.[1].trim()) continue;
    source = current
      ? source.replace(pattern, () => previous[0])
      : source.replace(/\s*$/, "\n") + previous[0] + "\n";
  }
}
for (const name of ["BMS_INTERNAL_SERVICE_KEY", "CUSTOMER_TRACKING_SECRET"]) {
  const pattern = new RegExp(`^${name}=(.*)$`, "m");
  const match = source.match(pattern);
  if (match && match[1].trim() && match[1].trim() !== '""') continue;
  const line = `${name}=${randomBytes(32).toString("base64url")}`;
  source = match
    ? source.replace(pattern, () => line)
    : source.replace(/\s*$/, "\n") + line + "\n";
}
writeFileSync(path, source, { mode: 0o600 });
console.log(
  "BMS environment prepared; existing nonempty secret values retained.",
);
