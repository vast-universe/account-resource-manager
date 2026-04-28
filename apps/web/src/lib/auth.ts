import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function readOptionalValue(name: string, localFallback: string) {
  return process.env[name]?.trim() || localFallback;
}

function readRuntimeValue(name: string, localFallback: string) {
  const value = process.env[name]?.trim();

  if (value) {
    return value;
  }

  if (IS_PRODUCTION) {
    throw new Error(`${name} must be configured in production.`);
  }

  return localFallback;
}

function getAdminEmail() {
  return readRuntimeValue("ARM_ADMIN_EMAIL", "admin@localhost").toLowerCase();
}

function getAdminPassword() {
  return readRuntimeValue("ARM_ADMIN_PASSWORD", "change-me");
}

function getSessionSecret() {
  return readRuntimeValue("ARM_SESSION_SECRET", "dev-session-secret-change-me");
}

export const ADMIN_EMAIL = readOptionalValue("ARM_ADMIN_EMAIL", "admin@localhost").toLowerCase();
export const SESSION_COOKIE_NAME = "arm-admin-session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

type SessionPayload = {
  email: string;
  role: "admin";
};

function signSessionPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isValidAdminCredentials(email: string, password: string) {
  return normalizeEmail(email) === getAdminEmail() && password === getAdminPassword();
}

function encodeSessionPayload(payload: SessionPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeSessionPayload(payload: string) {
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}

export function createAdminSessionValue() {
  const payload = encodeSessionPayload({
    email: getAdminEmail(),
    role: "admin",
  });
  const signature = signSessionPayload(payload);

  return `${payload}.${signature}`;
}

export function verifyAdminSessionValue(sessionValue?: string | null) {
  if (!sessionValue) {
    return false;
  }

  const separatorIndex = sessionValue.lastIndexOf(".");

  if (separatorIndex <= 0 || separatorIndex === sessionValue.length - 1) {
    return false;
  }

  const payload = sessionValue.slice(0, separatorIndex);
  const signature = sessionValue.slice(separatorIndex + 1);

  if (!payload || !signature) {
    return false;
  }

  const decodedPayload = decodeSessionPayload(payload);

  if (!decodedPayload) {
    return false;
  }

  const expectedSignature = signSessionPayload(payload);

  return (
    decodedPayload.email === getAdminEmail() &&
    decodedPayload.role === "admin" &&
    safeEqual(signature, expectedSignature)
  );
}
