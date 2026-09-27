// PII masking for the Support role (data minimisation). Support agents can find and help a
// customer without seeing their full contact details; Admin sees everything.
// Masking happens in the API response, so the unmasked value never reaches a support browser.
import type { Role } from "@da2/shared";

/** "saman.perera@gmail.com" -> "s***a@gmail.com" */
export function maskEmail(email: string | null | undefined) {
  if (!email) return email ?? null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local[0]}***${local.length > 1 ? local.at(-1) : ""}@${domain}`;
}

/** "+94 77 123 4567" -> "••• ••• 4567" */
export function maskPhone(phone: string | null | undefined) {
  if (!phone) return phone ?? null;
  const digits = phone.replace(/\D/g, "");
  return `••• ••• ${digits.slice(-4)}`;
}

/** Keeps city and country (useful for delivery questions), hides the street and postcode. */
export function maskAddress<A extends { line1?: string | null; line2?: string | null; postcode?: string | null }>(a: A | null | undefined) {
  if (!a) return a ?? null;
  return { ...a, line1: a.line1 ? "••••••" : a.line1, line2: a.line2 ? "••••••" : a.line2, postcode: a.postcode ? "•••••" : a.postcode };
}

export const shouldMask = (role: Role) => role !== "admin";

/** Masks the contact and address of an order (or order summary) for non-admin staff. */
export function maskOrder<O extends Record<string, any>>(order: O, role: Role): O {
  if (!shouldMask(role)) return order;
  return {
    ...order,
    ...(order.contact && { contact: { ...order.contact, email: maskEmail(order.contact.email), phone: maskPhone(order.contact.phone) } }),
    ...(order.guestEmail && { guestEmail: maskEmail(order.guestEmail) }),
    ...(order.shippingAddress && { shippingAddress: maskAddress(order.shippingAddress) }),
  };
}
