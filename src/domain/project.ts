export interface ProjectAlert {
  platform: 'PeoplePerHour' | 'Guru';
  title: string;
  category?: string;
  budget?: string;
  skills?: string[];
  description?: string;
  publishedAt?: string;
  url?: string;
  client?: {
    ratingScore?: string;
    ratingCount?: number;
    reviewCount?: number;
    joinedAt?: string;
  };
  detectedAt: Date;
}

export function formatAlert(alert: ProjectAlert): string {
  const lines = [alert.platform, alert.title];
  if (alert.category) lines.push(`Category: ${alert.category}`);
  if (alert.budget) lines.push(`Budget: ${alert.budget}`);
  if (alert.skills?.length) lines.push(`Skills: ${alert.skills.join(', ')}`);
  if (alert.publishedAt) lines.push(`Published: ${alert.publishedAt}`);
  if (alert.client?.ratingScore !== undefined) lines.push(`Client rating: ${alert.client.ratingScore}`);
  if (alert.client?.ratingCount !== undefined) lines.push(`Client ratings: ${alert.client.ratingCount}`);
  if (alert.client?.reviewCount !== undefined) lines.push(`Client reviews: ${alert.client.reviewCount}`);
  if (alert.client?.joinedAt !== undefined) lines.push(`Client joined: ${alert.client.joinedAt}`);
  if (alert.description) lines.push('', alert.description);
  // Reserve space for the source link and timestamp even for long descriptions.
  const body = lines.join('\n').slice(0, 3000);
  const url = alert.url && /^https?:\/\//i.test(alert.url) ? alert.url.slice(0, 800) : undefined;
  return [body, url, `Detected: ${alert.detectedAt.toISOString()}`].filter(Boolean).join('\n\n');
}
