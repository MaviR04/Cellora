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
