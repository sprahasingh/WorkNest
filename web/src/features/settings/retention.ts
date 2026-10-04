// How long an organization keeps chat messages, in words people can read.
// null means messages are never deleted automatically.
export function retentionPhrase(days: number | null | undefined): string {
  switch (days) {
    case 365:
      return "1 year";
    case 180:
      return "6 months";
    case 90:
      return "90 days";
    default:
      return typeof days === "number"
        ? `${days} days`
        : "for as long as the organization exists";
  }
}
