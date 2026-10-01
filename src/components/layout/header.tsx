"use client";

import { useState, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, Blocks, Bell, Loader2, Menu, X } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "@/lib/auth/auth-context";
import { useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { RepositoryLink } from "./repository-link";

const navigation = [
  { name: "Programs", href: "/programs", icon: Blocks },
  { name: "Changes", href: "/changes", icon: Bell },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b bg-background">
      <div className="page-container">
        <div className="flex h-16 items-center justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-1 sm:gap-2 md:gap-8">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 md:hidden"
              aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link href="/" className="min-w-0">
              <span className="block truncate text-sm font-semibold sm:text-lg">IDL Sentinel</span>
            </Link>

            <nav className="hidden shrink-0 items-center space-x-1 md:flex">
              {navigation.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className="flex items-center space-x-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-4">
            <RepositoryLink className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              {null}
            </RepositoryLink>
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="border-t py-4 md:hidden">
            <nav id="mobile-navigation" className="flex flex-col space-y-2">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center space-x-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}

const subscribeHydration = () => () => {};

function WalletButton() {
  const { publicKey, connected, disconnect } = useWallet();
  const { isAuthenticated, signIn, isLoading } = useAuth();
  const mounted = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false
  );
  const attemptedWallet = useRef<string | null>(null);
  const walletAddress = publicKey?.toBase58() || null;

  useEffect(() => {
    if (!connected) {
      attemptedWallet.current = null;
      return;
    }
    if (
      !mounted ||
      !walletAddress ||
      isAuthenticated ||
      isLoading ||
      attemptedWallet.current === walletAddress
    )
      return;
    attemptedWallet.current = walletAddress;
    void signIn().catch(() => disconnect());
  }, [connected, mounted, walletAddress, isAuthenticated, isLoading, signIn, disconnect]);

  if (!mounted) return <div className="h-10 w-[140px] animate-pulse rounded-md bg-muted/50" />;
  if (connected && !isAuthenticated && isLoading) {
    return (
      <Button disabled size="sm">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Signing in…
      </Button>
    );
  }
  return (
    <div className="wallet-button-small">
      <WalletMultiButton />
    </div>
  );
}
