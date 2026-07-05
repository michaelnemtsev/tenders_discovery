# RFP / Design Spec — Registration-Wall Ingestion Mechanism

**Project:** Australia Tender Discovery
**Document type:** Requirements + technical design (the "RFP" for building the ingestion layer)
**Date:** 2026-07-05
**Status:** Draft for review — no code written yet

---

## 1. Problem statement

Today the pipeline is **LLM-only**: a Claude routine runs [`prompts/deep_search_aus_tenders.txt`](../prompts/deep_search_aus_tenders.txt), browses the web, and emits `output/tenders.json` (`run_metadata` / `tenders` / `discovered_sources`). `scripts/aggregate.js` merges daily snapshots and the static portal in `web/` displays them. **There is no HTTP-fetch, scrape, or extraction code in the repo** — ingestion is whatever the model could see while browsing.

The prompt itself names the gap (lines 47–82, 91): a large slice of Australian opportunity — especially **Tier 3 corporate** and some quasi-gov portals — sits behind a **free registration wall**. The routine can capture the *portal* (`discovered_sources`, `access_method=portal-registration`) and a headline row, but **cannot read the actual requirements, deliverables, documents, closing dates, or contacts** because those render only after login.

Evidence from the current `output/aggregate.json`:

- 7 of 17 tenders are `access: "free-registration"` — headline only, requirements largely null.
- 10 of 23 discovered sources are `access_method: "portal-registration"` — recorded but never read.
- Gated platforms in play: **SAP Ariba Discovery, SAP Business Network, Coupa (Qantas), RangeMe/Ariba (Coles), Woolworths Partner Hub, EstimateOne, VendorPanel, GCMS (BHP), Rio Tinto supplier portal**, plus gov portals whose *full detail* needs a free account (buy.nsw, QTenders, Tenders Tasmania).

**Goal of this work:** an automated ingestion mechanism that, for opportunities behind a *free* wall, (a) obtains an inbox via a free temp-email service with an API, (b) emulates the free registration + email confirmation, (c) logs in and pulls the full opportunity detail + documents, (d) summarizes the requirements, and (e) writes them back into the existing `tenders.json` schema — turning `free-registration` headline rows into fully-populated entries.

---

## 2. Scope

### In scope
- **No-wall sources** — harden with real fetchers (RSS/Atom, JSON/REST, HTML) so we stop depending on the LLM to read AusTender/state feeds. This is the reliable backbone and prerequisite.
- **Free-email-registration walls** — automate account creation + confirmation + authenticated read. This is the headline ask.
- **Requirements summarization** — parse HTML detail pages and attached tender documents (PDF/DOCX) into the schema's `deliverables_summary`, `key_deliverables`, `requirements`, `eligibility`, `evaluation_criteria`, dates, contacts, `documents[]`.

### Out of scope
- **Invitation-only RFx** (closed, shortlist-only) — never published; the prompt already excludes these (lines 80–82). Unchanged.
- **Paid aggregators / paywalls** (`access: paywalled-do-not-rely`) — discovery signal only, never source of truth. Unchanged.
- **Defeating hard anti-bot / paid CAPTCHA / KYC-gated registration** — see §7. Where a portal requires an ABN, business verification, or trips enterprise bot defense, we do **not** force it; we fall back to a persistent real account or leave the row headline-only and log the gap.

### Guiding constraint (unchanged from the prompt)
Fidelity rule (prompt lines 134–137, 246): **every extracted field must come from the actual notice or its documents; null when not published. Never infer or fabricate.** The automation must preserve this — extraction is grounded in fetched bytes, not model guesses.

---

## 3. Wall taxonomy (what we are actually automating)

Classify every source into one of four bands. The ingestion strategy differs per band.

| Band | Description | Examples (from current data) | Strategy |
|------|-------------|------------------------------|----------|
| **A. Open / machine-readable** | RSS/Atom/JSON/REST or plain HTML, no login | AusTender, buy.nsw search, VendorPanel public tenders | Direct fetcher. No email needed. |
| **B. Free email registration** | Account required; a *free* email confirms; no ABN/business KYC to *view* | SAP Ariba Discovery, EstimateOne, RangeMe, some council/GBE portals | **Temp-email + registration automation** (the core of this spec) |
| **C. Free but identity-gated** | Free account, but needs ABN / business details / manual approval | Woolworths Partner Hub, BHP GCMS, Coupa buyer-specific | Persistent **real** account (one-time human setup), credentials in vault; automation only logs in |
| **D. Closed / paywalled** | Invitation-only or paid aggregator | consultancy RFPs, TenderLink | Out of scope — record portal only |

**Key design decision:** temp-email automation targets **Band B only**. Bands A and C do not need disposable inboxes. Trying to temp-email your way through Band C wastes effort and trips defenses. The mechanism must *classify first, then route*.

---

## 4. Free temp-email services with APIs (evaluation)

Requirement: programmatic **create inbox → receive confirmation email → read body → extract confirmation link/OTP**, free, no human step.

| Service | API | Auth | Free? | Notes / risk |
|---------|-----|------|-------|--------------|
### 4.0 Why public temp-mail cannot pass Ariba (root cause)

Ariba / SAP Business Network registration validates the email **domain** against
disposable-email intelligence: public blocklists (the `disposable-email-domains`
GitHub list and its many forks) plus commercial validators that score domain age,
MX records, and known-disposable reputation. **Every shared free temp-mail domain is
on those lists** — that is the entire product category's fingerprint. So `mail.tm`,
`guerrillamail.com`, `maildrop.cc`, `dropmail`, `1secmail`, and even QA services'
*shared* domains (`@inbox.testmail.app`, `@mailosaur.net`) get rejected at signup.

You cannot win by finding a "better" shared temp domain — any domain enough people
use for throwaway mail eventually lands on a list. **The only durable way to pass is
an address on a domain _you_ control**, because a domain you registered is, by
definition, not on any disposable list and has clean reputation. The trick is to keep
it **fully automated** — create/read addresses via API, no human in the loop — while
still using your own domain. Three stacks below do exactly that, all free.

### 4.1 Recommended: your own domain, read via API (passes Ariba, free)

| Rank | Stack | How it works | Cost | Why it passes |
|------|-------|--------------|------|---------------|
| **1 (best)** | **Cloudflare Email Routing + Email Workers** | Own a domain (~$10/yr). Enable **catch-all** → every `anything@yourdomain.com` is accepted. Attach an **Email Worker** (free) that runs code on each inbound message: parse the confirmation link / OTP and POST it to the ingester (or store in Workers KV for polling). | Domain only (~$10/yr); routing + Workers **free**, unlimited addresses | Your own registered domain — not on any disposable list; clean MX/SPF. |
| **2** | **AgentMail** | API-first service *built for AI agents auto-creating inboxes*. `POST /inboxes` creates an inbox programmatically; inboxes **receive + store + thread**; supports **custom domains**. | **Free: 3 inboxes / 3,000 emails-mo / 3 GB** — plenty since we reuse one account per portal | On a custom domain it's your reputation; even default domain is low-volume/agent-focused, not a known throwaway list. Use custom domain for Ariba-grade walls. |
| **3** | **Mailgun inbound routing** | Free plan: **1 custom domain + 1 inbound route**. Point your domain's MX at Mailgun, catch inbound via **webhook/API**, parse the confirmation. | Free (1 route); domain ~$10/yr | Your own domain → passes. Thinner free tier (1 route) than Cloudflare. |
| alt | **ImprovMX / addy.io / SimpleLogin** (custom-domain aliases) | Catch-all aliases on your domain, forwarded to a real mailbox you poll via IMAP; all have APIs for alias management. | Free tiers | Your own domain → passes; read path is IMAP rather than a Worker. |

**Address-per-portal pattern (works with all of the above):** with catch-all you mint
a unique address per portal on the fly — `ariba-<uuid>@yourdomain.com`,
`estimateone-<uuid>@yourdomain.com` — no pre-provisioning. All land in the same Worker
/ inbox / route, keyed by the local-part so the ingester knows which signup each
confirmation belongs to. Unlimited addresses, one domain, fully automated, passes
blocklists.

### 4.2 Not for Ariba — shared temp-mail (keep only for weak Band-B walls)

`mail.tm` (REST/JWT), `mail.gw`, Guerrilla Mail (JSON, no key), Dropmail (GraphQL).
Zero setup, zero cost, but **shared/known domains** → they work on *weakly-defended*
councils/GBEs and fail on Ariba/EstimateOne/RangeMe. Keep them as a `MailProvider`
implementation for the easy walls, but **do not rely on them for the corporate
platforms** — route those through the §4.1 own-domain provider.

### 4.3 Honest limit — email is necessary, not always sufficient

Passing the email check unblocks the *email-verification* gate specifically. Ariba /
SAP Business Network supplier registration frequently **also** asks for company
details / ABN and runs bot detection (reCAPTCHA). A clean own-domain email removes the
disposable-email rejection; it does **not** by itself defeat ABN/KYC or CAPTCHA. Where
those remain (§7, Band C), the play is a **persistent real supplier account** using
your genuine business identity — the own-domain email is what makes that account's
address look professional and stick. So: own-domain email is the right foundation for
*both* the automated Band-B walls and the human-set-up Band-C accounts.

> **Design decision:** build the email layer behind a `MailProvider` interface (see §6).
> Ship two implementations: `catchall` (Cloudflare Email Worker — the default for any
> wall that blocklists) and `sharedtemp` (mail.tm — for known-weak walls only). The
> driver never knows which is behind it; the registry picks per-portal.

---

## 5. End-to-end logic (the flow you asked for)

For a single Band-B opportunity whose portal needs a free account:

```
1. CLASSIFY
   - Look up portal in the source registry → band (A/B/C/D) + platform driver.
   - If not B → route elsewhere (A: direct fetch, C: vault creds, D: skip).

2. RESOLVE ACCOUNT
   - Check credential vault for an existing valid session/account for this portal.
     - If a live cookie/session exists → skip to step 6 (LOGIN/READ).
     - If an account exists but session expired → step 6 with stored creds.
   - Else → provision a new account (steps 3-5).

3. PROVISION INBOX
   - mailProvider.createInbox()  → { address, inboxId, token }
   - Generate a strong random password; derive a plausible profile
     (business-looking name/company; use the user's real business identity
      where the portal legitimately needs it — do NOT fabricate an ABN).

4. AUTOMATE REGISTRATION
   - Driver opens the portal's signup form (Playwright headless browser for
     JS-heavy platforms; requests+bs4 for simple HTML forms).
   - Fill fields, submit. Handle multi-step wizards per-driver.
   - If a CAPTCHA / bot-check / ABN-KYC appears → ABORT this portal,
     mark band=C (needs human/real account), log gap. Do not brute-force.

5. CONFIRM EMAIL
   - Poll mailProvider.waitForMessage(inboxId, fromPattern, timeout)
   - Extract confirmation URL (or OTP) from the email body via link regex /
     known template per platform.
   - Visit the confirmation URL (or submit OTP). Account now active.
   - Persist { portal, address, password, cookies/session } to the vault
     (encrypted at rest).

6. LOGIN & READ
   - Authenticate (reuse session cookie when possible to minimise logins).
   - Navigate to the opportunity detail page (tender_url from the headline row).
   - Capture: rendered HTML, and download every accessible tender document
     (PDF/DOCX/XLSX/ZIP) to a local blob store.

7. EXTRACT & SUMMARISE
   - HTML → structured fields via per-platform selectors (deterministic where
     the DOM is stable) + a fallback LLM extraction pass over cleaned text.
   - Documents → text (pdfminer/pdfplumber for PDF, python-docx for DOCX) →
     LLM summarisation constrained to the schema fields.
   - Produce: deliverables_summary, key_deliverables[], requirements[],
     eligibility, evaluation_criteria[], value, contract_term, dates,
     submission_method, documents[], contacts.
   - FIDELITY GUARD: every field must be traceable to fetched text; set null
     when absent; record detail_source = the page/document it came from.

8. MERGE
   - Upsert into output/tenders.json by dedup_key (same key aggregate.js uses:
     dedup_key || source_name|tender_id|title).
   - Flip access from "free-registration" (headline) to fully-populated;
     keep access value accurate ("public" only if truly public).
   - Existing scripts/aggregate.js then folds it into aggregate.json unchanged.
```

**Idempotency & politeness:** one account per portal reused across runs (don't create a new inbox every day); respect robots/rate limits; backoff on 429; cache detail pages by content hash so unchanged tenders aren't re-fetched.

---

## 6. Proposed architecture

Keep the existing contract intact — the ingester's only output obligation is a valid `output/tenders.json`. Everything downstream (`aggregate.js`, portal) is unchanged.

```
ingest/
  registry.py         # source → {band, platform, driver, check_frequency}
                      #   seeded from the prompt's Tier 1/2/3 + discovered_sources
  mail/
    provider.py       # MailProvider interface: createInbox / waitForMessage / extractLink
    mailtm.py         # public temp-mail (default)  [Band B, weak walls]
    catchall.py       # private-domain via IMAP/Cloudflare/MailSlurp  [Band B, strong walls]
  drivers/
    base.py           # Driver interface: register / confirm / login / fetch_detail
    ariba_discovery.py
    estimateone.py
    vendorpanel.py
    generic_html.py   # requests+bs4 for simple gov/council forms
  auth/
    vault.py          # encrypted store: {portal: {email, password, cookies, expires}}
  fetch/
    http.py           # polite fetcher (retry/backoff/cache/robots)
    browser.py        # Playwright session pool (headless)
  extract/
    html_extract.py   # per-platform selectors + generic reader
    doc_extract.py    # PDF/DOCX/XLSX → text
    summarise.py      # LLM pass → schema fields, fidelity-guarded
  pipeline.py         # classify → route → extract → merge into tenders.json
  merge.py            # upsert by dedup_key; preserve schema exactly
```

**Language:** Python (matches existing `src/` + `requirements.txt`; best PDF/HTML/Playwright ecosystem).
**New deps:** `playwright`, `httpx`, `pdfplumber`, `python-docx`, `cryptography` (vault), plus the Anthropic SDK for the summarisation pass (use the latest Claude model per `claude-api` guidance).
**Interface-first:** `MailProvider` and `Driver` are the two seams that let us start cheap (mail.tm + one driver) and grow coverage portal-by-portal without rework.

---

## 7. Anti-bot, CAPTCHA & feasibility reality (read before estimating)

Not every "free registration" wall is automatable, and honesty here matters more than optimism:

- **Weak walls (automatable now):** many councils, GBEs, mid-tier platforms, and gov "register to download documents" gates are plain forms + a confirmation email. Temp-email + Playwright handles these. **This is where the near-term value is.**
- **Strong walls (hard/unwise to automate):**
  - **SAP Ariba / SAP Business Network / Coupa / GCMS** are enterprise platforms with bot detection, sometimes reCAPTCHA, and frequently want an **ABN / company verification** even for a "free" supplier account. Automated disposable-email signup will often fail or get the account banned. **Recommend one persistent real supplier account (human setup once), stored in the vault**; automation only logs in and reads. This is more reliable *and* stays inside their supplier terms.
  - **EstimateOne / RangeMe** vary; test empirically, fall back to a real account.
- **CAPTCHA:** do **not** integrate paid CAPTCHA-solving farms. If a portal gates registration on CAPTCHA, that is a signal to use a real account, not to escalate. Escalation raises both ToS and ethics exposure for marginal coverage gain.

**Consequence for the design:** the automation must **degrade gracefully** — detect a wall it can't pass, mark the portal `band=C`, emit the headline row it already has, and record the limitation in `run_metadata.gaps`. The pipeline's success is measured by *how many rows it upgrades from headline to full detail*, not by beating every wall.

---

## 8. Compliance / ToS / risk register (must be decided before build)

This mechanism automates account creation with disposable identities to read behind free walls. That is **legal grey**, not clearly permitted, and the risk differs sharply by band. Flagging honestly so you can make the call:

| Risk | Detail | Mitigation |
|------|--------|------------|
| **ToS breach** | Many supplier portals' terms prohibit automated access and/or disposable/false registration details. | For Band C (corporate), use **real accounts with your genuine business identity** — you are a legitimate prospective supplier, which is exactly who these portals are for. Reserve temp-email only for low-stakes Band B gov/council document gates. |
| **Data provenance** | Automated summaries could misstate a requirement and mislead a bid decision. | Fidelity guard (§5.7) + always store `detail_source`; surface the source document link in the portal so a human verifies before bidding. |
| **Account bans / IP blocks** | Aggressive automation on Ariba/Coupa can get accounts/IPs blocked, losing the source entirely. | Politeness limits, low frequency, real accounts for strong walls, one account per portal. |
| **Fabricated identity on KYC portals** | Inventing an ABN/company to pass verification is misrepresentation — do not do it. | Never fabricate ABN/business identity. If a portal needs real KYC, use real details or skip. |
| **Personal data / GDPR-adjacent** | Contact names/emails scraped from notices are personal data. | Store only what's needed; the notices already publish these for supplier contact. |

**Recommended posture:** treat temp-email automation as the tool for **weakly-gated, low-risk, genuinely-public-interest gov/quasi-gov document walls**, and use **persistent real supplier accounts** for the high-value corporate platforms. This gets ~most of the coverage with far less ToS/ban risk than trying to disposable-email through Ariba. This split should be an explicit config policy, not an accident.

---

## 9. Output contract (unchanged schema)

The ingester writes the **same** `output/tenders.json` shape the routine produces today, so `aggregate.js` and the portal need **zero changes**. The only difference is that previously-null detail fields get populated for Band-B rows. Fields to now reliably fill for upgraded rows:

`deliverables_summary`, `key_deliverables[]`, `scope_of_work`, `requirements[]`, `eligibility`, `evaluation_criteria[]`, `value`, `contract_term`, `contract_start/end`, `closing_date/time`, `questions_due`, `briefing`, `submission_method`, `lodgement_url`, `documents[]` (with real downloadable URLs), `mandatory_conditions[]`, `contact_*`, and crucially `detail_source` (provenance) + `access` (set truthfully).

Add two optional `run_metadata` counters so the portal's Coverage tab can show progress:
- `entries_upgraded` — headline rows turned into full detail this run.
- `walls_passed` / `walls_failed` — Band-B portals successfully vs. unsuccessfully authenticated.

---

## 10. Phased delivery plan

| Phase | Deliverable | Value | Risk |
|-------|-------------|-------|------|
| **0. Registry + classifier** | `registry.py` seeded from the prompt's tiers + current `discovered_sources`; every source tagged band A/B/C/D. | Foundation; tells us what's even automatable. | None |
| **1. Band-A fetchers** | Real RSS/JSON/HTML fetchers for AusTender + state portals + VendorPanel public. Extraction + merge. | Stops relying on the LLM for the reliable backbone; immediate accuracy win. | Low |
| **2. Mail layer + generic Band-B driver** | `MailProvider` (mail.tm), `generic_html` driver, vault. Prove the loop on **one weakly-gated gov/council document wall** end-to-end. | Validates the whole registration→confirm→read→summarise loop cheaply. | Medium |
| **3. Private catch-all domain** | `catchall.py` provider (Cloudflare/IMAP). | Defeats disposable-domain blocklists; unlocks stronger Band-B walls. | Medium |
| **4. Platform drivers** | `estimateone`, `vendorpanel`, then evaluate `ariba_discovery` (likely Band C → real account). | Coverage of the highest-value platforms, using real accounts where wise. | High (anti-bot) |
| **5. Doc extraction + summarisation hardening** | `pdfplumber`/`python-docx` + fidelity-guarded LLM pass, provenance-tracked. | Turns downloaded documents into the requirements summary you want. | Medium |

**Recommendation:** do Phases 0–2 first. They de-risk the concept (prove one wall end-to-end, harden the open backbone) before investing in the fragile, high-anti-bot corporate drivers. Decide Phase 4's Ariba approach (real account vs. automated) only after Phase 2 shows how the mail+driver loop behaves in practice.

---

## 11. Open questions for you

1. **Risk appetite:** OK to automate free-registration on gov/council document walls, but use *real* supplier accounts for corporate (Ariba/Coupa/Woolworths)? (Recommended.) Or push automation everywhere and accept ban/ToS risk?
2. **Private domain:** willing to register one cheap domain + Cloudflare Email Routing (≈$10/yr, free routing) for the robust email tier? Materially raises Band-B success rate.
3. **Compute for browser automation:** Playwright headless needs somewhere to run daily (the current routine is LLM-only). Local machine, a cheap VPS, or CI runner?
4. **Priority portals:** which 3–5 gated sources matter most to your bidding? That sets the Phase-4 driver order.
5. **LLM budget:** summarisation of documents per tender costs tokens. Cap per-run (e.g. only upgrade the last 48h / high-value rows, matching the prompt's depth-vs-breadth rule)?
