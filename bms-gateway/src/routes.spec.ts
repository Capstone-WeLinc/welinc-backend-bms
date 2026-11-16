import { route } from "./routes";
describe("BMS route ownership", () => {
  it("keeps config prefixes and strips other business prefixes once", () => {
    expect(route("/bms/config/vehicles")).toEqual({
      owner: "dispatch",
      path: "/bms/config/vehicles",
      public: false,
    });
    expect(route("/bms/booking")).toEqual({
      owner: "booking",
      path: "/booking",
      public: false,
    });
    expect(route("/bms/reports/forecast")).toEqual({
      owner: "analytics",
      path: "/reports/forecast",
      public: false,
    });
  });
  it("does not expose auth or internal service routes", () => {
    expect(route("/auth/login")).toBeNull();
    expect(route("/bms/auth/login")).toBeNull();
    expect(route("/bms/internal/audit")).toBeNull();
  });
  it("preserves public signed webhook and customer tracking access", () => {
    expect(route("/bms/integrations/wix/bookings")?.public).toBe(true);
    expect(route("/bms/public/tracking/example")?.public).toBe(true);
    expect(route("/bms/integrations/wix/review")?.public).toBe(false);
  });
});
