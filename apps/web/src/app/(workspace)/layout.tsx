import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ADMIN_EMAIL, SESSION_COOKIE_NAME, verifyAdminSessionValue } from "@/lib/auth";

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!verifyAdminSessionValue(sessionValue)) {
    redirect("/");
  }

  return <WorkspaceShell accountEmail={ADMIN_EMAIL}>{children}</WorkspaceShell>;
}
