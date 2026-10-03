// HTTP routes for the optional Data Collection program
// (docs/data-collection-program.md). Registered from server.js with its
// own auth middleware and helpers injected, so this file holds only the
// program's request handling; every decision rule lives in
// lib/dataCollection.js.
//
// Authorization, on every route:
//   - Driver routes use requireDriverSelf: the driver is the one from the
//     signed session, never a driver_id from the request, and admin
//     credentials cannot act as a driver here.
//   - Admin routes use requireAdmin plus a program capability checked
//     with lib/adminRbac.js (deny by default).
//   - The database tables are server-only (RLS on, no client grants).

const crypto = require("crypto");
const dc = require("./dataCollection");
const { hasCapability, resolveAdminRole } = require("./adminRbac");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 1000;

const T = Object.freeze({
  applications: "data_collection_applications",
  agreements: "data_collection_agreements",
  equipment: "data_collection_equipment",
  batches: "data_collection_import_batches",
  hours: "data_collection_hour_records",
  exceptions: "data_collection_import_exceptions",
  audit: "data_collection_audit_log"
});

function registerDataCollectionRoutes(app, deps) {
  const { supabase, requireAdmin, requireDriverSelf, getSystemFlag, asyncRoute, ok, fail, env = process.env } = deps;

  /* ---------------- helpers ---------------- */

  async function loadGates() {
    const [program, enrollment, collection] = await Promise.all([
      getSystemFlag(dc.FLAGS.program, "false"),
      getSystemFlag(dc.FLAGS.enrollment, "false"),
      getSystemFlag(dc.FLAGS.collection, "false")
    ]);
    return dc.resolveProgramGates({
      [dc.FLAGS.program]: program,
      [dc.FLAGS.enrollment]: enrollment,
      [dc.FLAGS.collection]: collection
    });
  }

  // Read at request time so a configuration change needs no code change.
  // The organization code lives only in the server environment.
  function minuteConfig() {
    return {
      organizationCode: dc.cleanText(env.MINUTE_ORGANIZATION_CODE || "", 100),
      iosUrl: dc.safeHttpsUrl(env.MINUTE_IOS_APP_URL || ""),
      androidUrl: dc.safeHttpsUrl(env.MINUTE_ANDROID_APP_URL || "")
    };
  }

  function adminActor(req) {
    return `admin:${req.admin?.email || req.admin?.id || "unknown"}`;
  }

  // requireAdmin stays a visible, separate step in every admin route's
  // middleware chain (test/server.agent-safety.test.js checks for it);
  // the capability check runs after it, on the identity it resolved.
  function requireCapability(capability) {
    const checkCapability = (req, res, next) => {
      if (!hasCapability(resolveAdminRole(req.admin), capability)) {
        return fail(res, "Your admin role does not allow this Data Collection action.", 403);
      }
      return next();
    };
    return [requireAdmin, checkCapability];
  }

  async function audit(actor, action, entityType, entityId, details = {}) {
    const { error } = await supabase.from(T.audit).insert({
      actor,
      action,
      entity_type: entityType,
      entity_id: entityId == null ? null : String(entityId),
      details
    });
    if (error) {
      console.error("❌ Data collection audit entry failed:", { action, code: error.code, message: error.message });
      return false;
    }
    return true;
  }

  // Saved, but no audit entry: say so rather than report plain success.
  function auditFailed(res) {
    return fail(res, "The change was saved, but its audit entry could not be written. Contact engineering before continuing.", 500, {
      saved: true,
      audit_logged: false
    });
  }

  async function selectAll(table, columns, apply = (q) => q) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await apply(supabase.from(table).select(columns)).range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) return rows;
    }
  }

  async function loadApplication(id) {
    if (!UUID_RE.test(String(id || ""))) return null;
    const { data, error } = await supabase.from(T.applications).select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  const byNewest = (field) => (a, b) => String(b[field] || "").localeCompare(String(a[field] || ""));

  /* ======================================================
     DRIVER ROUTES
  ====================================================== */

  app.get(
    "/api/driver/data-collection",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const gates = await loadGates();
      // Program off: reveal nothing beyond that.
      if (!gates.program) return ok(res, { program_enabled: false });

      const driverId = req.driver.id;
      const eligibility = dc.evaluateDriverEligibility(req.driver);

      const { data: apps, error: appErr } = await supabase.from(T.applications).select("*").eq("driver_id", driverId);
      if (appErr) throw appErr;
      const application = (apps || []).sort(byNewest("submitted_at"))[0] || null;

      let agreementRows = [];
      let equipmentRows = [];
      if (application) {
        const [{ data: ag, error: agErr }, { data: eq, error: eqErr }] = await Promise.all([
          supabase.from(T.agreements).select("*").eq("application_id", application.id),
          supabase.from(T.equipment).select("*").eq("application_id", application.id)
        ]);
        if (agErr) throw agErr;
        if (eqErr) throw eqErr;
        agreementRows = ag || [];
        equipmentRows = eq || [];
      }

      const hourRows = await selectAll(
        T.hours,
        "id, session_date, duration_seconds, status, driver_amount_cents, paid_at, created_at",
        (q) => q.eq("driver_id", driverId)
      );

      const config = minuteConfig();
      const codeAccess = dc.evaluateOrganizationCodeAccess({
        gates,
        application,
        agreementRows,
        organizationCode: config.organizationCode
      });
      const participant = Boolean(application && application.status === "approved" && gates.collection);

      return ok(res, {
        program_enabled: true,
        enrollment_open: gates.enrollment,
        collection_open: gates.collection,
        managed_by: "Harvey Taxi Service LLC",
        ineligible_task_notice: dc.INELIGIBLE_TASK_NOTICE,
        supported_countries: dc.SUPPORTED_COUNTRIES,
        driver_rate_cents_per_hour: dc.RATES.driverCentsPerHour,
        eligibility,
        application: application
          ? {
              id: application.id,
              status: application.status,
              status_reason: ["rejected", "suspended"].includes(application.status) ? application.status_reason || null : null,
              phone_model: application.phone_model,
              country: application.country,
              proposed_location: application.proposed_location,
              location_state: application.location_state,
              proposed_tasks: application.proposed_tasks,
              submitted_at: application.submitted_at,
              reviewed_at: application.reviewed_at || null,
              minute_account_linked: Boolean(application.minute_contributor_id)
            }
          : null,
        agreements: application ? dc.agreementStatusList(agreementRows) : [],
        equipment: equipmentRows.map((e) => ({
          id: e.id,
          item: e.item,
          asset_tag: e.asset_tag || null,
          status: e.status,
          assigned_at: e.assigned_at
        })),
        minute: participant
          ? {
              download_links: { ios: config.iosUrl, android: config.androidUrl },
              organization_code: codeAccess.allowed ? config.organizationCode : null,
              organization_code_pending: codeAccess.allowed ? [] : codeAccess.reasons
            }
          : null,
        earnings: dc.summarizeHours(hourRows),
        hours: hourRows
          .sort(byNewest("session_date"))
          .slice(0, 100)
          .map((h) => ({
            id: h.id,
            session_date: h.session_date,
            duration_seconds: h.duration_seconds,
            hours: dc.secondsToHours(h.duration_seconds),
            status: h.status,
            driver_amount_cents: h.driver_amount_cents,
            paid_at: h.paid_at || null
          }))
      });
    })
  );

  app.post(
    "/api/driver/data-collection/application",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const gates = await loadGates();
      if (!gates.program) return fail(res, "The Data Collection program is not available.", 404);
      if (!gates.enrollment) return fail(res, "Enrollment in the Data Collection program is not open yet.", 403);

      const eligibility = dc.evaluateDriverEligibility(req.driver);
      if (!eligibility.eligible) {
        return fail(res, "Only approved drivers in good standing can apply.", 403, { reasons: eligibility.reasons });
      }

      const parsed = dc.validateApplicationInput(req.body);
      if (!parsed.ok) return fail(res, parsed.errors[0], 400, { errors: parsed.errors });

      const { data: existing, error: exErr } = await supabase
        .from(T.applications)
        .select("id, status")
        .eq("driver_id", req.driver.id)
        .in("status", dc.ACTIVE_APPLICATION_STATUSES);
      if (exErr) throw exErr;
      if ((existing || []).length) return fail(res, "You already have an open application.", 409);

      const now = new Date().toISOString();
      const { data: inserted, error } = await supabase
        .from(T.applications)
        .insert({ id: crypto.randomUUID(), ...parsed.application, driver_id: req.driver.id, status: "submitted", submitted_at: now, updated_at: now })
        .select("*")
        .single();
      if (error) {
        if (error.code === "23505") return fail(res, "You already have an open application.", 409);
        throw error;
      }

      const logged = await audit(`driver:${req.driver.id}`, "application.submitted", "application", inserted.id, {
        task_review_flags: parsed.application.task_review_flags
      });
      if (!logged) return auditFailed(res);

      return ok(res, { application: { id: inserted.id, status: inserted.status } }, 201);
    })
  );

  app.post(
    "/api/driver/data-collection/application/withdraw",
    requireDriverSelf,
    asyncRoute(async (req, res) => {
      const gates = await loadGates();
      if (!gates.program) return fail(res, "The Data Collection program is not available.", 404);

      const { data: rows, error } = await supabase
        .from(T.applications)
        .update({ status: "withdrawn", updated_at: new Date().toISOString() })
        .eq("driver_id", req.driver.id)
        .eq("status", "submitted")
        .select("id");
      if (error) throw error;
      if (!rows || !rows.length) return fail(res, "There is no submitted application to withdraw.", 409);

      const logged = await audit(`driver:${req.driver.id}`, "application.withdrawn", "application", rows[0].id);
      if (!logged) return auditFailed(res);
      return ok(res, { withdrawn: true });
    })
  );

  /* ======================================================
     ADMIN ROUTES
  ====================================================== */

  const base = "/api/admin/data-collection";

  app.get(
    `${base}/overview`,
    requireCapability("data_collection.read"),
    asyncRoute(async (req, res) => {
      const gates = await loadGates();
      const config = minuteConfig();
      const [apps, hours, openExceptions] = await Promise.all([
        selectAll(T.applications, "id, status"),
        selectAll(T.hours, "status, duration_seconds, driver_amount_cents, company_amount_cents"),
        selectAll(T.exceptions, "id", (q) => q.is("resolved_at", null))
      ]);
      const applicationCounts = {};
      for (const s of dc.APPLICATION_STATUSES) applicationCounts[s] = 0;
      for (const a of apps) applicationCounts[a.status] = (applicationCounts[a.status] || 0) + 1;

      return ok(res, {
        gates,
        flags: dc.FLAGS,
        rates: dc.RATES,
        configuration: {
          organization_code_configured: Boolean(config.organizationCode),
          ios_download_link_configured: Boolean(config.iosUrl),
          android_download_link_configured: Boolean(config.androidUrl)
        },
        required_agreements: dc.REQUIRED_AGREEMENTS,
        application_counts: applicationCounts,
        hours: dc.summarizeHours(hours, { includeCompany: true }),
        open_exceptions: openExceptions.length
      });
    })
  );

  app.get(
    `${base}/applications`,
    requireCapability("data_collection.read"),
    asyncRoute(async (req, res) => {
      const status = dc.cleanText(req.query.status, 20);
      if (status && !dc.APPLICATION_STATUSES.includes(status)) return fail(res, "Unknown status filter.", 400);

      const apps = (await selectAll(T.applications, "*", (q) => (status ? q.eq("status", status) : q))).sort(
        byNewest("submitted_at")
      );
      const ids = apps.map((a) => a.id);
      const driverIds = [...new Set(apps.map((a) => a.driver_id))];

      const [drivers, agreements, equipment, hours] = ids.length
        ? await Promise.all([
            selectAll("drivers", "id, full_name, first_name, last_name, email, approval_status, access_revoked, is_blocked, is_disabled, is_review_account, deleted_at", (q) =>
              q.in("id", driverIds)
            ),
            selectAll(T.agreements, "*", (q) => q.in("application_id", ids)),
            selectAll(T.equipment, "*", (q) => q.in("application_id", ids)),
            selectAll(T.hours, "application_id, status, duration_seconds, driver_amount_cents, company_amount_cents", (q) =>
              q.in("application_id", ids)
            )
          ])
        : [[], [], [], []];

      const driverById = new Map(drivers.map((d) => [d.id, d]));
      const list = apps.map((a) => {
        const d = driverById.get(a.driver_id) || {};
        return {
          ...a,
          driver: {
            id: a.driver_id,
            name: d.full_name || [d.first_name, d.last_name].filter(Boolean).join(" ") || null,
            email: d.email || null,
            approval_status: d.approval_status || null,
            eligibility: dc.evaluateDriverEligibility(d.id ? d : null)
          },
          agreements: dc.agreementStatusList(agreements.filter((g) => g.application_id === a.id)),
          equipment: equipment.filter((e) => e.application_id === a.id),
          hours: dc.summarizeHours(
            hours.filter((h) => h.application_id === a.id),
            { includeCompany: true }
          )
        };
      });

      return ok(res, { applications: list });
    })
  );

  app.post(
    `${base}/applications/:id/status`,
    requireCapability("data_collection.manage"),
    asyncRoute(async (req, res) => {
      const application = await loadApplication(req.params.id);
      if (!application) return fail(res, "Application not found.", 404);

      const to = dc.cleanText(req.body?.status, 20);
      const reason = dc.cleanText(req.body?.reason, 500);
      const check = dc.validateApplicationTransition({ from: application.status, to, reason });
      if (!check.ok) return fail(res, check.error, 400);

      if (to === "approved") {
        const gates = await loadGates();
        if (!gates.enrollment) {
          return fail(res, "Program approvals are disabled until enrollment is opened.", 403);
        }
        const { data: driver, error: dErr } = await supabase.from("drivers").select("*").eq("id", application.driver_id).maybeSingle();
        if (dErr) throw dErr;
        const eligibility = dc.evaluateDriverEligibility(driver);
        if (!eligibility.eligible) {
          return fail(res, "This driver is not an approved driver in good standing.", 409, { reasons: eligibility.reasons });
        }
      }

      const now = new Date().toISOString();
      const { data: rows, error } = await supabase
        .from(T.applications)
        .update({ status: to, status_reason: reason || null, reviewed_by: adminActor(req), reviewed_at: now, updated_at: now })
        .eq("id", application.id)
        .eq("status", application.status)
        .select("id, status");
      if (error) {
        if (error.code === "23505") return fail(res, "This driver already has another open application.", 409);
        throw error;
      }
      if (!rows || !rows.length) return fail(res, "The application changed while you were reviewing it. Reload and try again.", 409);

      const logged = await audit(adminActor(req), `application.${to}`, "application", application.id, {
        from: application.status,
        to,
        reason: reason || null,
        driver_id: application.driver_id
      });
      if (!logged) return auditFailed(res);
      return ok(res, { application: rows[0] });
    })
  );

  app.post(
    `${base}/applications/:id/contributor`,
    requireCapability("data_collection.manage"),
    asyncRoute(async (req, res) => {
      const application = await loadApplication(req.params.id);
      if (!application) return fail(res, "Application not found.", 404);
      if (!["approved", "suspended"].includes(application.status)) {
        return fail(res, "Only program-approved participants can be linked to a Minute contributor id.", 409);
      }
      const contributor = dc.cleanText(req.body?.minute_contributor_id, 200) || null;

      const { error } = await supabase
        .from(T.applications)
        .update({ minute_contributor_id: contributor, updated_at: new Date().toISOString() })
        .eq("id", application.id);
      if (error) {
        if (error.code === "23505") return fail(res, "That contributor id is already linked to another participant.", 409);
        throw error;
      }

      const logged = await audit(adminActor(req), "application.contributor_linked", "application", application.id, {
        previous: application.minute_contributor_id || null,
        minute_contributor_id: contributor
      });
      if (!logged) return auditFailed(res);
      return ok(res, { minute_contributor_id: contributor });
    })
  );

  app.post(
    `${base}/applications/:id/agreements`,
    requireCapability("data_collection.manage"),
    asyncRoute(async (req, res) => {
      const application = await loadApplication(req.params.id);
      if (!application) return fail(res, "Application not found.", 404);

      const type = dc.cleanText(req.body?.agreement_type, 40);
      const status = dc.cleanText(req.body?.status, 20);
      if (!dc.AGREEMENT_TYPES.includes(type)) return fail(res, "Unknown agreement type.", 400);
      if (!dc.AGREEMENT_STATUSES.includes(status)) return fail(res, "Unknown agreement status.", 400);

      const documentVersion = dc.cleanText(req.body?.document_version, 60) || null;
      let signedAt = null;
      if (status === "signed") {
        const date = dc.parseSessionDate(req.body?.signed_at);
        if (!date.ok || !documentVersion) {
          return fail(res, "A signed agreement needs the document version and the signing date (YYYY-MM-DD).", 400);
        }
        signedAt = `${date.date}T00:00:00Z`;
      }

      const { data: row, error } = await supabase
        .from(T.agreements)
        .insert({
          id: crypto.randomUUID(),
          application_id: application.id,
          driver_id: application.driver_id,
          agreement_type: type,
          status,
          document_version: documentVersion,
          signed_at: signedAt,
          recorded_by: adminActor(req),
          notes: dc.cleanText(req.body?.notes, 500) || null,
          recorded_at: new Date().toISOString()
        })
        .select("*")
        .single();
      if (error) throw error;

      const logged = await audit(adminActor(req), "agreement.recorded", "application", application.id, {
        agreement_type: type,
        status,
        document_version: documentVersion
      });
      if (!logged) return auditFailed(res);
      return ok(res, { agreement: row }, 201);
    })
  );

  app.post(
    `${base}/applications/:id/equipment`,
    requireCapability("data_collection.manage"),
    asyncRoute(async (req, res) => {
      const application = await loadApplication(req.params.id);
      if (!application) return fail(res, "Application not found.", 404);
      if (!["approved", "suspended"].includes(application.status)) {
        return fail(res, "Equipment can only be assigned to program-approved participants.", 409);
      }
      const item = dc.cleanText(req.body?.item, 120);
      if (!item) return fail(res, "Describe the equipment item.", 400);

      const now = new Date().toISOString();
      const { data: row, error } = await supabase
        .from(T.equipment)
        .insert({
          id: crypto.randomUUID(),
          application_id: application.id,
          driver_id: application.driver_id,
          item,
          asset_tag: dc.cleanText(req.body?.asset_tag, 80) || null,
          status: "assigned",
          notes: dc.cleanText(req.body?.notes, 500) || null,
          assigned_by: adminActor(req),
          assigned_at: now,
          updated_at: now
        })
        .select("*")
        .single();
      if (error) throw error;

      const logged = await audit(adminActor(req), "equipment.assigned", "equipment", row.id, {
        application_id: application.id,
        item,
        asset_tag: row.asset_tag
      });
      if (!logged) return auditFailed(res);
      return ok(res, { equipment: row }, 201);
    })
  );

  app.patch(
    `${base}/equipment/:id`,
    requireCapability("data_collection.manage"),
    asyncRoute(async (req, res) => {
      if (!UUID_RE.test(String(req.params.id || ""))) return fail(res, "Equipment not found.", 404);
      const status = dc.cleanText(req.body?.status, 20);
      if (!dc.EQUIPMENT_STATUSES.includes(status)) return fail(res, "Unknown equipment status.", 400);

      const { data: current, error: curErr } = await supabase.from(T.equipment).select("*").eq("id", req.params.id).maybeSingle();
      if (curErr) throw curErr;
      if (!current) return fail(res, "Equipment not found.", 404);

      const notes = dc.cleanText(req.body?.notes, 500);
      const { error } = await supabase
        .from(T.equipment)
        .update({ status, notes: notes || current.notes || null, updated_at: new Date().toISOString() })
        .eq("id", current.id);
      if (error) throw error;

      const logged = await audit(adminActor(req), "equipment.status_changed", "equipment", current.id, {
        from: current.status,
        to: status,
        notes: notes || null
      });
      if (!logged) return auditFailed(res);
      return ok(res, { equipment: { id: current.id, status } });
    })
  );

  async function previewFromRequest(body) {
    const csvText = typeof body?.csv_text === "string" ? body.csv_text : "";
    const mapping = body?.mapping;

    const [applications, existing, openExceptions] = await Promise.all([
      selectAll(T.applications, "id, driver_id, status, minute_contributor_id", (q) => q.not("minute_contributor_id", "is", null)),
      selectAll(T.hours, "external_session_id"),
      selectAll(T.exceptions, "external_session_id", (q) => q.is("resolved_at", null))
    ]);

    const fileSha = dc.sha256(csvText);
    const { data: previousBatches, error } = await supabase
      .from(T.batches)
      .select("id, filename, created_at")
      .eq("file_sha256", fileSha);
    if (error) throw error;

    return dc.buildImportPreview({
      csvText,
      mapping,
      applications,
      existingSessionIds: existing.map((r) => r.external_session_id),
      openExceptionSessionIds: openExceptions.map((r) => r.external_session_id),
      previousBatches: previousBatches || []
    });
  }

  function publicPreview(preview) {
    const { records, ...rest } = preview;
    return rest;
  }

  app.post(
    `${base}/imports/preview`,
    requireCapability("data_collection.hours.manage"),
    asyncRoute(async (req, res) => {
      const preview = await previewFromRequest(req.body);
      if (!preview.ok) return fail(res, preview.errors[0], 400, { errors: preview.errors, headers: preview.headers || null });
      const gates = await loadGates();
      // Nothing is written by a preview.
      return ok(res, { ...publicPreview(preview), collection_open: gates.collection });
    })
  );

  app.post(
    `${base}/imports/commit`,
    requireCapability("data_collection.hours.manage"),
    asyncRoute(async (req, res) => {
      const gates = await loadGates();
      if (!gates.collection) return fail(res, "Recording hours is disabled until collection is opened.", 403);
      if (req.body?.confirm !== true) return fail(res, "Confirm the import after reviewing its preview.", 400);

      const filename = dc.cleanText(req.body?.filename, 200);
      if (!filename) return fail(res, "filename is required.", 400);

      // Re-validated from scratch: the client's preview is never trusted.
      const preview = await previewFromRequest(req.body);
      if (!preview.ok) return fail(res, preview.errors[0], 400, { errors: preview.errors });
      if (!preview.can_commit) {
        return fail(res, "This file has invalid rows or nothing to save. Fix it and preview again.", 422, {
          summary: preview.summary
        });
      }
      if (preview.preview_digest !== req.body?.preview_digest) {
        return fail(res, "The data changed since your preview. Preview the file again before importing.", 409);
      }
      if (preview.previously_imported.length && req.body?.acknowledge_previous_import !== true) {
        return fail(res, "This exact file was imported before. Confirm that you mean to import it again.", 409, {
          previously_imported: preview.previously_imported
        });
      }

      const { data, error } = await supabase.rpc("data_collection_commit_hours", {
        p_batch: {
          source: "minute_import",
          filename,
          file_sha256: preview.file_sha256,
          column_mapping: req.body.mapping,
          row_count: preview.summary.total_rows,
          duplicate_count: preview.summary.duplicate_existing + preview.summary.duplicate_in_file,
          audit: {
            filename,
            preview_digest: preview.preview_digest,
            summary: preview.summary,
            rejected_duplicates: preview.rows
              .filter((r) => r.outcome.startsWith("duplicate"))
              .map((r) => ({ row: r.row_number, session_id: r.session_id, outcome: r.outcome })),
            reimport_acknowledged: preview.previously_imported.length > 0
          }
        },
        p_records: preview.records,
        p_exceptions: preview.exceptions,
        p_actor: adminActor(req)
      });
      if (error) {
        if (error.code === "23505") {
          return fail(res, "Some sessions were recorded by someone else meanwhile. Preview the file again.", 409);
        }
        throw error;
      }

      return ok(res, { committed: true, result: data, summary: preview.summary });
    })
  );

  app.post(
    `${base}/hours/manual`,
    requireCapability("data_collection.hours.manage"),
    asyncRoute(async (req, res) => {
      const gates = await loadGates();
      if (!gates.collection) return fail(res, "Recording hours is disabled until collection is opened.", 403);

      const application = await loadApplication(req.body?.application_id);
      if (!application) return fail(res, "Application not found.", 404);
      if (!["approved", "suspended"].includes(application.status)) {
        return fail(res, "Hours can only be recorded for program-approved participants.", 409);
      }

      const parsed = dc.validateManualEntry(req.body);
      if (!parsed.ok) return fail(res, parsed.errors[0], 400, { errors: parsed.errors });
      const entry = parsed.entry;

      const { data: dup, error: dupErr } = await supabase
        .from(T.hours)
        .select("id")
        .ilike("external_session_id", entry.external_session_id.replace(/[\\%_]/g, (c) => `\\${c}`));
      if (dupErr) throw dupErr;
      if ((dup || []).length) return fail(res, "That session is already recorded.", 409);

      const amounts = dc.computeRecordAmounts(entry.duration_seconds);
      const { data, error } = await supabase.rpc("data_collection_commit_hours", {
        p_batch: {
          source: "manual_entry",
          row_count: 1,
          notes: entry.reason,
          audit: { application_id: application.id, driver_id: application.driver_id, reason: entry.reason, ...entry }
        },
        p_records: [
          {
            driver_id: application.driver_id,
            application_id: application.id,
            external_session_id: entry.external_session_id,
            external_contributor_id: application.minute_contributor_id || null,
            session_date: entry.session_date,
            duration_seconds: entry.duration_seconds,
            notes: entry.reason,
            ...amounts
          }
        ],
        p_exceptions: [],
        p_actor: adminActor(req)
      });
      if (error) {
        if (error.code === "23505") return fail(res, "That session is already recorded.", 409);
        throw error;
      }

      return ok(res, { recorded: true, result: data, amounts }, 201);
    })
  );

  app.get(
    `${base}/hours`,
    requireCapability("data_collection.read"),
    asyncRoute(async (req, res) => {
      const status = dc.cleanText(req.query.status, 20);
      if (status && !dc.HOUR_STATUSES.includes(status)) return fail(res, "Unknown status filter.", 400);
      const driverId = dc.cleanText(req.query.driver_id, 100);
      const rows = await selectAll(T.hours, "*", (q) => {
        let query = q;
        if (status) query = query.eq("status", status);
        if (driverId) query = query.eq("driver_id", driverId);
        return query;
      });
      rows.sort(byNewest("session_date"));
      return ok(res, { hours: rows.slice(0, 1000), total: rows.length, summary: dc.summarizeHours(rows, { includeCompany: true }) });
    })
  );

  app.post(
    `${base}/hours/status`,
    requireAdmin,
    asyncRoute(async (req, res) => {
      const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : [];
      const from = dc.cleanText(req.body?.from, 20);
      const to = dc.cleanText(req.body?.to, 20);
      const reason = dc.cleanText(req.body?.reason, 500) || null;
      const payoutReference = dc.cleanText(req.body?.payout_reference, 120) || null;

      if (!ids.length || ids.length > 500 || !ids.every((id) => UUID_RE.test(id))) {
        return fail(res, "Select between 1 and 500 hour records.", 400);
      }
      const check = dc.validateHourTransition({ from, to, reason, payoutReference });
      if (!check.ok) return fail(res, check.error, 400);

      const capability = dc.capabilityForHourTransition(to);
      if (!hasCapability(resolveAdminRole(req.admin), capability)) {
        return fail(res, "Your admin role does not allow this Data Collection action.", 403);
      }

      const { data, error } = await supabase.rpc("data_collection_set_hour_status", {
        p_ids: ids,
        p_from: from,
        p_to: to,
        p_actor: adminActor(req),
        p_reason: reason,
        p_payout_reference: payoutReference
      });
      if (error) {
        if (/stale_status/.test(error.message || "")) {
          return fail(res, `Some selected records are no longer ${from}. Reload and try again; nothing was changed.`, 409);
        }
        throw error;
      }
      return ok(res, { updated: data?.updated ?? null });
    })
  );

  app.get(
    `${base}/exceptions`,
    requireCapability("data_collection.read"),
    asyncRoute(async (req, res) => {
      const rows = await selectAll(T.exceptions, "*", (q) => q.is("resolved_at", null));
      rows.sort(byNewest("created_at"));
      return ok(res, { exceptions: rows });
    })
  );

  app.get(
    `${base}/audit-log`,
    requireCapability("data_collection.read"),
    asyncRoute(async (req, res) => {
      const { data, error } = await supabase.from(T.audit).select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return ok(res, { entries: data || [] });
    })
  );
}

module.exports = { registerDataCollectionRoutes, TABLES: T };
