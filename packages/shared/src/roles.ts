export const ROLES = ["customer", "analyst", "support", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: readonly Role[] = ["analyst", "support", "admin"];
