import { browser } from "$app/environment";

const STORAGE_KEY = "sf_api_key";
const API_URL_KEY = "sf_api_url";

function loadFromStorage(key: string): string {
  if (!browser) return "";
  return localStorage.getItem(key) ?? "";
}

export function getApiKey(): string {
  return loadFromStorage(STORAGE_KEY);
}

export function setApiKey(key: string): void {
  if (browser) localStorage.setItem(STORAGE_KEY, key);
}

export function clearApiKey(): void {
  if (browser) localStorage.removeItem(STORAGE_KEY);
}

export function getApiUrl(): string {
  const stored = loadFromStorage(API_URL_KEY);
  if (stored) return stored;
  if (browser) return window.location.origin.replace(":5173", ":3000");
  return "http://localhost:3000";
}

export function setApiUrl(url: string): void {
  if (browser) localStorage.setItem(API_URL_KEY, url);
}

export function isAuthenticated(): boolean {
  return getApiKey().length > 0;
}
