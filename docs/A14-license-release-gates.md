# A14 v1 — Licence correctness draft

Prepared 15 October 2026. Base main: 28db4a6eb99027dacaf3a86d7cb9af0bfcf7788f. Not approved for production.

## Problem and behaviour

The existing Function accepts another product's valid key in the same store and returns valid=true when activation is refused. Both behaviours were reproduced locally using mocked upstream responses and fixture-only keys. This patch requires a matching numeric store AND product, known active/inactive status and successful activation with a returned instance. Returning instance requests may validate instanceId without creating another activation. Both current Function routes share the same handler.

The public License API does not require the merchant API key used by the old configuration guard. This patch does not read, change, expose or remove deployed environment variables. Requests use the documented public API, bounded timeout, no-store responses and generic errors. It rejects missing identity configuration, missing upstream metadata, invalid status, upstream HTTP errors and activation refusal. No licence/customer payloads are logged.

## Validation

- `node --test tests/license-validation.test.mjs`: 29 fixture-only cases, no network or real licence use.
- `npm run build` and `npm run lint`: pass with inherited warnings. Actual Netlify Function bundle validation follows in the PR checks.
- Tests cover success, wrong store/product, missing metadata/status, disabled/expired keys, activation refusal/missing instance, same-instance reuse, malformed input/configuration, upstream errors and duplicate legacy route parity.

## Hard release gates — do not merge before these pass

1. Secure merchant read verifies Halyo's numeric store and product IDs, licence activation allowance and actual existing-customer behaviour. The public checkout buy UUID is NOT a numeric product ID. No guessed IDs.
2. Set `LEMONSQUEEZY_STORE_ID` and `LEMONSQUEEZY_PRODUCT_ID` for the intended environment only after a concrete owner-approved configuration/release package. Missing IDs intentionally return 503, which would block customers. Do not deploy this draft unconfigured.
3. A follow-up frontend change must store the returned activationToken and use instanceId for returning customers. Current App.jsx still trusts saved halyo_license locally and sends instanceName on manual entry; this server patch alone does NOT fix returning access/revocation or avoid repeated manual activations. Keep this draft on hold pending that acceptance work.
4. Authorised test-mode order: receipt/key delivery, first activation, reload, second entry, rejected activation and disabled key all tested. Separate verified live-order purchase measurement from QA/test orders. No real paid order/refund needed for local tests.
5. Verify an actual Netlify deploy preview for the exact commit; confirm runtime AbortSignal.timeout support and both Function entrypoints. Preview build alone is not a live licence test.
6. Syafiq approves the final combined commit, preview, environment changes and migration before production merge. Broad marketing delegation is not release approval.

## Boundaries and rollback

App.jsx, price, analytics, checkout linker, mobile design and approved 11,358-learner wording are unchanged. Existing CORS behaviour is retained. This is client-delivered code, not a complete server entitlement/session system; do not describe it as piracy-proof. Rate limits, signed sessions and migration/revalidation are separate design decisions. No account setting, customer communication or spend changed.

No production action recommended for this partial draft. If eventually released, revert the approved merge through a reviewed PR and restore the recorded pre-release configuration, preserving later unrelated changes. Do not delete any existing credentials or perform destructive activation resets as rollback.

Primary documentation checked 15 October:
- https://docs.lemonsqueezy.com/api/license-api
- https://docs.lemonsqueezy.com/api/license-api/validate-license-key
- https://docs.lemonsqueezy.com/api/license-api/activate-license-key
