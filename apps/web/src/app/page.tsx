import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SignInPage } from "@/components/sign-in-page";
import { SESSION_COOKIE_NAME, verifyAdminSessionValue } from "@/lib/auth";

export default async function Page() {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (verifyAdminSessionValue(sessionValue)) {
    redirect("/dashboard");
  }

  return <SignInPage />;
}
