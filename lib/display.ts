/** DASH-2: name → email prefix → "Movie fan". */
export function displayName(user: { name: string | null; email: string | null }): string {
  const name = user.name?.trim();
  if (name) return name;
  const prefix = user.email?.split("@")[0]?.trim();
  if (prefix) return prefix;
  return "Movie fan";
}

/** DASH-3: up to two initials for the fallback avatar. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => p[0]!.toUpperCase()).join("") || "?";
}
