import { NextResponse, type NextRequest } from "next/server";

/**
 * Vérification « optimiste » : redirige vers la connexion en l'absence de cookie
 * de session. La vérification réelle (session valide en base) est faite côté
 * serveur par requireUser() dans chaque page et chaque action.
 */
const PUBLIC_PATHS = ["/connexion", "/inscription"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !req.cookies.has("lea_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|vendor/|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
