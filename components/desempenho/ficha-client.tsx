"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2 } from "lucide-react";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { Dica } from "@/components/ui/dica";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import {
  ROTULO_METRICA, ROTULO_PENALIDADE, ROTULO_SITUACAO, ROTULO_TIPO_PERFIL, competenciaCurta, formatarEscore, rotuloCompetencia,
  type SituacaoPenalidade, type TipoPenalidade,
} from "@/lib/desempenho/regras";
import type { FichaDoColaborador } from "@/lib/desempenho/servidor";
import { BarraEscore, Erro, SeletorDeMes, SeloFaixa, posicaoTexto } from "./comum";
import { PremioEmDisputa } from "./painel-client";
import { ListaDeAtrasos, SemAtrasosJustificados, separarAtrasos } from "./atrasos";

const TOM_SITUACAO: Record<SituacaoPenalidade, TomStatus> = { A_REVISAR: "atencao", CONTA: "atrasado", NAO_CONTA: "previsto" };
const AJUDA_COMPOSICAO = "Cada métrica vale um peso dentro do escore. Métrica sem medição no mês não vira zero: o peso dela é repartido entre as outras. Penalidades marcadas \"Conta\" na revisão descontam pontos do total.";
const AJUDA_PENALIDADES = "Retorno e ressalva do cliente entram sozinhos; reclamação é registrada à mão. Só pesa no escore o que a revisão marcou \"Conta\": registrar um problema nunca penaliza.";

const AJUDA_JUSTIFICADOS = "Atrasos que a gestão justificou na OS — cliente ausente, peça faltando, acesso negado, clima. Ficam fora da conta do \"no prazo\": não ajudam nem atrapalham o escore. O atraso continua registrado na OS.";
const AJUDA_CONTAM = "Atividades concluídas depois do prazo (o prazo da atividade ou, sem ele, o dia agendado). Quando o atraso não foi culpa de quem executou, abra a OS e use \"Justificar atraso\" no cartão Prazos.";

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
  const { justificados, contam } = separarAtrasos(linha.atrasos);
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
          <h2 className="font-semibold text-ink flex items-center gap-1.5">Composição do escore <Dica texto={AJUDA_COMPOSICAO} rotulo="Composição do escore" /></h2>
        </div>
        <TabelaPro
          tela="desempenho-composicao"
          atributos={{ "data-tabela-composicao": true }}
          barra={
            <p data-fecho-composicao>
              Qualidade <strong className="text-ink" data-ficha-base>{pontos(linha.base)}</strong>
              {" · "}Penalidades que contam <strong className="text-ink" data-ficha-desconto>{descontou ? `− ${pontos(linha.desconto)}` : pontos(0)}</strong>
              <span className="hidden sm:inline"> ({linha.penalidades.retornos} de retorno, {linha.penalidades.reclamacoes} de reclamação)</span>
              {" · "}Escore <strong className="text-ink">{formatarEscore(linha.escore)}</strong>
            </p>
          }
          cartoes={
            <ul className="divide-y divide-surface-border" data-composicao-cartoes>
              {linha.composicao.map((c) => (
                <li key={c.metrica} className="px-4 py-3" data-metrica={c.metrica}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{ROTULO_METRICA[ficha.perfil.tipo][c.metrica]} <span className="text-xs font-normal text-ink-muted">· peso {c.peso}%</span></p>
                    <span className={cn(PLANILHA.numero, "text-sm font-semibold text-ink")} data-metrica-pontos>{pontos(c.pontos)}</span>
                  </div>
                  <p className="text-xs text-ink-muted" data-metrica-detalhe>{c.detalhe}</p>
                </li>
              ))}
            </ul>
          }
          colunas={[
            { id: "metrica", titulo: "Métrica", minimo: 160, obrigatoria: true },
            { id: "detalhe", titulo: "Os números", minimo: 180 },
            { id: "valor", titulo: "Resultado", alinhar: "direita", largura: 110 },
            { id: "peso", titulo: "Peso", alinhar: "direita", largura: 80 },
            { id: "pontos", titulo: "Pontos", alinhar: "direita", largura: 100, obrigatoria: true },
          ]}
          linhas={linha.composicao.map((c) => ({
            id: c.metrica,
            atributos: { "data-metrica": c.metrica },
            titulos: { metrica: ROTULO_METRICA[ficha.perfil.tipo][c.metrica] },
            celulas: {
              metrica: <span className="font-medium text-ink">{ROTULO_METRICA[ficha.perfil.tipo][c.metrica]}</span>,
              detalhe: <span className={PLANILHA.apagado} data-metrica-detalhe>{c.detalhe}</span>,
              valor: <span className={PLANILHA.numero} data-metrica-valor>{formatarEscore(c.valor)}</span>,
              peso: <span className={cn(PLANILHA.numero, "text-ink-muted")}>{c.peso}%</span>,
              pontos: <span className={cn(PLANILHA.numero, "font-medium")} data-metrica-pontos>{pontos(c.pontos)}</span>,
            },
          }))}
        />
      </section>

      {/* Mês fechado antes de a justificativa existir não guardou a lista: as seções não aparecem */}
      {linha.atrasos && (
        <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-atrasos-justificados>
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="font-semibold text-ink flex items-center gap-1.5">Atrasos justificados <Dica texto={AJUDA_JUSTIFICADOS} rotulo="Atrasos justificados" /></h2>
          </div>
          {justificados.length === 0 ? <SemAtrasosJustificados competencia={ficha.competencia} /> : <ListaDeAtrasos atrasos={justificados} comLink />}
        </section>
      )}
      {contam.length > 0 && (
        <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-atrasos-que-contam>
          <div className="px-4 py-3 border-b border-surface-border">
            <h2 className="font-semibold text-ink flex items-center gap-1.5">Atrasos que contam <Dica texto={AJUDA_CONTAM} rotulo="Atrasos que contam" /></h2>
          </div>
          <ListaDeAtrasos atrasos={contam} comLink />
        </section>
      )}

      <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-penalidades-ficha>
        <div className="px-4 py-3 border-b border-surface-border">
          <h2 className="font-semibold text-ink flex items-center gap-1.5">Retornos e reclamações do mês <Dica texto={AJUDA_PENALIDADES} rotulo="Retornos e reclamações" /></h2>
        </div>
        {ficha.penalidades.length === 0 ? <ListaVazia mensagem={`Nada registrado em ${competenciaCurta(ficha.competencia)}.`} /> : (
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
      {ficha.premiacoes.length > 0 && <PremioEmDisputa premiacoes={ficha.premiacoes} encerrada={!!ficha.fechamento} />}
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
