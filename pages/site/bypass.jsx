import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function SiteBypass() {
  const router = useRouter();
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    const { token, site } = router.query;
    if (!token || !site) return;
    fetch("/api/site/verify-bypass", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, siteId: site }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.valid) {
          localStorage.setItem(`site_bypass_${site}`, "granted");
          router.replace(`/site/${site}`);
        } else {
          setStatus("invalid");
        }
      })
      .catch(() => setStatus("invalid"));
  }, [router.query]);

  if (status === "invalid") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: "2rem" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🚫</div>
          <h2 style={{ color: "#b91c1c" }}>Invalid Link</h2>
          <p style={{ color: "#6b7280" }}>This bypass link is not valid.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ textAlign: "center", color: "#6b7280" }}>Verifying link…</div>
    </div>
  );
}
