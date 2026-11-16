import assert from "node:assert/strict";
import { CookieJar, DEFAULT_ACCOUNTS } from "../../scripts/check-system.mjs";
const base = process.env.BMS_TEST_API_BASE_URL ?? "http://localhost:3000";
const portal = "http://localhost:8000";
const web = "http://localhost:8003";
async function call(path, { jar, token, origin, method = "GET", data } = {}) {
  const url = new URL(path, base);
  const headers = {
    ...(jar ? { Cookie: jar.header(url.pathname) } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  if (origin) headers.Origin = origin;
  if (data !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  if (jar) jar.store(response.headers.getSetCookie());
  const json = await response.json().catch(() => null);
  return {
    status: response.status,
    json,
    location: response.headers.get("location"),
  };
}
async function login(key) {
  const jar = new CookieJar();
  const account = DEFAULT_ACCOUNTS[key];
  let result = await call("/auth/login", {
    jar,
    method: "POST",
    origin: portal,
    data: account,
  });
  assert.equal(result.status, 200, "Portal seed sign-in");
  result = await call("/bms/session/start?return=%2Fcs%2Fbookings", { jar });
  assert.equal(result.status, 302, "Session start");
  result = await call(result.location, { jar });
  assert.equal(result.status, 302, "Authorization");
  result = await call(result.location, { jar });
  assert.equal(result.status, 302, "Callback");
  result = await call("/bms/session/refresh", {
    jar,
    method: "POST",
    origin: web,
    data: {},
  });
  assert.equal(result.status, 200, "Refresh");
  return { jar, token: result.json.accessToken };
}
const sessions = [];
try {
  const cs = await login("bms.cs");
  sessions.push(cs);
  for (const path of [
    "/bms/booking",
    "/bms/config/booking-services",
    "/bms/config/services-offered",
    "/bms/config/protective-materials",
    "/bms/reports/saved",
    "/bms/data/booking",
  ]) {
    const result = await call(path, cs);
    assert.equal(result.status, 200, path);
    assert(Array.isArray(result.json), path + " list shape");
    console.log("ok " + path);
  }
  const profile = await call("/auth/profile/activity", cs);
  assert.equal(profile.status, 200);
  assert(Array.isArray(profile.json.data));
  assert("nextCursor" in profile.json);
  console.log("ok own profile activity uses cursor feed");
  const ops = await login("bms.ops");
  sessions.push(ops);
  const drivers = await call("/bms/config/drivers", ops);
  const helpers = await call("/bms/config/helpers", ops);
  assert.equal(drivers.status, 200);
  assert.equal(drivers.json.length, 12);
  assert.equal(helpers.status, 200);
  assert.equal(helpers.json.length, 20);
  console.log("ok dispatch returns the 12 drivers and 20 helpers");
  assert(drivers.json.every((driver) => driver.email.endsWith("@welinc.com")));
  assert(helpers.json.every((helper) => helper.email.endsWith("@welinc.com")));
  console.log("ok crew identity emails follow the suite manifest");
  const fleet = await call("/bms/config/vehicles", ops);
  if (fleet.status === 503) {
    assert.equal(fleet.json.code, "FLEET_UNAVAILABLE");
    console.log(
      "ok unavailable VMMS fails closed with FLEET_UNAVAILABLE (live fleet sign-off remains pending)",
    );
  } else {
    assert.equal(fleet.status, 200);
    console.log(
      "ok live vehicle list returned; lead must verify fleet parity and assignment freshness",
    );
  }
  const forbidden = await call("/bms/approvals", ops);
  assert.equal(forbidden.status, 403);
  console.log("ok BMS role restrictions remain enforced");
} finally {
  for (const session of sessions) {
    const result = await call("/bms/session/logout", {
      ...session,
      method: "POST",
      origin: web,
      data: {},
    });
    assert.equal(result.status, 204, "Test session logout");
  }
}
