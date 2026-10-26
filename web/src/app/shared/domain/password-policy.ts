import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/// Client-side mirror of the server password policy (spec 6.14). The server also rejects the
/// email address and the 10 000 most common passwords; those errors come back as field errors.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words make a strong, memorable password.`;

/// Group validator: `confirmKey` must equal `passwordKey`. Sets `mismatch` on the group.
export function matchingPasswords(passwordKey: string, confirmKey: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordKey)?.value as string | undefined;
    const confirm = group.get(confirmKey)?.value as string | undefined;
    return confirm && password !== confirm ? { mismatch: true } : null;
  };
}
