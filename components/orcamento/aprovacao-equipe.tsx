"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/avisos";
import { CANAIS_APROVACAO, ROTULO_CANAL, type CanalAprovacao } from "@/lib/orcamentos/aprovacao-equipe";

const ROTULO_OPCAO: Record<CanalAprovacao, string> = { TELEFONE: "Telefone", WHATSAPP: "WhatsApp", EMAIL: "E-mail", PRESENCIAL: "Pessoalmente", OUTRO: "Outro" };

/**
 * "Cliente aprovou" (o espelho do "Cliente recusou"): o cliente aprovou por fora do link e a equipe
 * registra quem aprovou, por onde e uma observação. Sem assinatura: o documento mostra que a
 * aprovação foi registrada pela equipe.
 */
export function BotaoClienteAprovou({ orcamentoId }: { orcamentoId: string }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [canal, setCanal] = useState<CanalAprovacao | "">("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function registrar() {
    setErro("");
    if (nome.trim().length < 2) return setErro("Informe quem aprovou.");
    if (!canal) return setErro("Escolha por onde o cliente aprovou.");
    setSalvando(true);
    try {
      const r = await fetch(`/api/orcamentos/${orcamentoId}/aprovacao-equipe`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: nome.trim(), canal, observacao: observacao.trim() || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Não foi possível registrar a aprovação."); return; }
      toast("Aprovação registrada.");
      setAberto(false);
      router.refresh();
    } catch { setErro("Erro de conexão. Tente novamente."); } finally { setSalvando(false); }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => { setAberto(true); setErro(""); }} data-marcar-aprovado>
        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Cliente aprovou
      </Button>
      <Modal aberto={aberto} onFechar={() => { if (!salvando) setAberto(false); }} titulo="Registrar aprovação do cliente" tamanho="sm">
        <div className="space-y-4" data-modal-aprovacao-equipe>
          <p className="text-sm text-ink-muted">Use quando o cliente aprovou por fora do link (telefone, WhatsApp, e-mail). O orçamento passa para Aprovado; o documento mostra que a aprovação foi registrada pela equipe, sem assinatura.</p>
          <FormField label="Quem aprovou" required><Input value={nome} onChange={(e) => { setNome(e.target.value); setErro(""); }} placeholder="Nome de quem aprovou pelo cliente" data-campo="nome" /></FormField>
          <fieldset>
            <legend className="text-sm font-medium text-ink mb-1.5">Por onde <span className="text-atrasado">*</span></legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {CANAIS_APROVACAO.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={canal === c} onClick={() => { setCanal(c); setErro(""); }} data-canal={c}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${canal === c ? "border-primary-500 bg-primary-50 text-primary-700 font-medium" : "border-surface-border text-ink-muted hover:border-primary-300"}`}>
                  {ROTULO_OPCAO[c]}
                </button>
              ))}
            </div>
          </fieldset>
          <FormField label="Observação"><Input value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder={canal ? `Ex.: aprovou por ${ROTULO_CANAL[canal]} às 10h` : "Opcional"} maxLength={500} data-campo="observacao" /></FormField>
          {erro && <p role="alert" className="text-sm text-atrasado-texto flex items-center gap-1.5" data-erro-aprovacao><AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {erro}</p>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)} disabled={salvando}>Cancelar</Button>
            <Button type="button" onClick={registrar} loading={salvando} data-confirmar-aprovacao>Registrar aprovação</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
