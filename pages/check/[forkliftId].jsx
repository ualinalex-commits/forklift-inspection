import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import SupervisorSignoffModal from "../../components/SupervisorSignoffModal";

const BRAND = "#d02a35";

// ─── Check item definitions ───────────────────────────────────────────────────
// Wording and item numbers must match the printed rows on the PL054-OP-V3
// Telehandler Inspection Checklist template (see lib/generateReport.js VIS_ROWS /
// FUNC_ROWS) — the PDF stamps results/comments by item_number onto fixed
// coordinates for these exact rows, so the two must stay in sync.
const SECTIONS = [
  { id: "outside_cab", label: "On the Machine, Outside the Cab", emoji: "🚜", items: [
    { id: 1,  text: "Mirrors — clean, no damage, properly adjusted" },
    { id: 2,  text: "Windows — clean, no damage, front and top" },
    { id: 3,  text: "Windshield wipers — arm and rubber blade intact" },
    { id: 4,  text: "Forks — no damage, cracks or misalignment; check welds, locking pins in place and secure" },
    { id: 5,  text: "Warning decals — present, legible, not damaged" },
    { id: 6,  text: "Tyres — no damage, bulges, correct ply rating" },
    { id: 7,  text: "Wheels — no loose lug bolts, bent rims or cracks" },
    { id: 8,  text: "Differentials — no oil leaks or cracks in housing" },
    { id: 9,  text: "Guards and covers — no damage, all in place" },
    { id: 10, text: "Steps and handrail — no damage, clean" },
    { id: 11, text: "Stabiliser arms, cylinders, pads — no damage or oil leaks, cylinder rod condition, no missing bolts" },
    { id: 12, text: "Battery / terminals — cable connections secure, no water ingress, clean — no corrosion" },
    { id: 13, text: "Overall machine — no loose/missing nuts or bolts, guards secure, no damage, clean" },
  ]},
  { id: "engine_compartment", label: "Engine Compartment", emoji: "⚙️", items: [
    { id: 14, text: "Air filter — check restriction indicator" },
    { id: 15, text: "Radiator fin — no blockage, leaks; clean" },
    { id: 16, text: "All hoses — no cracks, wear spots or leaks" },
    { id: 17, text: "All belts — check tightness, wear, cracks, delamination" },
    { id: 18, text: "Overall engine compartment — no rubbish or dirt build-up, no leaks" },
  ]},
  { id: "inside_cab", label: "Inside the Cab", emoji: "🪑", items: [
    { id: 19, text: "ROPS or FOPS — no damage, no loose bolts" },
    { id: 20, text: "Seat — adjustment and pedal travel correct" },
  ]},
];

const FUNCTION_CHECKS = [
  { id: 21, text: "Seat belt & mounting — no damage or wear, adjusts and functions correctly" },
  { id: 22, text: "Fire extinguisher — charge OK, no damage, inspection card in date" },
  { id: 23, text: "Horn, backup alarm, lights, wipers — proper function" },
  { id: 24, text: "Controls, gauge lenses — proper function, clean" },
  { id: 25, text: "Overall cab — interior cleanliness" },
  { id: 26, text: "Training — do you have a current CPCS card for the item of plant you are operating?" },
  { id: 27, text: "Familiarisation — are you familiar with the model of telehandler, its functions and controls, and any attachments you are using?" },
  { id: 28, text: "Supervision — do you know who your supervisor is?" },
  { id: 29, text: "Fit and well to carry out work — are you?" },
  { id: 31, text: "Slings, bin handlers, chains etc — suitable storage, free from damage, good condition" },
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

// ─── Weekly tracker + report link (same style as site dashboard) ─────────────
function getWeekDates() {
  const today = new Date();
  const dow = today.getDay();
  const fromMon = (dow + 6) % 7;
  const mon = new Date(today);
  mon.setDate(today.getDate() - fromMon);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return toLocalDateStr(d);
  });
}

function WeeklyTrackerRow({ forkliftId }) {
  const [entryMap, setEntryMap] = useState({});
  const weekDates = getWeekDates();
  const today = todayStr();

  useEffect(() => {
    supabase.from("daily_inspection_entries")
      .select("id, inspection_date")
      .eq("forklift_id", forkliftId)
      .in("inspection_date", weekDates)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(e => { map[e.inspection_date] = e; });
        setEntryMap(map);
      });
  }, [forkliftId]);

  const dayLabels = ["M","T","W","T","F","S"];
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {weekDates.map((date, i) => {
        const done = !!entryMap[date];
        const past = date < today;
        const isToday = date === today;
        const bg = done ? "#15803d" : past ? "#b91c1c" : "#e5e7eb";
        return (
          <div key={date} title={date} style={{ width: 28, height: 28, borderRadius: 6,
            background: bg, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.7rem", fontWeight: 800, color: done || past ? "#fff" : "#9ca3af",
            border: isToday ? `2px solid ${BRAND}` : "2px solid transparent" }}>
            {dayLabels[i]}
          </div>
        );
      })}
    </div>
  );
}

function WeeklyOverviewCard({ forkliftId }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const weekCommencing = getWeekDates()[0];
    supabase.from("weekly_inspection_sheets")
      .select("pdf_url")
      .eq("forklift_id", forkliftId)
      .eq("week_commencing", weekCommencing)
      .maybeSingle()
      .then(({ data }) => { setPdfUrl(data?.pdf_url || null); setLoaded(true); });
  }, [forkliftId]);

  return (
    <div style={{ ...card, marginBottom: "1rem" }}>
      <p style={{ margin: "0 0 0.5rem", fontWeight: 800, color: "#111827", fontSize: "0.9rem" }}>This Week</p>
      <WeeklyTrackerRow forkliftId={forkliftId} />
      <div style={{ marginTop: "0.75rem" }}>
        {pdfUrl ? (
          <a href={`${pdfUrl}?t=${Date.now()}`} target="_blank" rel="noreferrer"
            style={{ display: "block", textAlign: "center", padding: "0.6rem", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 10, fontWeight: 700, fontSize: "0.85rem", color: BRAND, textDecoration: "none" }}>
            📄 View This Week's Report
          </a>
        ) : (
          <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>{loaded ? "Report not generated yet" : "Loading report…"}</span>
        )}
      </div>
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

// ─── Diagram annotation canvas ────────────────────────────────────────────────
// Uses Picture 1.png as a static background image; drawCanvasRef is the drawing overlay.
function DiagramCanvas({ imgRef, drawCanvasRef, onClear, status, onImgLoad, onImgError }) {
  const isPointerDown = useRef(false);
  const lastPos       = useRef({ x: 0, y: 0 });

  function getPos(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }

  function onDown(e) {
    if (status !== "ready") return;
    e.preventDefault();
    isPointerDown.current = true;
    lastPos.current = getPos(drawCanvasRef.current, e);
  }

  function onMove(e) {
    e.preventDefault();
    if (!isPointerDown.current) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pos = getPos(canvas, e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#d02a35";
    ctx.lineWidth   = 3;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.stroke();
    lastPos.current = pos;
  }

  function onUp() { isPointerDown.current = false; }

  return (
    <div>
      <div style={{ position: "relative", border: "2px solid #e5e7eb", borderRadius: 10, overflow: "hidden", background: "#f9fafb", touchAction: "none", minHeight: 80 }}>
        {/* Background image — Picture 1.png */}
        <img
          ref={imgRef}
          src="/Picture 1.png"
          alt="Machine diagram"
          draggable={false}
          onLoad={onImgLoad}
          onError={onImgError}
          style={{ display: "block", width: "100%", userSelect: "none" }}
        />
        {/* Drawing overlay — transparent canvas captures touches */}
        <canvas ref={drawCanvasRef}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", cursor: status === "ready" ? "crosshair" : "default", touchAction: "none" }}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        />
        {status === "loading" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(249,250,251,0.85)", fontSize: "0.85rem", color: "#6b7280" }}>
            Loading diagram…
          </div>
        )}
        {status === "error" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(254,242,242,0.9)", fontSize: "0.82rem", color: "#b91c1c", textAlign: "center", padding: "1rem" }}>
            ⚠️ Diagram could not be loaded.<br />You can still submit — annotations are optional.
          </div>
        )}
      </div>
      {status === "ready" && (
        <button onClick={onClear}
          style={{ marginTop: "0.4rem", padding: "0.35rem 0.9rem", background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: "0.82rem", cursor: "pointer" }}>
          Clear Drawing
        </button>
      )}
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

  // Step 3 — fault details only
  const [faultDetails, setFaultDetails] = useState({});

  // Step 4 — comments, diagram, signature
  const [additionalComments, setAdditionalComments] = useState("");
  const [sigDataUrl, setSigDataUrl] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [diagramStatus, setDiagramStatus] = useState("idle"); // idle | loading | ready | error

  const canvasRef      = useRef(null); // signature canvas
  const sigPadRef      = useRef(null); // SignaturePad instance
  const imgRef         = useRef(null); // diagram background image (Picture 1.png)
  const drawCanvasRef  = useRef(null); // diagram drawing overlay

  const [doneEntry, setDoneEntry] = useState(null);

  // Supervisor sign-off (already_done screen) — one per forklift per week
  const [weekSheet, setWeekSheet] = useState(null);
  const [signoffOpen, setSignoffOpen] = useState(false);

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
        if (entry.sheet_id) {
          const { data: sheet } = await supabase
            .from("weekly_inspection_sheets")
            .select("id, supervisor_name, supervisor_signature_url, supervisor_sign_date")
            .eq("id", entry.sheet_id)
            .maybeSingle();
          setWeekSheet(sheet || null);
        }
      } else {
        setPageStatus("form");
      }
    }
    load();
  }, [forkliftId]);

  // ── Signature pad init (step 4) ───────────────────────────────────────────
  useEffect(() => {
    if (step !== 4) return;
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

  // ── Diagram: set loading state when entering step 4 ──────────────────────
  useEffect(() => {
    if (step === 4) setDiagramStatus("loading");
  }, [step]);

  // ── Capture annotated diagram as PNG data URL ─────────────────────────────
  function captureAnnotatedDiagram() {
    const img  = imgRef.current;
    const draw = drawCanvasRef.current;
    if (!img || !draw || !img.naturalWidth) return null;
    const out = document.createElement("canvas");
    out.width  = img.naturalWidth;
    out.height = img.naturalHeight;
    const ctx = out.getContext("2d");
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(draw, 0, 0);
    return out.toDataURL("image/png");
  }

  function clearDiagram() {
    const draw = drawCanvasRef.current;
    if (!draw) return;
    draw.getContext("2d").clearRect(0, 0, draw.width, draw.height);
  }

  // ── Step navigation ────────────────────────────────────────────────────────
  function goToStep2() {
    const unanswered = ALL_VISUAL_ITEMS.filter(i => !visualResults[i.id]).map(i => i.id);
    if (unanswered.length > 0) { setVisHighlighted(unanswered); window.scrollTo(0,0); return; }
    setVisHighlighted([]);
    setStep(2);
    window.scrollTo(0,0);
  }

  function goToStep3() {
    const unanswered = FUNCTION_CHECKS.filter(i => !funcResults[i.id]).map(i => i.id);
    if (unanswered.length > 0) { setFuncHighlighted(unanswered); window.scrollTo(0,0); return; }
    setFuncHighlighted([]);
    setStep(3);
    window.scrollTo(0,0);
  }

  function goToStep4() {
    setStep(4);
    window.scrollTo(0,0);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitError("");

    // Capture sig BEFORE re-render destroys the canvas
    let capturedSig = sigDataUrl;
    if (!capturedSig && sigPadRef.current && !sigPadRef.current.isEmpty()) {
      capturedSig = sigPadRef.current.toDataURL("image/png");
    }

    // Capture annotated diagram before re-render
    const diagramDataUrl = captureAnnotatedDiagram();

    // Validate
    if (!capturedSig || (sigPadRef.current && sigPadRef.current.isEmpty())) {
      setSubmitError("Please provide your signature.");
      canvasRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }

    setSigDataUrl(capturedSig);
    setPageStatus("submitting");

    const today  = todayStr();
    const siteId = forklift.sites?.id || forklift.site_id;
    const faultIds = [...Object.entries(visualResults), ...Object.entries(funcResults)]
      .filter(([, v]) => v === "fail")
      .map(([k]) => Number(k));
    const dailyStatus = faultIds.length > 0 ? "fault" : "ok";

    try {
      // Upload signature
      const sigBase64 = capturedSig.split(",")[1];
      const sigBinary = atob(sigBase64);
      const sigBytes  = new Uint8Array(sigBinary.length);
      for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);
      const sigBlob = new Blob([sigBytes], { type: "image/png" });
      const sigPath = `${siteId}/${forkliftId}/${today}.png`;
      const { error: sigErr } = await supabase.storage.from("signatures")
        .upload(sigPath, sigBlob, { upsert: true, contentType: "image/png" });
      if (sigErr) throw new Error("Signature upload failed: " + sigErr.message);
      const { data: { publicUrl: signatureUrl } } = supabase.storage.from("signatures").getPublicUrl(sigPath);

      // Upload annotated diagram
      let diagramAnnotationUrl = null;
      if (diagramDataUrl) {
        const diagBase64 = diagramDataUrl.split(",")[1];
        const diagBinary = atob(diagBase64);
        const diagBytes  = new Uint8Array(diagBinary.length);
        for (let i = 0; i < diagBinary.length; i++) diagBytes[i] = diagBinary.charCodeAt(i);
        const diagBlob = new Blob([diagBytes], { type: "image/png" });
        const diagPath = `${siteId}/${forkliftId}/${today}-diagram.png`;
        const { error: diagErr } = await supabase.storage.from("forklift-photos")
          .upload(diagPath, diagBlob, { upsert: true, contentType: "image/png" });
        if (!diagErr) {
          const { data: { publicUrl } } = supabase.storage.from("forklift-photos").getPublicUrl(diagPath);
          diagramAnnotationUrl = publicUrl;
        }
      }

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
          sheet_id:        sheetId,
          forklift_id:     forkliftId,
          site_id:         siteId,
          inspection_date: today,
          day_of_week:     getDayOfWeek(today),
          operator_name:   operatorName.trim(),
          forklift_owner:  forkOwner.trim() || null,
          initialled:      true,
          daily_status:    dailyStatus,
          submitted_at:    new Date().toISOString(),
          signature_url:   signatureUrl,
          tyre_fl_psi:     tyrePsi.fl ? Number(tyrePsi.fl) : null,
          tyre_fr_psi:     tyrePsi.fr ? Number(tyrePsi.fr) : null,
          tyre_rl_psi:     tyrePsi.rl ? Number(tyrePsi.rl) : null,
          tyre_rr_psi:     tyrePsi.rr ? Number(tyrePsi.rr) : null,
          additional_comments:    additionalComments.trim() || null,
          diagram_annotation_url: diagramAnnotationUrl,
        })
        .select()
        .single();
      if (entryErr) throw new Error("Entry error: " + entryErr.message);

      // Insert visual check results
      const visRows = ALL_VISUAL_ITEMS.map(item => ({
        entry_id:        entry.id,
        sheet_id:        sheetId,
        forklift_id:     forkliftId,
        inspection_date: today,
        item_number:     item.id,
        category:        SECTIONS.find(s => s.items.some(i => i.id === item.id))?.id,
        result:          visualResults[item.id],
      }));
      const { error: visErr } = await supabase.from("visual_check_results").insert(visRows);
      if (visErr) throw new Error("Visual results error: " + visErr.message);

      // Insert function check results
      const funcRows = FUNCTION_CHECKS.map(item => ({
        entry_id:        entry.id,
        sheet_id:        sheetId,
        forklift_id:     forkliftId,
        inspection_date: today,
        item_number:     item.id,
        result:          funcResults[item.id],
      }));
      const { error: funcErr } = await supabase.from("function_check_results").insert(funcRows);
      if (funcErr) throw new Error("Function results error: " + funcErr.message);

      // Insert defect log rows
      if (faultIds.length > 0) {
        const allItems = [...ALL_VISUAL_ITEMS, ...FUNCTION_CHECKS];
        const defectRows = faultIds.map(id => ({
          entry_id:        entry.id,
          sheet_id:        sheetId,
          forklift_id:     forkliftId,
          site_id:         siteId,
          inspection_date: today,
          item_number:     id,
          check_type:      id <= 20 ? "visual" : "function",
          defect_details:  faultDetails[id] || "",
          date_noted:      today,
          status:          "open",
        }));
        await supabase.from("defect_log").insert(defectRows);
      }

      // Trigger PDF and confirm it actually completed before moving on
      try {
        const pdfRes = await fetch("/api/trigger-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forklift_id: forkliftId, sheet_id: sheetId }),
        });
        const pdfJson = await pdfRes.json().catch(() => ({}));
        if (!pdfRes.ok || !pdfJson.ok) {
          console.error("PDF generation failed:", pdfJson.error || pdfRes.status);
        }
      } catch (err) {
        console.error("PDF trigger request failed:", err);
      }

      setDoneEntry({ ...entry, faultIds, faultDetails: { ...faultDetails } });
      setPageStatus("done");

    } catch (err) {
      console.error(err);
      setPageStatus("submit_error");
      setSubmitError(err.message);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const answeredVis  = ALL_VISUAL_ITEMS.filter(i => visualResults[i.id]).length;
  const answeredFunc = FUNCTION_CHECKS.filter(i => funcResults[i.id]).length;
  const progressPct  = step === 1
    ? Math.round((answeredVis  / ALL_VISUAL_ITEMS.length) * 100)
    : step === 2
    ? Math.round((answeredFunc / FUNCTION_CHECKS.length) * 100)
    : 0;

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (pageStatus === "loading") return <FullPageMsg msg="Loading…" />;

  // ── NOT FOUND ─────────────────────────────────────────────────────────────
  if (pageStatus === "not_found") return (
    <FullPageMsg msg="Machine not found" sub="This QR code is not registered or the machine is inactive." icon="🚫" />
  );

  // ── ALREADY DONE ──────────────────────────────────────────────────────────
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
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "1rem", marginBottom: "1rem" }}>
            <p style={{ margin: "0 0 0.5rem", fontWeight: 800, color: "#b91c1c" }}>⚠️ {faults.length} fault{faults.length > 1 ? "s" : ""} reported</p>
            {faults.map((f, i) => (
              <div key={i} style={{ fontSize: "0.85rem", color: "#111827", marginBottom: "0.35rem" }}>
                <strong>Item {f.item_number}:</strong> {f.defect_details || "No details provided"}
              </div>
            ))}
          </div>
        )}

        <WeeklyOverviewCard forkliftId={forkliftId} />

        {/* Supervisor sign-off — one per forklift per week */}
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "1rem" }}>
          <p style={{ margin: "0 0 0.5rem", fontWeight: 800, color: "#111827", fontSize: "0.9rem" }}>Supervisor Sign-off</p>
          <button onClick={() => setSignoffOpen(true)}
            style={{ padding: "0.6rem 1rem", fontSize: "0.85rem", fontWeight: 700, borderRadius: 10, cursor: "pointer",
              border: weekSheet?.supervisor_name ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
              background: weekSheet?.supervisor_name ? "#f0fdf4" : "#f9fafb",
              color: weekSheet?.supervisor_name ? "#15803d" : "#374151" }}>
            {weekSheet?.supervisor_name ? `✓ Signed — ${weekSheet.supervisor_name}` : "Supervisor Sign-off"}
          </button>
        </div>

        {signoffOpen && (
          <SupervisorSignoffModal
            forklift={forklift}
            siteId={forklift.sites?.id || forklift.site_id}
            sheetId={weekSheet?.id || existingEntry?.sheet_id || null}
            supervisorName={weekSheet?.supervisor_name || ""}
            onClose={() => setSignoffOpen(false)}
            onDone={async () => {
              setSignoffOpen(false);
              if (existingEntry?.sheet_id) {
                const { data: sheet } = await supabase
                  .from("weekly_inspection_sheets")
                  .select("id, supervisor_name, supervisor_signature_url, supervisor_sign_date")
                  .eq("id", existingEntry.sheet_id)
                  .maybeSingle();
                setWeekSheet(sheet || null);
              }
            }}
          />
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
          <p style={{ fontSize: "0.85rem", color: "#374151" }}>{submitError}</p>
        </div>
        <button onClick={() => { setPageStatus("form"); setStep(4); }} style={btnStyle(BRAND)}>
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
        <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.75rem" }}>Step {step + 1}/5</div>
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
            <WeeklyOverviewCard forkliftId={forkliftId} />
            <ThoroughExamCard forklift={forklift} />
            <div style={card}>
              <Field label="Full Name *" value={operatorName} onChange={setOperatorName} placeholder="Enter your full name" />
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
              Next: Review →
            </button>
            <button style={btnStyle("#6b7280")} onClick={() => { setStep(1); window.scrollTo(0,0); }}>
              ← Back
            </button>
          </>
        )}

        {/* ── STEP 3: Review ───────────────────────────────────────────────── */}
        {step === 3 && (
          <>
            <h2 style={sectionTitle}>Review</h2>

            {/* Summary table */}
            <div style={{ ...card, padding: 0, overflow: "hidden", marginBottom: "1rem" }}>
              <div style={{ background: "#1e2a47", color: "#fff", padding: "0.5rem 0.75rem", fontSize: "0.8rem", fontWeight: 800 }}>INSPECTION SUMMARY</div>
              {[
                ["Machine",          forklift?.machine_ref],
                ["Site",             forklift?.sites?.name],
                ["Operator",         operatorName],
                ["Date",             fmtDateGB(todayStr())],
                ["Visual checks",    `${ALL_VISUAL_ITEMS.length} items`],
                ["Function checks",  `${FUNCTION_CHECKS.length} items`],
                ["Faults",           faultIds.length ? `${faultIds.length} fault${faultIds.length > 1 ? "s" : ""}` : "None"],
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

            <button style={btnStyle(BRAND)} onClick={goToStep4}>
              Next: Comments &amp; Sign →
            </button>
            <button style={btnStyle("#6b7280")} onClick={() => { setStep(2); window.scrollTo(0,0); }}>
              ← Back
            </button>
          </>
        )}

        {/* ── STEP 4: Additional Comments & Diagram ───────────────────────── */}
        {step === 4 && (
          <>
            <h2 style={sectionTitle}>Additional Comments &amp; Diagram</h2>

            {/* Additional comments */}
            <div style={{ ...card, marginBottom: "1rem" }}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: "0.5rem", color: "#111827" }}>💬 Additional Comments</div>
              <p style={{ margin: "0 0 0.6rem", fontSize: "0.82rem", color: "#6b7280" }}>Note any observations not captured in the checklist above (optional).</p>
              <textarea
                value={additionalComments}
                onChange={e => setAdditionalComments(e.target.value)}
                placeholder="e.g. Minor scuff on rear left panel — noted for records. No impact on operation."
                rows={4}
                style={{ width: "100%", boxSizing: "border-box", padding: "0.65rem", border: "1.5px solid #e5e7eb", borderRadius: 8, fontSize: "0.9rem", resize: "vertical" }}
              />
            </div>

            {/* Diagram annotation */}
            <div style={{ ...card, marginBottom: "1rem" }}>
              <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: "0.3rem", color: "#111827" }}>🔴 Mark Areas of Concern</div>
              <p style={{ margin: "0 0 0.65rem", fontSize: "0.82rem", color: "#6b7280" }}>
                Use your finger to circle or annotate areas of concern on the machine diagram. The annotated image will be saved with your inspection.
              </p>
              <DiagramCanvas
                imgRef={imgRef}
                drawCanvasRef={drawCanvasRef}
                onClear={clearDiagram}
                status={diagramStatus}
                onImgLoad={() => {
                  const img  = imgRef.current;
                  const draw = drawCanvasRef.current;
                  if (img && draw) {
                    draw.width  = img.naturalWidth;
                    draw.height = img.naturalHeight;
                  }
                  setDiagramStatus("ready");
                }}
                onImgError={() => setDiagramStatus("error")}
              />
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

            {submitError && (
              <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", fontSize: "0.85rem", color: "#b91c1c", fontWeight: 700 }}>
                {submitError}
              </div>
            )}

            <button style={btnStyle(faultIds.length ? "#b91c1c" : "#15803d")} onClick={handleSubmit}>
              {faultIds.length ? `⚠️ Submit with ${faultIds.length} Fault${faultIds.length > 1 ? "s" : ""}` : "✅ Submit — All Clear"}
            </button>
            <button style={btnStyle("#6b7280")} onClick={() => { setStep(3); window.scrollTo(0,0); }}>
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
