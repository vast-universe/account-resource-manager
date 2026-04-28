import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE,
  createAdminSessionValue,
  isValidAdminCredentials,
} from "@/lib/auth";

type LoginRequestBody = {
  email?: string;
  password?: string;
  rememberMe?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LoginRequestBody | null;
  const email = body?.email?.trim() || "";
  const password = body?.password || "";
  const rememberMe = body?.rememberMe ?? true;

  if (!email || !password) {
    return NextResponse.json({ message: "请输入邮箱和密码" }, { status: 400 });
  }

  if (!isValidAdminCredentials(email, password)) {
    return NextResponse.json({ message: "账号或密码错误" }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    redirectTo: "/dashboard",
  });

  response.cookies.set(SESSION_COOKIE_NAME, createAdminSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(rememberMe ? { maxAge: SESSION_MAX_AGE } : {}),
  });

  return response;
}
