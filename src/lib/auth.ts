import { NextRequest } from "next/server";
import { getApps, getApp, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function getAdminAuth() {
  let app;
  if (getApps().length > 0) {
    app = getApp();
  } else {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (projectId && clientEmail && privateKey) {
      app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
    } else {
      app = initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "hermesco-7080d" });
    }
  }
  return getAuth(app);
}

/**
 * Verify Firebase ID token from Authorization: Bearer <token> header.
 * Returns decoded token on success. Throws on failure.
 */
export async function verifyAuth(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }
  const token = authHeader.slice(7);
  const adminAuth = getAdminAuth();
  const decoded = await adminAuth.verifyIdToken(token);
  return decoded;
}

/**
 * Admin UIDs with elevated privileges.
 */
export const ADMIN_UIDS = [
  "kC0sgkjA0KdGKy4MV48AXjnZeCi1", // Joe
];

export function isAdmin(uid: string): boolean {
  return ADMIN_UIDS.includes(uid);
}
