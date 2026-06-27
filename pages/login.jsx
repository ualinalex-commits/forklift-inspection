import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

const BRAND = "#d02a35";

export default function Login() {
  const router = useRouter();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [newPw1, setNewPw1]     = useState("");
  const [newPw2, setNewPw2]     = useState("");
  const [step, setStep]         = useState("login"); // 'login' | 'change_pw'
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");

  useEffect(() => {
    async function check() {
      // If admin bypass token in localStorage, redirect to admin
      const bypass = localStorage.getItem("admin_bypass_token");
      if (bypass) { router.replace("/admin"); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) await redirectByRole(session);
      setLoading(false);
    }
    check();
  }, []);

  async function redirectByRole(session) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role, site_id, must_change_password, is_archived")
      .eq("id", session.user.id)
      .single();

    if (!profile || profile.is_archived) {
      await supabase.auth.signOut();
      setError("Your account has been deactivated. Contact your administrator.");
      return;
    }
    if (profile.must_change_password) { setStep("change_pw"); return; }
    if (profile.role === "main_admin") { router.replace("/admin"); return; }
    if (profile.role === "site_admin") { router.replace(`/site/${profile.site_id}`); return; }
    router.replace("/");
  }

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setLoading(false); return; }
    await redirectByRole(data.session);
    setLoading(false);
  }

  async function handleChangePw(e) {
    e.preventDefault();
    setError("");
    if (newPw1.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (newPw1 !== newPw2)  { setError("Passwords do not match."); return; }
    setLoading(true);

    const { error: pwErr } = await supabase.auth.updateUser({ password: newPw1 });
    if (pwErr) { setError(pwErr.message); setLoading(false); return; }

    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await supabase.from("user_profiles")
        .update({ must_change_password: false })
        .eq("id", session.user.id);
      await redirectByRole(session);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={{ color: "#6b7280", fontSize: "0.95rem" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img src="/logo.png" alt="Logo" style={styles.logo} onError={e => { e.target.style.display = "none"; }} />
        <h1 style={styles.title}>ProLift Inspection</h1>

        {step === "login" ? (
          <>
            <p style={styles.sub}>Admin Login</p>
            <form onSubmit={handleLogin}>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
              <label style={styles.label}>Password</label>
              <input style={styles.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
              {error && <p style={styles.err}>{error}</p>}
              <button style={styles.btn} type="submit" disabled={loading}>
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>
          </>
        ) : (
          <>
            <p style={{ ...styles.sub, color: BRAND }}>Set your new password</p>
            <p style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: "1rem" }}>
              You must set a new password before continuing.
            </p>
            <form onSubmit={handleChangePw}>
              <label style={styles.label}>New Password</label>
              <input style={styles.input} type="password" value={newPw1} onChange={e => setNewPw1(e.target.value)} required autoComplete="new-password" />
              <label style={styles.label}>Confirm Password</label>
              <input style={styles.input} type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)} required autoComplete="new-password" />
              {error && <p style={styles.err}>{error}</p>}
              <button style={styles.btn} type="submit" disabled={loading}>
                {loading ? "Saving…" : "Set Password & Continue"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  page:  { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f3f4f6", fontFamily: "system-ui, -apple-system, sans-serif" },
  card:  { background: "#fff", borderRadius: 16, padding: "2rem", width: "100%", maxWidth: 380, boxShadow: "0 4px 24px rgba(0,0,0,0.10)" },
  logo:  { display: "block", height: 40, marginBottom: "0.75rem" },
  title: { margin: "0 0 0.25rem", fontSize: "1.3rem", fontWeight: 800, color: "#111827" },
  sub:   { margin: "0 0 1.25rem", fontSize: "0.9rem", color: "#6b7280" },
  label: { display: "block", fontSize: "0.8rem", fontWeight: 700, color: "#374151", marginBottom: "0.25rem" },
  input: { display: "block", width: "100%", boxSizing: "border-box", padding: "0.7rem 0.75rem", border: "1.5px solid #e5e7eb", borderRadius: 10, fontSize: "1rem", marginBottom: "1rem", outline: "none" },
  btn:   { display: "block", width: "100%", padding: "0.85rem", background: BRAND, color: "#fff", border: "none", borderRadius: 12, fontSize: "1rem", fontWeight: 800, cursor: "pointer", marginTop: "0.5rem" },
  err:   { color: "#b91c1c", fontSize: "0.85rem", marginBottom: "0.75rem", background: "#fef2f2", padding: "0.5rem 0.75rem", borderRadius: 8 },
};
