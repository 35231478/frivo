"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2 } from "lucide-react";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import {
  ROTULO_METRICA, ROTULO_PENALIDADE, ROTULO_SITUACAO, ROTULO_TIPO_PERFIL, competenciaCurta, formatarEscore, rotuloCompetencia,
  type SituacaoPenalidade, type TipoPenalidade,
} from "@/lib/desempenho/regras";
import type { FichaDoColaborador } from "@/lib/desempenho/servidor";
import { BarraEscore, Erro, SeletorDeMes, SeloFaixa, posicaoTexto } from "./comum";
import { PremioEmDisputa } from "./painel-client";

const TOM_SITUACAO: Record<SituacaoPenalidade, TomStatus> = { A_REVISAR: "atencao", CONTA: "atrasado", NAO_CONTA: "previsto" };
const pontos = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

/**
 * Ficha do colaborador no mês: o escore, de onde ele veio (cada métrica com o peso e os números), a
 * faixa e o bônus projetado. O bônus em reais só aparece para quem pode ver valores.
 */
export function FichaDesempenho({ tecnicoId, mesInicial, mesAtual }: { tecnicoId: string; mesInicial: string; mesAtual: string }) {
  const [mes, setMes] = useState(mesInicial);
  const [ficha, setFicha] = useState<FichaDoColaborador | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    setErro("");
    fetch(`/api/desempenho/colaboradores/${tecnicoId}?mes=${mes}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) { setFicha(null); setErro(d.erro ?? "Não foi possível carregar a ficha."); return; }
      setFicha(d);
    }).catch(() => { if (vivo) setErro("Erro de conexão."); });
    return () => { vivo = false; };
  }, [tecnicoId, mes]);

  return (
    <div className="space-y-4" data-ficha-desempenho data-mes={mes}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Link href="/desempenho" aria-label="Voltar ao painel" data-voltar className="mt-1 p-2 rounded-lg text-ink-muted hover:text-acento hover:bg-white"><ChevronLeft className="w-5 h-5" /></Link>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold text-ink tracking-tight break-words" data-ficha-nome>{ficha?.tecnico.nome ?? "Ficha do colaborador"}</h1>
            {ficha && <p className="text-sm text-ink-muted mt-1" data-ficha-perfil>{ficha.perfil.nome} · {ROTULO_TIPO_PERFIL[ficha.perfil.tipo]}</p>}
          </div>
        </div>
        <SeletorDeMes mes={mes} aoMudar={setMes} max={mesAtual} />
      </header>
      <Erro texto={erro} data-erro-ficha="" />
      {!ficha ? (!erro && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>) : <Conteudo ficha={ficha} />}
    </div>
  );
}

function Conteudo({ ficha }: { ficha: FichaDoColaborador }) {
  const { linha, regra } = ficha;
  if (!regra) {
    return (
      <p className="bg-white border border-surface-border rounded-xl px-4 py-8 text-sm text-ink-muted text-center" data-ficha-sem-regra>
        O perfil {ficha.perfil.nome} não tem regra em vigor em {rotuloCompetencia(ficha.competencia)}: não há escore neste mês.
      </p>
    );
  }
  const descontou = linha.desconto > 0;
  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-resumo-ficha>
        <Cartao rotulo="Escore do mês">
          <p className="text-3xl font-bold text-ink tabular-nums" data-ficha-escore>{formatarEscore(linha.escore)}</p>
          <BarraEscore escore={linha.escore} meta={regra.metaMinima} className="mt-2 [&_[data-escore]]:hidden" />
          <p className="text-xs text-ink-muted mt-1">Meta mínima: {regra.metaMinima}%</p>
        </Cartao>
        <Cartao rotulo="Posição no perfil">
          <p className="text-3xl font-bold text-ink tabular-nums" data-ficha-posicao>{posicaoTexto(linha.posicao)}</p>
          <p className="text-xs text-ink-muted mt-1">{ficha.participantes === 1 ? "1 colaborador no perfil" : `Entre ${ficha.participantes} colaboradores`}</p>
        </Cartao>
        <Cartao rotulo="Faixa">
          <div className="mt-1"><SeloFaixa faixa={linha.faixa} escore={linha.escore} atingiuMeta={linha.atingiuMeta} /></div>
          <p className="text-xs text-ink-muted mt-2" data-ficha-faixas>{regra.faixas.map((f) => `${f.nome} ${f.minimo}%`).join(" · ")}</p>
        </Cartao>
        <Cartao rotulo={ficha.fechamento ? "Bônus fechado" : "Bônus projetado"}>
          {linha.bonus === null
            ? <p className="text-sm text-ink-muted mt-1" data-ficha-bonus="oculto">Valor visível só para a gestão.</p>
            : <p className="text-3xl font-bold text-ink tabular-nums" data-ficha-bonus>{formatarMoeda(linha.bonus)}</p>}
          <p className="text-xs text-ink-muted mt-1" data-ficha-situacao-bonus={ficha.fechamento ? "fechado" : "projetado"}>
            {ficha.fechamento ? `Definitivo: mês fechado em ${formatarData(ficha.fechamento.fechadoEm)}.` : "Projeção: muda até o mês ser fechado."}
          </p>
        </Cartao>
      </section>

      <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-composicao>
        <div className="px-4 py-3 border-b border-surface-border">
          <h2 className="font-semibold text-ink">Composição do escore</h2>
          <p className="text-xs text-ink-muted">Métrica sem medição no mês não vira zero: o peso dela é repartido entre as outras.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-surface-border">
                <th className="px-4 py-2 font-medium">Métrica</th><th className="px-4 py-2 font-medium">Os números</th>
                <th className="px-4 py-2 font-medium text-right">Resultado</th><th className="px-4 py-2 font-medium text-right">Peso</th>
                <th className="px-4 py-2 font-medium text-right">Pontos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {linha.composicao.map((c) => (
                <tr key={c.metrica} data-metrica={c.metrica}>
                  <td className="px-4 py-2 font-medium text-ink">{ROTULO_METRICA[ficha.perfil.tipo][c.metrica]}</td>
                  <td className="px-4 py-2 text-ink-muted" data-metrica-detalhe>{c.detalhe}</td>
                  <td className="px-4 py-2 text-right tabular-nums" data-metrica-valor>{formatarEscore(c.valor)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{c.peso}%</td>
                  <td className="px-4 py-2 text-right tabular-nums font-medium" data-metrica-pontos>{pontos(c.pontos)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-surface-border text-sm">
              <tr><td className="px-4 py-2 text-ink-muted" colSpan={4}>Qualidade (soma das métricas)</td><td className="px-4 py-2 text-right tabular-nums" data-ficha-base>{pontos(linha.base)}</td></tr>
              <tr data-linha-desconto>
                <td className="px-4 py-2 text-ink-muted" colSpan={4}>
                  Penalidades que contam: {linha.penalidades.retornos} de retorno, {linha.penalidades.reclamacoes} de reclamação
                </td>
                <td className="px-4 py-2 text-right tabular-nums" data-ficha-desconto>{descontou ? `− ${pontos(linha.desconto)}` : pontos(0)}</td>
              </tr>
              <tr className="font-semibold text-ink"><td className="px-4 py-2" colSpan={4}>Escore</td><td className="px-4 py-2 text-right tabular-nums">{formatarEscore(linha.escore)}</td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-penalidades-ficha>
        <div className="px-4 py-3 border-b border-surface-border">
          <h2 className="font-semibold text-ink">Retornos e reclamações do mês</h2>
          <p className="text-xs text-ink-muted">Só pesa o que a revisão marcou “Conta”. Registrar um problema nunca penaliza.</p>
        </div>
        {ficha.penalidades.length === 0 ? <p className="text-sm text-ink-muted px-4 py-6" data-sem-penalidades>Nada registrado em {competenciaCurta(ficha.competencia)}.</p> : (
          <ul className="divide-y divide-surface-border">
            {ficha.penalidades.map((p) => (
              <li key={p.id} className="px-4 py-3 flex flex-wrap items-start gap-x-4 gap-y-1" data-penalidade-ficha={p.situacao}>
                <span className="text-sm text-ink-muted tabular-nums w-24 shrink-0">{formatarData(p.dataFato)}</span>
                <span className="flex-1 min-w-[12rem]">
                  <span className="text-sm font-medium text-ink">{ROTULO_PENALIDADE[p.tipo as TipoPenalidade] ?? p.tipo}</span>
                  {p.descricao && <span className="block text-sm text-ink-muted break-words">{p.descricao}</span>}
                  {p.motivo && <span className="block text-xs text-ink-muted break-words">Motivo da decisão: {p.motivo}</span>}
                </span>
                <StatusPill tom={TOM_SITUACAO[p.situacao as SituacaoPenalidade] ?? "previsto"} tamanho="sm">{ROTULO_SITUACAO[p.situacao as SituacaoPenalidade] ?? p.situacao}</StatusPill>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ficha.premiosGanhos.length > 0 && (
        <p className="rounded-xl border border-ok/30 bg-ok-claro text-ok-texto text-sm px-4 py-3" data-premios-ganhos>
          Ganhou a premiação do mês: {ficha.premiosGanhos.join(", ")}.
        </p>
      )}
      {ficha.premiacoes.length > 0 && <PremioEmDisputa premiacoes={ficha.premiacoes} />}
    </>
  );
}

function Cartao({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-surface-border rounded-xl px-4 py-3">
      <p className="text-xs font-medium text-ink-muted">{rotulo}</p>
      {children}
    </div>
  );
}
