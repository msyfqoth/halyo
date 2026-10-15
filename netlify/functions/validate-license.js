// Public Lemon Squeezy License API: no merchant API key is sent or needed.
// Release gate: verify and configure the numeric Halyo STORE_ID and PRODUCT_ID.
// A checkout buy UUID is not a product ID. Missing identity fails closed.
const numericId = value => typeof value === "string" && /^[1-9]\d*$/.test(value.trim()) ? value.trim() : null;

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
  const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
  const deny = (statusCode, error) => reply(statusCode, { valid: false, error });
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return deny(405, "Method not allowed");

  let input;
  try { input = JSON.parse(event.body || "{}"); }
  catch { return deny(400, "Invalid request"); }
  const licenseKey = typeof input?.licenseKey === "string" ? input.licenseKey.trim() : "";
  const instanceName = typeof input?.instanceName === "string" ? input.instanceName.trim() : "";
  const instanceId = typeof input?.instanceId === "string" ? input.instanceId.trim() : "";
  if (licenseKey.length < 8 || licenseKey.length > 200 || instanceName.length > 200 || instanceId.length > 200 || (!instanceName && !instanceId)) {
    return deny(400, "Enter a valid license key and browser instance");
  }
  const storeId = numericId(process.env.LEMONSQUEEZY_STORE_ID);
  const productId = numericId(process.env.LEMONSQUEEZY_PRODUCT_ID);
  if (!storeId || !productId) return deny(503, "License service is not configured. Please contact support.");
  const belongsToHalyo = data => data?.meta && String(data.meta.store_id) === storeId && String(data.meta.product_id) === productId;
  const knownStatus = data => ["active", "inactive"].includes(data?.license_key?.status);
  const callLicenseApi = async (action, params) => {
    const response = await fetch(`https://api.lemonsqueezy.com/v1/licenses/${action}`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 429 || response.status >= 500) throw new Error("Upstream unavailable");
    const data = await response.json();
    return { ok: response.ok, data };
  };
  try {
    const params = { license_key: licenseKey };
    if (instanceId) params.instance_id = instanceId;
    const validated = await callLicenseApi("validate", params);
    const vData = validated.data;
    if (!validated.ok || vData?.valid !== true || !knownStatus(vData)) return deny(200, "Invalid, expired or disabled license");
    if (!belongsToHalyo(vData)) return deny(200, "This license is not for Halyo");

    let activationToken;
    if (instanceId) {
      // Revalidate the supplied instance; never activate another one on return.
      if (vData.instance?.id !== instanceId || vData.license_key.status !== "active") return deny(200, "This browser instance is not active");
      activationToken = instanceId;
    } else {
      const activated = await callLicenseApi("activate", { license_key: licenseKey, instance_name: instanceName });
      const aData = activated.data;
      if (!activated.ok || aData?.activated !== true || typeof aData.instance?.id !== "string" || !aData.instance.id.trim() || aData.license_key?.status !== "active" || !belongsToHalyo(aData)) {
        return deny(200, "License activation could not be completed. Please contact support if you already activated this key.");
      }
      activationToken = aData.instance.id;
    }
    return reply(200, {
      valid: true,
      customerName: vData.meta?.customer_name || null,
      productName: vData.meta?.product_name || null,
      activationToken,
    });
  } catch {
    // No keys, upstream payloads or customer details in errors/logs.
    return deny(503, "Couldn't reach the license service. Please try again.");
  }
}
