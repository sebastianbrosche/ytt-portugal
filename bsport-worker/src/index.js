// bsport Webhook Receiver → Google Sheets Sync
// Receives bsport webhooks, appends data to Google Sheets

const GOOGLE_CLIENT_ID = "155462436083-nf3oe6q4s95fchbeqqq5540go7o8q8rp.apps.googleusercontent.com"
const GOOGLE_REFRESH_TOKEN = "1//018zjyFLqI5wjCgYIARAAGAESNgF-L9IrQjxHMUcUUWMXrGlXRaNAJSJzueFYJSsIhdXksxVBPzSu-MJsLanz9ulovsJ6NdLzJg"

const SHEET_ID = "1SH1SZ0BIa9yyBgo2WgWtUg5AINnplgMkSott6NsIAT0"
const SHEET_NAMES = {
  "member-create": "Members",
  "member-update": "Members",
  "booking-create": "Bookings",
  "booking-update": "Bookings",
  "invoice-create": "Revenue",
  "invoice-pay": "Revenue",
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

// Email helper
async function sendEmail({ to, subject, html, apiKey }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Heat Lagos Daily <daily@heatlagos.com>",
      to,
      subject,
      html,
    }),
  })
  return response
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS, status: 204 })
    }

    try {
      if (path === "/api/bsport-webhook" && request.method === "POST") {
        return await handleWebhook(request, env, ctx)
      }
      
      if (path === "/api/test" && request.method === "GET") {
        return await handleTest(request, env)
      }

      if (path === "/api/trigger-daily" && request.method === "GET") {
        // Manual trigger for daily briefing (Sebastian only)
        const token = url.searchParams.get("token")
        if (token !== "yttl3ads2026!") {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          })
        }
        await sendDailyBriefing(env)
        return new Response(JSON.stringify({ success: true, message: "Daily briefing sent" }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        })
      }

      if (path === "/api/monthly-report" && request.method === "GET") {
        const token = url.searchParams.get("token")
        if (token !== "yttl3ads2026!") {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          })
        }
        const year = parseInt(url.searchParams.get("year") || new Date().getFullYear().toString())
        const month = parseInt(url.searchParams.get("month") || (new Date().getMonth() + 1).toString())
        
        const { generateMonthlyReport } = await import("./charts.js")
        const html = await generateMonthlyReport(env.BSPORT_API_TOKEN, year, month, env)
        
        return new Response(html, {
          headers: { "Content-Type": "text/html" },
        })
      }

      if (path === "/" && request.method === "GET") {
        return new Response(getDashboardHTML(), {
          headers: { "Content-Type": "text/html" },
        })
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      })
    }
  },

  async scheduled(event, env, ctx) {
    // Daily briefing at 8pm for Stine
    if (event.cron === "0 19 * * *") {
      ctx.waitUntil(sendDailyBriefing(env))
    }
    // Monthly report on 1st of month at 8am
    if (event.cron === "0 8 1 * *") {
      ctx.waitUntil(sendMonthlyReport(env))
    }
  },
}

async function handleWebhook(request, env, ctx) {
  const body = await request.text()
  let data
  try {
    data = JSON.parse(body)
  } catch {
    data = { raw: body }
  }

  const eventType = data.event || "unknown"
  const timestamp = new Date().toISOString()
  const today = new Date().toISOString().split("T")[0]

  // Store in KV for backup
  const id = crypto.randomUUID()
  await env.BSPORT_KV.put(`webhook:${id}`, JSON.stringify({ id, eventType, timestamp, data }))

  // Track daily stats in KV
  const statsKey = `stats:${today}`
  let stats = await env.BSPORT_KV.get(statsKey)
  stats = stats ? JSON.parse(stats) : { members: 0, bookings: 0, revenue: 0 }
  
  if (eventType === "member-create") stats.members++
  if (eventType === "booking-create") stats.bookings++
  if (eventType === "invoice-pay") {
    const amount = parseFloat(data.invoice?.amount || data.invoice?.total_amount || 0)
    stats.revenue += amount
  }
  
  await env.BSPORT_KV.put(statsKey, JSON.stringify(stats))

  // Append to Google Sheet
  ctx.waitUntil(appendToSheet(eventType, data, timestamp, env))

  return new Response(JSON.stringify({ success: true, id }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  })
}

async function sendDailyBriefing(env) {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) {
    console.error("No RESEND_API_KEY configured")
    return
  }

  const today = new Date().toISOString().split("T")[0]
  const statsKey = `stats:${today}`
  let stats = await env.BSPORT_KV.get(statsKey)
  stats = stats ? JSON.parse(stats) : { members: 0, bookings: 0, revenue: 0 }

  // Also get yesterday for comparison
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0]
  const yesterdayKey = `stats:${yesterday}`
  let yesterdayStats = await env.BSPORT_KV.get(yesterdayKey)
  yesterdayStats = yesterdayStats ? JSON.parse(yesterdayStats) : { members: 0, bookings: 0, revenue: 0 }

  const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; color: #333; }
    h2 { color: #b87333; }
    .stat-box { background: #f5f0ea; padding: 16px; border-radius: 8px; margin: 12px 0; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .stat-value { font-size: 28px; font-weight: bold; color: #1a1a1a; }
    .comparison { font-size: 14px; color: #666; margin-top: 4px; }
    .footer { margin-top: 24px; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <h2>Heat Lagos Daily Summary — ${today}</h2>
  
  <div class="stat-box">
    <div class="stat-label">New Members Today</div>
    <div class="stat-value">${stats.members}</div>
    <div class="comparison">Yesterday: ${yesterdayStats.members}</div>
  </div>
  
  <div class="stat-box">
    <div class="stat-label">New Bookings Today</div>
    <div class="stat-value">${stats.bookings}</div>
    <div class="comparison">Yesterday: ${yesterdayStats.bookings}</div>
  </div>
  
  <div class="stat-box">
    <div class="stat-label">Revenue Today</div>
    <div class="stat-value">€${stats.revenue.toFixed(2)}</div>
    <div class="comparison">Yesterday: €${yesterdayStats.revenue.toFixed(2)}</div>
  </div>
  
  <div class="footer">
    <p>Auto-generated by Heat Lagos AI</p>
    <p><a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}">View full data →</a></p>
  </div>
</body>
</html>`

  await sendEmail({
    to: "stine.hegre@gmail.com",
    subject: `Heat Lagos Daily — ${today}`,
    html,
    apiKey,
  })

  // Also send to Sebastian
  await sendEmail({
    to: "sebastian.brosche@gmail.com",
    subject: `Heat Lagos Daily (Stine copy) — ${today}`,
    html,
    apiKey,
  })
}

async function sendMonthlyReport(env) {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) {
    console.error("No RESEND_API_KEY configured")
    return
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1

  const { generateMonthlyReport } = await import("./charts.js")
  const html = await generateMonthlyReport(env.BSPORT_API_TOKEN, year, month, env)

  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" })

  await sendEmail({
    to: "sebastian.brosche@gmail.com",
    subject: `Heat Lagos Monthly Report — ${monthName}`,
    html: `
      <p>Your monthly report is ready. <a href="https://bsport-sync.sebastian-brosche.workers.dev/api/monthly-report?token=yttl3ads2026!&year=${year}&month=${month}">View online →</a></p>
      <p>Or view the full data in Google Sheets: <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}">Open Sheet →</a></p>
    `,
    apiKey,
  })

  // Also send to Stine
  await sendEmail({
    to: "stine.hegre@gmail.com",
    subject: `Heat Lagos Monthly Report — ${monthName}`,
    html: `
      <p>Your monthly report is ready. <a href="https://bsport-sync.sebastian-brosche.workers.dev/api/monthly-report?token=yttl3ads2026!&year=${year}&month=${month}">View online →</a></p>
      <p>Or view the full data in Google Sheets: <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}">Open Sheet →</a></p>
    `,
    apiKey,
  })
}

async function getGoogleAccessToken(env) {
  const clientSecret = env.GOOGLE_CLIENT_SECRET
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: clientSecret,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  })
  
  if (!response.ok) {
    throw new Error(`Google auth failed: ${response.status}`)
  }
  
  const result = await response.json()
  return result.access_token
}

async function appendToSheet(eventType, data, timestamp, env) {
  const sheetName = SHEET_NAMES[eventType] || "RawData"
  const accessToken = await getGoogleAccessToken(env)

  let values = []

  if (eventType === "member-create" || eventType === "member-update") {
    const member = data.member || data
    values = [
      timestamp,
      eventType,
      member.id || "",
      `${member.first_name || ""} ${member.last_name || ""}`.trim(),
      member.email || "",
      member.created_at || "",
      data.source || "bsport",
      JSON.stringify(data).slice(0, 50000),
    ]
  } else if (eventType === "booking-create" || eventType === "booking-update") {
    const booking = data.booking || data
    values = [
      timestamp,
      eventType,
      booking.id || "",
      `${booking.member_first_name || ""} ${booking.member_last_name || ""}`.trim(),
      booking.session_name || booking.activity_name || "",
      booking.session_date || "",
      booking.status || "",
      JSON.stringify(data).slice(0, 50000),
    ]
  } else if (eventType === "invoice-create" || eventType === "invoice-pay") {
    const invoice = data.invoice || data
    values = [
      timestamp,
      eventType,
      invoice.id || "",
      `${invoice.member_first_name || ""} ${invoice.member_last_name || ""}`.trim(),
      invoice.amount || invoice.total_amount || "",
      invoice.status || "",
      JSON.stringify(data).slice(0, 50000),
    ]
  } else {
    values = [
      timestamp,
      eventType,
      "",
      "",
      "",
      "",
      "",
      JSON.stringify(data).slice(0, 50000),
    ]
  }

  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${sheetName}!A1:H1:append?valueInputOption=RAW`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        values: [values],
      }),
    }
  )

  if (!response.ok) {
    console.error("Sheet append failed:", await response.text())
  }
}

async function handleTest(request, env) {
  try {
    const token = await getGoogleAccessToken(env)
    return new Response(JSON.stringify({ success: true, message: "Google auth working" }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>bsport Sync Dashboard</title>
<style>
body{font-family:Inter,system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;color:#1a1a1a}
h1{font-size:28px;margin-bottom:8px}
.subtitle{color:#666;margin-bottom:24px}
.stat{background:#f5f0ea;padding:16px;border-radius:8px;margin-bottom:8px}
.stat-label{font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.05em}
.stat-value{font-size:24px;font-weight:800;color:#b87333}
code{background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:13px}
</style></head><body>
<h1>bsport → Google Sheets Sync</h1>
<p class="subtitle">Heat Lagos bsport Webhook Receiver</p>
<div class="stat"><div class="stat-label">Webhook Endpoint</div><div class="stat-value" style="font-size:14px"><code>https://bsport-sync.sebastian-brosche.workers.dev/api/bsport-webhook</code></div></div>
<div class="stat"><div class="stat-label">Google Sheet</div><div class="stat-value" style="font-size:14px"><a href="https://docs.google.com/spreadsheets/d/1SH1SZ0BIa9yyBgo2WgWtUg5AINnplgMkSott6NsIAT0" target="_blank">Heat Lagos - bsport Data Sync</a></div></div>
<p><strong>Supported events:</strong> member-create, member-update, booking-create, booking-update, invoice-create, invoice-pay</p>
</body></html>`
}
