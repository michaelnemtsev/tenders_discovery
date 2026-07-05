/* Australia Tender Discovery — static portal logic (no dependencies). */
(function () {
  "use strict";

  // ---- State ----
  var STATE = {
    data: { run_metadata: {}, tenders: [], discovered_sources: [] },
    meta: { runs: [], runCount: 1, latestRun: null, isAggregate: false },
    source: "none", // "live" | "sample" | "file"
    view: "cards",
    filters: { search: "", closingWindow: "", facets: {}, month: "", newOnly: false, activeOnly: false },
    sort: "open_recent",
    sourcesNewOnly: false
  };

  var FACET_FIELDS = ["source_type", "state", "procurement_type", "current_status", "access"];

  // Reference "today" — prefer the run_date so urgency is consistent with the export.
  function refToday() {
    var rd = STATE.data.run_metadata && STATE.data.run_metadata.run_date;
    var d = rd ? new Date(rd + "T00:00:00") : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  }

  // ---- Utilities ----
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Only allow http(s) links — data is auto-harvested, so block javascript:/data: etc.
  function safeUrl(u) {
    var s = String(u == null ? "" : u).trim();
    return /^https?:\/\//i.test(s) ? s : "";
  }
  function titleize(s) {
    if (!s) return "—";
    return String(s).replace(/[-_]/g, " ").replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  function parseValue(v) {
    if (v == null || v === "") return null;
    var n = Number(String(v).replace(/[^0-9.]/g, ""));
    return isNaN(n) ? null : n;
  }
  function fmtValue(v) {
    var n = parseValue(v);
    if (n == null) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + n;
  }
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(String(s).length <= 10 ? s + "T00:00:00" : s);
    return isNaN(d.getTime()) ? null : d;
  }
  function daysUntil(dateStr) {
    var d = parseDate(dateStr);
    if (!d) return null;
    return Math.round((d - refToday()) / 86400000);
  }
  function fmtDate(s) {
    var d = parseDate(s);
    if (!d) return "—";
    return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  }
  function dueInfo(dateStr) {
    var n = daysUntil(dateStr);
    if (n == null) return { cls: "due--ok", text: fmtDate(dateStr) };
    if (n < 0) return { cls: "due--overdue", text: "Closed " + Math.abs(n) + "d ago" };
    if (n === 0) return { cls: "due--soon", text: "Closes today" };
    if (n <= 7) return { cls: "due--soon", text: n + "d left" };
    return { cls: "due--ok", text: n + "d left" };
  }

  // =================================================================
  // Data loading
  // =================================================================
  function setData(data, source) {
    data = data || {};
    var isAggregate = Array.isArray(data.runs);
    STATE.data = {
      run_metadata: data.run_metadata || {},
      tenders: Array.isArray(data.tenders) ? data.tenders : [],
      discovered_sources: Array.isArray(data.discovered_sources) ? data.discovered_sources : []
    };
    // Normalise run coverage so the UI works for both an aggregate and a single run.
    var runs = isAggregate ? data.runs
      : (data.run_metadata && data.run_metadata.run_date ? [data.run_metadata.run_date] : []);
    STATE.meta = {
      runs: runs,
      runCount: isAggregate ? (data.run_count || runs.length) : runs.length,
      latestRun: isAggregate ? data.latest_run : (data.run_metadata && data.run_metadata.run_date) || null,
      firstRun: isAggregate ? data.first_run : runs[0] || null,
      coverage: isAggregate ? data.latest_coverage_summary : (data.run_metadata && data.run_metadata.coverage_summary) || "",
      latestMeta: isAggregate ? (data.latest_run_metadata || {}) : (data.run_metadata || {}),
      isAggregate: isAggregate
    };
    STATE.source = source;
    STATE.filters.facets = {};
    STATE.filters.month = "";
    STATE.filters.newOnly = false;
    STATE.filters.activeOnly = false;
    if (source === "live" || source === "file") clearBanner(); // real data loaded
    updateDataBadge();
    renderRunStrip();
    buildMonths();
    buildFacets();
    renderAll();
  }

  // Prefer the accumulated aggregate; fall back to a single day's run.
  function loadLive() {
    return fetchJson("../output/aggregate.json")
      .then(function (json) { setData(json, "live"); return { ok: true }; })
      .catch(function () {
        return fetchJson("../output/tenders.json")
          .then(function (json) { setData(json, "live"); return { ok: true }; })
          .catch(function (err) { return { ok: false, error: err }; });
      });
  }
  function fetchJson(url) {
    return fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  function updateDataBadge() {
    var badge = $("#data-badge");
    badge.classList.remove("badge--live", "badge--sample", "badge--muted");
    if (STATE.source === "live") { badge.textContent = "Live export"; badge.classList.add("badge--live"); }
    else if (STATE.source === "file") { badge.textContent = "Loaded file"; badge.classList.add("badge--live"); }
    else if (STATE.source === "sample") { badge.textContent = "Sample data"; badge.classList.add("badge--sample"); }
    else { badge.textContent = "No data"; badge.classList.add("badge--muted"); }
  }

  // =================================================================
  // Run strip (run_metadata summary)
  // =================================================================
  function renderRunStrip() {
    var strip = $("#run-strip");
    strip.hidden = false;
    $("#meta-latest-run").textContent = STATE.meta.latestRun || "—";
    $("#meta-unique").textContent = STATE.data.tenders.length;
    var newCount = STATE.data.tenders.filter(function (t) { return t.is_new_in_latest; }).length;
    $("#meta-new").textContent = STATE.meta.isAggregate ? newCount : STATE.data.tenders.length;
    var closing = STATE.data.tenders.filter(function (t) {
      var n = daysUntil(t.closing_date);
      return n != null && n >= 0 && n <= 7;
    }).length;
    $("#meta-closing").textContent = closing;
    var runsLabel = String(STATE.meta.runCount);
    if (STATE.meta.runCount > 1) runsLabel += " (" + STATE.meta.firstRun + " → " + STATE.meta.latestRun + ")";
    $("#meta-runs").textContent = runsLabel;
  }

  // =================================================================
  // Month dropdown (built from first_seen of accumulated tenders)
  // =================================================================
  function buildMonths() {
    var sel = $("#month-filter");
    var monthField = $("#field-month");
    var flagsField = $("#field-time-flags");
    var months = {};
    STATE.data.tenders.forEach(function (t) {
      var m = (t.first_seen || "").slice(0, 7);
      if (m) months[m] = (months[m] || 0) + 1;
    });
    var keys = Object.keys(months).sort().reverse();
    // Only worth showing the time controls once there is accumulation to slice.
    var showTime = STATE.meta.isAggregate || keys.length > 1;
    monthField.hidden = !showTime || keys.length < 1;
    flagsField.hidden = !STATE.meta.isAggregate;
    sel.innerHTML = '<option value="">All time</option>';
    keys.forEach(function (k) {
      var opt = document.createElement("option");
      opt.value = k;
      opt.textContent = monthLabel(k) + " (" + months[k] + ")";
      sel.appendChild(opt);
    });
  }
  function monthLabel(ym) {
    var parts = ym.split("-");
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var mi = Number(parts[1]) - 1;
    return (names[mi] || parts[1]) + " " + parts[0];
  }

  // =================================================================
  // Facets
  // =================================================================
  function buildFacets() {
    FACET_FIELDS.forEach(function (field) {
      var counts = {};
      STATE.data.tenders.forEach(function (t) {
        var v = t[field] || "—";
        counts[v] = (counts[v] || 0) + 1;
      });
      var container = $("#facet-" + field);
      container.innerHTML = "";
      var keys = Object.keys(counts).sort();
      if (!keys.length) {
        container.appendChild(el("div", "facet__count", "none"));
        return;
      }
      keys.forEach(function (key) {
        var row = el("label", "facet__row");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = key;
        cb.checked = !!(STATE.filters.facets[field] && STATE.filters.facets[field][key]);
        cb.addEventListener("change", function () {
          STATE.filters.facets[field] = STATE.filters.facets[field] || {};
          if (cb.checked) STATE.filters.facets[field][key] = true;
          else delete STATE.filters.facets[field][key];
          renderTenders();
        });
        row.appendChild(cb);
        row.appendChild(el("span", "facet__label", field === "state" || field === "access" || field === "current_status" || field === "procurement_type" || field === "source_type" ? labelFor(field, key) : key));
        row.appendChild(el("span", "facet__count", String(counts[key])));
        container.appendChild(row);
      });
    });
  }

  function labelFor(field, key) {
    if (field === "state") return key;
    return titleize(key);
  }

  // =================================================================
  // Filtering + sorting
  // =================================================================
  function activeFacet(field) {
    var f = STATE.filters.facets[field];
    return f ? Object.keys(f) : [];
  }

  function filteredTenders() {
    var q = STATE.filters.search.trim().toLowerCase();
    var win = STATE.filters.closingWindow;
    var month = STATE.filters.month;
    return STATE.data.tenders.filter(function (t) {
      // text search
      if (q) {
        var hay = [t.title, t.description, t.buyer, t.source_name, t.category, (t.tags || []).join(" ")].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      // accumulation filters
      if (month && (t.first_seen || "").slice(0, 7) !== month) return false;
      if (STATE.filters.newOnly && !t.is_new_in_latest) return false;
      if (STATE.filters.activeOnly && !t.active_in_latest) return false;
      // facets
      for (var i = 0; i < FACET_FIELDS.length; i++) {
        var field = FACET_FIELDS[i];
        var sel = activeFacet(field);
        if (sel.length) {
          var v = t[field] || "—";
          if (sel.indexOf(v) === -1) return false;
        }
      }
      // closing window
      if (win) {
        var n = daysUntil(t.closing_date);
        if (win === "overdue") { if (n == null || n >= 0) return false; }
        else { if (n == null || n < 0 || n > Number(win)) return false; }
      }
      return true;
    });
  }

  // A tender counts as "closed" only when it has a real closing date in the past.
  // No/unknown closing date is treated as still-open so it stays near the top.
  function isClosed(t) {
    var n = daysUntil(t.closing_date);
    return n != null && n < 0;
  }
  // "Latest" = most recently published, falling back to when we first saw it.
  function recencyTime(t) {
    var d = parseDate(t.publish_date) || parseDate(t.first_seen);
    return d ? d.getTime() : null;
  }

  function sortTenders(rows) {
    // Default view: open (not-yet-closed) opportunities on top, newest first;
    // anything already closed sinks to the bottom (most-recently-closed first).
    if (STATE.sort === "open_recent") {
      return rows.slice().sort(function (a, b) {
        var ac = isClosed(a), bc = isClosed(b);
        if (ac !== bc) return ac ? 1 : -1; // open before closed
        if (ac) {
          var acd = parseDate(a.closing_date), bcd = parseDate(b.closing_date);
          acd = acd ? acd.getTime() : null; bcd = bcd ? bcd.getTime() : null;
          if (acd == null && bcd == null) return 0;
          if (acd == null) return 1;
          if (bcd == null) return -1;
          return bcd - acd; // both closed → most recently closed first
        }
        var ar = recencyTime(a), br = recencyTime(b);
        if (ar == null && br == null) return 0;
        if (ar == null) return 1;
        if (br == null) return -1;
        return br - ar; // both open → latest published first
      });
    }
    var parts = STATE.sort.split(":");
    var key = parts[0], dir = parts[1] === "desc" ? -1 : 1;
    return rows.slice().sort(function (a, b) {
      var av, bv;
      if (key === "value") { av = parseValue(a.value); bv = parseValue(b.value); }
      else if (key === "title") { av = (a.title || "").toLowerCase(); bv = (b.title || "").toLowerCase(); }
      else { av = parseDate(a[key]); bv = parseDate(b[key]); av = av ? av.getTime() : null; bv = bv ? bv.getTime() : null; }
      // nulls always sort last regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  // =================================================================
  // Rendering — tenders
  // =================================================================
  function statusChip(status) {
    var s = (status || "").toLowerCase().replace(/\s+/g, "-");
    return '<span class="chip chip--status-' + esc(s) + '">' + esc(titleize(status || "—")) + "</span>";
  }
  function accessChip(access) {
    if (!access) return "";
    var s = access.toLowerCase().replace(/\s+/g, "-");
    var label = access === "paywalled-do-not-rely" ? "Paywalled" : titleize(access);
    return '<span class="chip chip--access-' + esc(s) + '">' + esc(label) + "</span>";
  }

  function renderTenders() {
    var rows = sortTenders(filteredTenders());
    var total = STATE.data.tenders.length;
    $("#results-count").innerHTML = "<strong>" + rows.length + "</strong> of " + total + " tenders";
    var container = $("#tender-results");
    container.innerHTML = "";
    if (!rows.length) {
      container.appendChild(emptyState("No tenders match", "Try clearing filters or widening the closing window."));
      return;
    }
    if (STATE.view === "cards") container.appendChild(renderCards(rows));
    else container.appendChild(renderTable(rows));
  }

  function renderCards(rows) {
    var grid = el("div", "cards");
    rows.forEach(function (t) {
      var card = el("article", "card");

      var top = el("div", "card__top");
      var badges = el("div", "card__badges");
      badges.innerHTML =
        (STATE.meta.isAggregate && t.is_new_in_latest ? '<span class="chip chip--new">NEW</span>' : "") +
        '<span class="chip chip--type">' + esc(t.procurement_type || "—") + "</span>" +
        statusChip(t.current_status);
      top.appendChild(badges);
      var due = dueInfo(t.closing_date);
      top.appendChild(el("span", "due " + due.cls, due.text));
      card.appendChild(top);

      var title = el("h3", "card__title", t.title || "(untitled)");
      card.appendChild(title);
      card.appendChild(el("div", "card__buyer", (t.buyer || "Unknown buyer") + " · " + (t.state || t.jurisdiction || "")));
      if (t.description) card.appendChild(el("p", "card__desc", t.description));

      var meta = el("div", "card__meta");
      meta.appendChild(metaCell("Value", fmtValue(t.value)));
      meta.appendChild(metaCell("Closing", fmtDate(t.closing_date)));
      meta.appendChild(metaCell("Source", titleize(t.source_type)));
      meta.appendChild(metaCell("Category", t.category || "—"));
      if (STATE.meta.isAggregate) {
        meta.appendChild(metaCell("First seen", fmtDate(t.first_seen)));
        meta.appendChild(metaCell("Seen", (t.seen_count || 1) + (t.seen_count === 1 ? " run" : " runs")));
      }
      card.appendChild(meta);

      var foot = el("div", "card__foot");
      var tags = el("div", "card__tags");
      tags.innerHTML = accessChip(t.access);
      (t.tags || []).slice(0, 3).forEach(function (tag) {
        tags.appendChild(el("span", "tag", tag));
      });
      foot.appendChild(tags);
      var cardHref = safeUrl(t.tender_url);
      if (cardHref) {
        var a = el("a", "card__link", "View ↗");
        a.href = cardHref; a.target = "_blank"; a.rel = "noopener";
        foot.appendChild(a);
      }
      card.appendChild(foot);
      grid.appendChild(card);
    });
    return grid;
  }

  function metaCell(label, value) {
    var c = el("div", "meta-cell");
    c.appendChild(el("div", "meta-cell__label", label));
    c.appendChild(el("div", "meta-cell__value", value));
    return c;
  }

  function renderTable(rows) {
    var agg = STATE.meta.isAggregate;
    var wrap = el("div", "table-wrap");
    var table = el("table", "data");
    table.innerHTML =
      "<thead><tr>" +
      "<th>Title / Buyer</th><th>Type</th><th>Source</th><th>State</th>" +
      "<th>Value</th><th>Closing</th><th>Status</th><th>Access</th>" +
      (agg ? "<th>Seen</th>" : "") + "<th></th>" +
      "</tr></thead>";
    var tbody = el("tbody");
    rows.forEach(function (t) {
      var tr = el("tr");
      var due = dueInfo(t.closing_date);
      var newBadge = agg && t.is_new_in_latest ? ' <span class="chip chip--new">NEW</span>' : "";
      var seenCell = agg
        ? "<td>" + (t.seen_count || 1) + '<div class="cell-sub">since ' + esc(fmtDate(t.first_seen)) + "</div></td>"
        : "";
      tr.innerHTML =
        '<td class="col-title">' + esc(t.title || "(untitled)") + newBadge +
          '<div class="cell-sub">' + esc(t.buyer || "") + "</div></td>" +
        "<td>" + esc(t.procurement_type || "—") + "</td>" +
        "<td>" + esc(titleize(t.source_type)) + "</td>" +
        "<td>" + esc(t.state || "—") + "</td>" +
        "<td>" + esc(fmtValue(t.value)) + "</td>" +
        '<td>' + esc(fmtDate(t.closing_date)) + '<div class="cell-sub ' + due.cls + '">' + esc(due.text) + "</div></td>" +
        "<td>" + statusChip(t.current_status) + "</td>" +
        "<td>" + (accessChip(t.access) || "—") + "</td>" +
        seenCell +
        "<td>" + (safeUrl(t.tender_url) ? '<a href="' + esc(safeUrl(t.tender_url)) + '" target="_blank" rel="noopener">View ↗</a>' : "") + "</td>";
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // =================================================================
  // Rendering — discovered sources
  // =================================================================
  function renderSources() {
    var rows = STATE.data.discovered_sources;
    if (STATE.sourcesNewOnly) rows = rows.filter(function (s) { return s.is_new_source; });
    $("#sources-count").innerHTML = "<strong>" + rows.length + "</strong> sources";
    var container = $("#sources-results");
    container.innerHTML = "";
    if (!rows.length) {
      container.appendChild(emptyState("No sources", "This export contained no discovered_sources entries."));
      return;
    }
    var wrap = el("div", "table-wrap");
    var table = el("table", "data");
    table.innerHTML =
      "<thead><tr><th>Source</th><th>Type</th><th>Jurisdiction</th><th>Platform</th>" +
      "<th>Access</th><th>Confidence</th><th>Check</th><th></th></tr></thead>";
    var tbody = el("tbody");
    rows.forEach(function (s) {
      var tr = el("tr");
      var newBadge = s.is_new_source ? ' <span class="chip chip--new">NEW</span>' : "";
      tr.innerHTML =
        '<td class="col-title">' + esc(s.source_name || "—") + newBadge +
          (s.how_discovered ? '<div class="cell-sub">' + esc(s.how_discovered) + "</div>" : "") + "</td>" +
        "<td>" + esc(titleize(s.source_type)) + "</td>" +
        "<td>" + esc(s.jurisdiction || "—") + "</td>" +
        "<td>" + esc(s.platform || "—") + "</td>" +
        "<td>" + esc(titleize(s.access_method)) + "</td>" +
        "<td>" + esc(titleize(s.confidence)) + "</td>" +
        "<td>" + esc(titleize(s.recommended_check_frequency)) + "</td>" +
        "<td>" + (safeUrl(s.source_url) ? '<a href="' + esc(safeUrl(s.source_url)) + '" target="_blank" rel="noopener">Open ↗</a>' : "") + "</td>";
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
  }

  // =================================================================
  // Rendering — coverage (run_metadata)
  // =================================================================
  function renderCoverage() {
    var m = STATE.meta.latestMeta || {};
    var summary = STATE.meta.coverage || m.coverage_summary || "";
    var c = $("#coverage-results");
    c.innerHTML = "";

    // Latest-run summary banner (moved here from the home strip to save space).
    if (summary) {
      var banner = el("div", "cov-card");
      banner.style.cssText = "margin-bottom:16px";
      banner.appendChild(el("h3", null, "Latest run — " + (STATE.meta.latestRun || m.run_date || "")));
      var sp = el("p", null, summary);
      sp.style.cssText = "margin:0;font-size:13px;color:var(--text-2);line-height:1.55";
      banner.appendChild(sp);
      c.appendChild(banner);
    }

    var grid = el("div", "cov-grid");

    // Stats card
    var stats = el("div", "cov-card");
    stats.appendChild(el("h3", null, "Coverage (latest run)"));
    var row = el("div", "cov-stat-row");
    [
      [m.tenders_found != null ? m.tenders_found : STATE.data.tenders.length, "Tenders"],
      [m.sources_checked != null ? m.sources_checked : "—", "Sources checked"],
      [m.new_sources_found != null ? m.new_sources_found : "—", "New sources"],
      [m.entries_pending_detail != null ? m.entries_pending_detail : "—", "Pending detail"]
    ].forEach(function (pair) {
      var st = el("div", "cov-stat");
      st.appendChild(el("div", "cov-stat__n", String(pair[0])));
      st.appendChild(el("div", "cov-stat__l", pair[1]));
      row.appendChild(st);
    });
    stats.appendChild(row);
    grid.appendChild(stats);

    // Gaps card
    var gaps = el("div", "cov-card");
    gaps.appendChild(el("h3", null, "Coverage gaps"));
    if (m.gaps && m.gaps.length) {
      var ul = el("ul");
      m.gaps.forEach(function (g) {
        var li = el("li");
        li.innerHTML = '<span class="pill-warn">gap</span> ' + esc(g);
        ul.appendChild(li);
      });
      gaps.appendChild(ul);
    } else {
      gaps.appendChild(el("p", null, "No gaps reported.")).style.cssText = "font-size:13px;color:var(--text-2)";
    }
    grid.appendChild(gaps);

    // Recommended seed additions
    var rec = el("div", "cov-card");
    rec.appendChild(el("h3", null, "Recommended seed additions"));
    if (m.recommended_seed_additions && m.recommended_seed_additions.length) {
      var ul2 = el("ul");
      m.recommended_seed_additions.forEach(function (r) {
        var li = el("li");
        li.innerHTML = '<span class="pill-ok">add</span> ' + esc(r);
        ul2.appendChild(li);
      });
      rec.appendChild(ul2);
    } else {
      rec.appendChild(el("p", null, "Nothing recommended this run.")).style.cssText = "font-size:13px;color:var(--text-2)";
    }
    grid.appendChild(rec);

    c.appendChild(grid);
  }

  function emptyState(title, sub) {
    var e = el("div", "empty");
    e.appendChild(el("div", "empty__icon", "∅"));
    e.appendChild(el("h3", null, title));
    e.appendChild(el("p", null, sub));
    return e;
  }

  // =================================================================
  // Render orchestration + tab counts
  // =================================================================
  function renderAll() {
    $("#tab-count-tenders").textContent = STATE.data.tenders.length;
    $("#tab-count-sources").textContent = STATE.data.discovered_sources.length;
    renderTenders();
    renderSources();
    renderCoverage();
  }

  // =================================================================
  // Events
  // =================================================================
  function wireEvents() {
    // Tabs
    $all(".tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        $all(".tab").forEach(function (t) { t.classList.remove("tab--active"); });
        tab.classList.add("tab--active");
        var name = tab.getAttribute("data-tab");
        ["tenders", "sources", "coverage"].forEach(function (n) {
          $("#panel-" + n).hidden = n !== name;
        });
      });
    });

    // Search (debounced)
    var to;
    $("#search").addEventListener("input", function (e) {
      clearTimeout(to);
      var v = e.target.value;
      to = setTimeout(function () { STATE.filters.search = v; renderTenders(); }, 140);
    });

    $("#closing-window").addEventListener("change", function (e) {
      STATE.filters.closingWindow = e.target.value; renderTenders();
    });
    $("#sort-by").addEventListener("change", function (e) {
      STATE.sort = e.target.value; renderTenders();
    });
    $("#month-filter").addEventListener("change", function (e) {
      STATE.filters.month = e.target.value; renderTenders();
    });
    $("#flag-new").addEventListener("change", function (e) {
      STATE.filters.newOnly = e.target.checked; renderTenders();
    });
    $("#flag-active").addEventListener("change", function (e) {
      STATE.filters.activeOnly = e.target.checked; renderTenders();
    });

    $("#clear-filters").addEventListener("click", function () {
      STATE.filters.search = "";
      STATE.filters.closingWindow = "";
      STATE.filters.facets = {};
      STATE.filters.month = "";
      STATE.filters.newOnly = false;
      STATE.filters.activeOnly = false;
      $("#search").value = "";
      $("#closing-window").value = "";
      $("#month-filter").value = "";
      $("#flag-new").checked = false;
      $("#flag-active").checked = false;
      buildFacets();
      renderTenders();
    });

    // View toggle
    $("#view-cards").addEventListener("click", function () { setView("cards"); });
    $("#view-table").addEventListener("click", function () { setView("table"); });

    // Sources new-only
    $("#sources-new-only").addEventListener("change", function (e) {
      STATE.sourcesNewOnly = e.target.checked; renderSources();
    });

    // File input
    $("#file-input").addEventListener("change", function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) readFile(file);
    });

    // Reload live
    $("#reload-btn").addEventListener("click", function () {
      loadLive().then(function (res) {
        if (!res.ok) noteLiveFailure(res.error);
      });
    });

    // Drag & drop
    var overlay = $("#drop-overlay");
    var dragDepth = 0;
    window.addEventListener("dragenter", function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1) {
        dragDepth++; overlay.hidden = false;
      }
    });
    window.addEventListener("dragover", function (e) { e.preventDefault(); });
    window.addEventListener("dragleave", function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
    window.addEventListener("drop", function (e) {
      e.preventDefault(); dragDepth = 0; overlay.hidden = true;
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readFile(file);
    });
  }

  function setView(view) {
    STATE.view = view;
    $("#view-cards").classList.toggle("viewtoggle__btn--active", view === "cards");
    $("#view-table").classList.toggle("viewtoggle__btn--active", view === "table");
    renderTenders();
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var json = JSON.parse(reader.result);
        setData(json, "file");
      } catch (err) {
        flashBadge("Invalid JSON: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  function flashBadge(msg) {
    var badge = $("#data-badge");
    var prev = badge.textContent;
    badge.textContent = msg;
    setTimeout(function () { badge.textContent = prev; }, 3200);
  }

  // Persistent banner explaining why live data could not load (so the fallback
  // to sample data is never silent).
  function showBanner(msg, isHint) {
    clearBanner();
    var bar = document.createElement("div");
    bar.id = "data-banner";
    bar.style.cssText =
      "padding:11px 24px;font-size:12.5px;font-weight:600;line-height:1.45;" +
      "border-bottom:1px solid rgba(0,0,0,.06);" +
      (isHint ? "background:#fdecdc;color:#9a3412;" : "background:#fbe6e6;color:#b91c1c;");
    bar.textContent = msg;
    var tabs = document.querySelector(".tabs");
    tabs.parentNode.insertBefore(bar, tabs);
  }
  function clearBanner() {
    var b = document.getElementById("data-banner");
    if (b) b.remove();
  }
  function noteLiveFailure(err) {
    var isFile = location.protocol === "file:";
    var msg = isFile
      ? "Showing bundled sample data. The browser blocks reading local files over file:// — so output/tenders.json can’t be auto-loaded. Fix: run a local server (npm start) and open http://localhost:8000/web/ — or use “Load JSON…” / drag a tenders.json onto the page."
      : "Showing bundled sample data — couldn’t load ../output/tenders.json (" +
        ((err && err.message) || "fetch failed") +
        "). Make sure the file exists and the page is served from the project root.";
    console.warn("[Tender Discovery] " + msg);
    showBanner(msg, isFile);
  }

  // =================================================================
  // Boot
  // =================================================================
  function boot() {
    wireEvents();
    // Show sample immediately so the page is never empty, then try live export.
    if (window.SAMPLE_DATA) setData(window.SAMPLE_DATA, "sample");
    loadLive().then(function (res) {
      if (!res.ok) noteLiveFailure(res.error);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
