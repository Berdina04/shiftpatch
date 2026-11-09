// The spec's sample data as the API must return it (docs/spec.md).
export const SEED_LOGINS = [
  { email: "admin@sunrisehealth.example", user: { id: "agency-a", name: "Sunrise Health Staffing", role: "agency" } },
  { email: "admin@metrocare.example", user: { id: "agency-b", name: "Metro Care Partners", role: "agency" } },
  { email: "maria.lopez@example.com", user: { id: "nurse-1", name: "Maria Lopez", role: "nurse" } },
  { email: "james.cook@example.com", user: { id: "nurse-2", name: "James Cook", role: "nurse" } },
  { email: "alex.kim@example.com", user: { id: "admin-1", name: "Alex Kim", role: "admin" } },
] as const;

export const SEED_SHIFTS = [
  {
    id: "shift-1",
    agencyId: "agency-a",
    agencyName: "Sunrise Health Staffing",
    role: "RN",
    date: "2026-10-02",
    startTime: "19:00",
    endTime: "07:00",
    status: "open",
    claimedBy: null,
  },
  {
    id: "shift-2",
    agencyId: "agency-a",
    agencyName: "Sunrise Health Staffing",
    role: "LPN",
    date: "2026-10-03",
    startTime: "07:00",
    endTime: "19:00",
    status: "filled",
    claimedBy: "nurse-1",
  },
  {
    id: "shift-3",
    agencyId: "agency-b",
    agencyName: "Metro Care Partners",
    role: "RN",
    date: "2026-10-04",
    startTime: "19:00",
    endTime: "07:00",
    status: "open",
    claimedBy: null,
  },
] as const;
