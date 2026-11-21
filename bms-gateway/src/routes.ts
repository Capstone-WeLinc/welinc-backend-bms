export type Owner = "booking" | "dispatch" | "completion" | "analytics";
export function route(
  path: string,
): { owner: Owner; path: string; public: boolean } | null {
  if (!path.startsWith("/bms/")) return null;
  const local = path.slice(4);
  if (
    /^\/integrations\/(welinc|wix)\/(bookings|review|notifications)(\/|$)/.test(
      local,
    )
  ) {
    return {
      owner: "booking",
      path: local,
      public: /^\/integrations\/(welinc|wix)\/bookings$/.test(local),
    };
  }
  if (/^\/public\/tracking(\/|$)/.test(local))
    return { owner: "booking", path: local, public: true };
  if (
    /^\/config\/(booking-services|services-offered|protective-materials)(\/|$)/.test(
      local,
    )
  )
    return { owner: "booking", path, public: false };
  if (
    /^\/config\/(vehicle-availability|vehicles|drivers|helpers|garages)(\/|$)/.test(
      local,
    )
  )
    return { owner: "dispatch", path, public: false };
  if (/^\/(booking|approvals)(\/|$)/.test(local))
    return { owner: "booking", path: local, public: false };
  if (/^\/(dispatch|scheduling|job-order|crew-leave)(\/|$)/.test(local))
    return { owner: "dispatch", path: local, public: false };
  if (/^\/(post-service|daily-sales|collections)(\/|$)/.test(local))
    return { owner: "completion", path: local, public: false };
  if (/^\/(reports|data)(\/|$)/.test(local))
    return { owner: "analytics", path: local, public: false };
  return null;
}
