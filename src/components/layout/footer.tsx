"use client";

import { RepositoryLink } from "./repository-link";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/50">
      <div className="page-container py-6">
        <div className="flex flex-col items-center justify-between gap-3 text-center text-sm text-slate-600 dark:text-slate-400 sm:flex-row">
          <span>© {new Date().getFullYear()} IDL Sentinel. All rights reserved.</span>
          <RepositoryLink className="inline-flex items-center gap-2 underline-offset-4 transition-colors hover:text-foreground hover:underline">
            GitHub
          </RepositoryLink>
        </div>
      </div>
    </footer>
  );
}
