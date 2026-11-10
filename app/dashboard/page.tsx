import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { displayName, initials } from "@/lib/display";
import { signOutAction } from "./actions";

export default async function DashboardPage() {
  const user = await requireUser(); // AUTH-4
  if (!user.favoriteMovie) redirect("/onboarding"); // DASH-4

  const name = displayName(user);

  return (
    <div className="space-y-6">
      <section className="flex items-center gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        {user.image ? (
          // Plain <img>: one avatar doesn't justify next/image remote config.
          // no-referrer is required by Google's image host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-200 text-lg font-semibold text-slate-700"
          >
            {initials(name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{name}</p>
          {user.email && <p className="truncate text-sm text-slate-600">{user.email}</p>}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
          >
            Log out
          </button>
        </form>
      </section>

      <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Favorite movie
        </p>
        <p className="mt-1 text-2xl font-bold">{user.favoriteMovie}</p>
      </section>
    </div>
  );
}
