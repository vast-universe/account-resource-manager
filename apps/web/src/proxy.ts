import { NextRequest, NextResponse } from "next/server";

const ADMIN_EMAIL = process.env.ARM_ADMIN_EMAIL?.trim().toLowerCase() || "admin@aries.local";
const SESSION_COOKIE_NAME = "arm-admin-session";
const SESSION_SECRET = process.env.ARM_SESSION_SECRET || "arm-local-session-secret-change-me";

function base64UrlToBase64(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
}

function base64ToBase64Url(value: string) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeSessionPayload(payload: string) {
  try {
    return JSON.parse(atob(base64UrlToBase64(payload))) as {
      email?: string;
      role?: string;
    };
  } catch {
    return null;
  }
}

async function signSessionPayload(payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const bytes = new Uint8Array(signature);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return base64ToBase64Url(btoa(binary));
}

async function verifyAdminSessionValue(sessionValue?: string | null) {
  if (!sessionValue) {
    return false;
  }

  const separatorIndex = sessionValue.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === sessionValue.length - 1) {
    return false;
  }

  const payload = sessionValue.slice(0, separatorIndex);
  const signature = sessionValue.slice(separatorIndex + 1);
  const decodedPayload = decodeSessionPayload(payload);
  if (!decodedPayload) {
    return false;
  }

  const expectedSignature = await signSessionPayload(payload);
  return (
    decodedPayload.email === ADMIN_EMAIL &&
    decodedPayload.role === "admin" &&
    signature === expectedSignature
  );
}

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  );
}

function isPublicApi(pathname: string) {
  return (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname.startsWith("/api/webhooks/")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicAsset(pathname) || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const sessionValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = await verifyAdminSessionValue(sessionValue);

  if (pathname === "/") {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
