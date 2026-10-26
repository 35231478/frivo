"use client";

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { toast } from "@/components/ui/avisos";
import { usePermissoes } from "@/components/providers/permissoes-provider";

export const MOTIVO_MINIMO = 10;

/**
 * Saída pontual da trava de equipamento: "Concluir sem equipamento — justificar". Só para quem pode
 * concluir OS (o servidor exige o mesmo). O motivo é obrigatório e fica na OS e no histórico; com
 * `atividadeId`, a atividade que travou já é concluída junto.
 */
export function ConcluirSemEquipamento({ osId, atividadeId, onConcluido, className }: {
  osId: string; atividadeId?: string; onConcluido: (r: { status: string | null }) => void; className?: string;
}) {
  const { pode } = usePermissoes();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  if (!pode("ordens", "concluir")) return null;

  async function enviar() {
    const texto = motivo.trim();
    if (texto.length < MOTIVO_MINIMO) { setErro(`Explique o motivo (pelo menos ${MOTIVO_MINIMO} caracteres).`); return; }
    setEnviando(true); setErro("");
    try {
      const r = await fetch(`/api/ordens/${osId}/concluir-sem-equipamento`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: texto, ...(atividadeId && { atividadeId }) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível concluir sem equipamento."); return; }
      setAberto(false); setMotivo("");
      toast(atividadeId ? "Atividade concluída sem equipamento — motivo registrado no histórico." : "Conclusão sem equipamento autorizada — motivo registrado no histórico.");
      onConcluido({ status: d.status ?? null });
    } catch { setErro("Erro de conexão."); } finally { setEnviando(false); }
  }

  return (
    <>
      <button type="button" onClick={() => { setErro(""); setAberto(true); }} data-concluir-sem-equipamento
        className={className ?? "inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg px-3 py-2"}>
        <ShieldAlert className="w-4 h-4" /> Concluir sem equipamento — justificar
      </button>
      <Modal aberto={aberto} onFechar={() => setAberto(false)} titulo="Concluir sem equipamento">
        <div className="space-y-4" data-modal-sem-equipamento>
          <p className="text-sm text-ink-muted">
            Use só para exceções (o serviço não envolveu equipamento). O motivo fica gravado na OS e no histórico, com o seu nome e a hora.
            Equipamentos que já foram atendidos continuam exigindo o checklist completo.
          </p>
          <FormField label="Motivo" required hint={`Mínimo de ${MOTIVO_MINIMO} caracteres`}>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={500} aria-label="Motivo"
              placeholder="Ex.: visita de avaliação do local, sem intervenção em equipamento" />
          </FormField>
          {erro && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button type="button" loading={enviando} onClick={enviar} data-confirmar-sem-equipamento>Concluir sem equipamento</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
