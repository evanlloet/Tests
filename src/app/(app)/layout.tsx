import { redirect } from "next/navigation";
import { AssistantFab, BottomNav, SidebarNav } from "@/components/app-nav";
import { requireUser } from "@/server/auth/session";
import { countPendingMatches } from "@/server/repositories/matches";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Parcours d'accueil d'abord : secteur, domicile, rythme, puis visite guidée
  if (!user.onboardingCompletedAt) redirect("/bienvenue");
  const pending = await countPendingMatches(user.id);
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-border/70 bg-surface lg:block">
        <SidebarNav pendingMatches={pending} displayName={user.displayName} gamification={user.gamificationEnabled} levelName={null} />
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-32 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      <AssistantFab />
      <BottomNav />
    </div>
  );
}
