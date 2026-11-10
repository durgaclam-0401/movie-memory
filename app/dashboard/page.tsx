import { requireUser } from "@/lib/auth";
import { signOutAction } from "./actions";

export default async function DashboardPage() {
  const user = await requireUser(); // AUTH-4

  return (
    <section className="flex items-center justify-between rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p>Signed in as {user.email}</p>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
        >
          Log out
        </button>
      </form>
    </section>
  );
}
