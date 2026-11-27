"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";

interface Modelo { nome: string; exigeEquipamento: boolean }

/**
 * "Usar modelos sugeridos": os tipos de OS de climatização que faltam na empresa, num clique.
 * Só aparece para quem grava tipos de OS e só com a lista VAZIA (empresa sem nenhum tipo de OS: quem já
 * montou os seus não é incomodado). Nunca altera os existentes.
 */
export function ModelosTiposOs({ onCriados }: { onCriados: () => void }) {
  const { pode } = usePermissoes();
  const podeGravar = pode("configuracoes", "gerenciar");
  const [faltam, setFaltam] = useState<Modelo[] | null>(null);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (!podeGravar) return;
    fetch("/api/tipos-os/modelos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setFaltam(d && d.total === 0 ? d.faltando ?? [] : [])).catch(() => setFaltam([]));
  }, [podeGravar]);

  if (!podeGravar || !faltam?.length) return null;

  async function usar() {
    setCriando(true);
    try {
      const r = await fetch("/api/tipos-os/modelos", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível criar os modelos.", "erro"); return; }
      toast(d.criados === 1 ? "1 tipo de OS criado." : `${d.criados} tipos de OS criados.`);
      setFaltam([]);
      onCriados();
    } catch { toast("Erro de conexão. Tente novamente.", "erro"); } finally { setCriando(false); }
  }

  return (
    <div className="rounded-card border border-acento/25 bg-acento-claro/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3" data-modelos-tipos-os>
      <div className="flex-1 min-w-0 text-sm">
        <p className="font-semibold text-ink flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-acento shrink-0" aria-hidden /> Modelos sugeridos de climatização</p>
        <p className="text-ink-muted mt-0.5">
          {faltam.map((m) => m.nome).join(", ")}. PMOC e Manutenção Preventiva exigem equipamento para concluir; os demais, não. Dá para editar depois.
        </p>
      </div>
      <Button type="button" onClick={usar} loading={criando} className="shrink-0" data-usar-modelos>Usar modelos sugeridos</Button>
    </div>
  );
}
