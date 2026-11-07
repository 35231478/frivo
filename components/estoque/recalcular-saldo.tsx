"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/avisos";
import { formatarQtd } from "@/lib/estoque/regras";

/**
 * "Recalcular pelo histórico": acerta o saldo em cache pela soma do razão (Estoque › gerenciar).
 * Aparece no extrato quando o cache diverge; o resultado diz o que mudou.
 */
export function RecalcularSaldo({ produtoId, unidade }: { produtoId: string; unidade: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  async function recalcular() {
    setOcupado(true); setResultado(null);
    try {
      const r = await fetch(`/api/estoque/${produtoId}/recalcular`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setResultado(j.erro ?? "Não foi possível recalcular."); return; }
      const texto = j.divergia ? `Saldo corrigido: ${formatarQtd(j.saldoCache)} → ${formatarQtd(j.somaRazao)} ${unidade}.` : `Conferido: o saldo já batia (${formatarQtd(j.somaRazao)} ${unidade}).`;
      setResultado(texto);
      toast(texto, "sucesso"); // o aviso de divergência some quando a tela recarrega: o resultado fica no toast
      router.refresh();
    } catch { setResultado("Sem conexão. Tente de novo."); } finally { setOcupado(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="secondary" onClick={recalcular} loading={ocupado} data-recalcular={produtoId}><RefreshCw className="w-3.5 h-3.5" /> Recalcular pelo histórico</Button>
      {resultado && <span className="text-xs text-ink" data-recalculo-resultado>{resultado}</span>}
    </span>
  );
}
