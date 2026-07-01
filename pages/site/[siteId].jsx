import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../../lib/supabase";

const BRAND = "#d02a35";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayStr() { return toLocalDateStr(new Date()); }
function fmtDateGB(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}
function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" });
}

// ─── WeeklyTracker ─────────────────────────────────────────────────────────────
function getWeekDates() {
  const today  = new Date();
  const dow    = today.getDay();
  const fromMon = (dow + 6) % 7;
  const mon    = new Date(today);
  mon.setDate(today.getDate() - fromMon);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return toLocalDateStr(d);
  });
}

function WeeklyTracker({ forkliftId, refreshKey, onSelectDay, hideSquares }) {
  const [entryMap, setEntryMap] = useState({});
  const weekDates = getWeekDates();
  const today     = todayStr();

  useEffect(() => {
    supabase.from("daily_inspection_entries")
      .select("id, inspection_date, sheet_id, supervisor_name")
      .eq("forklift_id", forkliftId)
      .in("inspection_date", weekDates)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(e => { map[e.inspection_date] = e; });
        setEntryMap(map);
      });
  }, [forkliftId, refreshKey]);

  const dayLabels = ["M","T","W","T","F","S"];
  return (
    <div>
      {!hideSquares && (
        <div style={{ display:"flex", gap:4, marginTop:"0.5rem" }}>
          {weekDates.map((date, i) => {
            const entry   = entryMap[date];
            const done    = !!entry;
            const past    = date < today;
            const isToday = date === today;
            const bg = done ? "#15803d" : past ? "#b91c1c" : "#e5e7eb";
            return (
              <div key={date} title={date} style={{ width:28, height:28, borderRadius:6,
                background:bg, display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:"0.7rem", fontWeight:800, color: done || past ? "#fff" : "#9ca3af",
                border: isToday ? `2px solid ${BRAND}` : "2px solid transparent" }}>
                {dayLabels[i]}
              </div>
            );
          })}
        </div>
      )}
      {onSelectDay && (
        <div style={{ display:"flex", gap:4, marginTop:"0.35rem", flexWrap:"wrap" }}>
          {weekDates.map((date, i) => {
            const entry = entryMap[date];
            if (!entry) return null;
            const signed = !!entry.supervisor_name;
            return (
              <button key={date}
                onClick={() => onSelectDay({ entryId: entry.id, sheetId: entry.sheet_id, date, supervisorName: entry.supervisor_name })}
                style={{ padding:"0.2rem 0.5rem", fontSize:"0.68rem", fontWeight:700, borderRadius:6, cursor:"pointer",
                  border: signed ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
                  background: signed ? "#f0fdf4" : "#f9fafb",
                  color: signed ? "#15803d" : "#374151" }}>
                {signed ? `✓ ${dayLabels[i]} Signed` : `${dayLabels[i]} Sign-off`}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── SupervisorSignoffModal ────────────────────────────────────────────────────
function SupervisorSignoffModal({ forklift, siteId, day, onClose, onDone }) {
  const [name, setName]       = useState(day.supervisorName || "");
  const [signDate, setSignDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const canvasRef = useRef(null);
  const sigPadRef = useRef(null);

  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      import("signature_pad").then(({ default: SignaturePad }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width  = canvas.offsetWidth  || 320;
        canvas.height = canvas.offsetHeight || 160;
        sigPadRef.current = new SignaturePad(canvas, { backgroundColor:"rgb(255,255,255)", penColor:"#111827" });
      });
    });
    return () => {
      cancelAnimationFrame(raf);
      if (sigPadRef.current) { sigPadRef.current.off(); sigPadRef.current = null; }
    };
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    if (!name.trim()) { setError("Please enter the supervisor's name."); return; }
    if (!sigPadRef.current || sigPadRef.current.isEmpty()) { setError("Please provide a signature."); return; }
    setLoading(true); setError("");

    try {
      const sigDataUrl = sigPadRef.current.toDataURL("image/png");
      const sigBase64  = sigDataUrl.split(",")[1];
      const sigBinary  = atob(sigBase64);
      const sigBytes   = new Uint8Array(sigBinary.length);
      for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);
      const sigBlob = new Blob([sigBytes], { type:"image/png" });
      const sigPath = `${siteId}/${forklift.id}/${day.date}-supervisor.png`;
      const { error: upErr } = await supabase.storage.from("signatures").upload(sigPath, sigBlob, { upsert:true, contentType:"image/png" });
      if (upErr) throw new Error(upErr.message);
      const { data:{ publicUrl } } = supabase.storage.from("signatures").getPublicUrl(sigPath);

      const { error: dbErr } = await supabase.from("daily_inspection_entries").update({
        supervisor_name: name.trim(),
        supervisor_signature_url: publicUrl,
        supervisor_sign_date: signDate,
      }).eq("id", day.entryId);
      if (dbErr) throw new Error(dbErr.message);

      // Regenerate the PDF so the sign-off appears on page 3
      fetch("/api/trigger-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forklift_id: forklift.id, sheet_id: day.sheetId }),
      }).catch(() => {});

      onDone();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Modal title={`Supervisor Sign-off — ${fmtDateGB(day.date)}`} onClose={onClose}>
      <form onSubmit={handleSave}>
        <label style={labelStyle}>Supervisor Name *</label>
        <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="Full name" required />
        <label style={labelStyle}>Date *</label>
        <input type="date" value={signDate} onChange={e => setSignDate(e.target.value)} style={inputStyle} required />
        <label style={labelStyle}>Signature *</label>
        <div style={{ border:"2px solid #e5e7eb", borderRadius:10, overflow:"hidden", touchAction:"none", marginBottom:"0.5rem" }}>
          <canvas ref={canvasRef} style={{ display:"block", width:"100%", height:140, touchAction:"none" }} />
        </div>
        <button type="button" onClick={() => sigPadRef.current?.clear()} style={{ ...smallBtn("#6b7280"), marginBottom:"1rem" }}>Clear</button>
        {error && <p style={{ color:BRAND, fontSize:"0.85rem" }}>{error}</p>}
        <button type="submit" disabled={loading} style={btnStyle(BRAND)}>{loading ? "Saving…" : "Save Sign-off"}</button>
      </form>
    </Modal>
  );
}

// ─── ThoroughExamCard ─────────────────────────────────────────────────────────
function ThoroughExamCard({ forklift, isAdmin, onUpload }) {
  if (!forklift?.thorough_exam_url) {
    return (
      <div style={{ background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:8, padding:"0.6rem 0.75rem", marginTop:"0.5rem" }}>
        <p style={{ margin:0, fontSize:"0.8rem", color:"#c2410c", fontWeight:700 }}>No thorough exam on file</p>
        {isAdmin && <button onClick={onUpload} style={smallBtn("#c2410c")}>Upload</button>}
      </div>
    );
  }
  const expired = forklift.thorough_exam_expiry && new Date(forklift.thorough_exam_expiry) < new Date();
  return (
    <div style={{ background: expired ? "#fef2f2" : "#f0fdf4", border:`1px solid ${expired?"#fecaca":"#bbf7d0"}`, borderRadius:8, padding:"0.6rem 0.75rem", marginTop:"0.5rem" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"0.5rem", marginBottom:"0.25rem" }}>
        <span style={{ fontSize:"0.72rem", fontWeight:800, color: expired?"#b91c1c":"#15803d", background: expired?"#fee2e2":"#dcfce7", padding:"1px 7px", borderRadius:20 }}>
          {expired?"EXPIRED":"VALID"}
        </span>
        <span style={{ fontSize:"0.78rem", color:"#374151" }}>LOLER Exam</span>
        {forklift.thorough_exam_expiry && <span style={{ fontSize:"0.75rem", color:"#6b7280" }}>— {fmtDateGB(forklift.thorough_exam_expiry)}</span>}
      </div>
      <div style={{ display:"flex", gap:"0.5rem", alignItems:"center" }}>
        <a href={forklift.thorough_exam_url} target="_blank" rel="noreferrer" style={{ fontSize:"0.78rem", color:"#1d4ed8" }}>
          Open Document ↗
        </a>
        {isAdmin && <button onClick={onUpload} style={smallBtn("#6b7280")}>Replace</button>}
      </div>
    </div>
  );
}

// ─── QR Code panel ────────────────────────────────────────────────────────────
function QRPanel({ url, label }) {
  const canvasRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !canvasRef.current || !url) return;
    import("qrcode").then(({ default: QRCode }) => {
      QRCode.toCanvas(canvasRef.current, url, { width:160, margin:2, color:{ dark:"#000", light:"#fff" } });
    });
  }, [open, url]);

  async function download() {
    const QRCode = (await import("qrcode")).default;
    const dataUrl = await QRCode.toDataURL(url, { width:300, margin:2 });
    const canvas  = document.createElement("canvas");
    canvas.width  = 348; canvas.height = 372;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 24, 12, 300, 300);
      ctx.textAlign="center"; ctx.fillStyle="#111827";
      ctx.font="bold 20px system-ui";
      ctx.fillText(label, canvas.width/2, 334);
      canvas.toBlob(blob => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "qr.png"; a.click();
        URL.revokeObjectURL(a.href);
      });
    };
    img.src = dataUrl;
  }

  return (
    <div style={{ marginTop:"0.5rem" }}>
      <button onClick={() => setOpen(o => !o)} style={smallBtn("#374151")}>
        {open ? "Hide QR" : "Show QR Code"}
      </button>
      {open && (
        <div style={{ marginTop:"0.5rem", display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <canvas ref={canvasRef} />
          <div>
            <button onClick={download} style={smallBtn(BRAND)}>Download PNG</button>
            <button onClick={() => navigator.clipboard?.writeText(url)} style={{ ...smallBtn("#6b7280"), marginTop:"0.35rem" }}>Copy URL</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reports panel ────────────────────────────────────────────────────────────
function ReportsPanel({ forkliftId }) {
  const [sheets, setSheets] = useState(null);
  const [open, setOpen]     = useState(false);

  useEffect(() => {
    if (!open || sheets !== null) return;
    supabase.from("weekly_inspection_sheets")
      .select("week_commencing, pdf_url, pdf_generated_at")
      .eq("forklift_id", forkliftId)
      .not("pdf_url","is",null)
      .order("week_commencing", { ascending:false })
      .limit(26)
      .then(({ data }) => setSheets(data || []));
  }, [open, forkliftId]);

  return (
    <div style={{ marginTop:"0.5rem" }}>
      <button onClick={() => setOpen(o=>!o)} style={smallBtn("#374151")}>
        {open ? "Hide Reports" : "📄 Historical Reports"}
      </button>
      {open && (
        <div style={{ marginTop:"0.5rem", maxHeight:200, overflowY:"auto" }}>
          {sheets === null && <p style={{ fontSize:"0.8rem", color:"#6b7280" }}>Loading…</p>}
          {sheets?.length === 0 && <p style={{ fontSize:"0.8rem", color:"#6b7280" }}>No reports yet.</p>}
          {sheets?.map(s => (
            <div key={s.week_commencing} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0.35rem 0", borderBottom:"1px solid #f3f4f6" }}>
              <span style={{ fontSize:"0.8rem", color:"#374151" }}>W/c {fmtDateGB(s.week_commencing)}</span>
              <a href={s.pdf_url} target="_blank" rel="noreferrer" style={{ fontSize:"0.78rem", color:BRAND, fontWeight:700 }}>Download PDF ↗</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ThoroughExamModal ────────────────────────────────────────────────────────
function ThoroughExamModal({ forklift, onClose, onDone }) {
  const [file, setFile]     = useState(null);
  const [expiry, setExpiry] = useState(forklift.thorough_exam_expiry || "");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  async function handleUpload(e) {
    e.preventDefault();
    if (!file) { setError("Please select a file."); return; }
    setLoading(true); setError("");
    const ext  = file.name.split(".").pop();
    const path = `${forklift.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("thorough-exams").upload(path, file, { upsert:true });
    if (upErr) { setError(upErr.message); setLoading(false); return; }
    const { data:{ publicUrl } } = supabase.storage.from("thorough-exams").getPublicUrl(path);
    const { error: dbErr } = await supabase.from("forklifts").update({
      thorough_exam_url: publicUrl,
      thorough_exam_expiry: expiry || null,
      thorough_exam_filename: file.name,
      thorough_exam_uploaded_at: new Date().toISOString(),
    }).eq("id", forklift.id);
    if (dbErr) { setError(dbErr.message); setLoading(false); return; }
    onDone({ thorough_exam_url: publicUrl, thorough_exam_expiry: expiry, thorough_exam_filename: file.name });
  }

  return (
    <Modal title="Upload Thorough Exam" onClose={onClose}>
      <form onSubmit={handleUpload}>
        <label style={labelStyle}>Document (PDF / image)</label>
        <input type="file" accept=".pdf,image/*" onChange={e => setFile(e.target.files?.[0])} required style={{ marginBottom:"1rem", display:"block" }} />
        <label style={labelStyle}>Expiry Date</label>
        <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} style={inputStyle} />
        {error && <p style={{ color:BRAND, fontSize:"0.85rem" }}>{error}</p>}
        <button type="submit" disabled={loading} style={btnStyle(BRAND)}>{loading?"Uploading…":"Upload"}</button>
      </form>
    </Modal>
  );
}

// ─── AddForkliftModal ─────────────────────────────────────────────────────────
function AddForkliftModal({ siteId, onClose, onAdded }) {
  const [machineRef, setMachineRef] = useState("");
  const [model, setModel]           = useState("");
  const [serial, setSerial]         = useState("");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  async function handleAdd(e) {
    e.preventDefault();
    if (!machineRef.trim()) return;
    setLoading(true); setError("");
    const { data, error:err } = await supabase.from("forklifts")
      .insert({ site_id:siteId, machine_ref:machineRef.trim(), model:model.trim()||null, serial_number:serial.trim()||null })
      .select()
      .single();
    if (err) { setError(err.message); setLoading(false); return; }
    const nfcUrl = `${process.env.NEXT_PUBLIC_APP_URL}/check/${data.id}`;
    await supabase.from("forklifts").update({ nfc_url:nfcUrl }).eq("id", data.id);
    onAdded({ ...data, nfc_url:nfcUrl });
  }

  return (
    <Modal title="Add Machine" onClose={onClose}>
      <form onSubmit={handleAdd}>
        <label style={labelStyle}>Machine Name / Ref *</label>
        <input value={machineRef} onChange={e=>setMachineRef(e.target.value)} required style={inputStyle} placeholder="e.g. TH-01, Merlo 40.25" />
        <label style={labelStyle}>Model</label>
        <input value={model} onChange={e=>setModel(e.target.value)} style={inputStyle} placeholder="e.g. Merlo Panoramic 40.25" />
        <label style={labelStyle}>Serial Number</label>
        <input value={serial} onChange={e=>setSerial(e.target.value)} style={inputStyle} />
        {error && <p style={{ color:BRAND, fontSize:"0.85rem" }}>{error}</p>}
        <button type="submit" disabled={loading||!machineRef.trim()} style={btnStyle(BRAND)}>{loading?"Adding…":"Add Machine"}</button>
      </form>
    </Modal>
  );
}

// ─── ForkliftCard ─────────────────────────────────────────────────────────────
function ForkliftCard({ forklift, todayEntry, currentPdfUrl, rtRefreshKey, isAdmin, onArchiveToggle }) {
  const [open, setOpen]         = useState(false);
  const [examModal, setExamModal] = useState(false);
  const [signoffDay, setSignoffDay] = useState(null);
  const [localFork, setLocalFork] = useState(forklift);
  const faults = todayEntry?.defect_log || [];
  const done   = !!todayEntry;
  const hasFaults = faults.length > 0;

  const statusColor = !done ? "#6b7280" : hasFaults ? BRAND : "#15803d";
  const statusLabel = !done ? "Pending" : hasFaults ? `Faults (${faults.length})` : `Done ${fmtTime(todayEntry?.submitted_at)}`;

  return (
    <div style={{ background:"#fff", borderRadius:12, border:`1px solid ${done ? (hasFaults?"#fecaca":"#bbf7d0") : "#e5e7eb"}`, marginBottom:"0.75rem", overflow:"hidden" }}>
      {/* Card header */}
      <button onClick={() => setOpen(o=>!o)}
        style={{ width:"100%", padding:"0.75rem 1rem", background:"none", border:"none", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", textAlign:"left" }}>
        <div>
          <div style={{ fontWeight:800, color:"#111827", fontSize:"1rem" }}>{localFork.machine_ref}</div>
          {localFork.model && <div style={{ fontSize:"0.78rem", color:"#6b7280", marginTop:2 }}>{localFork.model}</div>}
          <WeeklyTracker forkliftId={localFork.id} refreshKey={rtRefreshKey} />
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
          <span style={{ fontSize:"0.78rem", fontWeight:800, color:statusColor, background:`${statusColor}15`, padding:"3px 10px", borderRadius:20 }}>{statusLabel}</span>
          <span style={{ fontSize:"1rem", color:"#9ca3af" }}>{open?"▲":"▼"}</span>
        </div>
      </button>

      {open && (
        <div style={{ padding:"0 1rem 1rem", borderTop:"1px solid #f3f4f6" }}>
          {/* Inspect Now — always visible, no day-of-week restriction */}
          <div style={{ marginTop:"0.75rem" }}>
            <a href={`/check/${localFork.id}`}
              style={{ display:"block", textAlign:"center", padding:"0.7rem", background:BRAND, color:"#fff", borderRadius:12, fontWeight:800, fontSize:"0.95rem", textDecoration:"none" }}>
              Inspect Now
            </a>
          </div>

          {/* Today's entry */}
          {todayEntry && (
            <div style={{ marginTop:"0.75rem" }}>
              <p style={{ margin:"0 0 0.25rem", fontSize:"0.82rem", fontWeight:700, color:"#374151" }}>Today's Inspection</p>
              <p style={{ margin:0, fontSize:"0.82rem", color:"#6b7280" }}>
                {todayEntry.operator_name}{todayEntry.pal_card_number ? ` · ${todayEntry.pal_card_number}` : ""} · {fmtTime(todayEntry.submitted_at)}
              </p>
              {hasFaults && (
                <div style={{ marginTop:"0.5rem" }}>
                  {faults.map((f,i) => (
                    <div key={i} style={{ fontSize:"0.8rem", color:"#b91c1c", marginBottom:"0.2rem" }}>
                      ⚠️ Item {f.item_number}: {f.defect_details || "Fault reported"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Thorough exam */}
          <ThoroughExamCard forklift={localFork} isAdmin={isAdmin} onUpload={() => setExamModal(true)} />

          {/* Supervisor sign-off — admin only, per completed day */}
          {isAdmin && (
            <div style={{ marginTop:"0.75rem" }}>
              <p style={{ margin:"0 0 0.25rem", fontSize:"0.8rem", fontWeight:700, color:"#374151" }}>Supervisor Sign-off</p>
              <WeeklyTracker forkliftId={localFork.id} refreshKey={rtRefreshKey} hideSquares onSelectDay={setSignoffDay} />
            </div>
          )}

          {/* Current PDF */}
          <div style={{ marginTop:"0.75rem" }}>
            <p style={{ margin:"0 0 0.25rem", fontSize:"0.8rem", fontWeight:700, color:"#374151" }}>This Week's Report</p>
            {currentPdfUrl
              ? <a href={currentPdfUrl} target="_blank" rel="noreferrer" style={{ fontSize:"0.82rem", color:BRAND, fontWeight:700 }}>Download PDF ↗</a>
              : <span style={{ fontSize:"0.8rem", color:"#9ca3af" }}>No report yet</span>
            }
          </div>

          {/* Reports history */}
          <ReportsPanel forkliftId={localFork.id} />

          {/* QR code */}
          {localFork.nfc_url && <QRPanel url={localFork.nfc_url} label={localFork.machine_ref} />}

          {/* Admin: archive */}
          {isAdmin && (
            <div style={{ marginTop:"0.75rem", borderTop:"1px solid #f3f4f6", paddingTop:"0.75rem" }}>
              <button onClick={() => onArchiveToggle(localFork.id, true)} style={smallBtn("#6b7280")}>
                Archive Machine
              </button>
            </div>
          )}
        </div>
      )}

      {examModal && (
        <ThoroughExamModal
          forklift={localFork}
          onClose={() => setExamModal(false)}
          onDone={updates => { setLocalFork(p => ({ ...p, ...updates })); setExamModal(false); }}
        />
      )}

      {signoffDay && (
        <SupervisorSignoffModal
          forklift={localFork}
          siteId={localFork.site_id}
          day={signoffDay}
          onClose={() => setSignoffDay(null)}
          onDone={() => setSignoffDay(null)}
        />
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function SiteDashboard({ siteId }) {
  const [site, setSite]           = useState(null);
  const [forklifts, setForklifts] = useState([]);
  const [archived, setArchived]   = useState([]);
  const [todayEntries, setTodayEntries] = useState({});
  const [pdfUrls, setPdfUrls]     = useState({});
  const [loading, setLoading]     = useState(true);
  const [isAdmin, setIsAdmin]     = useState(false);
  const [isMainAdmin, setIsMainAdmin] = useState(false);
  const [stats, setStats]         = useState({ total:0, done:0, faults:0 });
  const [addModal, setAddModal]   = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [rtRefreshKey, setRtRefreshKey] = useState(0);

  // ── Auth + initial load ──────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      // Auth check
      const { data:{ session } } = await supabase.auth.getSession();
      if (session) {
        const { data:profile } = await supabase.from("user_profiles").select("role, is_archived").eq("id", session.user.id).single();
        if (profile && !profile.is_archived) {
          setIsAdmin(true);
          if (profile.role === "main_admin") setIsMainAdmin(true);
        }
      } else {
        const bypass = localStorage.getItem("admin_bypass_token");
        if (bypass) { setIsAdmin(true); setIsMainAdmin(true); }
        else {
          const siteBypass = localStorage.getItem(`site_bypass_${siteId}`);
          if (siteBypass === "granted") setIsAdmin(true);
        }
      }
      await loadAll();
      setLoading(false);
    }
    init();
  }, [siteId]);

  async function loadAll() {
    await Promise.all([loadSite(), loadForklifts(), loadTodayData(), loadPdfData()]);
  }

  async function loadSite() {
    const { data } = await supabase.from("sites").select("*").eq("id", siteId).single();
    setSite(data);
  }

  async function loadForklifts() {
    const { data } = await supabase.from("forklifts").select("*")
      .eq("site_id", siteId).eq("active", true).order("created_at");
    const active   = (data||[]).filter(f => !f.is_archived);
    const arc      = (data||[]).filter(f => f.is_archived);
    setForklifts(active);
    setArchived(arc);
    setStats(p => ({ ...p, total: active.length }));
  }

  async function loadTodayData() {
    const today = todayStr();
    const { data } = await supabase.from("daily_inspection_entries")
      .select("*, defect_log(*)")
      .eq("site_id", siteId)
      .eq("inspection_date", today);
    const map = {};
    (data||[]).forEach(e => { map[e.forklift_id] = e; });
    setTodayEntries(map);
    const done   = Object.keys(map).length;
    const faults = Object.values(map).filter(e => e.daily_status === "fault").length;
    setStats(p => ({ ...p, done, faults }));
  }

  async function loadPdfData() {
    const weekComm = getWeekCommencing(new Date());
    const { data } = await supabase.from("weekly_inspection_sheets")
      .select("forklift_id, pdf_url")
      .eq("site_id", siteId)
      .eq("week_commencing", weekComm)
      .not("pdf_url","is",null);
    const map = {};
    (data||[]).forEach(s => { map[s.forklift_id] = s.pdf_url; });
    setPdfUrls(map);
  }

  function getWeekCommencing(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day + 6) % 7;
    d.setDate(d.getDate() - diff);
    return toLocalDateStr(d);
  }

  // ── Real-time subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    const ch1 = supabase.channel(`site-${siteId}-forklifts`)
      .on("postgres_changes", { event:"UPDATE", schema:"public", table:"forklifts" }, async payload => {
        if (payload.new?.site_id !== siteId) return;
        await loadForklifts();
      }).subscribe();

    const ch2 = supabase.channel(`site-${siteId}-inspections`)
      .on("postgres_changes", { event:"*", schema:"public", table:"daily_inspection_entries", filter:`site_id=eq.${siteId}` }, () => {
        loadTodayData();
        setRtRefreshKey(k => k + 1);
      }).subscribe();

    const ch3 = supabase.channel(`site-${siteId}-sheets`)
      .on("postgres_changes", { event:"UPDATE", schema:"public", table:"weekly_inspection_sheets", filter:`site_id=eq.${siteId}` }, () => {
        loadPdfData();
      }).subscribe();

    const interval = setInterval(loadAll, 10000);

    return () => {
      supabase.removeChannel(ch1);
      supabase.removeChannel(ch2);
      supabase.removeChannel(ch3);
      clearInterval(interval);
    };
  }, [siteId]);

  async function handleArchiveToggle(forkliftId, archive) {
    const token = getAuthToken();
    await supabase.from("forklifts").update({ is_archived: archive }).eq("id", forkliftId);
    await loadForklifts();
  }

  async function handleUnarchive(forkliftId) {
    await supabase.from("forklifts").update({ is_archived: false }).eq("id", forkliftId);
    await loadForklifts();
  }

  function getAuthToken() {
    return localStorage.getItem("admin_bypass_token") || "";
  }

  const progressPct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  const today = todayStr();

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", fontFamily:"system-ui, sans-serif", background:"#f3f4f6" }}>
      <p style={{ color:"#6b7280" }}>Loading dashboard…</p>
    </div>
  );

  return (
    <div style={{ fontFamily:"system-ui, -apple-system, sans-serif", minHeight:"100vh", background:"#f3f4f6" }}>
      {/* Header */}
      <div style={{ background: BRAND, padding:"1rem", color:"#fff" }}>
        <div style={{ maxWidth:800, margin:"0 auto", display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <img src="/logo.png" alt="" style={{ height:36 }} onError={e=>{ e.target.style.display="none"; }} />
          <div style={{ flex:1 }}>
            <h1 style={{ margin:0, fontSize:"1.2rem", fontWeight:800 }}>{site?.name || "Site Dashboard"}</h1>
            {site?.location && <p style={{ margin:0, fontSize:"0.82rem", opacity:0.85 }}>{site.location}{site.postcode ? ` · ${site.postcode}` : ""}</p>}
          </div>
          {isAdmin && (
            <button onClick={() => setAddModal(true)} style={{ padding:"0.55rem 1rem", background:"rgba(255,255,255,0.2)", color:"#fff", border:"2px solid rgba(255,255,255,0.5)", borderRadius:10, fontWeight:800, cursor:"pointer", fontSize:"0.9rem" }}>
              + Add Machine
            </button>
          )}
        </div>
      </div>

      <div style={{ maxWidth:800, margin:"0 auto", padding:"1rem" }}>
        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0.75rem", marginBottom:"1rem" }}>
          {[
            { label:"Total Machines", value:stats.total, color:"#374151" },
            { label:"Done Today", value:stats.done, color:"#15803d" },
            { label:"Faults Today", value:stats.faults, color: stats.faults > 0 ? BRAND : "#6b7280" },
          ].map(s => (
            <div key={s.label} style={{ background:"#fff", borderRadius:12, padding:"0.85rem", textAlign:"center", border:"1px solid #e5e7eb" }}>
              <div style={{ fontSize:"1.75rem", fontWeight:900, color:s.color }}>{s.value}</div>
              <div style={{ fontSize:"0.75rem", color:"#6b7280", marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ background:"#fff", borderRadius:12, padding:"0.85rem", marginBottom:"1rem", border:"1px solid #e5e7eb" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:"0.4rem" }}>
            <span style={{ fontSize:"0.82rem", fontWeight:700, color:"#374151" }}>Today's Progress</span>
            <span style={{ fontSize:"0.82rem", fontWeight:800, color: progressPct===100 ? "#15803d" : "#374151" }}>{progressPct}%</span>
          </div>
          <div style={{ height:8, background:"#f3f4f6", borderRadius:4, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${progressPct}%`, background: progressPct===100 ? "#15803d" : BRAND, transition:"width 0.3s", borderRadius:4 }} />
          </div>
        </div>

        {/* Site QR */}
        {site?.qr_code_url && (
          <div style={{ background:"#fff", borderRadius:12, padding:"0.85rem", marginBottom:"1rem", border:"1px solid #e5e7eb" }}>
            <p style={{ margin:"0 0 0.35rem", fontSize:"0.82rem", fontWeight:700, color:"#374151" }}>Site Dashboard QR</p>
            <QRPanel url={site.qr_code_url} label={site.name} />
          </div>
        )}

        {/* Machine cards */}
        {forklifts.length === 0 && (
          <div style={{ textAlign:"center", padding:"2rem", color:"#9ca3af", background:"#fff", borderRadius:12, border:"1px solid #e5e7eb" }}>
            <p style={{ fontSize:"1.5rem" }}>🏗️</p>
            <p>No machines registered yet.{isAdmin ? " Use + Add Machine to add one." : ""}</p>
          </div>
        )}
        {forklifts.map(f => (
          <ForkliftCard key={f.id} forklift={f} todayEntry={todayEntries[f.id]} currentPdfUrl={pdfUrls[f.id]}
            rtRefreshKey={rtRefreshKey} isAdmin={isAdmin}
            onArchiveToggle={handleArchiveToggle} />
        ))}

        {/* Archived */}
        {archived.length > 0 && (
          <div style={{ marginTop:"1rem" }}>
            <button onClick={() => setShowArchived(o=>!o)}
              style={{ width:"100%", padding:"0.65rem", background:"#f3f4f6", border:"1px solid #e5e7eb", borderRadius:10, fontSize:"0.85rem", fontWeight:700, color:"#6b7280", cursor:"pointer" }}>
              {showArchived ? "▲" : "▼"} Archived Machines ({archived.length})
            </button>
            {showArchived && archived.map(f => (
              <div key={f.id} style={{ background:"#fff", borderRadius:10, border:"1px solid #e5e7eb", padding:"0.75rem 1rem", marginTop:"0.5rem", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <p style={{ margin:0, fontWeight:700, color:"#6b7280" }}>{f.machine_ref}</p>
                  {f.model && <p style={{ margin:0, fontSize:"0.78rem", color:"#9ca3af" }}>{f.model}</p>}
                </div>
                {isAdmin && <button onClick={() => handleUnarchive(f.id)} style={smallBtn("#15803d")}>Restore</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {addModal && (
        <AddForkliftModal siteId={siteId} onClose={() => setAddModal(false)} onAdded={newFork => {
          setForklifts(p => [...p, newFork]);
          setStats(p => ({ ...p, total: p.total + 1 }));
          setAddModal(false);
        }} />
      )}
    </div>
  );
}

// ─── Shared UI helpers ─────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.5rem", width:"100%", maxWidth:420, maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
          <h3 style={{ margin:0, fontSize:"1rem", fontWeight:800, color:"#111827" }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:"1.3rem", color:"#6b7280", cursor:"pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function smallBtn(bg) {
  return { padding:"0.3rem 0.75rem", background:bg, color:"#fff", border:"none", borderRadius:8, fontSize:"0.78rem", fontWeight:700, cursor:"pointer" };
}
function btnStyle(bg) {
  return { display:"block", width:"100%", padding:"0.85rem", background:bg, color:"#fff", border:"none", borderRadius:12, fontWeight:800, fontSize:"1rem", cursor:"pointer", marginBottom:"0.5rem" };
}
const labelStyle = { display:"block", fontSize:"0.82rem", fontWeight:700, color:"#374151", marginBottom:"0.3rem" };
const inputStyle = { display:"block", width:"100%", boxSizing:"border-box", padding:"0.65rem 0.75rem", border:"1.5px solid #e5e7eb", borderRadius:10, fontSize:"0.95rem", marginBottom:"1rem" };

export async function getServerSideProps({ params }) {
  return { props: { siteId: params.siteId } };
}
