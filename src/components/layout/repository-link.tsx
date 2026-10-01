import type { ComponentPropsWithoutRef } from "react";
import { CodeXml } from "lucide-react";

type RepositoryLinkProps = Pick<
  ComponentPropsWithoutRef<"a">,
  "className" | "children" | "onClick"
>;

export function RepositoryLink({ className, children = "GitHub", onClick }: RepositoryLinkProps) {
  return (
    <a
      href="https://github.com/roborun-xyz/idl-sentinel"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="IDL Sentinel source code on GitHub (opens in a new tab)"
      title="View source code on GitHub"
      className={className}
      onClick={onClick}
    >
      <CodeXml className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </a>
  );
}
