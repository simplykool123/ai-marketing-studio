export type HolidayApiObservance = {
  id: string;
  title: string;
  date: string;
  country: string;
  region?: string | null;
  observanceType: string;
  source: "holiday_api";
};

export interface HolidayApiAdapter {
  fetchHolidays(country: string, year: number): Promise<HolidayApiObservance[]>;
}

export const holidayApiAdapter: HolidayApiAdapter = {
  async fetchHolidays() {
    return [];
  },
};
