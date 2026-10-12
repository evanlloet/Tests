import { BottomNav, SidebarNav } from "@/components/app-nav";
import { requireUser } from "@/server/auth/session";
import { countPendingMatches } from "@/server/repositories/matches";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const pending = await countPendingMatches(user.id);
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-surface lg:block">
        <SidebarNav pendingMatches={pending} displayName={user.displayName} />
      </aside>
      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      <BottomNav />
    </div>
  );
}
