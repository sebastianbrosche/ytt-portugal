// bsport-charts Monthly Report Generator
// Built into bsport-sync worker
// Fetches bsport API data, generates Chart.js visualizations

const BSPORT_API_BASE = "https://api.production.bsport.io/api/v1";

// Chart.js CDN
const CHART_JS_CDN = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";

async function fetchBsportMembers(token) {
  const allMembers = [];
  let page = 1;
  
  while (true) {
    const url = new URL(`${BSPORT_API_BASE}/member/`);
    url.searchParams.set("page", page.toString());
    url.searchParams.set("page_size", "100");
    url.searchParams.set("ordering", "-created_at");
    
    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "Authorization": `Token ${token}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`bsport API error: ${response.status}`);
    }
    
    const data = await response.json();
    allMembers.push(...data.results);
    
    if (!data.links?.next) break;
    page++;
  }
  
  return allMembers;
}

async function generateMonthlyReport(token, year, month, env) {
  // Calculate date range for the month
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = new Date(year, month, 0).toISOString().split("T")[0];
  
  // Fetch all members (this API works reliably)
  const members = await fetchBsportMembers(token);
  
  // Filter members who joined this month
  const monthMembers = members.filter(m => {
    const joined = m.date_joined || m.created_at;
    if (!joined) return false;
    return joined >= startDate && joined <= `${endDate}T23:59:59`;
  });
  
  // Get webhook-captured bookings for this month
  const webhookBookings = [];
  const webhookList = await env.BSPORT_KV.list({ prefix: "webhook:" });
  for (const key of webhookList.keys.slice(0, 500)) {
    const value = await env.BSPORT_KV.get(key.name);
    if (value) {
      const event = JSON.parse(value);
      if (event.eventType === "booking-create") {
        const date = event.data.booking?.date || event.data.date;
        if (date && date >= startDate && date <= endDate) {
          webhookBookings.push(event.data);
        }
      }
    }
  }
  
  // Process member data for charts
  const weekdayLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  
  // New members per weekday this month
  const weekdayCounts = Array(7).fill(0);
  for (const m of monthMembers) {
    const joined = new Date(m.date_joined || m.created_at);
    const weekday = (joined.getDay() + 6) % 7; // 0=Monday
    weekdayCounts[weekday]++;
  }
  
  // All-time member growth per week
  const weeklyData = {};
  for (const m of members) {
    const joined = m.date_joined || m.created_at;
    if (!joined) continue;
    const date = new Date(joined);
    const weekStart = getWeekStart(date);
    weeklyData[weekStart] = (weeklyData[weekStart] || 0) + 1;
  }
  
  const weeks = Object.keys(weeklyData).sort();
  const weekCounts = weeks.map(w => weeklyData[w]);
  
  // Cumulative member count
  const cumulativeData = [];
  let cumulative = 0;
  for (const w of weeks) {
    cumulative += weeklyData[w];
    cumulativeData.push(cumulative);
  }
  
  // Bookings from webhooks by weekday
  const bookingWeekdayCounts = Array(7).fill(0);
  
  // Bookings by class type (from webhook data)
  const classTypeCounts = {};
  
  for (const b of webhookBookings) {
    const date = new Date(b.booking?.date || b.date);
    const weekday = (date.getDay() + 6) % 7;
    bookingWeekdayCounts[weekday]++;
    
    // Extract class type from session name
    const sessionName = b.booking?.session_name || b.session_name || b.activity_name || "Unknown";
    classTypeCounts[sessionName] = (classTypeCounts[sessionName] || 0) + 1;
  }
  
  // Sort class types by count
  const sortedClassTypes = Object.entries(classTypeCounts)
    .sort((a, b) => b[1] - a[1]);
  
  return generateHTML({
    year,
    month,
    totalMembers: members.length,
    newMembersThisMonth: monthMembers.length,
    totalBookingsFromWebhooks: webhookBookings.length,
    weekdayLabels,
    weekdayCounts,
    weeks,
    weekCounts,
    cumulativeData,
    sortedClassTypes: sortedClassTypes,
    sampleMembers: monthMembers.slice(0, 5).map(m => ({
      name: m.name,
      email: m.email,
      date_joined: m.date_joined,
    })),
  });
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split("T")[0];
}

function generateHTML(data) {
  const monthName = new Date(data.year, data.month - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Heat Lagos Monthly Report — ${monthName}</title>
  <script src="${CHART_JS_CDN}"></script>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Inter, system-ui, sans-serif; max-width: 1000px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; background: #faf8f5; }
    h1 { font-size: 32px; margin-bottom: 8px; color: #1a1a1a; }
    .subtitle { color: #666; margin-bottom: 32px; font-size: 16px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 40px; }
    .stat { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 1px 8px rgba(0,0,0,0.04); }
    .stat-value { font-size: 36px; font-weight: 800; color: #b87333; }
    .stat-label { font-size: 13px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    .chart-container { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 1px 8px rgba(0,0,0,0.04); margin-bottom: 24px; }
    .chart-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
    canvas { max-height: 400px; }
    .sample-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 16px; }
    .sample-table th { text-align: left; padding: 10px; border-bottom: 2px solid #e5e5e5; font-weight: 600; }
    .sample-table td { padding: 10px; border-bottom: 1px solid #f0f0f0; }
    .footer { text-align: center; color: #999; font-size: 12px; margin-top: 40px; }
    .note { background: #fff8e1; padding: 12px 16px; border-radius: 8px; font-size: 13px; color: #666; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>Heat Lagos Monthly Report</h1>
  <p class="subtitle">${monthName} · Generated ${new Date().toLocaleDateString()}</p>
  
  <div class="stats">
    <div class="stat">
      <div class="stat-value">${data.totalMembers}</div>
      <div class="stat-label">Total Members</div>
    </div>
    <div class="stat">
      <div class="stat-value">${data.newMembersThisMonth}</div>
      <div class="stat-label">New This Month</div>
    </div>
    <div class="stat">
      <div class="stat-value">${data.totalBookingsFromWebhooks}</div>
      <div class="stat-label">New Bookings (webhooks)</div>
    </div>
  </div>
  
  <div class="note">
    📊 This report combines bsport API data (members) with webhook-captured booking data. 
    As webhooks collect more data over time, booking charts will become more accurate.
  </div>
  
  <div class="chart-container">
    <div class="chart-title">Cumulative Member Growth</div>
    <canvas id="growthChart"></canvas>
  </div>
  
  <div class="chart-container">
    <div class="chart-title">New Members by Day of Week</div>
    <canvas id="weekdayChart"></canvas>
  </div>
  
  <div class="chart-container">
    <div class="chart-title">New Members per Week (All Time)</div>
    <canvas id="weeklyChart"></canvas>
  </div>
  
  <div class="chart-container">
    <div class="chart-title">Bookings by Class Type</div>
    <table class="sample-table">
      <thead><tr><th>Class Type</th><th style="text-align:right">Bookings</th></tr></thead>
      <tbody>
        ${data.sortedClassTypes.length > 0 
          ? data.sortedClassTypes.map(([name, count]) => `
            <tr><td>${name}</td><td style="text-align:right">${count}</td></tr>
          `).join('')
          : '<tr><td colspan="2" style="color:#999;font-style:italic">No webhook booking data collected yet</td></tr>'
        }
      </tbody>
    </table>
  </div>
  
  <div class="chart-container">
    <div class="chart-title">Bookings by Day of Week (Webhook Data)</div>
    <canvas id="bookingWeekdayChart"></canvas>
  </div>
  
  <div class="chart-container">
    <div class="chart-title">Recent New Members</div>
    <table class="sample-table">
      <thead><tr><th>Name</th><th>Email</th><th>Joined</th></tr></thead>
      <tbody>
        ${data.sampleMembers.map(m => `
          <tr><td>${m.name}</td><td>${m.email}</td><td>${new Date(m.date_joined).toLocaleDateString()}</td></tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  
  <div class="footer">Auto-generated by Heat Lagos AI · bsport data sync</div>

  <script>
    const weekdayLabels = ${JSON.stringify(data.weekdayLabels.map(d => d.slice(0, 3)))};
    
    // Growth chart (cumulative)
    new Chart(document.getElementById('growthChart'), {
      type: 'line',
      data: {
        labels: ${JSON.stringify(data.weeks.map(w => w.slice(5)))},
        datasets: [{
          label: 'Total Members',
          data: ${JSON.stringify(data.cumulativeData)},
          borderColor: '#b87333',
          backgroundColor: 'rgba(184, 115, 51, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
    
    // Weekday bar chart (new members)
    new Chart(document.getElementById('weekdayChart'), {
      type: 'bar',
      data: {
        labels: weekdayLabels,
        datasets: [{
          label: 'New Members',
          data: ${JSON.stringify(data.weekdayCounts)},
          backgroundColor: '#b87333',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    
    // Weekly bar chart
    new Chart(document.getElementById('weeklyChart'), {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(data.weeks.map(w => w.slice(5)))},
        datasets: [{
          label: 'New Members',
          data: ${JSON.stringify(data.weekCounts)},
          backgroundColor: '#d4a574',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
    
    // Booking weekday chart
    new Chart(document.getElementById('bookingWeekdayChart'), {
      type: 'bar',
      data: {
        labels: weekdayLabels,
        datasets: [{
          label: 'Bookings',
          data: ${JSON.stringify(data.bookingWeekdayCounts)},
          backgroundColor: '#1a1a1a',
          borderRadius: 6,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
      }
    });
  </script>
</body>
</html>`;
}

export { fetchBsportMembers, generateMonthlyReport };
