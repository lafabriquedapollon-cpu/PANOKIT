/** J07 D1: pure contact admission, not order acceptance or phone ownership proof.
 * The fulfillment mode MUST originate in the trusted, revalidated server quote.
 * No I/O, persistence, logging, marketing consent or public route. */
export type GuestMode = "pickup" | "delivery";
export type GuestField = "name" | "phone" | "email" | "city" | "address";
export type GuestContact = Readonly<{
  name: string;
  phone: string;
  email?: string;
  delivery?: Readonly<{city: string; address: string}>;
}>;
export type GuestContactResult =
  | Readonly<{status: "valid"; contact: GuestContact}>
  | Readonly<{status: "invalid"; fields: readonly GuestField[]; reason: "invalid_shape" | "invalid_fields"}>;
const invalidShape = (): GuestContactResult => ({status: "invalid", fields: [], reason: "invalid_shape"});
const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const forbidden = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
function line(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length > max || forbidden.test(v)) return null;
  const normalized = v.normalize("NFC").trim().replace(/\p{Zs}+/gu, " ");
  return normalized.length > 0 && normalized.length <= max ? normalized : null;
}
function phone(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 40 || forbidden.test(v)) return null;
  const digits = v.normalize("NFKC").replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x6f0)).trim().replace(/[ .()-]/g, "");
  // V1 Morocco default for a domestic fixed/mobile number; explicit international prefix supported.
  const canonical = /^0[5-7][0-9]{8}$/.test(digits) ? "+212" + digits.slice(1)
    : digits.startsWith("00") ? "+" + digits.slice(2) : digits;
  return /^\+[1-9][0-9]{7,14}$/.test(canonical) ? canonical : null;
}
function email(v: unknown): string | null {
  const s = line(v, 254);
  if (!s || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(s)) return null;
  const [local, domain] = s.split("@");
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
      domain.split(".").some(part => part.length > 63 || part.startsWith("-") || part.endsWith("-"))) return null;
  return local + "@" + domain.toLowerCase();
}
export function validateGuestContact(input: unknown, trustedMode: GuestMode): GuestContactResult {
  if (!plain(input) || (trustedMode !== "pickup" && trustedMode !== "delivery")) return invalidShape();
  const allowed = trustedMode === "delivery" ? ["name", "phone", "email", "city", "address"] : ["name", "phone", "email"];
  if (Reflect.ownKeys(input).some(k => typeof k !== "string" || !allowed.includes(k) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(input, k) ?? {}, "value"))) return invalidShape();
  const fields: GuestField[] = [];
  const name = Object.hasOwn(input, "name") ? line(input.name, 120) : null;
  const tel = Object.hasOwn(input, "phone") ? phone(input.phone) : null;
  if (!name || !/\p{L}/u.test(name) || /[<>]/.test(name)) fields.push("name");
  if (!tel) fields.push("phone");
  let mail: string | undefined;
  if (Object.hasOwn(input, "email") && input.email !== "") {
    const parsed = email(input.email);
    if (!parsed) fields.push("email"); else mail = parsed;
  }
  let delivery: GuestContact["delivery"];
  if (trustedMode === "delivery") {
    const city = Object.hasOwn(input, "city") ? line(input.city, 100) : null;
    const address = Object.hasOwn(input, "address") ? line(input.address, 300) : null;
    if (!city || !/\p{L}/u.test(city) || /[<>]/.test(city)) fields.push("city");
    if (!address || !/[\p{L}\p{N}]/u.test(address) || /[<>]/.test(address)) fields.push("address");
    if (city && address) delivery = Object.freeze({city, address});
  }
  if (fields.length || !name || !tel) return {status: "invalid", reason: "invalid_fields", fields};
  return {status: "valid", contact: Object.freeze({name, phone: tel, ...(mail ? {email: mail} : {}), ...(delivery ? {delivery} : {})})};
}
