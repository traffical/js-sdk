/**
 * Safety layer — tiered error containment and bundle validation.
 *
 * See `error-policy.ts` for the tier rules and `validate-bundle.ts` for what
 * "reject whole, never partially apply" means in practice.
 */

export {
  ErrorPolicy,
  type ErrorPolicyOptions,
  type OnResolutionError,
  type ResolutionReason,
  type SdkDiagnostics,
  type SideEffectKind,
} from "./error-policy.js";

export {
  validateConfigBundle,
  isValidConfigBundle,
  type BundleValidationResult,
  type BundleValidationFailure,
  type BundleValidationSuccess,
} from "./validate-bundle.js";
