# YTT Portugal - SEO Plan (v1, 2026-06-13)

Owner: Heat Lagos (Stine, Sebastian). Site: yogateachertrainingportugal.eu. Analytics: GA4 G-3RB1DZCK81 already installed.

## Business goals (priority order)
1. **Fill the 200h Vinyasa YTT** - Sept 27 to Oct 12, 2026. Hybrid (100h online + 100h live), RYT200 Yoga Alliance, EUR 1,490 early bird (ends July 1), led by Stine + Sebastian. Need ~14 more students (1 paid).
2. **Fill the SCULPT Teacher Training** (2nd priority) - currently listed Sept 18-20, 2026, 3 days, EUR 490 early bird (before July 15), led by Alizee. [DATE CONFLICT: Sebastian referred to this as "October" - confirm actual dates.]

## Audience / markets
English-speaking, Europe-wide. Yoga/Pilates/fitness instructors (sculpt) + aspiring teachers and practitioners (200h). Digital-nomad and traveller angle is real (hybrid format + Algarve). "Train where others vacation."

## Keyword strategy
Generic "yoga teacher training" is too competitive - do NOT chase head term. Win on specificity.

### Cluster A - SCULPT (highest opportunity: real unique product, low competition)
Primary: `sculpt teacher training`, `sculpt certification`, `sculpt instructor training`, `sculpt training course`, `sculpt teacher training europe`, `sculpt teacher training portugal`.
Informational (top of funnel, capture then convert): `what is sculpt class`, `sculpt vs pilates`, `sculpt vs yoga`, `is sculpt good for weight loss`, `what to wear to sculpt class`, `sculpt class benefits`.
Note: SCULPT here = Alizee's method (dance/Pilates/functional, resistance bands + ankle weights + light weights, low-impact high-intensity). NOT "infrared yoga sculpt." Keep content accurate to the real product.

### Cluster B - Portugal / Algarve YTT (winnable geo-modified terms)
`yoga teacher training portugal`, `yoga teacher training algarve`, `200 hour yoga teacher training portugal`, `yoga teacher training portugal 2026`, `yoga teacher training lagos portugal`, `hybrid yoga teacher training` (online+live is a genuine differentiator vs residential-only competitors), `online yoga teacher training portugal`, `RYT200 portugal`.

### Cluster C - Long-tail / EEAT / decision-stage (already partly built)
`yoga teacher training after 40`, `online vs in-person yoga teacher training`, `yoga teacher training cost europe`, `accommodation yoga teacher training lagos`, `vinyasa vs hatha teacher training`, `what to expect 15 day ytt`, `why portugal yoga teacher training`.

## Technical SEO fixes (do FIRST - highest leverage)
1. **noindex bug**: 5 of 11 blog posts carry `<meta name="robots" content="noindex,nofollow">` and are invisible to Google:
   - blog/sculpt-teacher-training-guide.html  (CRITICAL - our priority topic, hidden)
   - blog/ytt-after-40.html
   - blog/ytt-vs-online.html
   - blog/ytt-accommodation-lagos.html
   - blog/why-choose-portugal-ytt.html
   Action: vet content, then remove noindex so they can rank. (Sculpt post must be content-fixed first - see below.)
2. **Content accuracy conflict (sculpt)**: blog/sculpt-teacher-training-guide.html defines sculpt as "yoga + strength + infrared heat" - WRONG. The real product (sculpt.html / Alizee) is dance/Pilates/functional with bands + weights, low-impact. Rewrite the article to match the real method before indexing. Likely AI-generated drift.
3. Ensure all indexable blog posts are in sitemap.xml and internally linked from blog/index and relevant landing pages.
4. Confirm canonical tags are clean (200h.html and sculpt.html already use extensionless canonicals - good).
5. Add Article + FAQ schema to blog posts; Course schema already present on 200h.html and sculpt.html (good).

## Content plan (drafts for Sebastian/Stine to proofread)
Priority 1 (sculpt funnel - fill the sculpt TT + capture Europe-wide sculpt search):
- Fix + index: "Sculpt Teacher Training: the complete guide" (rewrite to real method).
- New: "What is a Sculpt class? (and how it differs from Pilates)" - targets `what is sculpt` / `sculpt vs pilates`.
- New: "How to become a Sculpt instructor in Europe" - targets `sculpt certification` / `sculpt teacher training`.
Priority 2 (200h funnel - fill September):
- Expand: "Yoga Teacher Training in Portugal: complete 2026 guide" (anchor page for Cluster B).
- New: "Hybrid yoga teacher training: online + in-person, how it works" (differentiator).
- Expand/index decision-stage posts (after-40, vs-online, cost-europe, accommodation).

## EEAT (Google needs to trust us)
- Real author bios with credentials on every article (Stine: 17y, Joy Yoga Oslo founder, Yoga for BJJ co-founder, 500h Vinyasa Tiffany Cruikshank etc.; Sebastian: ~15y, 2x BJJ world champ, Yoga for BJJ co-founder; Alizee: 500h Integral YTT, dance background). 
- Link the site to the Heat Lagos Google Business Profile + real Google reviews.
- Genuine testimonials with names/photos (testimonials.html exists - keep populating with real ones).
- Organization + Person schema; consistent NAP (name/address/phone) with GBP.
- KEEP INTERVIEWING Sebastian for first-hand experience signals (Google rewards genuine expertise/originality).

## Measurement
- Wire Google Search Console (verify property, submit sitemap) - blocked on service-account/property access [[project-roadmap]] #5.
- GA4 already live (G-3RB1DZCK81). Track Apply form + bsport payment clicks as conversions.
- Weekly: track impressions/clicks/position for the Cluster A + B terms once Search Console is connected.

## Open questions for Sebastian (queued)
- Sculpt TT real dates: page says Sept 18-20, you said October. Which?
- OK to remove noindex from the 4 non-sculpt posts now, or do you want to read them first?
- OK to rewrite the sculpt blog post to the accurate (Alizee) method?
