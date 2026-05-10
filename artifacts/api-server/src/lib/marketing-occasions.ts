export type OccasionSource = "curated" | "holiday_api" | "manual";
export type ObservanceType =
  | "public_holiday"
  | "festival"
  | "marketing_moment"
  | "awareness_day"
  | "religious"
  | "national"
  | "regional";

export type MarketingOccasion = {
  id: string;
  title: string;
  month: number;
  day: number;
  source: OccasionSource;
  requiresYearlyUpdate: boolean;
  observanceType: ObservanceType;
  country?: "IN" | "GLOBAL";
  region?: string | null;
  category: string;
  recommendedContentTypes: string[];
  notes?: string;
};

const movableNote = "Movable date. Verify and update yearly before planning live campaigns.";

export const curatedMarketingOccasions: MarketingOccasion[] = [
  { id: "new-year", title: "New Year", month: 1, day: 1, source: "curated", requiresYearlyUpdate: false, observanceType: "marketing_moment", country: "GLOBAL", category: "Seasonal", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "lohri", title: "Lohri", month: 1, day: 13, source: "curated", requiresYearlyUpdate: false, observanceType: "regional", country: "IN", region: "Punjab, North India", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "makar-sankranti", title: "Makar Sankranti", month: 1, day: 14, source: "curated", requiresYearlyUpdate: false, observanceType: "festival", country: "IN", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "pongal", title: "Pongal", month: 1, day: 15, source: "curated", requiresYearlyUpdate: false, observanceType: "regional", country: "IN", region: "Tamil Nadu", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "republic-day", title: "Republic Day", month: 1, day: 26, source: "curated", requiresYearlyUpdate: false, observanceType: "national", country: "IN", category: "National", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "valentines-day", title: "Valentine's Day", month: 2, day: 14, source: "curated", requiresYearlyUpdate: false, observanceType: "marketing_moment", country: "GLOBAL", category: "Seasonal", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "women-day", title: "International Women's Day", month: 3, day: 8, source: "curated", requiresYearlyUpdate: false, observanceType: "awareness_day", country: "GLOBAL", category: "Awareness", recommendedContentTypes: ["social_post", "blog"] },
  { id: "holi", title: "Holi", month: 3, day: 4, source: "curated", requiresYearlyUpdate: true, observanceType: "festival", country: "IN", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "mahavir-jayanti", title: "Mahavir Jayanti", month: 3, day: 31, source: "curated", requiresYearlyUpdate: true, observanceType: "religious", country: "IN", category: "Religious", recommendedContentTypes: ["social_post"], notes: movableNote },
  { id: "world-health-day", title: "World Health Day", month: 4, day: 7, source: "curated", requiresYearlyUpdate: false, observanceType: "awareness_day", country: "GLOBAL", category: "Awareness", recommendedContentTypes: ["social_post", "blog"] },
  { id: "baisakhi", title: "Baisakhi", month: 4, day: 14, source: "curated", requiresYearlyUpdate: false, observanceType: "regional", country: "IN", region: "Punjab, North India", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "akshaya-tritiya", title: "Akshaya Tritiya", month: 4, day: 20, source: "curated", requiresYearlyUpdate: true, observanceType: "religious", country: "IN", category: "Religious", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "labour-day", title: "Labour Day", month: 5, day: 1, source: "curated", requiresYearlyUpdate: false, observanceType: "awareness_day", country: "GLOBAL", category: "Awareness", recommendedContentTypes: ["social_post"] },
  { id: "mothers-day", title: "Mother's Day", month: 5, day: 10, source: "curated", requiresYearlyUpdate: true, observanceType: "marketing_moment", country: "GLOBAL", category: "Seasonal", recommendedContentTypes: ["social_post", "image_prompt"], notes: "Second Sunday in May. Verify yearly." },
  { id: "world-environment-day", title: "World Environment Day", month: 6, day: 5, source: "curated", requiresYearlyUpdate: false, observanceType: "awareness_day", country: "GLOBAL", category: "Awareness", recommendedContentTypes: ["social_post", "blog", "image_prompt"] },
  { id: "fathers-day", title: "Father's Day", month: 6, day: 21, source: "curated", requiresYearlyUpdate: true, observanceType: "marketing_moment", country: "GLOBAL", category: "Seasonal", recommendedContentTypes: ["social_post", "image_prompt"], notes: "Third Sunday in June. Verify yearly." },
  { id: "yoga-day", title: "International Yoga Day", month: 6, day: 21, source: "curated", requiresYearlyUpdate: false, observanceType: "awareness_day", country: "IN", category: "Awareness", recommendedContentTypes: ["social_post", "blog", "image_prompt"] },
  { id: "world-entrepreneurs-day", title: "World Entrepreneurs Day", month: 8, day: 21, source: "curated", requiresYearlyUpdate: false, observanceType: "awareness_day", country: "GLOBAL", category: "Awareness", recommendedContentTypes: ["social_post", "blog"] },
  { id: "independence-day", title: "Independence Day", month: 8, day: 15, source: "curated", requiresYearlyUpdate: false, observanceType: "national", country: "IN", category: "National", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "onam", title: "Onam", month: 8, day: 26, source: "curated", requiresYearlyUpdate: true, observanceType: "regional", country: "IN", region: "Kerala", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "raksha-bandhan", title: "Raksha Bandhan", month: 8, day: 28, source: "curated", requiresYearlyUpdate: true, observanceType: "festival", country: "IN", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "teacher-day", title: "Teacher's Day", month: 9, day: 5, source: "curated", requiresYearlyUpdate: false, observanceType: "marketing_moment", country: "IN", category: "Seasonal", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "janmashtami", title: "Janmashtami", month: 9, day: 4, source: "curated", requiresYearlyUpdate: true, observanceType: "religious", country: "IN", category: "Religious", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "ganesh-chaturthi", title: "Ganesh Chaturthi", month: 9, day: 14, source: "curated", requiresYearlyUpdate: true, observanceType: "festival", country: "IN", region: "Maharashtra and many Indian states", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "world-pharmacists-day", title: "World Pharmacists Day", month: 9, day: 25, source: "curated", requiresYearlyUpdate: false, observanceType: "awareness_day", country: "GLOBAL", category: "Awareness", recommendedContentTypes: ["social_post", "blog"] },
  { id: "gandhi-jayanti", title: "Gandhi Jayanti", month: 10, day: 2, source: "curated", requiresYearlyUpdate: false, observanceType: "national", country: "IN", category: "National", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "navratri", title: "Navratri", month: 10, day: 11, source: "curated", requiresYearlyUpdate: true, observanceType: "festival", country: "IN", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "dussehra", title: "Dussehra", month: 10, day: 20, source: "curated", requiresYearlyUpdate: true, observanceType: "festival", country: "IN", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "karwa-chauth", title: "Karwa Chauth", month: 10, day: 29, source: "curated", requiresYearlyUpdate: true, observanceType: "religious", country: "IN", region: "North India", category: "Religious", recommendedContentTypes: ["social_post", "image_prompt"], notes: movableNote },
  { id: "diwali", title: "Diwali", month: 11, day: 8, source: "curated", requiresYearlyUpdate: true, observanceType: "festival", country: "IN", category: "Festival", recommendedContentTypes: ["social_post", "image_prompt", "blog"], notes: movableNote },
  { id: "children-day", title: "Children's Day", month: 11, day: 14, source: "curated", requiresYearlyUpdate: false, observanceType: "marketing_moment", country: "IN", category: "Seasonal", recommendedContentTypes: ["social_post", "image_prompt"] },
  { id: "eid-ul-fitr", title: "Eid", month: 3, day: 21, source: "curated", requiresYearlyUpdate: true, observanceType: "religious", country: "IN", category: "Religious", recommendedContentTypes: ["social_post", "image_prompt"], notes: "Movable Islamic calendar date. Verify locally each year." },
  { id: "christmas", title: "Christmas", month: 12, day: 25, source: "curated", requiresYearlyUpdate: false, observanceType: "religious", country: "GLOBAL", category: "Seasonal", recommendedContentTypes: ["social_post", "image_prompt"] },
];

export function findOccasion(occasionId: string): MarketingOccasion | undefined {
  return curatedMarketingOccasions.find((occasion) => occasion.id === occasionId);
}

export function occasionDate(occasion: MarketingOccasion, year: number): string {
  const month = String(occasion.month).padStart(2, "0");
  const day = String(occasion.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function listOccasionsForYear(year: number) {
  return curatedMarketingOccasions
    .map((occasion) => ({
      ...occasion,
      date: occasionDate(occasion, year),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
