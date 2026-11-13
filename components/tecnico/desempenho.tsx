"use client";

import { useEffect, useState } from "react";
import { Loader2, Trophy } from "lucide-react";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { BarraEscore, SeletorDeMes, SeloFaixa, posicaoTexto } from "@/components/desempenho/comum";
import { PremioEmDisputa } from "@/components/desempenho/painel-client";
import {
  ROTULO_METRICA, ROTULO_PENALIDADE, ROTULO_SITUACAO, competenciaAtual, formatarEscore, rotuloCompetencia, type SituacaoPenalidade, type TipoPenalidade,
} from "@/lib/desempenho/regras";
import type { FichaDoColaborador } from "@/lib/desempenho/servidor";

const TOM_SITUACAO: Record<SituacaoPenalidade, TomStatus> = { A_REVISAR: "atencao", CONTA: "atrasado", NAO_CONTA: "previsto" };
const pontos = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
type Resposta = { participa: boolean; ficha: FichaDoColaborador | null };

/**
 * "Desempenho" no app do técnico: o colaborador vê o DELE — escore do mês, de onde ele veio (cada
 * métrica com os números), a posição no perfil, o prêmio em disputa e o bônus (projetado, ou
 * definitivo depois que o mês fecha). A avaliação aparece como média; o que o cliente escreveu não.
 */
export function DesempenhoTecnico() {
  const [mesAtual] = useState(() => competenciaAtual());
  const [mes, setMes] = useState(mesAtual);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    setErro(""); setDados(null);
    fetch(`/api/tecnico/desempenho?mes=${mes}`).then(async (r) => {
      const d = await r.json().catch(() => null);
      if (!vivo) return;
      if (!r.ok || !d) { setErro("Não foi possível carregar o desempenho."); return; }
      setDados(d);
    }).catch(() => { if (vivo) setErro("Sem conexão. O desempenho aparece quando o sinal voltar."); });
    return () => { vivo = false; };
  }, [mes]);

  return (
    <div className="space-y-4" data-desempenho-tecnico data-mes={mes}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold text-ink flex items-center gap-2"><Trophy className="w-5 h-5 text-acento" aria-hidden /> Desempenho</h1>
        <SeletorDeMes mes={mes} aoMudar={setMes} max={mesAtual} />
      </div>
      {erro ? <p role="alert" className="rounded-xl border border-surface-border bg-white text-sm text-ink-muted px-4 py-6 text-center" data-erro-desempenho>{erro}</p>
        : !dados ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>
        : !dados.ficha ? (
          <p className="rounded-xl border border-surface-border bg-white text-sm text-ink-muted px-4 py-8 text-center" data-nao-participa>
            Sem desempenho para mostrar em {rotuloCompetencia(mes)}. Fale com o escritório se isso parecer errado.
          </p>
        ) : <Ficha ficha={dados.ficha} />}
    </div>
  );
}

function Ficha({ ficha }: { ficha: FichaDoColaborador }) {
  const { linha, regra } = ficha;
  if (!regra) {
    return (
      <p className="rounded-xl border border-surface-border bg-white text-sm text-ink-muted px-4 py-8 text-center" data-sem-regra>
        O perfil {ficha.perfil.nome} ainda não tem regra neste mês: não há escore.
      </p>
    );
  }
  const fechado = !!ficha.fechamento;
  return (
    <>
      <section className="rounded-xl border border-surface-border bg-white px-4 py-4 space-y-3" data-resumo>
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-ink-muted">Escore de {rotuloCompetencia(ficha.competencia)}</p>
            <p className="text-4xl font-bold text-ink tabular-nums" data-meu-escore>{formatarEscore(linha.escore)}</p>
          </div>
          <SeloFaixa faixa={linha.faixa} escore={linha.escore} atingiuMeta={linha.atingiuMeta} />
        </div>
        <BarraEscore escore={linha.escore} meta={regra.metaMinima} className="[&_[data-escore]]:hidden" />
        <p className="text-xs text-ink-muted">Meta mínima: {regra.metaMinima}% · {regra.faixas.map((f) => `${f.nome} ${f.minimo}%`).join(" · ")}</p>
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="rounded-lg bg-surface-alt px-3 py-2">
            <p className="text-xs text-ink-muted">Posição no perfil {ficha.perfil.nome}</p>
            <p className="text-xl font-bold text-ink tabular-nums" data-minha-posicao>
              {posicaoTexto(linha.posicao)}{linha.posicao !== null && <span className="text-sm font-medium text-ink-muted"> de {ficha.participantes}</span>}
            </p>
          </div>
          <div className="rounded-lg bg-surface-alt px-3 py-2" data-meu-bonus-situacao={fechado ? "fechado" : "projetado"}>
            <p className="text-xs text-ink-muted">{fechado ? "Bônus fechado" : "Bônus projetado"}</p>
            <p className="text-xl font-bold text-ink tabular-nums" data-meu-bonus>{formatarMoeda(linha.bonus ?? 0)}</p>
          </div>
        </div>
        <p className="text-xs text-ink-muted" data-explica-bonus>
          {fechado ? `Mês fechado em ${formatarData(ficha.fechamento!.fechadoEm)}: o valor é definitivo.` : "Projeção: muda até o escritório fechar o mês."}
        </p>
      </section>

      {ficha.premiosGanhos.length > 0 && (
        <p className="rounded-xl border border-ok/30 bg-ok-claro text-ok-texto text-sm font-medium px-4 py-3" data-premios-ganhos>
          Premiação do mês conquistada: {ficha.premiosGanhos.join(", ")}.
        </p>
      )}

      <section className="rounded-xl border border-surface-border bg-white overflow-hidden" data-minha-composicao>
        <h2 className="px-4 py-3 border-b border-surface-border font-semibold text-ink">De onde vem o escore</h2>
        <ul className="divide-y divide-surface-border">
          {linha.composicao.map((c) => (
            <li key={c.metrica} className="px-4 py-3 flex items-start justify-between gap-3" data-metrica={c.metrica}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{ROTULO_METRICA[ficha.perfil.tipo][c.metrica]}</span>
                <span className="block text-xs text-ink-muted" data-metrica-detalhe>{c.detalhe} · peso {c.peso}%</span>
              </span>
              <span className="text-right shrink-0">
                <span className="block text-sm font-semibold text-ink tabular-nums" data-metrica-valor>{formatarEscore(c.valor)}</span>
                <span className="block text-xs text-ink-muted tabular-nums" data-metrica-pontos>{c.pontos === null ? "sem pontos" : `${pontos(c.pontos)} pontos`}</span>
              </span>
            </li>
          ))}
          <li className="px-4 py-3 flex items-center justify-between gap-3 text-sm" data-meu-desconto>
            <span className="text-ink-muted">Penalidades que contaram: {linha.penalidades.retornos + linha.penalidades.reclamacoes}</span>
            <span className="font-semibold text-ink tabular-nums">{linha.desconto > 0 ? `− ${pontos(linha.desconto)} pontos` : "sem desconto"}</span>
          </li>
        </ul>
      </section>

      {ficha.penalidades.length > 0 && (
        <section className="rounded-xl border border-surface-border bg-white overflow-hidden" data-minhas-penalidades>
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="font-semibold text-ink">Retornos e reclamações do mês</h2>
            <p className="text-xs text-ink-muted">Só pesa o que o escritório marcou “Conta”.</p>
          </div>
          <ul className="divide-y divide-surface-border">
            {ficha.penalidades.map((p) => (
              <li key={p.id} className="px-4 py-3 flex items-start justify-between gap-3" data-minha-penalidade={p.tipo}>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{ROTULO_PENALIDADE[p.tipo as TipoPenalidade] ?? p.tipo} · {formatarData(p.dataFato)}</span>
                  {p.descricao && <span className="block text-xs text-ink-muted break-words">{p.descricao}</span>}
                </span>
                <StatusPill tom={TOM_SITUACAO[p.situacao as SituacaoPenalidade] ?? "previsto"} tamanho="sm">{ROTULO_SITUACAO[p.situacao as SituacaoPenalidade] ?? p.situacao}</StatusPill>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ficha.premiacoes.length > 0 && <PremioEmDisputa premiacoes={ficha.premiacoes} encerrada={fechado} urlDaImagem={(id) => `/api/tecnico/desempenho/premiacoes/${id}/imagem`} />}
    </>
  );
}
