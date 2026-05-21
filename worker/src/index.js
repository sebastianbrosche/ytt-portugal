// YTT Lead Capture Worker
// Stores leads in KV, sends email notifications, provides admin dashboard

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Resend email helper
async function sendEmail({ to, subject, html, apiKey }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "YTT Leads <leads@yogateachertrainingportugal.eu>",
      to,
      subject,
      html,
    }),
  });
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    try {
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

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  },
};

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

  if (!email || !isValidEmail(email)) {
    return new Response(
      JSON.stringify({ error: "Valid email required" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  const lead = { id, email, name, source, timestamp, ip: request.headers.get("cf-connecting-ip") || "unknown" };

  // Store in KV
  await env.LEADS_KV.put(`lead:${id}`, JSON.stringify(lead));
  
  // Also keep an index by email for dedup
  const existing = await env.LEADS_KV.get(`email:${email}`);
  if (!existing) {
    await env.LEADS_KV.put(`email:${email}`, id);
  }

  // Send email notification if Resend is configured
  if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
    ctx.waitUntil(sendNotificationEmail(lead, env));
  }

  return new Response(
    JSON.stringify({ success: true, id, message: "Thanks! Check your inbox." }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}

async function sendNotificationEmail(lead, env) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;

  await sendEmail({
    to: "sebastian.brosche@gmail.com",
    subject: `New YTT Lead: ${lead.email}`,
    html: `<p>New lead captured:</p>
           <ul>
             <li>Email: ${lead.email}</li>
             <li>Name: ${lead.name || "Not provided"}</li>
             <li>Source: ${lead.source}</li>
             <li>Time: ${lead.timestamp}</li>
           </ul>
           <p><a href="https://ytt-leads.sebastian-brosche.workers.dev/">View all leads</a></p>`,
    apiKey,
  });
}

async function handleListLeads(request, env) {
  // Simple auth: check for a secret token in query param
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const list = await env.LEADS_KV.list({ prefix: "lead:" });
  const leads = [];
  for (const key of list.keys) {
    const value = await env.LEADS_KV.get(key.name);
    if (value) leads.push(JSON.parse(value));
  }

  // Sort by newest first
  leads.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return new Response(JSON.stringify({ count: leads.length, leads }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function handleExport(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token !== env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const list = await env.LEADS_KV.list({ prefix: "lead:" });
  const leads = [];
  for (const key of list.keys) {
    const value = await env.LEADS_KV.get(key.name);
    if (value) leads.push(JSON.parse(value));
  }
  leads.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  // CSV export
  const headers = ["id", "email", "name", "source", "timestamp", "ip"];
  const rows = leads.map(l => [l.id, l.email, l.name, l.source, l.timestamp, l.ip]);
  const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${(v || "").replace(/"/g, '""')}"`).join(","))].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="ytt-leads-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YTT Lead Dashboard</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    .subtitle { color: #666; margin-bottom: 24px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat { background: #f5f0ea; padding: 16px; border-radius: 8px; }
    .stat-value { font-size: 32px; font-weight: 800; color: #b87333; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th { text-align: left; padding: 12px; border-bottom: 2px solid #e5e5e5; font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid #f0f0f0; }
    .empty { color: #999; font-style: italic; padding: 40px 0; text-align: center; }
    .loading { color: #666; padding: 40px 0; text-align: center; }
    .token-input { margin-bottom: 16px; }
    input { padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; width: 300px; }
    button { padding: 8px 16px; background: #b87333; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
    button:hover { background: #a0632a; }
    .export { margin-left: 8px; background: #1a1a1a; }
    .export:hover { background: #333; }
  </style>
</head>
<body>
  <h1>YTT Lead Dashboard</h1>
  <p class="subtitle">Heat Lagos Yoga Teacher Training — Lead Capture</p>
  
  <div class="token-input">
    <input type="password" id="token" placeholder="Admin token" />
    <button onclick="loadLeads()">Load Leads</button>
    <button class="export" onclick="exportCSV()">Export CSV</button>
  </div>
  
  <div class="stats" id="stats">
    <div class="stat">
      <div class="stat-value" id="totalLeads">-</div>
      <div class="stat-label">Total Leads</div>
    </div>
  </div>
  
  <div id="tableContainer"><p class="loading">Enter token and click Load Leads</p></div>

  <script>
    async function loadLeads() {
      const token = document.getElementById("token").value;
      const container = document.getElementById("tableContainer");
      container.innerHTML = '<p class="loading">Loading...</p>';
      
      try {
        const res = await fetch("/api/leads?token=" + encodeURIComponent(token));
        const data = await res.json();
        
        if (res.status === 401) {
          container.innerHTML = '<p class="empty">Invalid token</p>';
          return;
        }
        
        document.getElementById("totalLeads").textContent = data.count;
        
        if (!data.leads.length) {
          container.innerHTML = '<p class="empty">No leads yet</p>';
          return;
        }
        
        const rows = data.leads.map(l => \`
          <tr>
            <td>\${l.email}</td>
            <td>\${l.name || "—"}</td>
            <td>\${l.source}</td>
            <td>\${new Date(l.timestamp).toLocaleString()}</td>
          </tr>
        \`).join("");
        
        container.innerHTML = \`
          <table>
            <thead>
              <tr><th>Email</th><th>Name</th><th>Source</th><th>Date</th></tr>
            </thead>
            <tbody>\${rows}</tbody>
          </table>
        \`;
      } catch (err) {
        container.innerHTML = '<p class="empty">Error loading leads: ' + err.message + '</p>';
      }
    }
    
    function exportCSV() {
      const token = document.getElementById("token").value;
      window.open("/api/export?token=" + encodeURIComponent(token));
    }
  </script>
</body>
</html>`;
}
