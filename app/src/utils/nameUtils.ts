export function removeCityFromName(name: string, city: string | null | undefined): string {
  if (!city || !name) return name;
  const normalized = city.trim();
  if (!normalized) return name;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return name.replace(new RegExp(escaped, 'gi'), '').replace(/\s{2,}/g, ' ').trim();
}
