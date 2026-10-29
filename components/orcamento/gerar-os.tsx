"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, ClipboardPlus, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { FormField } from "@/components/ui/form-field";
import { InputDataHora } from "@/components/ui/input-data-hora";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { SeletorExecucao, VALOR_EXECUCAO_VAZIO, corpoExecucao, temExecutor, useOpcoesExecucao, type ValorExecucao } from "@/components/os/seletor-execucao";
import { MSG_SEM_EXECUTOR_TELA } from "@/lib/atividade-equipe";

export interface OsDoOrcamento { id: string; numero: string; gerada: boolean }

/**
 * Orçamento aprovado → OS (faturamento avulso, caminho inverso). Mostra a OS do orçamento quando
 * ela já existe (gerada ou vinculada) — nunca oferece gerar outra. Sem OS e com permissão de criar
 * OS, "Gerar OS" pede quem executa (e a data, opcional) e leva à OS criada.
 */
export function GerarOs({ orcamentoId, codigo, itens, os, podeCriar, podeVer }: {
  orcamentoId: string;
  codigo: string;
  /** Quantos serviços/produtos vão para a OS */
  itens: number;
  os: OsDoOrcamento | null;
  podeCriar: boolean;
  podeVer: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [execucao, setExecucao] = useState<ValorExecucao>(VALOR_EXECUCAO_VAZIO);
  const [agendarPara, setAgendarPara] = useState("");
  const [faltaExecutor, setFaltaExecutor] = useState(false);
  const [erro, setErro] = useState("");
  const [gerando, setGerando] = useState(false);
  const opcoes = useOpcoesExecucao(aberto);

  if (os) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-os-do-orcamento={os.id}>
        <ClipboardList className="w-4 h-4 text-acento shrink-0" aria-hidden />
        <p className="text-sm text-ink">
          {os.gerada ? "OS gerada a partir deste orçamento:" : "Orçamento vinculado à OS"} <strong className="font-mono">{os.numero}</strong>
        </p>
        {podeVer && (
          <Link href={`/ordens/${os.id}`} className="btn-secondary inline-flex items-center gap-1.5 text-sm sm:ml-auto" data-abrir-os>
            Abrir OS <ExternalLink className="w-3.5 h-3.5" aria-hidden />
          </Link>
        )}
      </div>
    );
  }
  if (!podeCriar) return null;

  async function gerar() {
    if (!temExecutor(execucao)) { setFaltaExecutor(true); setErro(MSG_SEM_EXECUTOR_TELA); return; }
    setErro(""); setGerando(true);
    try {
      const r = await fetch(`/api/orcamentos/${orcamentoId}/gerar-os`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execucao: { dataAgendada: agendarPara || null, ...corpoExecucao(execucao) } }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.os) { setErro(d.erro ?? "Não foi possível gerar a OS."); return; }
      toast(d.jaExistia ? `Este orçamento já tem a OS ${d.os.numero}.` : `OS ${d.os.numero} gerada.`, d.jaExistia ? "info" : "sucesso");
      setAberto(false);
      router.push(`/ordens/${d.os.id}`);
    } catch { setErro("Sem conexão. Tente novamente."); } finally { setGerando(false); }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-ink flex items-center gap-1">
          Orçamento aprovado, ainda sem OS.
          <Dica rotulo="Gerar OS" lado="direita"
            texto="Cria a ordem de serviço com o cliente, o endereço e os itens deste orçamento, vinculada a ele. Cada orçamento gera uma única OS." />
        </p>
        <Button type="button" onClick={() => setAberto(true)} className="w-full sm:w-auto sm:ml-auto" data-gerar-os>
          <ClipboardPlus className="w-4 h-4" aria-hidden /> Gerar OS
        </Button>
      </div>
      <Modal aberto={aberto} onFechar={() => { if (!gerando) setAberto(false); }} titulo={`Gerar OS do orçamento ${codigo}`}>
        <div className="space-y-4" data-modal-gerar-os>
          <p className="text-sm text-ink-muted flex items-center gap-1">
            {itens === 1 ? "1 item será copiado para a OS." : `${itens} itens serão copiados para a OS.`}
            <Dica rotulo="Itens copiados" lado="direita"
              texto="Os itens entram na OS como não executados, com os preços do orçamento. Descontos e ISS continuam registrados no orçamento." />
          </p>
          <FormField label="Quem executa" required>
            <SeletorExecucao opcoes={opcoes} tipoOsId="" valor={execucao}
              onChange={(v) => { setExecucao(v); if (temExecutor(v)) { setFaltaExecutor(false); setErro(""); } }} erro={faltaExecutor} />
          </FormField>
          <FormField label="Agendar para" dica="Opcional. Data e hora da primeira atividade, exibida no calendário.">
            <InputDataHora aria-label="Agendar para" value={agendarPara} onChange={setAgendarPara} />
          </FormField>
          {erro && <p role="alert" className="text-sm text-atrasado-texto" data-erro-gerar-os>{erro}</p>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setAberto(false)} disabled={gerando}>Cancelar</Button>
            <Button type="button" onClick={gerar} loading={gerando} data-confirmar-gerar-os>Gerar OS</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
