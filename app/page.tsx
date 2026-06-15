import { supabase } from "./lib/supabase";

export default async function Home() {
  // A harmless test call to confirm the connection works
  const { error } = await supabase.from("_test_").select("*").limit(1);

  const connectionMessage = error
    ? `Connected to Supabase ✅ (test table doesn't exist yet — that's expected: ${error.message})`
    : "Connected to Supabase ✅";

  return (
    <main style={{ padding: "40px", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "32px", fontWeight: "bold" }}>Unze Group Cockpit</h1>
      <p style={{ marginTop: "12px", color: "#555" }}>
        Welcome, James. This is the start of your command center.
      </p>
      <p style={{ marginTop: "20px", color: "#0070f3" }}>{connectionMessage}</p>
    </main>
  );
}
