"use client";
import { Light as SyntaxHighlighter } from "react-syntax-highlighter";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import { github } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { useQuery } from "@tanstack/react-query";
import { snapshotQuery } from "@/hooks/use-programs";

SyntaxHighlighter.registerLanguage("json", json);
export default function SnapshotJson({
  programId,
  snapshotId,
}: {
  programId: string;
  snapshotId: string;
}) {
  const { data, isLoading, isError } = useQuery(snapshotQuery(programId, snapshotId));
  if (isLoading) return <p>Loading IDL…</p>;
  if (isError) return <p role="alert">Unable to load this snapshot.</p>;
  return (
    <SyntaxHighlighter
      language="json"
      style={github}
      showLineNumbers
      customStyle={{ margin: 0, fontSize: "12px" }}
    >
      {JSON.stringify(data?.snapshot.idl_content, null, 2)}
    </SyntaxHighlighter>
  );
}
