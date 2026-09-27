import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Cart } from "@da2/shared";
import { api, del, patch, post } from "../lib/api";

export const useCart = () => useQuery({ queryKey: ["cart"], queryFn: () => api<Cart>("/cart") });

/** Every cart endpoint returns the updated cart, so we write it straight into the query cache. */
function useCartMutation<V>(fn: (v: V) => Promise<Cart>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (cart) => qc.setQueryData(["cart"], cart) });
}

export const useAddToCart = () => useCartMutation((v: { sku: string; qty?: number }) => post<Cart>("/cart/items", v));
export const useSetQty = () => useCartMutation((v: { sku: string; qty: number }) => patch<Cart>(`/cart/items/${encodeURIComponent(v.sku)}`, { qty: v.qty }));
export const useRemoveLine = () => useCartMutation((sku: string) => del<Cart>(`/cart/items/${encodeURIComponent(sku)}`));
