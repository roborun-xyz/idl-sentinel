"use client";

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white/50 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/50">
      <div className="page-container py-6">
        <div className="text-center text-sm text-slate-600 dark:text-slate-400">
          © {new Date().getFullYear()} IDL Sentinel. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
