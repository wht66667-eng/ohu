// CloudBase 3.9 uses phone for requesting an OTP. phone_number selects the already-verified signup flow.
export function registrationIdentity(kind: 'phone' | 'email', account: string) {
  return kind === 'phone' ? { phone: account.trim() } : { email: account.trim() }
}
