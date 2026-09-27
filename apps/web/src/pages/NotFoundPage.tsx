import { Link } from "react-router";

export function NotFoundPage({ message = "We couldn't find that page." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-3xl font-extrabold">Not found</h1>
      <p className="text-slate-500">{message}</p>
      <Link to="/" className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white">
        Back to the store
      </Link>
    </div>
  );
}
