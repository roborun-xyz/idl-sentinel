"use client";
import { useChangeDetails } from "@/hooks/use-changes";
import { ChangeDetails } from "./change-details";
export default function LazyChangeDetails({ id }: { id: string }) {
  const { data, isLoading, isError } = useChangeDetails(id);
  if (isLoading) return <p>Loading details…</p>;
  if (isError) return <p role="alert">Unable to load change details.</p>;
  return data ? <ChangeDetails details={data.details} /> : null;
}
