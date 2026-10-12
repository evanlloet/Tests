import { redirect } from "next/navigation";
import { BuddyCrowd } from "@/components/buddy";
import { getCurrentUser } from "@/server/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-8 px-5 py-8 lg:grid-cols-2">
      <div>
        <p className="font-display text-xl font-extrabold">Léa</p>
        <h1 className="mt-4 text-5xl leading-[1.02] font-extrabold sm:text-6xl">
          Des tournées
          <br />
          plus légères,
          <br />
          des journées
          <br />
          qui sourient.
        </h1>
        <p className="mt-4 max-w-sm text-muted">Votre assistante pour les visites en pharmacie : historique, échéances, planning et tournées.</p>
        <BuddyCrowd className="mt-6 hidden h-80 w-full max-w-md lg:block" />
      </div>
      <div className="w-full max-w-md lg:justify-self-end">{children}</div>
    </main>
  );
}
