import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../lib/supabase";

const BRAND = "#d02a35";

// ─── Check item definitions ───────────────────────────────────────────────────
const SECTIONS = [
  { id: "documentation", label: "Documentation", emoji: "📋", items: [
    { id: 1, text: "Statutory examination in date (LOLER)" },
    { id: 2, text: "Operator manual present and accessible" },
    { id: 3, text: "Pre-use inspection record up to date" },
  ]},
  { id: "tyres_wheels", label: "Tyres / Wheels", emoji: "🔧", items: [
    { id: 4, text: "Tyre condition — no cuts, bulges or foreign objects" },
    { id: 5, text: "Wheel nuts / bolts secure, no damaged rims" },
  ]},
  { id: "engine_power", label: "Engine / Power Source", emoji: "⚙️", items: [
    { id: 6, text: "Fuel level adequate for planned work" },
    { id: 7, text: "Engine oil and coolant levels correct" },
    { id: 8, text: "No fluid leaks visible on ground beneath machine" },
  ]},
  { id: "hydraulics", label: "Hydraulics", emoji: "💧", items: [
    { id: 9,  text: "Hydraulic oil level correct" },
    { id: 10, text: "No hydraulic leaks — hoses, cylinders, connections" },
  ]},
  { id: "boom_attachment", label: "Boom & Attachment", emoji: "🔱", items: [
    { id: 11, text: "Boom — no cracks, damage, wear or misalignment" },
    { id: 12, text: "Boom hoses and chains — condition, routing correct" },
    { id: 13, text: "Attachment secure, correct type, no visible damage" },
    { id: 14, text: "Attachment locking pins / retention devices secure" },
    { id: 15, text: "Headboard / forks / bucket — no cracks, bends or wear" },
  ]},
  { id: "bodywork_safety", label: "Bodywork & Safety Devices", emoji: "🏗️", items: [
    { id: 16, text: "Cab — seat, mirrors, windows, wipers undamaged" },
    { id: 17, text: "ROPS/FOPS structure — secure, no cracks or damage" },
    { id: 18, text: "Counterweight — secure and undamaged" },
    { id: 19, text: "Seat belt / operator restraint — condition and function" },
    { id: 20, text: "Lights and beacon present and working (if applicable)" },
  ]},
];

const FUNCTION_CHECKS = [
  { id: 21, text: "Engine start — normal operation, no warning lights" },
  { id: 22, text: "Drive — forward, reverse, steering response correct" },
  { id: 23, text: "Brakes — service and parking brake effective" },
  { id: 24, text: "Boom lift — smooth, correct speed, holds position" },
  { id: 25, text: "Boom lower — smooth, controlled descent" },
  { id: 26, text: "Boom extend — smooth, full travel, no binding" },
  { id: 27, text: "Boom retract — smooth, full travel" },
  { id: 28, text: "Tilt — forward and back, smooth operation" },
  { id: 29, text: "Horn — audible and functioning" },
  { id: 30, text: "Audible travel / reversing alarm working" },
];

const ALL_VISUAL_ITEMS = SECTIONS.flatMap(s => s.items);

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() { return toLocalDateStr(new Date()); }

function getDayOfWeek(dateStr) {
  const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  return days[new Date(dateStr).getDay()];
}

function fmtDateGB(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── ThoroughExamCard ─────────────────────────────────────────────────────────
function ThoroughExamCard({ forklift }) {
  if (!forklift?.thorough_exam_url) {
    return (
      <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem" }}>
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#c2410c", fontWeight: 700 }}>⚠️ No thorough examination on file</p>
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "#92400e" }}>Notify your supervisor before operating this machine.</p>
      </div>
    );
  }
  const expired = forklift.thorough_exam_expiry && new Date(forklift.thorough_exam_expiry) < new Date();
  return (
    <div style={{ background: expired ? "#fef2f2" : "#f0fdf4", border: `1px solid ${expired ? "#fecaca" : "#bbf7d0"}`, borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
        <span style={{ fontSize: "0.8rem", fontWeight: 800, color: expired ? "#b91c1c" : "#15803d", background: expired ? "#fee2e2" : "#dcfce7", padding: "2px 8px", borderRadius: 20 }}>
          {expired ? "EXPIRED" : "VALID"}
        </span>
        <span style={{ fontSize: "0.8rem", color: "#374151" }}>Thorough Examination (LOLER)</span>
      </div>
      {forklift.thorough_exam_expiry && (
        <p style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", color: expired ? "#b91c1c" : "#166534" }}>
          {expired ? "Expired" : "Valid until"}: {fmtDateGB(forklift.thorough_exam_expiry)}
        </p>
      )}
      {expired && (
        <p style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", fontWeight: 700, color: "#b91c1c" }}>
          ⚠️ This examination has expired. Notify your supervisor before operating.
        </p>
      )}
      <a href={forklift.thorough_exam_url} target="_blank" rel="noreferrer"
         style={{ fontSize: "0.8rem", color: "#1d4ed8", textDecoration: "underline" }}>
        Open Document ↗
      </a>
    </div>
  );
}

// ─── Toggle button (3-way: pass / fail / na) ──────────────────────────────────
function ToggleGroup({ value, onChange, highlighted }) {
  const opts = [
    { val: "pass", label: "PASS", active: "#15803d", bg: "#f0fdf4" },
    { val: "fail", label: "FAIL", active: "#b91c1c", bg: "#fef2f2" },
    { val: "na",   label: "N/A",  active: "#6b7280", bg: "#f9fafb" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, minWidth: 210 }}>
      {opts.map(o => {
        const sel = value === o.val;
        return (
          <button key={o.val} onClick={() => onChange(o.val)}
            style={{ flex: 1, padding: "0.85rem 0", border: `2px solid ${sel ? o.active : highlighted ? "#f97316" : "#e5e7eb"}`,
              background: sel ? o.bg : highlighted ? "#fff7ed" : "#fff",
              color: sel ? o.active : highlighted ? "#c2410c" : "#6b7280",
              borderRadius: 10, fontWeight: 800, fontSize: "0.95rem", cursor: "pointer", transition: "all 0.12s" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function CheckPage({ forkliftId }) {
  const [pageStatus, setPageStatus] = useState("loading");
  const [forklift, setForklift]     = useState(null);
  const [existingEntry, setExistingEntry] = useState(null);
  const [step, setStep]             = useState(0);

  // Step 0
  const [operatorName, setOperatorName] = useState("");
  const [palCard, setPalCard]           = useState("");
  const [forkOwner, setForkOwner]       = useState("");

  // Step 1 — visual results
  const [visualResults, setVisualResults] = useState(
    () => Object.fromEntries(ALL_VISUAL_ITEMS.map(i => [i.id, null]))
  );
  const [tyrePsi, setTyrePsi] = useState({ fl: "", fr: "", rl: "", rr: "" });
  const [visHighlighted, setVisHighlighted] = useState([]);

  // Step 2 — function results
  const [funcResults, setFuncResults] = useState(
    () => Object.fromEntries(FUNCTION_CHECKS.map(i => [i.id, null]))
  );
  const [funcHighlighted, setFuncHighlighted] = useState([]);

  // Step 3
  const [faultDetails, setFaultDetails]   = useState({});
  const [photoFile, setPhotoFile]         = useState(null);
  const [sigDataUrl, setSigDataUrl]       = useState(null);
  const [step3Error, setStep3Error]       = useState("");
  const photoInputRef = useRef(null);
  const canvasRef     = useRef(null);
  const sigPadRef     = useRef(null);

  const [doneEntry, setDoneEntry] = useState(null);

  // ── Load forklift + check today ────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const { data: fork, error: forkErr } = await supabase
        .from("forklifts")
        .select("*, sites(name, id)")
        .eq("id", forkliftId)
        .eq("active", true)
        .single();

      if (forkErr || !fork) { setPageStatus("not_found"); return; }
      setForklift(fork);

      const today = todayStr();
      const { data: entry } = await supabase
        .from("daily_inspection_entries")
        .select("*, visual_check_results(*), function_check_results(*), defect_log(*)")
        .eq("forklift_id", forkliftId)
        .eq("inspection_date", today)
        .maybeSingle();

      if (entry) {
        setExistingEntry(entry);
        setPageStatus("already_done");
      } else {
        setPageStatus("form");
      }
    }
    load();
  }, [forkliftId]);

  // ── Signature pad init ────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 3) return;
    let raf = requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      import("signature_pad").then(({ default: SignaturePad }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width  = canvas.offsetWidth  || 320;
        canvas.height = canvas.offsetHeight || 160;
        sigPadRef.current = new SignaturePad(canvas, {
          backgroundColor: "rgb(255,255,255)",
          penColor: "#111827",
        });
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (sigPadRef.current) { sigPadRef.current.off(); sigPadRef.current = null; }
    };
  }, [step]);

  // ── Step 1 → 2 validation ──────────────────────────────────────────────────
  function goToStep2() {
    const unanswered = ALL_VISUAL_ITEMS.filter(i => !visualResults[i.id]).map(i => i.id);
    if (unanswered.length > 0) { setVisHighlighted(unanswered); window.scrollTo(0,0); return; }
    setVisHighlighted([]);
    setStep(2);
    window.scrollTo(0,0);
  }

  // ── Step 2 → 3 validation ──────────────────────────────────────────────────
  function goToStep3() {
    const unanswered = FUNCTION_CHECKS.filter(i => !funcResults[i.id]).map(i => i.id);
    if (unanswered.length > 0) { setFuncHighlighted(unanswered); window.scrollTo(0,0); return; }
    setFuncHighlighted([]);
    setStep(3);
    window.scrollTo(0,0);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setStep3Error("");

    // Capture sig BEFORE re-render destroys the canvas
    let capturedSig = sigDataUrl;
    if (!capturedSig && sigPadRef.current && !sigPadRef.current.isEmpty()) {
      capturedSig = sigPadRef.current.toDataURL("image/png");
    }

    // Validate
    if (!photoFile) { setStep3Error("Please take a photo of the machine."); photoInputRef.current?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!capturedSig || (sigPadRef.current && sigPadRef.current.isEmpty())) {
      setStep3Error("Please provide your signature."); canvasRef.current?.scrollIntoView({ behavior: "smooth" }); return;
    }

    setSigDataUrl(capturedSig);
    setPageStatus("submitting");

    const today   = todayStr();
    const siteId  = forklift.sites?.id || forklift.site_id;
    const faultIds = [...Object.entries(visualResults), ...Object.entries(funcResults)]
      .filter(([, v]) => v === "fail")
      .map(([k]) => Number(k));
    const dailyStatus = faultIds.length > 0 ? "fault" : "ok";

    try {
      // Upload photo
      const photoExt  = photoFile.name?.split(".").pop() || "jpg";
      const photoPath = `${siteId}/${forkliftId}/${today}.${photoExt}`;
      const { error: photoErr } = await supabase.storage.from("forklift-photos")
        .upload(photoPath, photoFile, { upsert: true, contentType: photoFile.type });
      if (photoErr) throw new Error("Photo upload failed: " + photoErr.message);
      const { data: { publicUrl: photoUrl } } = supabase.storage.from("forklift-photos").getPublicUrl(photoPath);

      // Upload signature
      const sigBase64 = capturedSig.split(",")[1];
      const sigBinary = atob(sigBase64);
      const sigBytes  = new Uint8Array(sigBinary.length);
      for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);
      const sigBlob   = new Blob([sigBytes], { type: "image/png" });
      const sigPath   = `${siteId}/${forkliftId}/${today}.png`;
      const { error: sigErr } = await supabase.storage.from("signatures")
        .upload(sigPath, sigBlob, { upsert: true, contentType: "image/png" });
      if (sigErr) throw new Error("Signature upload failed: " + sigErr.message);
      const { data: { publicUrl: signatureUrl } } = supabase.storage.from("signatures").getPublicUrl(sigPath);

      // Get/create weekly sheet
      const { data: sheetId, error: sheetErr } = await supabase.rpc("get_or_create_weekly_sheet", {
        p_forklift_id: forkliftId,
        p_site_id:     siteId,
        p_machine_ref: forklift.machine_ref,
        p_date:        today,
      });
      if (sheetErr) throw new Error("Sheet error: " + sheetErr.message);

      // Insert daily entry
      const { data: entry, error: entryErr } = await supabase
        .from("daily_inspection_entries")
        .insert({
          sheet_id:       sheetId,
          forklift_id:    forkliftId,
          site_id:        siteId,
          inspection_date: today,
          day_of_week:    getDayOfWeek(today),
          operator_name:  operatorName.trim(),
          pal_card_number: palCard.trim() || null,
          forklift_owner: forkOwner.trim() || null,
          initialled:     true,
          daily_status:   dailyStatus,
          submitted_at:   new Date().toISOString(),
          photo_url:      photoUrl,
          signature_url:  signatureUrl,
          tyre_fl_psi:    tyrePsi.fl ? Number(tyrePsi.fl) : null,
          tyre_fr_psi:    tyrePsi.fr ? Number(tyrePsi.fr) : null,
          tyre_rl_psi:    tyrePsi.rl ? Number(tyrePsi.rl) : null,
          tyre_rr_psi:    tyrePsi.rr ? Number(tyrePsi.rr) : null,
        })
        .select()
        .single();
      if (entryErr) throw new Error("Entry error: " + entryErr.message);

      // Insert visual check results
      const visRows = ALL_VISUAL_ITEMS.map(item => ({
        entry_id:       entry.id,
        sheet_id:       sheetId,
        forklift_id:    forkliftId,
        inspection_date: today,
        item_number:    item.id,
        category:       SECTIONS.find(s => s.items.some(i => i.id === item.id))?.id,
        result:         visualResults[item.id],
      }));
      const { error: visErr } = await supabase.from("visual_check_results").insert(visRows);
      if (visErr) throw new Error("Visual results error: " + visErr.message);

      // Insert function check results
      const funcRows = FUNCTION_CHECKS.map(item => ({
        entry_id:       entry.id,
        sheet_id:       sheetId,
        forklift_id:    forkliftId,
        inspection_date: today,
        item_number:    item.id,
        result:         funcResults[item.id],
      }));
      const { error: funcErr } = await supabase.from("function_check_results").insert(funcRows);
      if (funcErr) throw new Error("Function results error: " + funcErr.message);

      // Insert defect log rows
      if (faultIds.length > 0) {
        const allItems = [...ALL_VISUAL_ITEMS, ...FUNCTION_CHECKS];
        const defectRows = faultIds.map(id => ({
          entry_id:       entry.id,
          sheet_id:       sheetId,
          forklift_id:    forkliftId,
          site_id:        siteId,
          inspection_date: today,
          item_number:    id,
          check_type:     id <= 20 ? "visual" : "function",
          defect_details: faultDetails[id] || "",
          date_noted:     today,
          status:         "open",
        }));
        await supabase.from("defect_log").insert(defectRows);
      }

      // Trigger PDF (fire and forget)
      fetch("/api/trigger-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forklift_id: forkliftId, sheet_id: sheetId }),
      }).catch(() => {});

      setDoneEntry({ ...entry, faultIds, faultDetails: { ...faultDetails } });
      setPageStatus("done");

    } catch (err) {
      console.error(err);
      setPageStatus("submit_error");
      setStep3Error(err.message);
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const totalItems   = ALL_VISUAL_ITEMS.length + FUNCTION_CHECKS.length;
  const answeredVis  = ALL_VISUAL_ITEMS.filter(i => visualResults[i.id]).length;
  const answeredFunc = FUNCTION_CHECKS.filter(i => funcResults[i.id]).length;
  const progressPct  = step === 1
    ? Math.round((answeredVis / ALL_VISUAL_ITEMS.length) * 100)
    : step === 2
    ? Math.round((answeredFunc / FUNCTION_CHECKS.length) * 100)
    : 0;

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (pageStatus === "loading") return <FullPageMsg msg="Loading…" />;

  // ── NOT FOUND ─────────────────────────────────────────────────────────────
  if (pageStatus === "not_found") return (
    <FullPageMsg msg="Machine not found" sub="This QR code is not registered or the machine is inactive." icon="🚫" />
  );

  // ── ALREADY DONE ─────────────────────────────────────────────────────────
  if (pageStatus === "already_done") {
    const e = existingEntry;
    const faults = e?.defect_log || [];
    return (
      <Page title="Already Inspected Today" forklift={forklift}>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ margin: 0, fontWeight: 800, color: "#15803d", fontSize: "1.1rem" }}>✅ Inspection complete</p>
          <p style={{ margin: "0.25rem 0 0", color: "#166534", fontSize: "0.9rem" }}>
            Submitted by <strong>{e?.operator_name}</strong> at {e?.submitted_at ? new Date(e.submitted_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}
          </p>
        </div>
        <ThoroughExamCard forklift={forklift} />
        {faults.length > 0 && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "1rem" }}>
            <p style={{ margin: "0 0 0.5rem", fontWeight: 800, color: "#b91c1c" }}>⚠️ {faults.length} fault{faults.length > 1 ? "s" : ""} reported</p>
            {faults.map((f, i) => (
              <div key={i} style={{ fontSize: "0.85rem", color: "#111827", marginBottom: "0.35rem" }}>
                <strong>Item {f.item_number}:</strong> {f.defect_details || "No details provided"}
              </div>
            ))}
          </div>
        )}
      </Page>
    );
  }

  // ── SUBMITTING ────────────────────────────────────────────────────────────
  if (pageStatus === "submitting") return <FullPageMsg msg="Submitting inspection…" sub="Please wait, do not close this page." />;

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (pageStatus === "done") {
    const faults = doneEntry?.faultIds || [];
    return (
      <Page title="Inspection Submitted" forklift={forklift}>
        <div style={{ background: faults.length ? "#fef2f2" : "#f0fdf4", border: `1px solid ${faults.length ? "#fecaca" : "#bbf7d0"}`, borderRadius: 12, padding: "1.25rem", marginBottom: "1rem", textAlign: "center" }}>
          <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>{faults.length ? "⚠️" : "✅"}</p>
          <p style={{ fontWeight: 800, fontSize: "1.1rem", color: faults.length ? "#b91c1c" : "#15803d", margin: 0 }}>
            {faults.length ? `${faults.length} fault${faults.length > 1 ? "s" : ""} reported — notify your supervisor` : "All Clear — inspection complete"}
          </p>
        </div>
        {faults.length > 0 && (
          <div style={{ background: "#fff", border: "1px solid #fee2e2", borderRadius: 10, padding: "0.75rem" }}>
            {faults.map(id => {
              const allItems = [...ALL_VISUAL_ITEMS, ...FUNCTION_CHECKS];
              const item = allItems.find(i => i.id === id);
              return (
                <div key={id} style={{ fontSize: "0.85rem", color: "#111827", marginBottom: "0.35rem", paddingBottom: "0.35rem", borderBottom: "1px solid #fee2e2" }}>
                  <strong>Item {id}:</strong> {item?.text}<br />
                  <span style={{ color: "#6b7280" }}>{doneEntry.faultDetails[id] || "No additional details"}</span>
                </div>
              );
            })}
          </div>
        )}
      </Page>
    );
  }

  // ── SUBMIT ERROR ──────────────────────────────────────────────────────────
  if (pageStatus === "submit_error") {
    return (
      <Page title="Submission Error" forklift={forklift}>
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "1rem", marginBottom: "1rem" }}>
          <p style={{ fontWeight: 800, color: "#b91c1c" }}>❌ Something went wrong</p>
          <p style={{ fontSize: "0.85rem", color: "#374151" }}>{step3Error}</p>
        </div>
        <button onClick={() => { setPageStatus("form"); setStep(3); }} style={btnStyle(BRAND)}>
          Try Again
        </button>
      </Page>
    );
  }

  // ── FORM ──────────────────────────────────────────────────────────────────
  const faultIds = [...Object.entries(visualResults), ...Object.entries(funcResults)]
    .filter(([, v]) => v === "fail")
    .map(([k]) => Number(k));

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", minHeight: "100vh", background: "#f3f4f6" }}>
      {/* Sticky top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: BRAND, padding: "0.6rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <img src="/logo.png" alt="" style={{ height: 28 }} onError={e => { e.target.style.display = "none"; }} />
        <div style={{ flex: 1 }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: "0.9rem", lineHeight: 1.2 }}>{forklift?.machine_ref}</div>
          <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.75rem" }}>{forklift?.sites?.name}</div>
        </div>
        <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.75rem" }}>Step {step + 1}/4</div>
      </div>

      {/* Progress bar */}
      {(step === 1 || step === 2) && (
        <div style={{ height: 6, background: "#fecdd3" }}>
          <div style={{ height: "100%", width: `${progressPct}%`, background: "#fff", transition: "width 0.3s" }} />
        </div>
      )}

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "1rem" }}>

        {/* ── STEP 0: Operator details ─────────────────────────────────────── */}
        {step === 0 && (
          <>
            <h2 style={sectionTitle}>Operator Details</h2>
            <ThoroughExamCard forklift={forklift} />
            <div style={card}>
              <Field label="Full Name *" value={operatorName} onChange={setOperatorName} placeholder="Enter your full name" />
              <Field label="Operator Card / PAL Number" value={palCard} onChange={setPalCard} placeholder="Optional" />
              <Field label="Machine Owner (if hire)" value={forkOwner} onChange={setForkOwner} placeholder="Optional — hire company name" />
            </div>
            <button style={btnStyle(BRAND, !operatorName.trim())}
              disabled={!operatorName.trim()}
              onClick={() => { setStep(1); window.scrollTo(0,0); }}>
              Start Visual Checks →
            </button>
          </>
        )}

        {/* ── STEP 1: Visual checks ────────────────────────────────────────── */}
        {step === 1 && (
          <>
            <h2 style={sectionTitle}>Visual Checks</h2>
            {visHighlighted.length > 0 && (
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", fontSize: "0.85rem", color: "#c2410c", fontWeight: 700 }}>
                ⚠️ Please answer all highlighted items before continuing.
              </div>
            )}
            {SECTIONS.map(sec => (
              <div key={sec.id} style={{ marginBottom: "0.75rem" }}>
                <div style={{ background: BRAND, color: "#fff", padding: "0.5rem 0.75rem", borderRadius: "10px 10px 0 0", fontSize: "0.8rem", fontWeight: 800, letterSpacing: "0.04em" }}>
                  {sec.emoji} {sec.label.toUpperCase()}
                </div>
                <div style={{ background: "#fff", borderRadius: "0 0 10px 10px", border: `1px solid ${BRAND}`, borderTop: "none" }}>
                  {sec.items.map((item, idx) => (
                    <div key={item.id} style={{ padding: "0.75rem", borderBottom: idx < sec.items.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                      <div style={{ fontSize: "0.85rem", color: "#111827", marginBottom: "0.5rem", lineHeight: 1.4 }}>
                        <span style={{ fontWeight: 700, color: BRAND, marginRight: "0.35rem" }}>{item.id}.</span>{item.text}
                      </div>
                      <ToggleGroup value={visualResults[item.id]} onChange={v => setVisualResults(p => ({ ...p, [item.id]: v }))} highlighted={visHighlighted.includes(item.id)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Tyre Pressures */}
            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ background: "#0f4c81", color: "#fff", padding: "0.5rem 0.75rem", borderRadius: "10px 10px 0 0", fontSize: "0.8rem", fontWeight: 800, letterSpacing: "0.04em" }}>
                🔵 TYRE PRESSURES (PSI) — optional
              </div>
              <div style={{ background: "#fff", borderRadius: "0 0 10px 10px", border: "1px solid #0f4c81", borderTop: "none", padding: "0.75rem" }}>
                <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "#6b7280" }}>Record the current tyre pressure for each wheel. Leave blank for solid/foam-filled tyres.</p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                  {[["fl","Front Left (FL)"],["fr","Front Right (FR)"],["rl","Rear Left (RL)"],["rr","Rear Right (RR)"]].map(([key, lbl]) => (
                    <div key={key}>
                      <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "#374151", display: "block", marginBottom: "0.25rem" }}>{lbl}</label>
                      <input type="number" min="0" max="200" value={tyrePsi[key]}
                        onChange={e => setTyrePsi(p => ({ ...p, [key]: e.target.value }))}
                        placeholder="PSI"
                        style={{ width: "100%", boxSizing: "border-box", padding: "0.6rem 0.75rem", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: "1rem" }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button style={btnStyle(BRAND)} onClick={goToStep2}>
              Next: Function Checks →
            </button>
            <button style={btnStyle("#6b7280")} onClick={() => { setStep(0); window.scrollTo(0,0); }}>
              ← Back
            </button>
          </>
        )}

        {/* ── STEP 2: Function checks ──────────────────────────────────────── */}
        {step === 2 && (
          <>
            <h2 style={sectionTitle}>Function Checks</h2>
            {funcHighlighted.length > 0 && (
              <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", fontSize: "0.85rem", color: "#c2410c", fontWeight: 700 }}>
                ⚠️ Please answer all highlighted items before continuing.
              </div>
            )}
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #1e2a47", overflow: "hidden", marginBottom: "0.75rem" }}>
              <div style={{ background: "#1e2a47", color: "#fff", padding: "0.5rem 0.75rem", fontSize: "0.8rem", fontWeight: 800, letterSpacing: "0.04em" }}>
                ⚡ FUNCTION CHECKS
              </div>
              {FUNCTION_CHECKS.map((item, idx) => (
                <div key={item.id} style={{ padding: "0.75rem", borderBottom: idx < FUNCTION_CHECKS.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <div style={{ fontSize: "0.85rem", color: "#111827", marginBottom: "0.5rem", lineHeight: 1.4 }}>
                    <span style={{ fontWeight: 700, color: "#1e2a47", marginRight: "0.35rem" }}>{item.id}.</span>{item.text}
                  </div>
                  <ToggleGroup value={funcResults[item.id]} onChange={v => setFuncResults(p => ({ ...p, [item.id]: v }))} highlighted={funcHighlighted.includes(item.id)} />
                </div>
              ))}
            </div>
            <button style={btnStyle(BRAND)} onClick={goToStep3}>
              Next: Review & Sign →
            </button>
            <button style={btnStyle("#6b7280")} onClick={() => { setStep(1); window.scrollTo(0,0); }}>
              ← Back
            </button>
          </>
        )}

        {/* ── STEP 3: Review, photo, signature ─────────────────────────────── */}
        {step === 3 && (
          <>
            <h2 style={sectionTitle}>Review & Sign</h2>

            {/* Summary table */}
            <div style={{ ...card, padding: 0, overflow: "hidden", marginBottom: "1rem" }}>
              <div style={{ background: "#1e2a47", color: "#fff", padding: "0.5rem 0.75rem", fontSize: "0.8rem", fontWeight: 800 }}>INSPECTION SUMMARY</div>
              {[
                ["Machine", forklift?.machine_ref],
                ["Site", forklift?.sites?.name],
                ["Operator", operatorName],
                palCard && ["Operator Card", palCard],
                ["Date", fmtDateGB(todayStr())],
                ["Visual checks", `${ALL_VISUAL_ITEMS.length} items`],
                ["Function checks", `${FUNCTION_CHECKS.length} items`],
                ["Faults", faultIds.length ? `${faultIds.length} fault${faultIds.length > 1 ? "s" : ""}` : "None"],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} style={{ display: "flex", padding: "0.5rem 0.75rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.85rem" }}>
                  <span style={{ color: "#6b7280", flex: "0 0 130px" }}>{k}</span>
                  <span style={{ color: "#111827", fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Fault details */}
            {faultIds.length > 0 && (
              <div style={{ ...card, marginBottom: "1rem" }}>
                <div style={{ background: "#b91c1c", color: "#fff", margin: "-0.75rem -0.75rem 0.75rem", padding: "0.5rem 0.75rem", borderRadius: "10px 10px 0 0", fontSize: "0.8rem", fontWeight: 800 }}>
                  ⚠️ FAULT DETAILS — please describe each fault
                </div>
                {faultIds.map(id => {
                  const allItems = [...ALL_VISUAL_ITEMS, ...FUNCTION_CHECKS];
                  const item = allItems.find(i => i.id === id);
                  return (
                    <div key={id} style={{ marginBottom: "0.75rem" }}>
                      <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "#b91c1c", display: "block", marginBottom: "0.25rem" }}>
                        Item {id}: {item?.text}
                      </label>
                      <textarea
                        value={faultDetails[id] || ""}
                        onChange={e => setFaultDetails(p => ({ ...p, [id]: e.target.value }))}
                        placeholder="Describe the fault…"
                        rows={2}
                        style={{ width: "100%", boxSizing: "border-box", padding: "0.6rem", border: "1.5px solid #fca5a5", borderRadius: 8, fontSize: "0.9rem", resize: "vertical" }}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Photo */}
            <div style={{ ...card, marginBottom: "1rem" }} ref={photoInputRef}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: "0.5rem", color: "#111827" }}>📸 Machine Photo *</div>
              <p style={{ fontSize: "0.82rem", color: "#6b7280", margin: "0 0 0.75rem" }}>Take a photo of the machine from the front or side.</p>
              <input type="file" accept="image/*" capture="environment"
                onChange={e => setPhotoFile(e.target.files?.[0] || null)}
                style={{ fontSize: "0.9rem" }}
              />
              {photoFile && <p style={{ margin: "0.5rem 0 0", fontSize: "0.8rem", color: "#15803d" }}>✓ Photo selected: {photoFile.name}</p>}
            </div>

            {/* Signature */}
            <div style={{ ...card, marginBottom: "1rem" }}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: "0.5rem", color: "#111827" }}>✍️ Operator Signature *</div>
              <div style={{ border: "2px solid #e5e7eb", borderRadius: 10, overflow: "hidden", touchAction: "none" }}>
                <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: 160, touchAction: "none" }} />
              </div>
              <button onClick={() => sigPadRef.current?.clear()}
                style={{ marginTop: "0.5rem", padding: "0.4rem 0.9rem", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: "0.82rem", cursor: "pointer" }}>
                Clear
              </button>
            </div>

            {step3Error && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", fontSize: "0.85rem", color: "#b91c1c", fontWeight: 700 }}>
                {step3Error}
              </div>
            )}

            <button style={btnStyle(faultIds.length ? "#b91c1c" : "#15803d")} onClick={handleSubmit}>
              {faultIds.length ? `⚠️ Submit with ${faultIds.length} Fault${faultIds.length > 1 ? "s" : ""}` : "✅ Submit — All Clear"}
            </button>
            <button style={btnStyle("#6b7280")} onClick={() => { setStep(2); window.scrollTo(0,0); }}>
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Layout helpers ────────────────────────────────────────────────────────────
function Page({ title, forklift, children }) {
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", minHeight: "100vh", background: "#f3f4f6" }}>
      <div style={{ background: BRAND, padding: "0.75rem 1rem" }}>
        <img src="/logo.png" alt="" style={{ height: 28, display: "block", marginBottom: "0.25rem" }} onError={e => { e.target.style.display = "none"; }} />
        <div style={{ color: "#fff", fontWeight: 800 }}>{forklift?.machine_ref}</div>
        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.8rem" }}>{forklift?.sites?.name}</div>
      </div>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "1rem" }}>
        <h2 style={sectionTitle}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function FullPageMsg({ msg, sub, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#f3f4f6" }}>
      <div style={{ textAlign: "center", padding: "2rem" }}>
        {icon && <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>{icon}</div>}
        <p style={{ fontWeight: 700, color: "#111827", fontSize: "1.1rem" }}>{msg}</p>
        {sub && <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>{sub}</p>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.3rem" }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "0.7rem 0.75rem", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: "1rem" }} />
    </div>
  );
}

const sectionTitle = { fontSize: "1.15rem", fontWeight: 800, color: "#111827", margin: "0 0 0.75rem" };
const card = { background: "#fff", borderRadius: 12, padding: "0.75rem", marginBottom: "0.75rem", border: "1px solid #e5e7eb" };

function btnStyle(bg, disabled) {
  return {
    display: "block", width: "100%", padding: "0.9rem", marginBottom: "0.6rem",
    background: disabled ? "#d1d5db" : bg, color: "#fff", border: "none",
    borderRadius: 12, fontWeight: 800, fontSize: "1rem", cursor: disabled ? "not-allowed" : "pointer",
  };
}

export async function getServerSideProps({ params }) {
  return { props: { forkliftId: params.forkliftId } };
}
