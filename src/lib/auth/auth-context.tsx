"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { createSignInMessage } from "./message";

interface Session {
  walletAddress: string;
  userId: string;
  isAdmin: boolean;
}
interface AuthContextType {
  isAuthenticated: boolean;
  walletAddress: string | null;
  userId: string | null;
  isAdmin: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  isLoading: boolean;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { publicKey, signMessage, disconnect, connected } = useWallet();
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const generation = useRef("");
  const [checkedWallet, setCheckedWallet] = useState<string | null | undefined>(undefined);
  const wallet = publicKey?.toBase58() || null;
  const previousWallet = useRef<string | null>(null);

  const clearPrivateCache = useCallback(() => {
    // Cancel first so an in-flight response cannot repopulate a signed-out cache.
    const filters = {
      predicate: (q: { queryKey: readonly unknown[] }) =>
        ["user", "watchlist", "programs"].includes(String(q.queryKey[0])),
    };
    void queryClient.cancelQueries(filters);
    queryClient.removeQueries(filters);
  }, [queryClient]);

  const readSession = useCallback(
    async (expectedWallet: string | null, requestGeneration: string) => {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const next: Session | null =
        response.ok && response.status !== 204 ? await response.json() : null;
      if (generation.current !== requestGeneration) return;
      if (next && expectedWallet && next.walletAddress !== expectedWallet) {
        await fetch("/api/auth/signout", { method: "POST" });
        if (generation.current !== requestGeneration) return;
        clearPrivateCache();
        setSession(null);
      } else {
        setSession(next);
      }
    },
    [clearPrivateCache]
  );

  useEffect(() => {
    const requestGeneration = crypto.randomUUID();
    generation.current = requestGeneration;
    const changed = previousWallet.current !== null && previousWallet.current !== wallet;
    previousWallet.current = wallet;
    if (changed) clearPrivateCache();
    void (async () => {
      try {
        if (changed && !connected) await fetch("/api/auth/signout", { method: "POST" });
        await readSession(wallet, requestGeneration);
      } catch {
        if (generation.current === requestGeneration) setSession(null);
      } finally {
        if (generation.current === requestGeneration) {
          setIsLoading(false);
          setCheckedWallet(wallet);
        }
      }
    })();
    return () => {
      generation.current = crypto.randomUUID();
    };
  }, [wallet, connected, readSession, clearPrivateCache]);

  const signIn = useCallback(async () => {
    if (!publicKey || !signMessage) throw new Error("Wallet not connected");
    const currentWallet = publicKey.toBase58();
    const requestGeneration = crypto.randomUUID();
    generation.current = requestGeneration;
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/nonce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: currentWallet }),
      });
      if (!response.ok) throw new Error("Failed to get nonce");
      const { nonce } = await response.json();
      const message = createSignInMessage(nonce);
      const signature = await signMessage(new TextEncoder().encode(message));
      if (requestGeneration !== generation.current) return;
      const verified = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: currentWallet,
          message,
          signature: bs58.encode(signature),
        }),
      });
      if (!verified.ok) throw new Error("Failed to verify signature");
      clearPrivateCache();
      await readSession(currentWallet, requestGeneration);
    } finally {
      if (generation.current === requestGeneration) setIsLoading(false);
    }
  }, [publicKey, signMessage, clearPrivateCache, readSession]);

  const signOut = useCallback(async () => {
    generation.current = crypto.randomUUID();
    setSession(null);
    clearPrivateCache();
    const response = await fetch("/api/auth/signout", { method: "POST" });
    if (!response.ok) throw new Error("Failed to sign out");
    await disconnect();
  }, [clearPrivateCache, disconnect]);

  // Never expose the previous account while a connected wallet is changing.
  const visibleSession = wallet && session?.walletAddress !== wallet ? null : session;
  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: !!visibleSession,
        walletAddress: visibleSession?.walletAddress || null,
        userId: visibleSession?.userId || null,
        isAdmin: visibleSession?.isAdmin || false,
        isLoading: isLoading || checkedWallet !== wallet,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within an AuthProvider");
  return value;
}
