"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/** "Criar cópia": duplica como Rascunho (sem a ART) e abre a cópia no editor. Exige pmoc.criar. */
export function PmocCopiarBotao({ id, variante = "icone" }: { id: string; variante?: "icone" | "botao" }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const [carregando, setCarregando] = useState(false);
  if (!pode("pmoc", "criar")) return null;

  async function copiar() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/pmocs/${id}/copia`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { alert(d.erro ?? "Não foi possível copiar o PMOC."); return; }
      router.push(`/pmoc/${d.id}?copia=1`);
    } catch { alert("Erro de conexão."); } finally { setCarregando(false); }
  }

  const Icone = carregando ? Loader2 : Copy;
  return variante === "icone" ? (
    <button type="button" title="Criar cópia" aria-label="Criar cópia" onClick={copiar} disabled={carregando}
      className="p-1.5 rounded-md text-ink-muted hover:text-primary-600 hover:bg-surface-alt disabled:opacity-50">
      <Icone className={carregando ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
    </button>
  ) : (
    <button type="button" onClick={copiar} disabled={carregando}
      className="inline-flex items-center gap-1.5 text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-ink hover:bg-surface-alt disabled:opacity-50">
      <Icone className={carregando ? "w-4 h-4 animate-spin" : "w-4 h-4"} /> Criar cópia
    </button>
  );
}
