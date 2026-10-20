"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CadastroRapidoModal, usePodeCriar, type OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import { EQUIPAMENTO, UNIDADE } from "@/components/cadastro-rapido/definicoes";
import { Plus, X, Check, Trash2, HardDrive, AlertTriangle, Camera, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { situacaoEquipamento, type EquipamentoTela } from "@/components/os/execucao-equipamento";
import { SeletorEquipamentos, rotuloEquipLista } from "@/components/os/seletor-equipamentos";
import { textoFaltas, type ResultadoConclusao } from "@/lib/execucao/pendencias";

interface Props {
  osId: string;
  atividadeId: string;
  clienteId?: string;
  unidadeId?: string | null;
}

interface ExecucaoResumo { bloqueada: boolean; equipamentos: EquipamentoTela[]; conclusao: ResultadoConclusao }

/**
 * Detalhe da OS → atividade: os equipamentos ATENDIDOS nela, cada um com a situação do checklist do
 * tipo dele (o mesmo que a execução mostra), e o vínculo por lista da unidade (com cadastro rápido).
 */
export function AtividadeEquipamentos({ osId, atividadeId, clienteId, unidadeId }: Props) {
  const [execucao, setExecucao] = useState<ExecucaoResumo | null>(null);
  const [mostraAdd, setMostraAdd] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [versaoLista, setVersaoLista] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const { pode } = usePermissoes();
  const podeVincular = pode("ordens", "editar") || pode("ordens", "concluir");
  const podeRemover = pode("ordens", "editar");
  // Cadastro rápido de equipamento (mesmo componente do cadastro inline)
  const podeCriarEquip = usePodeCriar(EQUIPAMENTO.permissao);
  const [novoEquip, setNovoEquip] = useState(false);
  const [unidadesCliente, setUnidadesCliente] = useState<OpcaoCadastro[] | null>(null);

  const base = `/api/ordens/${osId}/atividades/${atividadeId}`;
  const carregar = useCallback(() => {
    fetch(`${base}/execucao`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setExecucao(d)).catch(() => {});
  }, [base]);
  useEffect(() => { carregar(); }, [carregar]);

  async function abrirNovoEquip() {
    // OS sem endereço: o mini-cadastro pede a unidade do cliente
    if (!unidadeId && clienteId && !unidadesCliente) {
      const d = await fetch(`/api/unidades?clienteId=${clienteId}`).then((r) => r.json()).catch(() => []);
      setUnidadesCliente(Array.isArray(d) ? d.map(UNIDADE.opcao) : []);
    }
    setMostraAdd(true);
    setNovoEquip(true);
  }

  async function adicionar() {
    if (selecionados.size === 0) return;
    setSalvando(true); setErro("");
    try {
      const res = await fetch(`${base}/equipamentos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equipamentoIds: [...selecionados] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível vincular."); return; }
      setSelecionados(new Set());
      setMostraAdd(false);
      carregar();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function remover(vinculoId: string) {
    setErro("");
    const res = await fetch(`${base}/equipamentos/${vinculoId}`, { method: "DELETE" }).catch(() => null);
    if (!res) { setErro("Erro de conexão."); return; }
    if (!res.ok) { const d = await res.json().catch(() => ({})); setErro(d.erro ?? "Não foi possível remover."); return; }
    carregar();
  }

  const equipamentos = execucao?.equipamentos ?? [];
  const bloqueada = !!execucao?.bloqueada;

  return (
    <div className="space-y-3" data-atividade-equipamentos>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5" /> Equipamentos atendidos
        </p>
        {podeVincular && !bloqueada && !mostraAdd && clienteId && (
          <button onClick={() => setMostraAdd(true)} className="text-xs text-frivo-600 hover:text-frivo-700 flex items-center gap-1" data-adicionar-equipamento>
            <Plus className="w-3 h-3" /> Adicionar
          </button>
        )}
      </div>

      {erro && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5" data-erro-equipamentos>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {erro}
        </p>
      )}

      {execucao && equipamentos.length === 0 && !mostraAdd && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5" data-sem-equipamento>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Nenhum equipamento vinculado. A atividade pode ser aberta assim, mas só é concluída com pelo menos 1 equipamento atendido e o checklist dele respondido.
        </p>
      )}

      <div className="space-y-1.5">
        {equipamentos.map((e) => {
          const sit = situacaoEquipamento(e);
          const ativos = e.itens.filter((i) => i.ativo);
          const respondidos = ativos.filter((i) => e.respostas[i.id]?.status).length;
          return (
            <div key={e.vinculoId} className="bg-white border border-gray-100 rounded-lg px-2.5 py-2" data-equipamento-vinculado={e.equipamento.id} data-situacao={sit.chave}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-sm text-gray-800 truncate">{e.equipamento.titulo}</span>
                  {e.equipamento.tipo && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">{e.equipamento.tipo.nome}</span>}
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap", sit.classe)}>{sit.rotulo}</span>
                </div>
                {podeRemover && !bloqueada && (
                  <button onClick={() => remover(e.vinculoId)} className="p-1 text-gray-300 hover:text-red-600 shrink-0" title="Tirar da atividade" aria-label={`Tirar ${e.equipamento.titulo} da atividade`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px] text-gray-500 mt-1">
                {ativos.length ? (
                  <span className="flex items-center gap-1" data-progresso-checklist><ListChecks className="w-3 h-3" /> Checklist {respondidos}/{ativos.length}</span>
                ) : (
                  <span className="text-amber-700" data-sem-checklist>Tipo sem checklist cadastrado</span>
                )}
                <span className="flex items-center gap-1"><Camera className="w-3 h-3" /> {e.fotos.length} foto{e.fotos.length === 1 ? "" : "s"}</span>
                {e.equipamento.tag && <span>TAG {e.equipamento.tag}</span>}
              </div>
              {e.feito && !e.completo && <p className="text-[11px] text-amber-700 mt-1" data-faltas>Falta: {textoFaltas(e.faltas)}</p>}
            </div>
          );
        })}
      </div>

      {mostraAdd && clienteId && (
        <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-frivo-800">Equipamentos {unidadeId ? "deste endereço" : "do cliente"}</span>
            <button onClick={() => { setMostraAdd(false); setSelecionados(new Set()); }} className="text-gray-400 hover:text-gray-600" aria-label="Fechar"><X className="w-4 h-4" /></button>
          </div>
          <SeletorEquipamentos
            clienteId={clienteId} unidadeId={unidadeId} versao={versaoLista}
            excluir={equipamentos.map((e) => e.equipamento.id)}
            marcados={selecionados} onChange={setSelecionados}
            vazio={podeCriarEquip && (
              <button type="button" onClick={abrirNovoEquip} className="ml-1 font-semibold text-frivo-600 hover:text-frivo-700 inline-flex items-center gap-0.5">
                <Plus className="w-3 h-3" /> Cadastrar agora
              </button>
            )}
          />
          <div className="flex items-center justify-between gap-2">
            {podeCriarEquip ? (
              <button type="button" onClick={abrirNovoEquip} className="text-xs font-semibold text-frivo-600 hover:text-frivo-700 inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> Novo equipamento
              </button>
            ) : <span />}
            <Button type="button" loading={salvando} onClick={adicionar} disabled={selecionados.size === 0} className="h-7 text-xs px-3" data-vincular>
              <Check className="w-3.5 h-3.5" /> Adicionar {selecionados.size > 0 ? `(${selecionados.size})` : ""}
            </Button>
          </div>
        </div>
      )}

      <CadastroRapidoModal
        aberto={novoEquip}
        onFechar={() => setNovoEquip(false)}
        titulo="Novo equipamento"
        contexto={unidadeId ? "neste endereço da OS" : "para este cliente"}
        campos={EQUIPAMENTO.campos(unidadeId ? undefined : unidadesCliente ?? [])}
        linkCadastroCompleto={EQUIPAMENTO.link}
        criar={async (v) => {
          const e = await EQUIPAMENTO.criar(unidadeId ?? "", v);
          return { value: e.id, label: rotuloEquipLista(e) };
        }}
        // Já aparece marcado na lista — falta só confirmar em "Adicionar"
        onCriado={(o) => { setNovoEquip(false); setVersaoLista((n) => n + 1); setSelecionados((p) => new Set(p).add(o.value)); }}
      />
    </div>
  );
}
