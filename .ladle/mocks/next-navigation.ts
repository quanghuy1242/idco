import { useSyncExternalStore } from "react";

const BASE_URL = "https://id.example.test";

type Listener = () => void;
type NavigateMode = "push" | "replace";

let mockPathname = "/admin";
let mockSearchParams = new URLSearchParams();
let mockHash = "";
const listeners = new Set<Listener>();

function emitNavigation() {
  for (const listener of listeners) listener();
}

function setMockUrl(href: string) {
  const url = new URL(href, BASE_URL);
  mockPathname = url.pathname;
  mockSearchParams = new URLSearchParams(url.searchParams);
  mockHash = url.hash;
  return url;
}

function snapshot() {
  const search = mockSearchParams.toString();
  return `${mockPathname}${search ? `?${search}` : ""}${mockHash}`;
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function writeBrowserUrl(url: URL, mode: NavigateMode) {
  if (typeof window === "undefined") return;
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") window.history.replaceState({}, "", next);
  else window.history.pushState({}, "", next);
}

export function navigateMock(href: string, mode: NavigateMode = "push") {
  const url = setMockUrl(href);
  writeBrowserUrl(url, mode);
  emitNavigation();
}

export function getMockPathname() {
  return mockPathname;
}

const mockRouter = {
  push(href: string) { navigateMock(href, "push"); },
  replace(href: string) { navigateMock(href, "replace"); },
  refresh() {},
  back() {},
  forward() {},
  prefetch(_href: string) { return Promise.resolve(); },
};

export function setMockPathname(pathname: string) {
  setMockUrl(pathname);
}

export function usePathname() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return new URL(current, BASE_URL).pathname;
}

export function useSearchParams() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  return new URL(current, BASE_URL).searchParams;
}

export function useRouter() {
  return mockRouter;
}
