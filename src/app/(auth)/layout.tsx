import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-fg shadow-card">
          L
        </div>
        <p className="text-2xl font-semibold tracking-tight">Léa</p>
        <p className="mt-1 text-sm text-muted">Votre assistante de tournée</p>
      </div>
      {children}
    </main>
  );
}
