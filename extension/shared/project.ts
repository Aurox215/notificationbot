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
  const field = (value: string | undefined, maximum: number): string => {
    const text = value?.trim() || 'Not provided';
    return text.length <= maximum ? text : text.slice(0, Math.max(0, maximum - 3)) + '...';
  };
  const lines = [alert.platform, field(alert.title, 400),
    'Budget: ' + field(alert.budget, 200),
    'Category: ' + field(alert.category, 200),
    'Skills: ' + field(alert.skills?.filter(skill => skill.trim()).join(', '), 600),
    'Published: ' + field(alert.publishedAt, 150),
    'Client rating: ' + field(alert.client?.ratingScore, 60),
    'Client reviews: ' + (alert.client?.reviewCount ?? 'Not provided'),
    'Client joined: ' + field(alert.client?.joinedAt, 150)];
  if (alert.client?.ratingCount !== undefined) lines.push('Client ratings: ' + alert.client.ratingCount);
  const url = alert.url && alert.url.length <= 1000 && /^https?:\/\//i.test(alert.url) ? alert.url : undefined;
  return [lines.join('\n'), url, 'Detected: ' + alert.detectedAt.toISOString()].filter(Boolean).join('\n\n');
}
