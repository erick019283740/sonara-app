export function isPremium(
  profile: { subscription_status?: string | null } | null | undefined
): boolean {
  return profile?.subscription_status === "premium";
}
