import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { STAFF_ROLES, type Role } from "@da2/shared";
import { api, post } from "../lib/api";

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function useMe() {
  const q = useQuery({ queryKey: ["me"], queryFn: () => api<{ user: Me | null }>("/auth/me").then((r) => r.user) });
  const user = q.data ?? null;
  return { user, isLoading: q.isLoading, isStaff: !!user && STAFF_ROLES.includes(user.role) };
}

/** Login/signup/logout all change who we are AND which cart we see, so refresh both. */
function useAuthMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });
}

export const useLogin = () => useAuthMutation((v: { email: string; password: string }) => post("/auth/login", v));
export const useSignup = () => useAuthMutation((v: { name: string; email: string; password: string }) => post("/auth/signup", v));
export const useLogout = () => useAuthMutation(() => post("/auth/logout"));
