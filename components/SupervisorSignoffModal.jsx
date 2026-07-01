import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

const BRAND = "#d02a35";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// One Supervisor Name/Sign/Date per forklift per week (matches the single
// supervisor row on page 3 of the PDF — not one per day).
export default function SupervisorSignoffModal({ forklift, siteId, sheetId, supervisorName, onClose, onDone }) {
  const [name, setName] = useState(supervisorName || "");
  const [signDate, setSignDate] = useState(todayStr());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef(null);
  const sigPadRef = useRef(null);

  useEffect(() => {
    let raf = requestAnimationFrame(() => {
      if (!canvasRef.current) return;
      import("signature_pad").then(({ default: SignaturePad }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = canvas.offsetWidth || 320;
        canvas.height = canvas.offsetHeight || 160;
        sigPadRef.current = new SignaturePad(canvas, { backgroundColor: "rgb(255,255,255)", penColor: "#111827" });
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
      // The weekly sheet may not exist yet if no inspections have been logged
      // this week — create it so the sign-off has somewhere to land.
      let resolvedSheetId = sheetId;
      if (!resolvedSheetId) {
        const { data: newSheetId, error: sheetErr } = await supabase.rpc("get_or_create_weekly_sheet", {
          p_forklift_id: forklift.id,
          p_site_id: siteId,
          p_machine_ref: forklift.machine_ref,
          p_date: todayStr(),
        });
        if (sheetErr) throw new Error(sheetErr.message);
        resolvedSheetId = newSheetId;
      }

      const sigDataUrl = sigPadRef.current.toDataURL("image/png");
      const sigBase64  = sigDataUrl.split(",")[1];
      const sigBinary  = atob(sigBase64);
      const sigBytes   = new Uint8Array(sigBinary.length);
      for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);
      const sigBlob = new Blob([sigBytes], { type: "image/png" });
      const sigPath = `${siteId}/${forklift.id}/${resolvedSheetId}-supervisor.png`;
      const { error: upErr } = await supabase.storage.from("signatures").upload(sigPath, sigBlob, { upsert: true, contentType: "image/png" });
      if (upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabase.storage.from("signatures").getPublicUrl(sigPath);

      const { error: dbErr } = await supabase.from("weekly_inspection_sheets").update({
        supervisor_name: name.trim(),
        supervisor_signature_url: publicUrl,
        supervisor_sign_date: signDate,
      }).eq("id", resolvedSheetId);
      if (dbErr) throw new Error(dbErr.message);

      // Regenerate the PDF so the sign-off appears on page 3
      fetch("/api/trigger-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forklift_id: forklift.id, sheet_id: resolvedSheetId }),
      }).catch(() => {});

      onDone();
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800, color: "#111827" }}>
            Supervisor Sign-off {forklift?.machine_ref ? `— ${forklift.machine_ref}` : ""}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.3rem", color: "#6b7280", cursor: "pointer" }}>✕</button>
        </div>
        <form onSubmit={handleSave}>
          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.3rem" }}>Supervisor Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "0.65rem 0.75rem", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: "0.95rem", marginBottom: "1rem" }}
            placeholder="Full name" required />
          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.3rem" }}>Date *</label>
          <input type="date" value={signDate} onChange={e => setSignDate(e.target.value)}
            style={{ display: "block", width: "100%", boxSizing: "border-box", padding: "0.65rem 0.75rem", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: "0.95rem", marginBottom: "1rem" }}
            required />
          <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#374151", marginBottom: "0.3rem" }}>Signature *</label>
          <div style={{ border: "2px solid #e5e7eb", borderRadius: 10, overflow: "hidden", touchAction: "none", marginBottom: "0.5rem" }}>
            <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: 140, touchAction: "none" }} />
          </div>
          <button type="button" onClick={() => sigPadRef.current?.clear()}
            style={{ padding: "0.3rem 0.75rem", background: "#6b7280", color: "#fff", border: "none", borderRadius: 8, fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", marginBottom: "1rem" }}>
            Clear
          </button>
          {error && <p style={{ color: BRAND, fontSize: "0.85rem" }}>{error}</p>}
          <button type="submit" disabled={loading}
            style={{ display: "block", width: "100%", padding: "0.85rem", background: BRAND, color: "#fff", border: "none", borderRadius: 12, fontWeight: 800, fontSize: "1rem", cursor: "pointer" }}>
            {loading ? "Saving…" : "Save Sign-off"}
          </button>
        </form>
      </div>
    </div>
  );
}
