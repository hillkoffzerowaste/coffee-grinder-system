import type { Profile, Station } from "./types";

export function canUseStation(profile: Profile, station: Station) {
  if (!profile.active) return false;
  if (profile.station !== station && profile.station !== "both") return false;
  return station === "counter" ? profile.role === "counter" : profile.role === "packer" || profile.role === "admin";
}
