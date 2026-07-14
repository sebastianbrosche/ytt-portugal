// YTT / Sculpt lead capture + pricing flip worker
// ##grok 2026-07-14

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Early bird ends at start of this calendar day (Europe/Lisbon).
const EARLY_BIRD_END_DATE = "2026-07-15"; // first day of regular €550 price
const SCULPT_EARLY = 490;
const SCULPT_REGULAR = 550;
const PAY_URL =
  "https://backoffice.bsport.io/customer/payment/shop-item/460282/?membership=5821";
const GITHUB_OWNER = "sebastianbrosche";
const GITHUB_REPO = "heatlagos";
const GITHUB_PATH = "waitlist/2027-teacher-training-leads.jsonl";
const GITHUB_BRANCH = "main";
const STINE_EMAIL = "stine.hegre@gmail.com";

function lisbonDateISO(d = new Date()) {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function resolvePricing(earlyBirdEndedFlag) {
  const today = lisbonDateISO();
  const endedByDate = today >= EARLY_BIRD_END_DATE;
  const earlyBirdEnded = earlyBirdEndedFlag === true || endedByDate;
  const price = earlyBirdEnded ? SCULPT_REGULAR : SCULPT_EARLY;
  return {
    programme: "sculpt-sept-2026",
    earlyBirdEnded,
    earlyBirdEndDate: EARLY_BIRD_END_DATE,
    price,
    currency: "EUR",
    spotsLeft: 1,
    spotsLabel: "One spot left",
    payUrl: PAY_URL,
    todayLisbon: today,
  };
}

async function sendEmail({ to, subject, html, apiKey }) {
  const recipients = Array.isArray(to)
    ? to
    : String(to)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Heat Lagos Training <leads@yogateachertrainingportugal.eu>",
      to: recipients,
      subject,
      html,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error("Resend error", response.status, text);
  }
  return response;
}

async function appendLeadToGitHub(lead, env) {
  const token = env.GITHUB_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN;
  if (!token) {
    console.warn("GITHUB_TOKEN not set; skip GitHub waitlist save");
    return { ok: false, reason: "no_token" };
  }

  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ytt-leads-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  let sha = undefined;
  let existing = "";
  const getRes = await fetch(`${apiBase}?ref=${GITHUB_BRANCH}`, { headers });
  if (getRes.status === 200) {
    const body = await getRes.json();
    sha = body.sha;
    existing = atob(body.content.replace(/\n/g, ""));
  } else if (getRes.status !== 404) {
    const t = await getRes.text();
    console.error("GitHub get failed", getRes.status, t);
    return { ok: false, reason: "get_failed", status: getRes.status };
  }

  const line = JSON.stringify(lead);
  const next = existing ? `${existing.replace(/\s*$/, "")}\n${line}\n` : `${line}\n`;
  const contentB64 = btoa(unescape(encodeURIComponent(next)));

  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `waitlist: add lead ${lead.email} ##grok`,
      content: contentB64,
      branch: GITHUB_BRANCH,
      sha,
      committer: {
        name: "ytt-leads-worker",
        email: "leads@yogateachertrainingportugal.eu",
      },
    }),
  });

  if (!putRes.ok) {
    const t = await putRes.text();
    console.error("GitHub put failed", putRes.status, t);
    return { ok: false, reason: "put_failed", status: putRes.status };
  }
  return { ok: true };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    try {
      if (path === "/api/pricing" && request.method === "GET") {
        const flag = await env.LEADS_KV.get("pricing:sculpt:early_bird_ended");
        const pricing = resolvePricing(flag === "1");
        return json(pricing);
      }

      if (path === "/api/capture" && request.method === "POST") {
        return await handleCapture(request, env, ctx);
      }

      if (path === "/api/leads" && request.method === "GET") {
        return await handleListLeads(request, env);
      }

      if (path === "/api/export" && request.method === "GET") {
        return await handleExport(request, env);
      }

      if (path === "/" && request.method === "GET") {
        return new Response(getDashboardHTML(), {
          headers: { "Content-Type": "text/html" },
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  },

  // Daily cron: only acts on EARLY_BIRD_END_DATE (Lisbon), then is a no-op.
  async scheduled(event, env, ctx) {
    const today = lisbonDateISO();
    if (today < EARLY_BIRD_END_DATE) {
      console.log("pricing cron: before flip date", today);
      return;
    }
    const already = await env.LEADS_KV.get("pricing:sculpt:early_bird_ended");
    if (already === "1") {
      console.log("pricing cron: already flipped");
      return;
    }
    await env.LEADS_KV.put("pricing:sculpt:early_bird_ended", "1");
    await env.LEADS_KV.put(
      "pricing:sculpt:flipped_at",
      new Date().toISOString()
    );
    console.log("pricing cron: early bird ended, regular €550 active", today);

    if (env.RESEND_API_KEY) {
      ctx.waitUntil(
        sendEmail({
          to: STINE_EMAIL,
          subject: "Sculpt pricing flipped to €550 (early bird ended)",
          html: `<p>Early bird for SCULPT Sept 2026 has ended (Lisbon date ${today}).</p>
                 <p>Site price is now <strong>€550</strong>. Spots: <strong>one left</strong>.</p>
                 <p>Worker KV flag pricing:sculpt:early_bird_ended = 1</p>`,
          apiKey: env.RESEND_API_KEY,
        })
      );
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function handleCapture(request, env, ctx) {
  let data;
  try {
    data = await request.json();
  } catch {
    const formData = await request.formData();
    data = Object.fromEntries(formData.entries());
  }

  const email = (data.email || "").trim().toLowerCase();
  const name = (data.name || "").trim();
  const source = (data.source || "website").trim();
  const programme = (data.programme || "sculpt-2026").trim();
  const interest = (data.interest || "").trim();

  if (!email || !isValidEmail(email)) {
    return json({ error: "Valid email required" }, 400);
  }

  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const lead = {
    id,
    email,
    name,
    source,
    programme,
    interest,
    timestamp,
    ip: request.headers.get("cf-connecting-ip") || "unknown",
  };

  await env.LEADS_KV.put(`lead:${id}`, JSON.stringify(lead));
  const existing = await env.LEADS_KV.get(`email:${email}`);
  if (!existing) {
    await env.LEADS_KV.put(`email:${email}`, id);
  }

  // Waitlist / all captures: email Stine + append GitHub heatlagos
  const isWaitlist =
    programme.includes("2027") ||
    source.includes("waitlist") ||
    interest === "waitlist-2027";

  if (env.RESEND_API_KEY) {
    ctx.waitUntil(notifyStine(lead, env, isWaitlist));
  }

  if (isWaitlist) {
    ctx.waitUntil(appendLeadToGitHub(lead, env));
  }

  return json({
    success: true,
    id,
    message: isWaitlist
      ? "You're on the 2027 waitlist. We'll be in touch."
      : "Thanks! Check your inbox.",
  });
}

async function notifyStine(lead, env, isWaitlist) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  const subject = isWaitlist
    ? `2027 training waitlist: ${lead.email}`
    : `New training lead: ${lead.email}`;

  await sendEmail({
    to: STINE_EMAIL,
    subject,
    html: `<p>${isWaitlist ? "New <strong>2027 waitlist</strong> signup" : "New training lead"}:</p>
           <ul>
             <li>Email: ${escapeHtml(lead.email)}</li>
             <li>Name: ${escapeHtml(lead.name || "Not provided")}</li>
             <li>Programme: ${escapeHtml(lead.programme)}</li>
             <li>Source: ${escapeHtml(lead.source)}</li>
             <li>Interest: ${escapeHtml(lead.interest || "-")}</li>
             <li>Time: ${escapeHtml(lead.timestamp)}</li>
           </ul>
           <p>Saved to KV and ${
             isWaitlist
               ? `GitHub <code>${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_PATH}</code>`
               : "KV (non-waitlist)"
           }.</p>`,
    apiKey,
  });
}

async function handleListLeads(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }

  const list = await env.LEADS_KV.list({ prefix: "lead:" });
  const leads = [];
  for (const key of list.keys) {
    const value = await env.LEADS_KV.get(key.name);
    if (value) leads.push(JSON.parse(value));
  }
  leads.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return json({ count: leads.length, leads });
}

async function handleExport(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }

  const list = await env.LEADS_KV.list({ prefix: "lead:" });
  const leads = [];
  for (const key of list.keys) {
    const value = await env.LEADS_KV.get(key.name);
    if (value) leads.push(JSON.parse(value));
  }
  leads.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const headers = [
    "id",
    "email",
    "name",
    "source",
    "programme",
    "interest",
    "timestamp",
    "ip",
  ];
  const rows = leads.map((l) =>
    headers.map((h) => l[h] ?? "")
  );
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="training-leads-${new Date()
        .toISOString()
        .split("T")[0]}.csv"`,
    },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Lead Dashboard</title>
</head>
<body>
  <h1>Training leads</h1>
  <p>Use /api/leads?token=… and /api/export?token=…</p>
  <p>Pricing: GET /api/pricing</p>
</body>
</html>`;
}
