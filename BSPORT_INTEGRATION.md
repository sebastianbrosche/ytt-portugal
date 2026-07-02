# Bsport Integration Project Documentation

This document provides a comprehensive technical overview of the Bsport integration worker (`bsport-sync`), its features, architecture, database tags, cron schedules, endpoints, and deployment steps.

---

## 📋 1. Project Overview

The `bsport-sync` project is a serverless application deployed as a **Cloudflare Worker**. It integrates with the **Bsport Management API** to automate business operations, generate reports, and run automated review-reminder email campaigns via the **Resend API**.

### Key Repositories & Workspaces
*   **Root Directory**: `C:\Users\Admin\claudecode\ytt-portugal\bsport-worker`
*   **Main Code File**: [`src/index.js`](file:///C:/Users/Admin/claudecode/ytt-portugal/bsport-worker/src/index.js)
*   **Configuration**: [`wrangler.toml`](file:///C:/Users/Admin/claudecode/ytt-portugal/bsport-worker/wrangler.toml)

---

## 🔑 2. Authentication & Credentials Contract

To interact with Bsport's backoffice management endpoints, the worker uses a JWT-based credential set.

### Bsport API Headers
Every management request requires the following headers:
*   `X-API-Key`: `<BSPORT_JWT_TOKEN>`
*   `X-Client-ID`: `heat`
*   `X-Company-ID`: `5821`

### Worker Environment Variables (Secrets)
*   `BSPORT_JWT_TOKEN`: Bsport Backoffice JWT token.
*   `RESEND_API_KEY`: API key for email delivery via Resend.
*   `ADMIN_TOKEN`: Internal worker token (`<ADMIN_TOKEN>`) used to authorize manual triggers.

---

## 🏷️ 3. Bsport Tag Database

The worker uses custom tags inside Bsport to segment users and track status.

| Tag Name | Tag ID | Description |
| :--- | :--- | :--- |
| **`reviewed`** | `122123` | Client has successfully left a review. Excluded from all campaigns. |
| **`review-reminder-sent`** | `122124` | Review reminder has been sent. Prevents double emailing. |
| **`Local`** | `121344` | Client is a local resident. |
| **`Visitor`** | `121345` | Client is a traveler/tourist. |

---

## 📅 4. Automated Workflows (Cron Jobs)

The worker is configured with scheduled triggers in [`wrangler.toml`](file:///C:/Users/Admin/claudecode/ytt-portugal/bsport-worker/wrangler.toml) to execute automated tasks:

### 1. Daily Briefing (`0 19 * * *` — Daily at 7:00 PM WET)
*   **Purpose**: Delivers a daily email summary of studio operations directly to Sebastian.
*   **Metrics compiled**: Total bookings, new client signups, cancellation rates, daily class attendance details, and day-over-day revenue.

### 2. Weekly Review Reminders (`0 9 * * 2` — Tuesdays at 9:00 AM WET)
*   **Purpose**: Reminds first-timers to leave a review.
*   **Workflow**:
    1.  Queries bookings for the *previous week* (Monday to Sunday).
    2.  Filters for active bookings (`booking_status_code === "OK"`).
    3.  Identifies clients who took their **first class ever** at the studio.
    4.  Excludes clients tagged with `reviewed` (`122123`) or `review-reminder-sent` (`122124`).
    5.  Emails them a personalized review link and tags them as `review-reminder-sent`.

### 3. Monthly Report (`0 8 1 * *` — 1st of the month at 8:00 AM WET)
*   **Purpose**: Compiles a macro dashboard of monthly studio performance (retaining members, gross revenue, new clients) and emails it to Sebastian.

---

## 🔗 5. API Endpoints Reference

The worker exposes HTTP GET endpoints for manual execution and testing. All endpoints require the query parameter `token=yttl3ads2026!`.

### `/api/trigger-daily`
Manually triggers the Daily Briefing email.

### `/api/trigger-weekly-reminders`
Manually triggers the Weekly Review Reminders.
*   **Query Params**: `dryRun=true` (simulates run and lists target candidates without sending/tagging) or `dryRun=false` (live run).

### `/api/trigger-visitors-followup`
A custom execution to follow up with everyone who took a class during the current week.
*   **Query Params**: `dryRun=true`/`false`.
*   **Traveler Inference**: Classifies clients as "Visitors" if their phone country code is not Portugal (`+351`), or if their nationality or address country is outside Portugal.
*   **Dynamic Prioritization**:
    *   *Travelers*: Emailed with a TripAdvisor review link prioritized (TripAdvisor button first).
    *   *Locals*: Emailed with a Google Maps review link prioritized.

---

## 🚀 6. Deployment & CLI Execution

To compile and deploy changes to Cloudflare Workers, run the following commands in PowerShell from the project root:

```powershell
# Set credentials in current environment
$env:CLOUDFLARE_API_TOKEN = "<CLOUDFLARE_API_TOKEN>"
$env:CLOUDFLARE_ACCOUNT_ID = "<CLOUDFLARE_ACCOUNT_ID>"

# Deploy to Cloudflare Workers
npx wrangler deploy
```
