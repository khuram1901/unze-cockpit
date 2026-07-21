"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// HODs and Members land here after login — send them to /welcome
// (which is role-aware and shows their personalised homepage).
// Admin / CEO / Executive go directly to /home (set in AuthWrapper post-login).
export default function MyDashboardRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/welcome"); }, [router]);
  return null;
}
