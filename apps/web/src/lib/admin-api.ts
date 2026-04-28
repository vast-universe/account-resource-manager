import "server-only";

import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifyAdminSessionValue } from "@/lib/auth";

export async function hasAdminApiSession() {
  const cookieStore = await cookies();
  const sessionValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  return verifyAdminSessionValue(sessionValue);
}
