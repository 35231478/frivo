"use client";

import { useEffect, useMemo, useState } from "react";
import { Car } from "lucide-react";
import { cn } from "@/lib/utils";
import { rotuloVeiculo, sugerirVeiculo, type VeiculoResumo } from "@/lib/veiculo-sugestao";
import {
  SeletorTecnicos, VALOR_TECNICOS_VAZIO, corpoTecnicos, valorDaAtividade,
  type EquipeOpcao, type TecnicoOpcao, type ValorTecnicos,
} from "@/components/os/seletor-tecnicos";

/** Quem executa (equipe e/ou colaboradores) + o veículo desta atividade. */
export interface ValorExecucao extends ValorTecnicos { veiculoId: string | null }

export const VALOR_EXECUCAO_VAZIO: ValorExecucao = { ...VALOR_TECNICOS_VAZIO, veiculoId: null };

export interface OpcoesExecucao {
  tecnicos: (TecnicoOpcao & { veiculoId?: string | null })[];
  equipes: EquipeOpcao[];
  veiculos: VeiculoResumo[];
  carregando: boolean;
  adicionarTecnico: (t: TecnicoOpcao) => void;
}

/** Carrega colaboradores (com competências e veículo padrão), equipes ativas e veículos — uma vez. */
export function useOpcoesExecucao(ativo = true): OpcoesExecucao {
  const [tecnicos, setTecnicos] = useState<OpcoesExecucao["tecnicos"]>([]);
  const [equipes, setEquipes] = useState<EquipeOpcao[]>([]);
  const [veiculos, setVeiculos] = useState<VeiculoResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    if (!ativo) return;
    const json = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : [])).then((d) => (Array.isArray(d) ? d : [])).catch(() => []);
    Promise.all([json("/api/tecnicos"), json("/api/equipes?resumo=1"), json("/api/veiculos?resumo=1")])
      .then(([t, e, v]) => { setTecnicos(t); setEquipes(e); setVeiculos(v); })
      .finally(() => setCarregando(false));
  }, [ativo]);
  return { tecnicos, equipes, veiculos, carregando, adicionarTecnico: (t) => setTecnicos((l) => [...l, t]) };
}

export function valorExecucaoDaAtividade(a: any): ValorExecucao {
  return { ...valorDaAtividade(a), veiculoId: a?.veiculo?.id ?? a?.veiculoId ?? null };
}

/** Corpo para a API: técnicos/equipe + veículo (null = sem veículo). */
export function corpoExecucao(v: ValorExecucao) {
  return { ...corpoTecnicos(v), veiculoId: v.veiculoId };
}

export const temExecutor = (v: ValorTecnicos) => v.tecnicoIds.length > 0;

/**
 * Seleção OBRIGATÓRIA de quem executa (reaproveita o SeletorTecnicos: equipe, colaboradores,
 * cadastro rápido e competências) + veículo puxado automaticamente e editável só nesta OS:
 * equipe → veículo da equipe; colaborador(es) → veículo padrão do responsável; sem vínculo → vazio.
 */
export function SeletorExecucao({ opcoes, tipoOsId, valor, onChange, erro }: {
  opcoes: OpcoesExecucao;
  tipoOsId: string;
  valor: ValorExecucao;
  onChange: (v: ValorExecucao) => void;
  /** Destaca a falta de executor (ao tentar salvar sem escolher). */
  erro?: boolean;
}) {
  const veiculoDe = useMemo(() => new Map(opcoes.tecnicos.map((t) => [t.id, t.veiculoId ?? null])), [opcoes.tecnicos]);
  const sugestao = sugerirVeiculo(valor, opcoes.veiculos, (id) => veiculoDe.get(id));

  function mudarTecnicos(t: ValorTecnicos) {
    // Trocou a equipe ou o responsável → puxa o veículo de novo (dá para trocar depois)
    const mudou = t.equipeId !== valor.equipeId || t.responsavelId !== valor.responsavelId;
    const veiculoId = mudou ? sugerirVeiculo(t, opcoes.veiculos, (id) => veiculoDe.get(id)).veiculoId : valor.veiculoId;
    onChange({ ...t, veiculoId });
  }

  const equipe = opcoes.equipes.find((e) => e.id === valor.equipeId);
  const responsavel = opcoes.tecnicos.find((t) => t.id === valor.responsavelId);
  const veiculoSel = opcoes.veiculos.find((v) => v.id === valor.veiculoId);
  const listaVeiculos = opcoes.veiculos.filter((v) => v.status === "ATIVO" || v.id === valor.veiculoId);
  const origem = !valor.veiculoId
    ? (temExecutor(valor) ? (valor.equipeId ? "A equipe não tem veículo vinculado (opcional)." : "Sem veículo padrão vinculado (opcional).") : "Puxado automaticamente ao escolher quem executa.")
    : valor.veiculoId === sugestao.veiculoId && sugestao.origem === "equipe" ? `Puxado da equipe ${equipe?.nome ?? ""}.`
    : valor.veiculoId === sugestao.veiculoId && sugestao.origem === "colaborador" ? `Veículo padrão de ${responsavel?.nome ?? "colaborador"}.`
    : "Escolhido para esta OS (não altera o vínculo padrão).";

  return (
    <div className="space-y-3" data-seletor-execucao>
      <div className={cn("rounded-lg", erro && !temExecutor(valor) && "ring-2 ring-red-300 ring-offset-2")} data-erro-executor={erro && !temExecutor(valor) ? "" : undefined}>
        <SeletorTecnicos
          tecnicos={opcoes.tecnicos} equipes={opcoes.equipes} tipoOsId={tipoOsId} valor={valor} onChange={mudarTecnicos}
          carregando={opcoes.carregando} onTecnicoCriado={opcoes.adicionarTecnico}
        />
      </div>
      <div data-seletor-veiculo>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted mb-1"><Car className="w-3.5 h-3.5" /> Veículo</label>
        <select
          aria-label="Veículo" value={valor.veiculoId ?? ""} onChange={(e) => onChange({ ...valor, veiculoId: e.target.value || null })}
          className={cn("w-full bg-white border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary-500",
            valor.veiculoId ? "border-primary-300 text-ink" : "border-surface-border text-ink-muted")}
        >
          <option value="">Sem veículo</option>
          {listaVeiculos.map((v) => (
            <option key={v.id} value={v.id}>{rotuloVeiculo(v)}{v.status !== "ATIVO" ? " (inativo)" : ""}</option>
          ))}
        </select>
        <p className="text-[11px] text-ink-subtle mt-1" data-origem-veiculo>
          {origem}
          {veiculoSel && valor.veiculoId !== sugestao.veiculoId && sugestao.veiculoId && (
            <button type="button" className="ml-1 font-semibold text-primary-600 hover:text-primary-700"
              onClick={() => onChange({ ...valor, veiculoId: sugestao.veiculoId })}>Usar o padrão</button>
          )}
        </p>
      </div>
    </div>
  );
}
