"use client";

import { Header } from "./header";
import { Footer } from "./footer";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="page-container flex-1 py-6 sm:py-8 lg:py-12">{children}</main>
      <Footer />
    </div>
  );
}
