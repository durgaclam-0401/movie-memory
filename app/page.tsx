import { redirect } from "next/navigation";
import { getSessionUser, signIn } from "@/lib/auth";

// AUTH-1: landing page when logged out; signed-in users go to the dashboard.
export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <section className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
      <h1 className="text-3xl font-bold tracking-tight">Movie Memory</h1>
      <p className="mt-3 text-slate-600">
        Tell us your favorite movie and we&apos;ll dig up a fun fact about it.
      </p>
      <form action={signInWithGoogle} className="mt-8">
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-5 py-2.5 font-medium text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          Sign in with Google
        </button>
      </form>
    </section>
  );
}
