import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { PmocEditor } from "@/components/pmoc/pmoc-editor";

export const metadata: Metadata = { title: "Novo PMOC" };

export default async function NovoPmocPage() {
  const session = await auth();
  if (!pode(session?.user?.permissoes, "pmoc", "criar", session?.user?.role)) redirect("/pmoc");
  return <div className="max-w-5xl mx-auto"><PmocEditor /></div>;
}
