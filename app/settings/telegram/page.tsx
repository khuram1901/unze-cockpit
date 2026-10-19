"use client";
// Telegram integration removed — redirect to WhatsApp settings.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function TelegramSettingsPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings/whatsapp"); }, [router]);
  return null;
}
