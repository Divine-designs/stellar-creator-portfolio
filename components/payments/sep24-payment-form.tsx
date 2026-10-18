'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { paymentFlowSchema, validatePaymentFlow, type PaymentFlowData } from '@/lib/payments/payment-flow';

/**
 * SEP-24 payment form: collects and validates amount/asset/account details
 * against `paymentFlowSchema` via React Hook Form, then re-validates with
 * `validatePaymentFlow` on submit.
 *
 * Submission posts to `/api/payments/sep24` (Issue #1393). It previously only
 * `console.log`ed the payload behind a `// TODO: Call API endpoint`, so the
 * button reported success without anything having happened — the worst possible
 * outcome for a form that takes a recipient and an amount.
 *
 * The anchor handshake itself lives server-side: the interactive endpoints need
 * a SEP-10 JWT, and minting one in the browser would put the signing key there.
 * See `lib/stellar/sep24.ts` for the protocol client the route uses.
 *
 * After the server returns an interactive URL we open it in a popup (with a
 * fallback link when the popup is blocked) and poll the transaction status so
 * the UI reflects the anchor's state, including `pending_user_transfer_start`
 * instructions (Issue #1548).
 */
export interface Sep24FlowProps {
  /** Where the validated payload is posted. Overridable for tests. */
  endpoint?: string;
  /** Where transaction status is polled. Overridable for tests. */
  statusEndpoint?: string;
  /** Called with the anchor's interactive URL once the server returns one. */
  onInteractiveUrl?: (url: string) => void;
  onSuccess?: (result: { id: string; url: string }) => void;
}

/** Anchor transaction states we surface to the user. */
type AnchorStatus =
  | 'incomplete'
  | 'pending_user_transfer_start'
  | 'pending_anchor'
  | 'pending_stellar'
  | 'pending_external'
  | 'completed'
  | 'refunded'
  | 'expired'
  | 'error';

interface StatusResponse {
  status?: AnchorStatus;
  message?: string;
  more_info_url?: string;
  /** Instructions the anchor wants shown for `pending_user_transfer_start`. */
  instructions?: string;
  error?: string;
}

const POLL_INTERVAL_MS = 5000;
const TERMINAL_STATUSES: AnchorStatus[] = ['completed', 'refunded', 'expired', 'error'];

function describeStatus(status: AnchorStatus): string {
  switch (status) {
    case 'incomplete':
      return 'Waiting for you to finish the anchor flow.';
    case 'pending_user_transfer_start':
      return 'Send the funds to the anchor using the instructions below.';
    case 'pending_anchor':
      return 'The anchor is processing your transaction.';
    case 'pending_stellar':
      return 'Waiting for the Stellar network to confirm.';
    case 'pending_external':
      return 'Waiting on an external system to confirm.';
    case 'completed':
      return 'Transaction completed.';
    case 'refunded':
      return 'Transaction was refunded by the anchor.';
    case 'expired':
      return 'The transaction expired. Please start again.';
    case 'error':
      return 'The anchor reported an error with this transaction.';
    default:
      return 'Checking transaction status…';
  }
}

export const Sep24Flow: React.FC<Sep24FlowProps> = ({
  endpoint = '/api/payments/sep24',
  statusEndpoint = '/api/payments/sep24/status',
  onInteractiveUrl,
  onSuccess,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [status, setStatus] = useState<AnchorStatus | null>(null);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [moreInfoUrl, setMoreInfoUrl] = useState<string | null>(null);

  const popupRef = useRef<Window | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
  } = useForm<PaymentFlowData>({
    resolver: zodResolver(paymentFlowSchema),
    mode: 'onChange',
  });

  const amount = watch('amount');

  const openInteractive = useCallback(
    (url: string) => {
      const popup = window.open(url, 'sep24-interactive', 'width=480,height=720');
      if (!popup || popup.closed || typeof popup.closed === 'undefined') {
        // Popup blocked — keep the URL so the user can open it manually.
        setPopupBlocked(true);
        return;
      }
      popupRef.current = popup;
      setPopupBlocked(false);
    },
    [],
  );

  const onSubmit = async (data: PaymentFlowData) => {
    // Validate before submission
    const validation = validatePaymentFlow(data);
    if (!validation.valid) {
      setSubmitError(validation.errors.join(', '));
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setStatus(null);
    setStatusDetail(null);
    setInstructions(null);
    setMoreInfoUrl(null);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        // Surface the server's reason. "Asset not supported by this anchor" and
        // "KYC required" need different things from the user, and a generic
        // failure message tells them neither.
        let detail = `Payment could not be started (${response.status})`;
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) detail = payload.error;
        } catch {
          // Non-JSON error body — keep the status-code message.
        }
        setSubmitError(detail);
        return;
      }

      const result = (await response.json()) as { id?: string; url?: string };
      if (!result.url || !result.id) {
        setSubmitError('The anchor did not return an interactive URL.');
        return;
      }

      setTransactionId(result.id);
      setInteractiveUrl(result.url);
      onInteractiveUrl?.(result.url);
      onSuccess?.({ id: result.id, url: result.url });
      openInteractive(result.url);
    } catch {
      // A network failure here means we do not know whether the anchor created
      // the transaction, so the message deliberately does not claim it failed.
      setSubmitError('Could not reach the payment service. Check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Poll the anchor transaction status until it reaches a terminal state.
  useEffect(() => {
    if (!transactionId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(
          `${statusEndpoint}?id=${encodeURIComponent(transactionId)}`,
        );
        if (!response.ok) {
          // Transient failure — keep polling rather than dropping the user.
          if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        const payload = (await response.json()) as StatusResponse;
        if (cancelled) return;

        if (payload.error) {
          setStatusDetail(payload.error);
        }
        if (payload.status) {
          setStatus(payload.status);
          setStatusDetail(payload.message ?? null);
          setInstructions(payload.instructions ?? null);
          setMoreInfoUrl(payload.more_info_url ?? null);
          if (TERMINAL_STATUSES.includes(payload.status)) return;
        }
      } catch {
        // Network hiccup — retry on the next tick.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [transactionId, statusEndpoint]);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-md">
      <div className="space-y-2">
        <Label htmlFor="recipientAddress">Recipient Stellar Address</Label>
        <Input
          id="recipientAddress"
          placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
          {...register('recipientAddress')}
          aria-invalid={!!errors.recipientAddress}
        />
        {errors.recipientAddress && (
          <p className="text-sm text-destructive">{errors.recipientAddress.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="amount">Amount (XLM)</Label>
        <Input
          id="amount"
          type="number"
          step="0.0001"
          placeholder="0.0000"
          {...register('amount', { valueAsNumber: true })}
          aria-invalid={!!errors.amount}
        />
        {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
        {amount && <p className="text-xs text-muted-foreground">Amount: {amount} XLM</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          placeholder="Payment description"
          {...register('description')}
          aria-invalid={!!errors.description}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="memo">Memo (Optional)</Label>
        <Input
          id="memo"
          placeholder="Transaction memo"
          maxLength={28}
          {...register('memo')}
          aria-invalid={!!errors.memo}
        />
        {errors.memo && <p className="text-sm text-destructive">{errors.memo.message}</p>}
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      {transactionId && (
        <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className="text-muted-foreground">Transaction: {transactionId}</p>
          {status && <p>{describeStatus(status)}</p>}
          {statusDetail && <p className="text-muted-foreground">{statusDetail}</p>}
          {status === 'pending_user_transfer_start' && instructions && (
            <p className="whitespace-pre-line">{instructions}</p>
          )}
          {moreInfoUrl && (
            <a
              href={moreInfoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              View transaction details
            </a>
          )}
          {popupBlocked && interactiveUrl && (
            <p>
              Your browser blocked the payment window.{' '}
              <a
                href={interactiveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Open the anchor page
              </a>{' '}
              to continue.
            </p>
          )}
        </div>
      )}

      <Button type="submit" disabled={!isValid || isSubmitting} className="w-full">
        {isSubmitting ? 'Processing...' : 'Continue to Payment'}
      </Button>
    </form>
  );
};
