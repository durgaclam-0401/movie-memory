import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingForm } from "./OnboardingForm";

export default async function OnboardingPage() {
  const user = await requireUser(); // AUTH-4
  if (user.favoriteMovie) redirect("/dashboard"); // ONB-5

  return (
    <section className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-slate-200">
      <h1 className="text-2xl font-bold tracking-tight">Welcome!</h1>
      <p className="mt-2 text-slate-600">One quick question before we start.</p>
      <OnboardingForm />
    </section>
  );
}
