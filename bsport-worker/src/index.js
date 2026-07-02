// bsport Webhook Receiver → Google Sheets Sync
// Receives bsport webhooks, appends data to Google Sheets

const GOOGLE_CLIENT_ID = "155462436083-nf3oe6q4s95fchbeqqq5540go7o8q8rp.apps.googleusercontent.com"
const GOOGLE_REFRESH_TOKEN = "1//018zjyFLqI5wjCgYIARAAGAESNgF-L9IrQjxHMUcUUWMXrGlXRaNAJSJzueFYJSsIhdXksxVBPzSu-MJsLanz9ulovsJ6NdLzJg"

const SHEET_ID = "1SH1SZ0BIa9yyBgo2WgWtUg5AINnplgMkSott6NsIAT0"

// Meta Conversions API (Heat Lagos pixel) — server-side Purchase on invoice-pay
const META_PIXEL_ID = "3470828096400989"
const META_GRAPH = "https://graph.facebook.com/v21.0"

// GA4 Measurement Protocol (heatlagosweb stream) — mirror Purchase into GA4
const GA4_MEASUREMENT_ID = "G-L61V7HF6H2"

// Send a GA4 purchase event server-side so bsport sales show up in Analytics
// with revenue. client_id is derived from the member so repeat buys tie together.
async function sendGa4Purchase(data, env) {
  const secret = env.GA4_MP_SECRET
  if (!secret) {
    console.log("GA4_MP_SECRET not set — skipping GA4 purchase")
    return
  }
  const invoice = data.invoice || data
  const value = parseFloat(invoice.amount || invoice.total_amount || 0) || 0
  const memberId = invoice.member_id || invoice.member || data.member?.id || "unknown"
  const txId = `invoice_${invoice.id || crypto.randomUUID()}`

  const payload = {
    client_id: `bsport.${memberId}`,
    events: [
      {
        name: "purchase",
        params: {
          currency: "EUR",
          value,
          transaction_id: txId,
          source: "bsport",
        },
      },
    ],
  }
  const res = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${secret}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
  )
  console.log(`GA4 Purchase (€${value}): ${res.status}`)
}

async function sha256Hex(input) {
  if (input === null || input === undefined || input === "") return null
  const norm = String(input).trim().toLowerCase()
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// Fire a Purchase event to Meta when bsport reports a paid invoice. This is the
// reliable, ad-blocker-proof signal that an intro offer / pass was actually paid.
async function sendMetaCapiPurchase(data, env) {
  const token = env.HEAT_META_CAPI_TOKEN
  if (!token) {
    console.log("HEAT_META_CAPI_TOKEN not set — skipping Meta CAPI Purchase")
    return
  }
  const invoice = data.invoice || data
  const value = parseFloat(invoice.amount || invoice.total_amount || 0) || 0

  const userData = {}
  const em = await sha256Hex(invoice.member_email || data.member?.email || invoice.email)
  if (em) userData.em = [em]
  const fn = await sha256Hex(invoice.member_first_name || data.member?.first_name)
  if (fn) userData.fn = [fn]
  const ln = await sha256Hex(invoice.member_last_name || data.member?.last_name)
  if (ln) userData.ln = [ln]
  const ext = await sha256Hex(invoice.member_id || invoice.member || data.member?.id)
  if (ext) userData.external_id = [ext]

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: "https://www.heatlagos.com/hot-yoga-pilates-intro-offer",
        event_id: `invoice_${invoice.id || crypto.randomUUID()}`,
        user_data: userData,
        custom_data: { currency: "EUR", value },
      },
    ],
  }

  const res = await fetch(`${META_GRAPH}/${META_PIXEL_ID}/events?access_token=${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const txt = await res.text()
  console.log(`Meta CAPI Purchase (€${value}): ${res.status} ${txt.slice(0, 300)}`)
}
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
async function sendEmail({ to, subject, html, apiKey, from }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: from || "Heat Lagos Daily <daily@heatlagos.com>",
      to,
      subject,
      html,
    }),
  })
  return response
}

async function fetchBsportManagement(endpoint, params, env) {
  const apiKey = env.BSPORT_JWT_TOKEN;
  const baseUrl = "https://public.production.bsport.io/api/v1/management";
  const url = new URL(`${baseUrl}/${endpoint}`);
  
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val);
  }

  const results = [];
  let currentUrl = url.toString();

  while (currentUrl) {
    const response = await fetch(currentUrl, {
      headers: {
        "Accept": "application/json",
        "X-API-Key": apiKey,
        "X-Client-ID": "heat",
        "X-Company-ID": "5821"
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Bsport API error on ${endpoint}: ${response.status} - ${errText}`);
    }

    const data = await response.json();
    if (data && Array.isArray(data.results)) {
      results.push(...data.results);
      currentUrl = data.next || null;
    } else {
      return data;
    }
  }

  return results;
}

async function sendWeeklyReviewReminders(env, dryRun = false) {
  const apiKey = env.BSPORT_JWT_TOKEN;
  if (!apiKey) {
    throw new Error("BSPORT_JWT_TOKEN is not configured");
  }
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  // Calculate target dates (previous Monday to Sunday)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysToSubtractForSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
  const lastSunday = new Date(today.getTime() - daysToSubtractForSunday * 24 * 60 * 60 * 1000);
  const lastMonday = new Date(lastSunday.getTime() - 6 * 24 * 60 * 60 * 1000);

  const startDateStr = getFormattedDate(lastMonday);
  const endDateStr = getFormattedDate(lastSunday);

  console.log(`Checking first-timers between ${startDateStr} and ${endDateStr}`);

  // 1. Fetch bookings in the target range
  const bookings = await fetchBsportManagement(
    "bookings/",
    {
      session_started_after_date: startDateStr,
      session_started_before_date: endDateStr,
      page_size: "100"
    },
    env
  );

  // Filter for active bookings (booking_status_code === "OK")
  const activeBookings = bookings.filter(b => b.booking_status_code === "OK");
  console.log(`Found ${activeBookings.length} active bookings in the range.`);

  // Group bookings by client_id
  const clientBookingsMap = new Map();
  for (const b of activeBookings) {
    if (!clientBookingsMap.has(b.client_id)) {
      clientBookingsMap.set(b.client_id, []);
    }
    clientBookingsMap.get(b.client_id).push(b);
  }

  const clientsToProcess = [];
  
  for (const [clientId, cb] of clientBookingsMap.entries()) {
    try {
      const client = await fetchBsportManagement(`clients/${clientId}/`, {}, env);
      
      // Check if client has tag "reviewed" (122123) or "review-reminder-sent" (122124)
      const tagIds = client.tag_ids || [];
      if (tagIds.includes(122123) || tagIds.includes(122124)) {
        console.log(`Client ${client.fullname} (${client.email}) already reviewed or reminder sent. Skipping.`);
        continue;
      }

      // Check if the client has any active bookings BEFORE the target week (lastMonday)
      const prevBookings = await fetchBsportManagement(
        "bookings/",
        {
          client_id: clientId.toString(),
          session_started_before_date: startDateStr,
          page_size: "10"
        },
        env
      );

      const activePrevBookings = prevBookings.filter(b => b.booking_status_code === "OK");
      if (activePrevBookings.length > 0) {
        console.log(`Client ${client.fullname} (${client.email}) has ${activePrevBookings.length} previous bookings before ${startDateStr}. Not a first-timer.`);
        continue;
      }

      // This is a first timer!
      clientsToProcess.push({ client, bookings: cb });
    } catch (err) {
      console.error(`Error processing client ${clientId}:`, err);
    }
  }

  console.log(`Found ${clientsToProcess.length} first-timers to email.`);

  const results = [];
  for (const item of clientsToProcess) {
    const { client } = item;
    const email = client.email;
    const firstName = client.firstname || client.fullname.split(" ")[0] || "there";
    const fullName = client.fullname;

    const emailHtml = getReviewReminderEmailHtml(firstName);
    const subject = "How was your first class at Heat?";

    const result = {
      client_id: client.id,
      fullname: fullName,
      email,
      sent: false,
      tagged: false,
      error: null
    };

    if (dryRun) {
      result.sent = "dry-run";
      result.tagged = "dry-run";
      results.push(result);
      continue;
    }

    try {
      // Send the email using Resend
      const resendResponse = await sendEmail({
        to: email,
        subject,
        html: emailHtml,
        apiKey: resendApiKey,
        from: "Sebastian | Heat Lagos <daily@heatlagos.com>"
      });

      if (!resendResponse.ok) {
        const errText = await resendResponse.text();
        throw new Error(`Resend API failed: ${resendResponse.status} - ${errText}`);
      }

      result.sent = true;

      // Add "review-reminder-sent" tag (122124) to client
      const tagResponse = await fetch(`https://public.production.bsport.io/api/v1/management/clients/${client.id}/tag/`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Client-ID": "heat",
          "X-Company-ID": "5821"
        },
        body: JSON.stringify({ tag_id: 122124 })
      });

      if (!tagResponse.ok) {
        const errText = await tagResponse.text();
        console.error(`Failed to tag client ${client.id}: ${tagResponse.status} - ${errText}`);
        result.tag_error = `Failed to tag client: ${tagResponse.status}`;
      } else {
        result.tagged = true;
      }
    } catch (err) {
      console.error(`Error processing reminder for ${fullName}:`, err);
      result.error = err.message;
    }

    results.push(result);
  }

  return {
    range: { start: startDateStr, end: endDateStr },
    total_bookings: bookings.length,
    active_bookings: activeBookings.length,
    first_timers_identified: clientsToProcess.length,
    results
  };
}

function getFormattedDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getReviewReminderEmailHtml(firstName) {
  const formattedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      line-height: 1.6;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .greeting {
      font-size: 16px;
      margin-bottom: 16px;
    }
    .content {
      font-size: 15px;
      margin-bottom: 24px;
    }
    .button-container {
      margin: 24px 0;
      text-align: center;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      margin: 8px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: bold;
      font-size: 14px;
      color: #ffffff !important;
    }
    .btn-google {
      background-color: #1a73e8;
    }
    .btn-tripadvisor {
      background-color: #34e0a1;
      color: #000000 !important;
    }
    .footer {
      font-size: 13px;
      color: #666666;
      border-top: 1px solid #eeeeee;
      padding-top: 16px;
      margin-top: 32px;
    }
  </style>
</head>
<body>
  <div class="greeting">Hi ${formattedName},</div>
  
  <div class="content">
    <p>Hope you enjoyed your first class at Heat last week!</p>
    
    <p>Since you just joined us, we'd love to know what you thought. The reason you found us is likely because someone else left a review, and it's the easiest way to help us grow other than coming to class, of course! We are very grateful for the help and early support from you, and want to thank you in advance.</p>
    
    <p>If you loved your class, would you mind taking 30 seconds to leave us a review? You can choose freely whether to leave it on Google or TripAdvisor:</p>
  </div>
  
  <div class="button-container">
    <a href="https://g.page/r/CUQknjCELlG0EBM/review" class="btn btn-google" target="_blank">Review on Google</a>
    <a href="https://www.tripadvisor.com/UserReviewEdit-g189117-d34413807-Heat_Lagos-Lagos_Faro_District_Algarve.html" class="btn btn-tripadvisor" target="_blank">Review on TripAdvisor</a>
  </div>
  
  <div class="content">
    <p>When you write the review, if you can, please include a few words about the actual class you took or the studio (like <em>heated</em>, <em>pilates</em>, <em>yoga flow</em>, etc.) — it really helps others know what to expect!</p>
    
    <p>Thank you so much, and hope to see you back on the mat soon.</p>
  </div>
  
  <div class="footer">
    <p>Best regards,<br>
    <strong>Sebastian</strong><br>
    Heat Lagos</p>
  </div>
</body>
</html>`;
}

async function sendVisitorsFollowup(env, dryRun = false) {
  const apiKey = env.BSPORT_JWT_TOKEN;
  if (!apiKey) {
    throw new Error("BSPORT_JWT_TOKEN is not configured");
  }
  const resendApiKey = env.RESEND_API_KEY;
  if (!resendApiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  // Calculate target dates: Monday of this week to Sunday of this week
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ...
  const daysToSubtractForMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const currentMonday = new Date(today.getTime() - daysToSubtractForMonday * 24 * 60 * 60 * 1000);
  const currentSunday = new Date(currentMonday.getTime() + 6 * 24 * 60 * 60 * 1000);

  const startDateStr = getFormattedDate(currentMonday);
  const endDateStr = getFormattedDate(currentSunday);

  console.log(`Checking visitors this week between ${startDateStr} and ${endDateStr}`);

  // 1. Fetch bookings in the target range
  const bookings = await fetchBsportManagement(
    "bookings/",
    {
      session_started_after_date: startDateStr,
      session_started_before_date: endDateStr,
      page_size: "100"
    },
    env
  );

  // Filter for active bookings (booking_status_code === "OK")
  const activeBookings = bookings.filter(b => b.booking_status_code === "OK");
  console.log(`Found ${activeBookings.length} active bookings in the range.`);

  // Group bookings by client_id
  const clientBookingsMap = new Map();
  for (const b of activeBookings) {
    if (!clientBookingsMap.has(b.client_id)) {
      clientBookingsMap.set(b.client_id, []);
    }
    clientBookingsMap.get(b.client_id).push(b);
  }

  const clientsToProcess = [];
  
  for (const [clientId, cb] of clientBookingsMap.entries()) {
    try {
      const client = await fetchBsportManagement(`clients/${clientId}/`, {}, env);
      
      // Check if client has tag "reviewed" (122123) or "review-reminder-sent" (122124)
      const tagIds = client.tag_ids || [];
      if (tagIds.includes(122123) || tagIds.includes(122124)) {
        console.log(`Client ${client.fullname} (${client.email}) already reviewed or reminder sent. Skipping.`);
        continue;
      }

      // Check traveler status: tag Visitor (121345) or foreign phone/country/nationality
      const phone = client.phone_number || "";
      const address = client.address || {};
      const country = address.country || "";
      const nationality = client.nationality || "";

      let hasForeignPhone = false;
      if (phone) {
        const cleanPhone = phone.replace(/[^0-9+]/g, "");
        if (cleanPhone.startsWith("+") && !cleanPhone.startsWith("+351")) {
          hasForeignPhone = true;
        } else if (!cleanPhone.startsWith("+") && !cleanPhone.startsWith("351") && !cleanPhone.startsWith("00351")) {
          if (cleanPhone.length > 9) {
            hasForeignPhone = true;
          }
        }
      }

      const hasForeignAddress = country && !["portugal", "pt"].includes(country.toLowerCase());
      const hasForeignNationality = nationality && !["portuguese", "portugal", "pt"].includes(nationality.toLowerCase());

      const isVisitor = tagIds.includes(121345) || (!tagIds.includes(121344) && (hasForeignPhone || hasForeignAddress || hasForeignNationality));

      clientsToProcess.push({ client, isVisitor, bookings: cb });
    } catch (err) {
      console.error(`Error processing client ${clientId}:`, err);
    }
  }

  console.log(`Found ${clientsToProcess.length} candidates to email.`);

  const results = [];
  for (const item of clientsToProcess) {
    const { client, isVisitor } = item;
    const email = client.email;
    const firstName = client.firstname || client.fullname.split(" ")[0] || "there";
    const fullName = client.fullname;

    const emailHtml = getVisitorFollowupEmailHtml(firstName, isVisitor);
    const subject = "How was your class at Heat?";

    const result = {
      client_id: client.id,
      fullname: fullName,
      email,
      is_visitor: isVisitor,
      sent: false,
      tagged: false,
      error: null
    };

    if (dryRun) {
      result.sent = "dry-run";
      result.tagged = "dry-run";
      results.push(result);
      continue;
    }

    try {
      // Send the email using Resend
      const resendResponse = await sendEmail({
        to: email,
        subject,
        html: emailHtml,
        apiKey: resendApiKey,
        from: "Sebastian | Heat Lagos <daily@heatlagos.com>"
      });

      if (!resendResponse.ok) {
        const errText = await resendResponse.text();
        throw new Error(`Resend API failed: ${resendResponse.status} - ${errText}`);
      }

      result.sent = true;

      // Add "review-reminder-sent" tag (122124) to client
      const tagResponse = await fetch(`https://public.production.bsport.io/api/v1/management/clients/${client.id}/tag/`, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Client-ID": "heat",
          "X-Company-ID": "5821"
        },
        body: JSON.stringify({ tag_id: 122124 })
      });

      if (!tagResponse.ok) {
        const errText = await tagResponse.text();
        console.error(`Failed to tag client ${client.id}: ${tagResponse.status} - ${errText}`);
        result.tag_error = `Failed to tag client: ${tagResponse.status}`;
      } else {
        result.tagged = true;
      }
    } catch (err) {
      console.error(`Error processing followup for ${fullName}:`, err);
      result.error = err.message;
    }

    results.push(result);
  }

  return {
    range: { start: startDateStr, end: endDateStr },
    total_bookings: bookings.length,
    active_bookings: activeBookings.length,
    candidates_identified: clientsToProcess.length,
    results
  };
}

function getVisitorFollowupEmailHtml(firstName, isVisitor) {
  const formattedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  
  if (isVisitor) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      line-height: 1.6;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .greeting {
      font-size: 16px;
      margin-bottom: 16px;
    }
    .content {
      font-size: 15px;
      margin-bottom: 24px;
    }
    .button-container {
      margin: 24px 0;
      text-align: center;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      margin: 8px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: bold;
      font-size: 14px;
      color: #ffffff !important;
    }
    .btn-tripadvisor {
      background-color: #34e0a1;
      color: #000000 !important;
    }
    .btn-google {
      background-color: #1a73e8;
    }
    .footer {
      font-size: 13px;
      color: #666666;
      border-top: 1px solid #eeeeee;
      padding-top: 16px;
      margin-top: 32px;
    }
  </style>
</head>
<body>
  <div class="greeting">Hi ${formattedName},</div>
  
  <div class="content">
    <p>Hope you've had a great week and enjoyed your class(es) at Heat Lagos!</p>
    
    <p>We'd love to hear how you liked it. Did you love your class? If you have any feedback or thoughts to share, please feel free to reply directly to this email — we always want to make your experience on the mat the best it can be.</p>
    
    <p>If you had a great experience, could you help us and future visitors out by sharing a quick review? Since you are visiting the Algarve, leaving a review on TripAdvisor is incredibly helpful for other travelers searching for wellness spots, but a Google review is also amazing! You can choose either below:</p>
  </div>
  
  <div class="button-container">
    <a href="https://www.tripadvisor.com/UserReviewEdit-g189117-d34413807-Heat_Lagos-Lagos_Faro_District_Algarve.html" class="btn btn-tripadvisor" target="_blank">Review on TripAdvisor</a>
    <a href="https://g.page/r/CUQknjCELlG0EBM/review" class="btn btn-google" target="_blank">Review on Google</a>
  </div>
  
  <div class="content">
    <p>Thank you so much for the support and early help, and hope to see you back in the studio soon!</p>
  </div>
  
  <div class="footer">
    <p>Best regards,<br>
    <strong>Sebastian</strong><br>
    Heat Lagos</p>
  </div>
</body>
</html>`;
  } else {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      line-height: 1.6;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .greeting {
      font-size: 16px;
      margin-bottom: 16px;
    }
    .content {
      font-size: 15px;
      margin-bottom: 24px;
    }
    .button-container {
      margin: 24px 0;
      text-align: center;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      margin: 8px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: bold;
      font-size: 14px;
      color: #ffffff !important;
    }
    .btn-google {
      background-color: #1a73e8;
    }
    .btn-tripadvisor {
      background-color: #34e0a1;
      color: #000000 !important;
    }
    .footer {
      font-size: 13px;
      color: #666666;
      border-top: 1px solid #eeeeee;
      padding-top: 16px;
      margin-top: 32px;
    }
  </style>
</head>
<body>
  <div class="greeting">Hi ${formattedName},</div>
  
  <div class="content">
    <p>Hope you've had a great week and enjoyed your class(es) at Heat Lagos!</p>
    
    <p>We'd love to hear how you liked it. Did you love your class? If you have any feedback or thoughts to share, please feel free to reply directly to this email — we always want to hear from you and keep improving.</p>
    
    <p>If you had a great experience, could you help us and future visitors out by sharing a quick review? Leaving a Google review is the easiest way to help us grow, but if you prefer TripAdvisor, that's also amazing! You can choose either below:</p>
  </div>
  
  <div class="button-container">
    <a href="https://g.page/r/CUQknjCELlG0EBM/review" class="btn btn-google" target="_blank">Review on Google</a>
    <a href="https://www.tripadvisor.com/UserReviewEdit-g189117-d34413807-Heat_Lagos-Lagos_Faro_District_Algarve.html" class="btn btn-tripadvisor" target="_blank">Review on TripAdvisor</a>
  </div>
  
  <div class="content">
    <p>Thank you so much for the support and early help, and hope to see you back on the mat soon!</p>
  </div>
  
  <div class="footer">
    <p>Best regards,<br>
    <strong>Sebastian</strong><br>
    Heat Lagos</p>
  </div>
</body>
</html>`;
  }
}

// ============================================================================
// WEEKLY MARKETING REPORT — FB Ads + Google Ads + bsport sales + GA4, one email
// ============================================================================

const REPORT_RECIPIENTS = ["sebastian.brosche@gmail.com", "stine.hegre@gmail.com"]
const GADS_HEAT_CUSTOMER_ID = "2970858078"
const GA4_PROPERTY_ID = "538018528"
const HEAT_AD_ACCOUNT = "act_2397172774125481"

function b64url(bytes) {
  let s = typeof bytes === "string" ? btoa(bytes) : btoa(String.fromCharCode(...new Uint8Array(bytes)))
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// Mint a Google access token from a service-account key (for GA4 Data API)
async function getServiceAccountToken(env, scope) {
  const sa = JSON.parse(env.GA4_SA_KEY)
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))
  const unsigned = `${header}.${claim}`
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey("pkcs8", der.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${b64url(sig)}`
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  })
  return (await res.json()).access_token
}

// Mint a Google access token from an OAuth refresh token (for Google Ads API)
async function getGoogleOauthToken(env) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GADS_REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  })
  return (await res.json()).access_token
}

async function pullFbAds(env) {
  try {
    const tok = env.HEAT_META_CAPI_TOKEN
    const url = `${META_GRAPH}/${HEAT_AD_ACCOUNT}/insights?date_preset=last_7d&fields=spend,impressions,clicks,actions&access_token=${tok}`
    const d = await (await fetch(url)).json()
    const row = (d.data && d.data[0]) || {}
    const leads = (row.actions || []).find((a) => a.action_type === "lead" || a.action_type === "offsite_conversion.fb_pixel_lead")
    return { ok: true, spend: +(row.spend || 0), impressions: +(row.impressions || 0), clicks: +(row.clicks || 0), leads: leads ? +leads.value : 0 }
  } catch (e) { return { ok: false, error: String(e) } }
}

async function pullGoogleAds(env) {
  try {
    const tok = await getGoogleOauthToken(env)
    const q = JSON.stringify({ query: "SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM customer WHERE segments.date DURING LAST_7_DAYS" })
    const res = await fetch(`https://googleads.googleapis.com/v23/customers/${GADS_HEAT_CUSTOMER_ID}/googleAds:search`, {
      method: "POST", headers: { Authorization: `Bearer ${tok}`, "developer-token": env.GADS_DEVELOPER_TOKEN, "Content-Type": "application/json" }, body: q,
    })
    const d = await res.json()
    let cost = 0, clicks = 0, impr = 0, conv = 0
    for (const r of d.results || []) {
      cost += +(r.metrics?.costMicros || 0); clicks += +(r.metrics?.clicks || 0); impr += +(r.metrics?.impressions || 0); conv += +(r.metrics?.conversions || 0)
    }
    return { ok: true, spend: cost / 1e6, clicks, impressions: impr, conversions: conv }
  } catch (e) { return { ok: false, error: String(e) } }
}

async function pullGa4(env) {
  try {
    const tok = await getServiceAccountToken(env, "https://www.googleapis.com/auth/analytics.readonly")
    const body = JSON.stringify({
      dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "conversions" }],
    })
    const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`, {
      method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body,
    })
    const d = await res.json()
    const channels = (d.rows || []).map((r) => ({ channel: r.dimensionValues[0].value, sessions: +r.metricValues[0].value, conversions: +r.metricValues[1].value }))
    const totalSessions = channels.reduce((s, c) => s + c.sessions, 0)
    return { ok: true, channels, totalSessions }
  } catch (e) { return { ok: false, error: String(e) } }
}

// Sum the last 7 days of webhook-tracked bsport stats from KV
async function pullBsportWeek(env) {
  try {
    let members = 0, bookings = 0, revenue = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().split("T")[0]
      const raw = await env.BSPORT_KV.get(`stats:${d}`)
      if (raw) { const s = JSON.parse(raw); members += s.members || 0; bookings += s.bookings || 0; revenue += s.revenue || 0 }
    }
    return { ok: true, members, bookings, revenue }
  } catch (e) { return { ok: false, error: String(e) } }
}

function eur(n) { return "€" + (Math.round(n * 100) / 100).toLocaleString("en-GB") }

async function buildWeeklyReport(env) {
  const [fb, gads, ga4, bs] = await Promise.all([pullFbAds(env), pullGoogleAds(env), pullGa4(env), pullBsportWeek(env)])
  const totalSpend = (fb.ok ? fb.spend : 0) + (gads.ok ? gads.spend : 0)
  const cpa = bs.ok && bs.members > 0 ? totalSpend / bs.members : null

  const channelRows = ga4.ok
    ? ga4.channels.sort((a, b) => b.sessions - a.sessions).map((c) => `<tr><td>${c.channel}</td><td style="text-align:right">${c.sessions}</td><td style="text-align:right">${c.conversions}</td></tr>`).join("")
    : `<tr><td colspan="3" style="color:#b00">GA4 unavailable: ${ga4.error || ""}</td></tr>`

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#222;max-width:640px;margin:0 auto">
  <h2 style="color:#c0392b">Heat Lagos — Weekly Marketing Report</h2>
  <p style="color:#666">Last 7 days, all channels.</p>

  <h3>Ad spend &amp; results</h3>
  <table cellpadding="8" style="border-collapse:collapse;width:100%;border:1px solid #eee">
    <tr style="background:#faf3f2"><th align="left">Channel</th><th align="right">Spend</th><th align="right">Impr.</th><th align="right">Clicks</th><th align="right">Leads/Conv</th></tr>
    <tr><td>Facebook / Instagram</td><td align="right">${fb.ok ? eur(fb.spend) : "n/a"}</td><td align="right">${fb.ok ? fb.impressions : "-"}</td><td align="right">${fb.ok ? fb.clicks : "-"}</td><td align="right">${fb.ok ? fb.leads : "-"}</td></tr>
    <tr><td>Google Ads</td><td align="right">${gads.ok ? eur(gads.spend) : "n/a"}</td><td align="right">${gads.ok ? gads.impressions : "-"}</td><td align="right">${gads.ok ? gads.clicks : "-"}</td><td align="right">${gads.ok ? gads.conversions : "-"}</td></tr>
    <tr style="font-weight:bold;background:#faf3f2"><td>Total</td><td align="right">${eur(totalSpend)}</td><td></td><td></td><td></td></tr>
  </table>

  <h3>Sales (bsport)</h3>
  <table cellpadding="8" style="border-collapse:collapse;width:100%;border:1px solid #eee">
    <tr><td>New members</td><td align="right"><b>${bs.ok ? bs.members : "n/a"}</b></td></tr>
    <tr><td>Bookings</td><td align="right">${bs.ok ? bs.bookings : "n/a"}</td></tr>
    <tr><td>Revenue</td><td align="right"><b>${bs.ok ? eur(bs.revenue) : "n/a"}</b></td></tr>
    <tr><td>Blended cost per new member</td><td align="right">${cpa !== null ? eur(cpa) : "—"}</td></tr>
  </table>

  <h3>Website traffic (GA4)</h3>
  <table cellpadding="8" style="border-collapse:collapse;width:100%;border:1px solid #eee">
    <tr style="background:#faf3f2"><th align="left">Channel</th><th align="right">Sessions</th><th align="right">Conversions</th></tr>
    ${channelRows}
    <tr style="font-weight:bold;background:#faf3f2"><td>Total sessions</td><td align="right">${ga4.ok ? ga4.totalSessions : "-"}</td><td></td></tr>
  </table>

  <p style="color:#999;font-size:12px;margin-top:24px">Sources: Meta Marketing API, Google Ads API v23, bsport webhooks, GA4 Data API. Auto-generated by bsport-sync.</p>
  </body></html>`
}

async function sendWeeklyReport(env, recipients) {
  const html = await buildWeeklyReport(env)
  await sendEmail({
    to: recipients || REPORT_RECIPIENTS,
    subject: "Heat Lagos — Weekly Marketing Report",
    html,
    apiKey: env.RESEND_API_KEY,
    from: "Heat Lagos Reports <daily@heatlagos.com>",
  })
  return { sent: true, to: recipients || REPORT_RECIPIENTS }
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

      if (path === "/api/trigger-weekly-reminders" && request.method === "GET") {
        const token = url.searchParams.get("token")
        if (token !== "yttl3ads2026!") {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          })
        }
        const dryRun = url.searchParams.get("dryRun") === "true"
        const result = await sendWeeklyReviewReminders(env, dryRun)
        return new Response(JSON.stringify({ success: true, result }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        })
      }

      if (path === "/api/trigger-visitors-followup" && request.method === "GET") {
        const token = url.searchParams.get("token")
        if (token !== "yttl3ads2026!") {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          })
        }
        const dryRun = url.searchParams.get("dryRun") === "true"
        const result = await sendVisitorsFollowup(env, dryRun)
        return new Response(JSON.stringify({ success: true, result }), {
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

      if (path === "/api/weekly-report" && request.method === "GET") {
        const token = url.searchParams.get("token")
        if (token !== "yttl3ads2026!") {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          })
        }
        // dryRun=true returns the raw pulled data as JSON (no email)
        if (url.searchParams.get("dryRun") === "true") {
          const [fb, gads, ga4, bs] = await Promise.all([pullFbAds(env), pullGoogleAds(env), pullGa4(env), pullBsportWeek(env)])
          return new Response(JSON.stringify({ fb, gads, ga4, bs }, null, 2), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
        }
        // preview=true returns the HTML report without sending
        if (url.searchParams.get("preview") === "true") {
          return new Response(await buildWeeklyReport(env), { headers: { "Content-Type": "text/html" } })
        }
        // to= overrides recipients (e.g. just sebastian for the first test)
        const to = url.searchParams.get("to")
        const result = await sendWeeklyReport(env, to ? to.split(",") : null)
        return new Response(JSON.stringify({ success: true, result }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } })
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
    // Weekly review reminder follow-up on Tuesday at 9am
    if (event.cron === "0 9 * * 2") {
      ctx.waitUntil(sendWeeklyReviewReminders(env, false))
    }
    // Weekly marketing report (FB+Google+bsport+GA4) on Monday at 8am
    if (event.cron === "0 8 * * 1") {
      ctx.waitUntil(sendWeeklyReport(env))
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
    // Send server-side Purchase to Meta (Conversions API) + GA4 (Measurement Protocol)
    ctx.waitUntil(sendMetaCapiPurchase(data, env))
    ctx.waitUntil(sendGa4Purchase(data, env))
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
    const envKeys = {};
    for (const key of Object.keys(env)) {
      const val = env[key];
      envKeys[key] = {
        type: typeof val,
        length: typeof val === "string" ? val.length : undefined,
        startsWithEyJ: typeof val === "string" ? val.startsWith("eyJ") : undefined,
      };
    }
    const googleToken = await getGoogleAccessToken(env);
    return new Response(JSON.stringify({
      success: true,
      message: "Google auth working",
      env: envKeys
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      env: Object.keys(env)
    }), {
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
