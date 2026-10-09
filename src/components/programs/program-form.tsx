"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { isValidProgramId } from "@/lib/utils";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@/lib/solana/token";
import { useAuth } from "@/lib/auth/auth-context";
import { queryKeys } from "@/hooks/query-keys";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Loader2,
  Save,
  Search,
  Star,
} from "lucide-react";

const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

interface ProgramFormData {
  program_id: string;
  name: string;
  description: string;
  is_active: boolean;
}

interface ProgramFormProps {
  initialData?: Partial<ProgramFormData>;
  programId?: string;
  isEdit?: boolean;
}

type ProgramFormErrors = Partial<Record<"program_id" | "name" | "description", string>>;

interface ProgramPreview {
  already_monitored: boolean;
  idl_found: boolean;
  payment_required: boolean;
  program?: {
    id: string;
    program_id: string;
    name: string;
    description?: string | null;
  };
  idl_summary?: {
    name: string | null;
    version: string | null;
    instructions: number;
    accounts: number;
    types: number;
    errors: number;
  };
  activation_fee?: {
    amount_usdc: number;
    amount_atomic: number;
    decimals: number;
    usdc_mint: string;
  };
}

interface PaymentIntentResponse {
  payment_intent: {
    id: string;
    amount_usdc: number;
    amount_atomic: number;
    decimals: number;
    usdc_mint: string;
    treasury_token_account: string;
    payment_reference: string;
    memo: string;
    expires_at: string;
  };
}

export function ProgramForm({ initialData, programId, isEdit = false }: ProgramFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { isAdmin, isAuthenticated } = useAuth();

  const [formData, setFormData] = useState<ProgramFormData>({
    program_id: initialData?.program_id || "",
    name: initialData?.name || "",
    description: initialData?.description || "",
    is_active: initialData?.is_active ?? true,
  });
  const [errors, setErrors] = useState<ProgramFormErrors>({});
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ProgramPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [transactionSignature, setTransactionSignature] = useState<string | null>(null);

  const validateProgramId = (): boolean => {
    const newErrors: ProgramFormErrors = {};

    if (!formData.program_id.trim()) {
      newErrors.program_id = "Program ID is required";
    } else if (!isValidProgramId(formData.program_id.trim())) {
      newErrors.program_id = "Invalid Solana program ID format";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateFullForm = (): boolean => {
    const newErrors: ProgramFormErrors = {};

    if (!formData.program_id.trim()) {
      newErrors.program_id = "Program ID is required";
    } else if (!isValidProgramId(formData.program_id.trim())) {
      newErrors.program_id = "Invalid Solana program ID format";
    }

    if (!formData.name.trim()) {
      newErrors.name = "Program name is required";
    } else if (formData.name.trim().length < 3) {
      newErrors.name = "Program name must be at least 3 characters";
    }

    if (formData.description && formData.description.length > 500) {
      newErrors.description = "Description must be less than 500 characters";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const saveProgramDirectly = async () => {
    if (!validateFullForm()) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const url = isEdit ? `/api/programs/${programId}` : "/api/programs";
      const method = isEdit ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          program_id: formData.program_id.trim(),
          name: formData.name.trim(),
          description: formData.description.trim(),
          ...(isEdit && isAdmin ? { is_active: formData.is_active } : {}),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.programs }),
          queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
          ...(programId
            ? [queryClient.invalidateQueries({ queryKey: queryKeys.programDetail(programId) })]
            : []),
        ]);
        router.push("/programs");
      } else if (data.error?.includes("already exists")) {
        setErrors({ program_id: "A program with this ID is already being monitored" });
      } else {
        setMessage(data.error || "Failed to save program");
      }
    } catch (error) {
      console.error("Error saving program:", error);
      setMessage("Failed to save program");
    } finally {
      setLoading(false);
    }
  };

  const previewProgram = async () => {
    if (!validateProgramId()) {
      return;
    }

    setLoading(true);
    setPreview(null);
    setMessage(null);
    setTransactionSignature(null);

    try {
      const response = await fetch("/api/programs/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_id: formData.program_id.trim() }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Failed to preview program");
        return;
      }

      setPreview(data);

      if (data.idl_summary?.name && !formData.name.trim()) {
        setFormData((prev) => ({ ...prev, name: data.idl_summary.name }));
      }

      if (data.already_monitored) {
        setMessage("This program is already monitored. No payment is required.");
      }
    } catch (error) {
      console.error("Error previewing program:", error);
      setMessage("Failed to preview program");
    } finally {
      setLoading(false);
    }
  };

  const addExistingProgramToWatchlist = async (programDbId: string) => {
    if (!isAuthenticated) {
      setMessage("Please connect your wallet and sign in to add this program to your watchlist.");
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId: programDbId }),
      });

      if (!response.ok && response.status !== 409) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add program to watchlist");
      }

      await queryClient.invalidateQueries({ queryKey: queryKeys.watchlist });
      router.push(`/programs/${programDbId}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to add program to watchlist");
    } finally {
      setLoading(false);
    }
  };

  const activateWithPayment = async () => {
    if (!validateFullForm()) {
      return;
    }

    if (!isAuthenticated || !publicKey) {
      setMessage("Please connect your wallet and sign in before paying.");
      return;
    }

    setLoading(true);
    setMessage("Creating payment request...");
    setTransactionSignature(null);

    try {
      const intentResponse = await fetch("/api/payments/program-activation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: formData.program_id.trim(),
          name: formData.name.trim(),
          description: formData.description.trim(),
        }),
      });
      const intentData = await intentResponse.json();

      if (!intentResponse.ok) {
        if (intentData.already_monitored && intentData.program?.id) {
          await addExistingProgramToWatchlist(intentData.program.id);
          return;
        }
        throw new Error(intentData.error || "Failed to create payment request");
      }

      const payment = (intentData as PaymentIntentResponse).payment_intent;
      setMessage(`Approve the ${payment.amount_usdc} USDC payment in your wallet...`);

      const mint = new PublicKey(payment.usdc_mint);
      const sourceTokenAccount = getAssociatedTokenAddressSync(mint, publicKey);
      const destinationTokenAccount = new PublicKey(payment.treasury_token_account);
      const paymentReference = new PublicKey(payment.payment_reference);

      const sourceAccountInfo = await connection.getAccountInfo(sourceTokenAccount);
      if (!sourceAccountInfo) {
        throw new Error(
          "No USDC token account was found for your wallet. Fund your wallet with USDC and try again."
        );
      }

      const transaction = new Transaction();
      transaction.add(
        createTransferCheckedInstruction(
          sourceTokenAccount,
          mint,
          destinationTokenAccount,
          publicKey,
          BigInt(payment.amount_atomic),
          payment.decimals
        )
      );
      transaction.add(
        new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [{ pubkey: paymentReference, isSigner: false, isWritable: false }],
          data: Buffer.from(payment.memo, "utf8"),
        })
      );

      const signature = await sendTransaction(transaction, connection);
      setTransactionSignature(signature);
      setMessage("Payment submitted. Confirming on-chain...");

      await connection.confirmTransaction(signature, "confirmed");

      const confirmResponse = await fetch("/api/payments/program-activation/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payment_intent_id: payment.id,
          signature,
        }),
      });
      const confirmData = await confirmResponse.json();

      if (!confirmResponse.ok) {
        throw new Error(confirmData.error || "Payment could not be verified");
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.programs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.watchlist }),
        queryClient.invalidateQueries({ queryKey: queryKeys.stats }),
      ]);

      router.push(`/programs/${confirmData.program.id}`);
    } catch (error) {
      console.error("Error activating program:", error);
      setMessage(error instanceof Error ? error.message : "Failed to activate program");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (isEdit || isAdmin) {
      await saveProgramDirectly();
      return;
    }

    if (!preview) {
      await previewProgram();
      return;
    }

    if (preview.already_monitored && preview.program?.id) {
      await addExistingProgramToWatchlist(preview.program.id);
      return;
    }

    await activateWithPayment();
  };

  const handleInputChange = (field: "program_id" | "name" | "description", value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setMessage(null);
    if (field === "program_id") {
      setPreview(null);
      setTransactionSignature(null);
    }
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleActiveChange = () => {
    setFormData((prev) => ({ ...prev, is_active: !prev.is_active }));
    setMessage(null);
  };

  const submitLabel = (() => {
    if (loading) {
      return isEdit || isAdmin ? "Saving..." : "Processing...";
    }
    if (isEdit) return "Update Program";
    if (isAdmin) return "Add Program";
    if (!preview) return "Preview IDL";
    if (preview.already_monitored) return "Add to Watchlist";
    return `Pay ${preview.activation_fee?.amount_usdc || 5} USDC and Activate`;
  })();

  const SubmitIcon = (() => {
    if (loading) return Loader2;
    if (isEdit || isAdmin) return Save;
    if (!preview) return Search;
    if (preview.already_monitored) return Star;
    return CreditCard;
  })();

  const disableSubmit =
    loading || (!isEdit && !isAdmin && !!preview && !preview.already_monitored && !isAuthenticated);

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/programs">
          <Button variant="outline" className="flex items-center space-x-2">
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Programs</span>
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{isEdit ? "Edit Program" : "Add New Program"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="program_id" className="mb-2 block text-sm font-medium">
                Program ID *
              </label>
              <Input
                id="program_id"
                type="text"
                value={formData.program_id}
                onChange={(e) => handleInputChange("program_id", e.target.value)}
                placeholder="e.g., 11111111111111111111111111111112"
                disabled={isEdit}
                className={errors.program_id ? "border-destructive" : ""}
              />
              {errors.program_id && (
                <p className="mt-1 text-sm text-destructive">{errors.program_id}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                The Solana program ID to monitor for Anchor IDL changes
              </p>
            </div>

            {preview?.idl_summary && (
              <div className="rounded-md border bg-muted/30 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium">On-chain IDL found</span>
                </div>
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">IDL Name</div>
                    <div className="break-all font-medium leading-snug">
                      {preview.idl_summary.name || "Unknown"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Version</div>
                    <div className="break-words font-medium leading-snug">
                      {preview.idl_summary.version || "Unknown"}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Instructions</div>
                    <div className="font-medium">{preview.idl_summary.instructions}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Accounts</div>
                    <div className="font-medium">{preview.idl_summary.accounts}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Types</div>
                    <div className="font-medium">{preview.idl_summary.types}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">Errors</div>
                    <div className="font-medium">{preview.idl_summary.errors}</div>
                  </div>
                </div>
              </div>
            )}

            {preview?.already_monitored && preview.program && (
              <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-100">
                <div className="mb-1 font-medium">{preview.program.name} is already monitored</div>
                <div>
                  No payment is required. Add it to your watchlist to receive notifications.
                </div>
              </div>
            )}

            {!preview?.already_monitored && (
              <>
                <div>
                  <label htmlFor="name" className="mb-2 block text-sm font-medium">
                    Program Name *
                  </label>
                  <Input
                    id="name"
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    placeholder="e.g., My DeFi Protocol"
                    className={errors.name ? "border-destructive" : ""}
                  />
                  {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    A friendly name to identify this program
                  </p>
                </div>

                <div>
                  <label htmlFor="description" className="mb-2 block text-sm font-medium">
                    Description
                  </label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => handleInputChange("description", e.target.value)}
                    placeholder="Optional description of what this program does..."
                    rows={4}
                    className={errors.description ? "border-destructive" : ""}
                  />
                  {errors.description && (
                    <p className="mt-1 text-sm text-destructive">{errors.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Optional description to help identify this program
                  </p>
                </div>

                {isEdit && isAdmin && (
                  <div className="rounded-md border p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <label id="program-visibility-label" className="text-sm font-medium">
                          Visible and monitored
                        </label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formData.is_active
                            ? "This program appears in public program lists and is checked by IDL monitoring."
                            : "This program is hidden from public program lists and skipped by IDL monitoring."}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={formData.is_active}
                        aria-labelledby="program-visibility-label"
                        onClick={handleActiveChange}
                        disabled={loading}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                          formData.is_active ? "bg-primary" : "bg-muted-foreground/30"
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
                            formData.is_active ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {!isEdit && !isAdmin && preview?.payment_required && (
              <div className="rounded-md border p-4">
                <div className="mb-1 flex items-center gap-2 text-sm font-medium">
                  <CreditCard className="h-4 w-4" />
                  One-time activation fee: {preview.activation_fee?.amount_usdc || 5} USDC
                </div>
                <p className="text-sm text-muted-foreground">
                  This adds the program to the shared IDL Sentinel registry. Once added, anyone can
                  watch it for free.
                </p>
                {!isAuthenticated && (
                  <p className="mt-3 text-sm text-destructive">
                    Connect your wallet and sign in to activate this program.
                  </p>
                )}
              </div>
            )}

            {message && (
              <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p>{message}</p>
                  {transactionSignature && (
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {transactionSignature}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-4">
              <Link href="/programs">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={disableSubmit}
                className="flex items-center space-x-2"
              >
                <SubmitIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                <span>{submitLabel}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
