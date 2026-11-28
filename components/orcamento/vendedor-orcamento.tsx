"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, UserRound } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/avisos";
import { MOTIVO_TROCA_MIN } from "@/lib/comissoes/regras";

/**
 * COM-1 — o VENDEDOR do orçamento: nasce = quem criou e fica TRAVADO. Só quem tem Orçamentos › "Trocar vendedor"
 * vê o "Trocar" (o servidor confere de novo), escolhe a pessoa e informa o motivo, que vai para a trilha.
 */
export function VendedorDoOrcamento({ orcamentoId, vendedor, podeTrocar, opcoes }: {
  orcamentoId: string;
  vendedor: { id: string; nome: string } | null;
  podeTrocar: boolean;
  opcoes: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState("");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const pronto = !!novo && novo !== vendedor?.id && motivo.trim().length >= MOTIVO_TROCA_MIN;

  async function trocar() {
    setSalvando(true); setErro(null);
    try {
      const res = await fetch(`/api/orcamentos/${orcamentoId}/vendedor`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vendedorId: novo, motivo: motivo.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível trocar o vendedor."); return; }
      toast(`Vendedor trocado para ${d.vendedor?.nome ?? "a pessoa escolhida"}.`);
      setAberto(false); setNovo(""); setMotivo("");
      router.refresh();
    } catch { setErro("Erro de conexão: nada foi trocado."); } finally { setSalvando(false); }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-vendedor-orcamento>
      <UserRound className="w-4 h-4 text-ink-muted shrink-0" />
      <span className="text-ink-muted">Vendedor:</span>
      <span className="font-medium text-ink" data-vendedor-nome>{vendedor?.nome ?? "Sem vendedor"}</span>
      <Lock className="w-3.5 h-3.5 text-ink-muted" aria-label="Travado" />
      {podeTrocar && (
        <button type="button" onClick={() => setAberto(true)} data-trocar-vendedor
          className="min-h-[44px] sm:min-h-0 px-2 text-primary-700 font-medium hover:underline">
          Trocar
        </button>
      )}
      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo="Trocar vendedor" tamanho="sm">
        <div className="space-y-4">
          <FormField label="Novo vendedor" required>
            <Select value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Escolha a pessoa" data-novo-vendedor>
              {opcoes.filter((o) => o.id !== vendedor?.id).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </Select>
          </FormField>
          <FormField label="Motivo" required hint="Fica na linha do tempo do orçamento.">
            <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ex.: o cliente passou para a carteira da Paula" data-motivo-vendedor />
          </FormField>
          {erro && <p role="alert" className="text-sm text-atrasado-texto">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="button" onClick={trocar} disabled={!pronto} loading={salvando} data-confirmar-vendedor>Trocar vendedor</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
