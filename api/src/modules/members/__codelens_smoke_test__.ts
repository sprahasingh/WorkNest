/** Temporary CodeLens smoke fixture. Do not merge. */
export function isOwnMembership(
  membership: { userId: { toString(): string } },
  context: { userId: string },
) {
  return membership.userId === context.userId;
}
