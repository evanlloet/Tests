import type { Metadata } from "next";
import { SignupForm } from "@/components/auth-forms";

export const metadata: Metadata = { title: "Créer un compte" };

export default function SignupPage() {
  return <SignupForm enabled={process.env.ALLOW_SIGNUP === "true"} />;
}
