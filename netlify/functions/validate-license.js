// ───────────────────────────────────────────────────────────────
// Halyo — license key validation (NETLIFY Function)
// Place this file at:  netlify/functions/validate-license.js
// Your app will call it at:  /.netlify/functions/validate-license
// (or /api/validate-license if you add the redirect in netlify.toml — see guide)
//
// ENV VARS to set in Netlify dashboard (Site settings → Environment variables):
//   LEMONSQUEEZY_API_KEY   → your LS API key (LS → Settings → API)
//   LEMONSQUEEZY_STORE_ID  → your Halyo store's numeric ID (optional)
//
// The API key is SECRET — it lives only here in Netlify's env, never in
// the browser/app code.
// ───────────────────────────────────────────────────────────────

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*", // tighten to your domain in production
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")
    return { statusCode: 405, headers, body: JSON.stringify({ valid: false, error: "Method not allowed" }) };

  try {
    const { licenseKey, instanceName } = JSON.parse(event.body || "{}");
    if (!licenseKey || typeof licenseKey !== "string" || licenseKey.length < 8) {
      return { statusCode: 400, headers, body: JSON.stringify({ valid: false, error: "Missing or malformed license key" }) };
    }

    const API = process.env.LEMONSQUEEZY_API_KEY;
    const STORE_ID = process.env.LEMONSQUEEZY_STORE_ID; // optional
    if (!API) return { statusCode: 500, headers, body: JSON.stringify({ valid: false, error: "Server not configured" }) };

    // 1) VALIDATE the key with Lemon Squeezy
    const vResp = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ license_key: licenseKey }),
    });
    const vData = await vResp.json();

    if (!vData || vData.valid !== true) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: "Invalid or inactive license" }) };
    }

    // Optional: ensure the key belongs to YOUR store
    if (STORE_ID && vData.meta && String(vData.meta.store_id) !== String(STORE_ID)) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: "License not for this product" }) };
    }

    const status = vData.license_key?.status;
    if (status && !["active", "inactive"].includes(status)) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: `License ${status}` }) };
    }

    // 2) ACTIVATE (optional): bind key to one instance so it can't be shared endlessly
    let activationToken = null;
    if (instanceName) {
      const aResp = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ license_key: licenseKey, instance_name: instanceName }),
      });
      const aData = await aResp.json();
      if (aData && aData.activated) activationToken = aData.instance?.id || null;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        valid: true,
        customerName: vData.meta?.customer_name || null,
        productName: vData.meta?.product_name || null,
        activationToken,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ valid: false, error: "Validation failed, try again" }) };
  }
}
