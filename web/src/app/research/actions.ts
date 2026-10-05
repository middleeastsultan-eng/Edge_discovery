"use server";

import { revalidatePath } from "next/cache";
import { supabase } from "@/lib/supabase";

export async function updateComputeSettings(formData: FormData) {
  const maxWorkers = Math.max(0, Math.min(16, Number(formData.get("max_workers")) || 0));
  const paused = formData.get("paused") === "true";

  const { error } = await supabase
    .from("local_agent_settings")
    .upsert({ id: 1, max_workers: maxWorkers, paused, updated_at: new Date().toISOString() });

  if (error) {
    throw new Error(`Failed to update compute settings: ${error.message}`);
  }

  revalidatePath("/research");
}
