import { VmmsFleetProvider, permanentCrew } from "./vmms-fleet.provider";
import { ServiceTokenClient } from "../auth/verify";
const vehicle = {
  id: "v1",
  plateNumber: "ABC-123",
  status: "AVAILABLE",
  capacity: 1000,
  odometer: 5,
  model: "Truck",
  garageId: "g1",
};
describe("VMMS fleet consumer", () => {
  let fetchMock: jest.SpyInstance;
  let fleet: VmmsFleetProvider;
  beforeEach(() => {
    fleet = new VmmsFleetProvider(
      {
        vehicleDispatchProfile: {
          findMany: async () => [],
          findUnique: async () => null,
        },
        driver: { findMany: async () => [] },
      } as any,
      { lookup: async () => new Map(), roster: async () => [] } as any,
      { getOrThrow: () => "http://vmms" } as any,
      { internalUrl: "http://auth" } as any,
      {} as any,
    );
    (fleet as any).tokens = {
      withToken: (work: any) => work("test-service-token"),
    };
    fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async (input) =>
          new Response(
            JSON.stringify(
              String(input).endsWith("/garages")
                ? { garages: [{ id: "g1", name: "Main" }] }
                : { vehicles: [vehicle] },
            ),
            { status: 200 },
          ),
      );
  });
  afterEach(() => {
    fetchMock.mockRestore();
    jest.restoreAllMocks();
  });
  it("caches lists for 30 seconds and maps dispatch defaults", async () => {
    expect((await fleet.vehicles())[0]).toMatchObject({
      plateNumber: "ABC-123",
      requiredHelpers: 0,
      garage: "Main",
    });
    await fleet.vehicles();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("bypasses the list cache and refuses a newly unavailable vehicle", async () => {
    await fleet.vehicles();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...vehicle, status: "UNDER_MAINTENANCE" }),
        { status: 200 },
      ),
    );
    await expect(fleet.assignmentResources("v1", "d1")).rejects.toMatchObject({
      status: 409,
      response: { code: "VEHICLE_UNAVAILABLE" },
    });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe(
      "http://vmms/vmms/fleet/vehicles/v1",
    );
  });
  it("fails closed on VMMS outages and missing vehicles", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(fleet.vehicles()).rejects.toMatchObject({
      status: 503,
      response: { code: "FLEET_UNAVAILABLE" },
    });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    await expect(
      fleet.assignmentResources("missing", "driver"),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "VEHICLE_UNAVAILABLE" },
    });
  });
  it("never makes a temporary or erased role pickable", () => {
    const person = {
      id: "1",
      name: "Name",
      email: "name@example.invalid",
      roles: ["DRIVER"],
      isActive: true,
      deleted: false,
    };
    expect(permanentCrew(person, "DRIVER")).toBe(true);
    expect(
      permanentCrew({ ...person, temporaryRoles: ["DRIVER"] }, "DRIVER"),
    ).toBe(false);
    expect(permanentCrew({ ...person, erased: true }, "DRIVER")).toBe(false);
  });
  it.each(["TOKEN_EXPIRED", "TOKEN_INVALID"])(
    "retries only an expired fleet token (%s)",
    async (code) => {
      const tokenRequests: string[] = [];
      let fleetRequests = 0;
      (fleet as any).tokens = new ServiceTokenClient({
        tokenUrl: "http://auth/auth/token",
        signer: { clientId: "bms", sign: async () => "test-assertion" } as any,
        audience: "VMMS",
        scope: "fleet.read",
      });
      fetchMock.mockImplementation(async (input, init) => {
        if (String(input) === "http://auth/auth/token") {
          tokenRequests.push(String(init?.body));
          return new Response(
            JSON.stringify({
              access_token: `test-token-${tokenRequests.length}`,
              expires_in: 3600,
            }),
            { status: 200 },
          );
        }
        fleetRequests++;
        if (fleetRequests === 1)
          return new Response(JSON.stringify({ code }), { status: 401 });
        return new Response(JSON.stringify(vehicle), { status: 200 });
      });
      if (code === "TOKEN_EXPIRED") {
        await expect(
          fleet.assignmentResources("v1", "d1"),
        ).resolves.toMatchObject({ vehicle: { id: "v1" } });
        expect(tokenRequests).toHaveLength(2);
        expect(tokenRequests[0]).toContain("audience=VMMS");
        expect(tokenRequests[0]).toContain("scope=fleet.read");
        expect(fleetRequests).toBe(2);
      } else {
        await expect(
          fleet.assignmentResources("v1", "d1"),
        ).rejects.toMatchObject({
          status: 503,
          response: { code: "FLEET_UNAVAILABLE" },
        });
        expect(tokenRequests).toHaveLength(1);
        expect(fleetRequests).toBe(1);
      }
    },
  );
});
