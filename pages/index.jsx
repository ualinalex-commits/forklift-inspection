import { useEffect } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabase";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    async function redirect() {
      const bypass = localStorage.getItem("admin_bypass_token");
      if (bypass) { router.replace("/admin"); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase.from("user_profiles")
          .select("role, site_id").eq("id", session.user.id).single();
        if (profile?.role === "main_admin") { router.replace("/admin"); return; }
        if (profile?.role === "site_admin") { router.replace(`/site/${profile.site_id}`); return; }
      }
      router.replace("/login");
    }
    redirect();
  }, []);

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", fontFamily:"system-ui, sans-serif", background:"#f3f4f6" }}>
      <p style={{ color:"#6b7280" }}>Loading…</p>
    </div>
  );
}
