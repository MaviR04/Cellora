// Response shapes of the catalog API, shared by the API and the React app.
import type { ProductKind } from "./products";

export interface ProductCard {
  _id: string;
  slug: string;
  name: string;
  brand: string;
  kind: ProductKind;
  basePrice: number;
  inStock: boolean;
}

export interface Variant {
  sku: string;
  label: string;
  attributes?: Record<string, string | number>;
  price: number;
  stock: number;
}

/** Full product document. Kind-specific fields vary, so they are typed loosely. */
export interface ProductDetail extends Omit<ProductCard, "inStock"> {
  description: string;
  tags: string[];
  variants: Variant[];
  [attribute: string]: unknown;
}

export interface ProductList {
  items: ProductCard[];
  total: number;
  page: number;
  pages: number;
}

export interface CategorySummary {
  kind: ProductKind;
  count: number;
  fromPrice: number;
}

export interface Facets {
  brands: { brand: string; count: number }[];
  price: { min: number; max: number };
}

export interface RelatedGroups {
  groups: { title: string; items: ProductCard[] }[];
}

export interface CartLine {
  sku: string;
  qty: number;
  productId: string;
  slug: string;
  name: string;
  brand: string;
  kind: ProductKind;
  variantLabel: string;
  unitPrice: number;
  stock: number;
  lineTotal: number;
  /** false when the SKU no longer exists or stock has dropped below the quantity. */
  available: boolean;
}

export interface Cart {
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
}

export interface OrderItem {
  productId: string;
  sku: string;
  kind: ProductKind;
  name: string;
  brand: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}

export interface Order {
  _id: string;
  orderNumber: string;
  customerId: string | null;
  contact: { name: string; email: string; phone?: string };
  items: OrderItem[];
  totals: { subtotal: number; shipping: number; total: number };
  shippingAddress: { line1: string; line2?: string; city: string; postcode?: string; country: string };
  payment: { method: "cod" | "card"; status: "pending" | "paid" };
  status: "placed" | "paid" | "shipped" | "delivered" | "cancelled";
  statusHistory: { status: string; at: string }[];
  createdAt: string;
}

export type OrderSummary = Pick<Order, "_id" | "orderNumber" | "createdAt" | "status" | "totals"> & {
  items: Pick<OrderItem, "name" | "qty">[];
};
