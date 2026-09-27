import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { STAFF_ROLES, type Role } from "@da2/shared";
import { useLogin, useSignup, type Me } from "../hooks/useAuth";

const DEMO_ACCOUNTS: { email: string; role: Role }[] = [
  { email: "customer@cellora.test", role: "customer" },
  { email: "analyst@cellora.test", role: "analyst" },
  { email: "support@cellora.test", role: "support" },
  { email: "admin@cellora.test", role: "admin" },
];

/** After login: go back where the user came from, or to the staff area for staff. */
function useRedirect() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (user: Me) => navigate(params.get("next") ?? (STAFF_ROLES.includes(user.role) ? "/staff" : "/"));
}

export function LoginPage() {
  const login = useLogin();
  const redirect = useRedirect();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <AuthCard title="Log in" footer={<>New here? <Link to="/signup" className="font-medium text-accent-600 hover:underline">Create an account</Link></>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password }, { onSuccess: (r) => redirect((r as { user: Me }).user) });
        }}
      >
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" />
        <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {login.error && <p className="text-sm text-rose-600">{login.error.message}</p>}
        <SubmitButton pending={login.isPending}>Log in</SubmitButton>
      </form>
      <div className="mt-6 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
        <p className="mb-2 font-semibold text-slate-600">Demo accounts (password: SEED_USER_PASSWORD in .env)</p>
        <div className="flex flex-wrap gap-1.5">
          {DEMO_ACCOUNTS.map((a) => (
            <button key={a.email} type="button" onClick={() => setEmail(a.email)} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 hover:border-accent-500">
              {a.role}
            </button>
          ))}
        </div>
      </div>
    </AuthCard>
  );
}

export function SignupPage() {
  const signup = useSignup();
  const redirect = useRedirect();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <AuthCard title="Create an account" footer={<>Already have an account? <Link to="/login" className="font-medium text-accent-600 hover:underline">Log in</Link></>}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate({ name, email, password }, { onSuccess: (r) => redirect((r as { user: Me }).user) });
        }}
      >
        <Field label="Name" value={name} onChange={setName} autoComplete="name" />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Field label="Password (8+ characters)" type="password" value={password} onChange={setPassword} autoComplete="new-password" />
        {signup.error && <p className="text-sm text-rose-600">{signup.error.message}</p>}
        <SubmitButton pending={signup.isPending}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}

function AuthCard({ title, children, footer }: { title: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-sm py-10">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-extrabold">{title}</h1>
        {children}
      </div>
      <p className="mt-4 text-center text-sm text-slate-500">{footer}</p>
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; type?: string; autoComplete?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {props.label}
      <input
        required
        type={props.type ?? "text"}
        value={props.value}
        autoComplete={props.autoComplete}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-xl border border-slate-200 px-3 py-2.5 font-normal outline-none focus:border-accent-500"
      />
    </label>
  );
}

function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button disabled={pending} className="mt-2 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
      {pending ? "Please wait…" : children}
    </button>
  );
}
