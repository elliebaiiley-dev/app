// Minimal fetch wrapper around the FastAPI backend.
import { storage } from "@/src/utils/storage";

export const TOKEN_KEY = "petadmin.token";
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";

async function authHeaders(): Promise<Record<string, string>> {
  const token = await storage.secureGet(TOKEN_KEY, "");
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

export async function getToken(): Promise<string | null> {
  const t = await storage.secureGet(TOKEN_KEY, "");
  return t && typeof t === "string" ? t : null;
}

export async function apiFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${BACKEND_URL}/api${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
    ...(await authHeaders()),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : "Request failed");
  }
  return data as T;
}

export async function fileUrl(path: string): Promise<string> {
  const token = await getToken();
  return `${BACKEND_URL}/api/files/${path}?token=${encodeURIComponent(token ?? "")}`;
}

export async function uploadFile(uri: string, name: string, type: string): Promise<{ path: string }> {
  const token = await getToken();
  const form = new FormData();
  if (typeof window !== "undefined" && (window as any).fetch) {
    try {
      const blob = await (await fetch(uri)).blob();
      form.append("file", blob, name);
    } catch {
      // Fall through to native shape
      form.append("file", { uri, name, type } as any);
    }
  } else {
    form.append("file", { uri, name, type } as any);
  }
  const res = await fetch(`${BACKEND_URL}/api/upload`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  return res.json();
}
