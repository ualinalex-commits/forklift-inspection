import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabase";

const BRAND = "#d02a35";

// ─── Shared modal / field helpers ─────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:"#fff", borderRadius:16, padding:"1.5rem", width:"100%", maxWidth:440, maxHeight:"90vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
          <h3 style={{ margin:0, fontSize:"1rem", fontWeight:800 }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", fontSize:"1.3rem", color:"#6b7280", cursor:"pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const lbl  = { display:"block", fontSize:"0.82rem", fontWeight:700, color:"#374151", marginBottom:"0.3rem" };
const inp  = { display:"block", width:"100%", boxSizing:"border-box", padding:"0.65rem 0.75rem", border:"1.5px solid #e5e7eb", borderRadius:10, fontSize:"0.95rem", marginBottom:"1rem" };
const pBtn = (bg) => ({ display:"block", width:"100%", padding:"0.85rem", background:bg, color:"#fff", border:"none", borderRadius:12, fontWeight:800, fontSize:"1rem", cursor:"pointer", marginBottom:"0.5rem" });
const sBtn = (bg) => ({ padding:"0.35rem 0.85rem", background:bg, color:"#fff", border:"none", borderRadius:8, fontSize:"0.78rem", fontWeight:700, cursor:"pointer" });

// ─── AddSiteModal ─────────────────────────────────────────────────────────────
function AddSiteModal({ token, onClose, onAdded }) {
  const [name, setName]       = useState("");
  const [loc,  setLoc]        = useState("");
  const [post, setPost]       = useState("");
  const [mgr,  setMgr]        = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  async function submit(e) {
    e.preventDefault();
    setLoading(true); setError("");
    const res = await fetch("/api/admin/add-site", {
      method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify({ name, location:loc, postcode:post, managerName:mgr }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); setLoading(false); return; }
    onAdded(data.site);
  }

  return (
    <Modal title="Add Site" onClose={onClose}>
      <form onSubmit={submit}>
        <label style={lbl}>Site Name *</label>
        <input style={inp} value={name} onChange={e=>setName(e.target.value)} required placeholder="e.g. Manchester Warehouse" />
        <label style={lbl}>Location</label>
        <input style={inp} value={loc} onChange={e=>setLoc(e.target.value)} placeholder="Town / City" />
        <label style={lbl}>Postcode</label>
        <input style={inp} value={post} onChange={e=>setPost(e.target.value)} placeholder="M1 1AE" />
        <label style={lbl}>Manager Name</label>
        <input style={inp} value={mgr} onChange={e=>setMgr(e.target.value)} />
        {error && <p style={{ color:BRAND, fontSize:"0.85rem" }}>{error}</p>}
        <button style={pBtn(BRAND)} type="submit" disabled={loading||!name.trim()}>{loading?"Adding…":"Add Site"}</button>
      </form>
    </Modal>
  );
}

// ─── CreateAdminModal ─────────────────────────────────────────────────────────
function CreateAdminModal({ token, sites, onClose, onAdded }) {
  const [name, setName]     = useState("");
  const [email, setEmail]   = useState("");
  const [pw, setPw]         = useState("");
  const [siteId, setSiteId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  async function submit(e) {
    e.preventDefault();
    if (pw.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true); setError("");
    const res = await fetch("/api/admin/create-site-admin", {
      method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify({ name, email, password:pw, siteId }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Failed"); setLoading(false); return; }
    onAdded(data.siteAdmin);
  }

  return (
    <Modal title="Create Site Admin" onClose={onClose}>
      <form onSubmit={submit}>
        <label style={lbl}>Full Name *</label>
        <input style={inp} value={name} onChange={e=>setName(e.target.value)} required />
        <label style={lbl}>Email *</label>
        <input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <label style={lbl}>Temporary Password *</label>
        <input style={inp} type="password" value={pw} onChange={e=>setPw(e.target.value)} required minLength={8} />
        <label style={lbl}>Assign to Site *</label>
        <select style={inp} value={siteId} onChange={e=>setSiteId(e.target.value)} required>
          <option value="">— Select site —</option>
          {sites.filter(s=>!s.is_archived).map(s=>(
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {error && <p style={{ color:BRAND, fontSize:"0.85rem" }}>{error}</p>}
        <button style={pBtn(BRAND)} type="submit" disabled={loading||!name.trim()||!siteId}>{loading?"Creating…":"Create Admin"}</button>
      </form>
    </Modal>
  );
}

// ─── Main admin page ──────────────────────────────────────────────────────────
export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading]   = useState(true);
  const [token, setToken]       = useState("");
  const [sites, setSites]       = useState([]);
  const [admins, setAdmins]     = useState([]);
  const [showAddSite, setShowAddSite]     = useState(false);
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [showArchivedSites, setShowArchivedSites]   = useState(false);
  const [showArchivedAdmins, setShowArchivedAdmins] = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    async function init() {
      // Try bypass token first
      const bypass = localStorage.getItem("admin_bypass_token");
      if (bypass) {
        const ok = await loadData(bypass);
        if (ok) { setToken(bypass); setLoading(false); return; }
      }

      // Try Supabase session
      const { data:{ session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/login"); return; }

      const { data:profile } = await supabase.from("user_profiles")
        .select("role, site_id, is_archived")
        .eq("id", session.user.id)
        .single();

      if (!profile || profile.is_archived) { await supabase.auth.signOut(); router.replace("/login"); return; }
      if (profile.role === "site_admin")    { router.replace(`/site/${profile.site_id}`); return; }
      if (profile.role !== "main_admin")    { router.replace("/login"); return; }

      const jwt = session.access_token;
      await loadData(jwt);
      setToken(jwt);
      setLoading(false);
    }
    init();
  }, []);

  async function loadData(tok) {
    try {
      const res = await fetch("/api/admin/data", { headers:{ Authorization:`Bearer ${tok}` } });
      if (!res.ok) return false;
      const { sites:s, siteAdmins:a } = await res.json();
      setSites(s || []);
      setAdmins(a || []);
      return true;
    } catch { return false; }
  }

  async function handleArchiveSite(siteId, archive) {
    await fetch("/api/admin/archive-site", {
      method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify({ siteId, archive }),
    });
    setSites(p => p.map(s => s.id === siteId ? { ...s, is_archived:archive } : s));
  }

  async function handleArchiveAdmin(adminId, archive) {
    await fetch("/api/admin/archive-site-admin", {
      method:"POST",
      headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
      body: JSON.stringify({ adminId, archive }),
    });
    setAdmins(p => p.map(a => a.id === adminId ? { ...a, is_archived:archive } : a));
  }

  async function handleSignOut() {
    localStorage.removeItem("admin_bypass_token");
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const activeSites  = sites.filter(s => !s.is_archived);
  const archivedSites = sites.filter(s => s.is_archived);
  const activeAdmins = admins.filter(a => !a.is_archived);
  const archivedAdmins = admins.filter(a => a.is_archived);

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", fontFamily:"system-ui, sans-serif", background:"#f3f4f6" }}>
      <p style={{ color:"#6b7280" }}>Loading…</p>
    </div>
  );

  return (
    <div style={{ fontFamily:"system-ui, -apple-system, sans-serif", minHeight:"100vh", background:"#f3f4f6" }}>
      {/* Header */}
      <div style={{ background:BRAND, padding:"1rem", color:"#fff" }}>
        <div style={{ maxWidth:900, margin:"0 auto", display:"flex", alignItems:"center", gap:"0.75rem" }}>
          <img src="/logo.png" alt="" style={{ height:36 }} onError={e=>{ e.target.style.display="none"; }} />
          <div style={{ flex:1 }}>
            <h1 style={{ margin:0, fontSize:"1.2rem", fontWeight:800 }}>Admin Dashboard</h1>
            <p style={{ margin:0, fontSize:"0.8rem", opacity:0.85 }}>ProLift Lifting Software</p>
          </div>
          <button onClick={handleSignOut} style={{ padding:"0.45rem 0.9rem", background:"rgba(255,255,255,0.15)", color:"#fff", border:"1px solid rgba(255,255,255,0.4)", borderRadius:8, fontSize:"0.82rem", cursor:"pointer" }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:"0 auto", padding:"1rem" }}>
        {/* Stats */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0.75rem", marginBottom:"1.25rem" }}>
          {[
            { label:"Active Sites", value:activeSites.length },
            { label:"Active Admins", value:activeAdmins.length },
          ].map(s => (
            <div key={s.label} style={{ background:"#fff", borderRadius:12, padding:"1rem", textAlign:"center", border:"1px solid #e5e7eb" }}>
              <div style={{ fontSize:"2rem", fontWeight:900, color:BRAND }}>{s.value}</div>
              <div style={{ fontSize:"0.8rem", color:"#6b7280" }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Sites ───────────────────────────────────────────────────────── */}
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", marginBottom:"1.25rem", overflow:"hidden" }}>
          <div style={{ background:BRAND, padding:"0.65rem 1rem", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <h2 style={{ margin:0, fontSize:"0.95rem", fontWeight:800, color:"#fff" }}>Sites</h2>
            <button onClick={() => setShowAddSite(true)} style={{ ...sBtn("#fff"), color:BRAND }}>+ Add Site</button>
          </div>

          {activeSites.length === 0 && (
            <p style={{ padding:"1rem", color:"#9ca3af", fontSize:"0.9rem" }}>No active sites. Add one above.</p>
          )}

          {activeSites.map(site => (
            <div key={site.id} style={{ padding:"0.85rem 1rem", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <p style={{ margin:0, fontWeight:700, color:"#111827" }}>{site.name}</p>
                {site.location && <p style={{ margin:0, fontSize:"0.8rem", color:"#6b7280" }}>{site.location}{site.postcode ? ` · ${site.postcode}` : ""}</p>}
                {site.manager_name && <p style={{ margin:0, fontSize:"0.78rem", color:"#9ca3af" }}>Manager: {site.manager_name}</p>}
              </div>
              <div style={{ display:"flex", gap:"0.5rem", alignItems:"center" }}>
                <a href={`/site/${site.id}`} style={sBtn("#1d4ed8")}>View Dashboard</a>
                <button onClick={() => handleArchiveSite(site.id, true)} style={sBtn("#6b7280")}>Archive</button>
              </div>
            </div>
          ))}

          {archivedSites.length > 0 && (
            <>
              <button onClick={() => setShowArchivedSites(o=>!o)}
                style={{ width:"100%", padding:"0.6rem", background:"#f9fafb", border:"none", borderTop:"1px solid #e5e7eb", fontSize:"0.82rem", color:"#6b7280", cursor:"pointer", fontWeight:700 }}>
                {showArchivedSites ? "▲" : "▼"} Archived Sites ({archivedSites.length})
              </button>
              {showArchivedSites && archivedSites.map(site => (
                <div key={site.id} style={{ padding:"0.75rem 1rem", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center", background:"#f9fafb" }}>
                  <p style={{ margin:0, color:"#9ca3af", fontWeight:700 }}>{site.name}</p>
                  <button onClick={() => handleArchiveSite(site.id, false)} style={sBtn("#15803d")}>Restore</button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* ── Site Admins ──────────────────────────────────────────────────── */}
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #e5e7eb", overflow:"hidden" }}>
          <div style={{ background:"#1e2a47", padding:"0.65rem 1rem", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <h2 style={{ margin:0, fontSize:"0.95rem", fontWeight:800, color:"#fff" }}>Site Admins</h2>
            <button onClick={() => setShowCreateAdmin(true)} style={{ ...sBtn("#fff"), color:"#1e2a47" }}>+ Create Admin</button>
          </div>

          {activeAdmins.length === 0 && (
            <p style={{ padding:"1rem", color:"#9ca3af", fontSize:"0.9rem" }}>No site admins yet.</p>
          )}

          {activeAdmins.map(admin => (
            <div key={admin.id} style={{ padding:"0.85rem 1rem", borderBottom:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:"0.5rem" }}>
                  <p style={{ margin:0, fontWeight:700, color:"#111827" }}>{admin.name}</p>
                  {admin.must_change_password && (
                    <span style={{ fontSize:"0.7rem", background:"#fef3c7", color:"#92400e", padding:"1px 7px", borderRadius:20, fontWeight:700 }}>Must change PW</span>
                  )}
                </div>
                <p style={{ margin:0, fontSize:"0.8rem", color:"#6b7280" }}>{admin.email}</p>
                {admin.site_name && <p style={{ margin:0, fontSize:"0.78rem", color:"#9ca3af" }}>Site: {admin.site_name}</p>}
              </div>
              <button onClick={() => handleArchiveAdmin(admin.id, true)} style={sBtn("#6b7280")}>Archive</button>
            </div>
          ))}

          {archivedAdmins.length > 0 && (
            <>
              <button onClick={() => setShowArchivedAdmins(o=>!o)}
                style={{ width:"100%", padding:"0.6rem", background:"#f9fafb", border:"none", borderTop:"1px solid #e5e7eb", fontSize:"0.82rem", color:"#6b7280", cursor:"pointer", fontWeight:700 }}>
                {showArchivedAdmins ? "▲" : "▼"} Archived Admins ({archivedAdmins.length})
              </button>
              {showArchivedAdmins && archivedAdmins.map(admin => (
                <div key={admin.id} style={{ padding:"0.75rem 1rem", borderTop:"1px solid #f3f4f6", display:"flex", justifyContent:"space-between", alignItems:"center", background:"#f9fafb" }}>
                  <div>
                    <p style={{ margin:0, color:"#9ca3af", fontWeight:700 }}>{admin.name}</p>
                    <p style={{ margin:0, fontSize:"0.78rem", color:"#9ca3af" }}>{admin.email}</p>
                  </div>
                  <button onClick={() => handleArchiveAdmin(admin.id, false)} style={sBtn("#15803d")}>Restore</button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {showAddSite && (
        <AddSiteModal token={token} onClose={() => setShowAddSite(false)} onAdded={site => {
          setSites(p => [...p, site]);
          setShowAddSite(false);
        }} />
      )}

      {showCreateAdmin && (
        <CreateAdminModal token={token} sites={sites} onClose={() => setShowCreateAdmin(false)} onAdded={admin => {
          setAdmins(p => [...p, admin]);
          setShowCreateAdmin(false);
        }} />
      )}
    </div>
  );
}
