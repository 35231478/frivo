"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Gift, Loader2, Settings, Trophy, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROTULO_TIPO_PERFIL, formatarEscore } from "@/lib/desempenho/regras";
import type { GrupoRanking, PremiacaoNaTela } from "@/lib/desempenho/painel";
import type { PainelDoMes } from "@/lib/desempenho/servidor";
import { BarraEscore, CabecalhoDesempenho, Erro, SeletorDeMes, SeloFaixa, posicaoTexto, type PodeDesempenho } from "./comum";

type Dados = PainelDoMes | { ativo: false };

/**
 * Painel Desempenho: o ranking do mês por perfil (posição, escore, faixa), o prêmio em disputa e o
 * resumo por equipe. O escore é qualidade, não volume. Não mostra valor em reais: isso fica na ficha.
 */
export function PainelDesempenho({ mesAtual, pode }: { mesAtual: string; pode: PodeDesempenho }) {
  const [mes, setMes] = useState(mesAtual);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    setErro("");
    fetch(`/api/desempenho?mes=${mes}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!vivo) return;
      if (!r.ok) { setErro(d.erro ?? "Não foi possível carregar o painel."); return; }
      setDados(d);
    }).catch(() => { if (vivo) setErro("Erro de conexão."); });
    return () => { vivo = false; };
  }, [mes]);

  const ativo = dados?.ativo ? dados : null;
  return (
    <div className="space-y-4" data-painel-desempenho data-mes={mes}>
      <CabecalhoDesempenho ativa="painel" pode={pode} aRevisar={ativo?.aRevisar} acoes={<SeletorDeMes mes={mes} aoMudar={setMes} max={mesAtual} />} />
      <Erro texto={erro} data-erro-painel="" />
      {!dados ? (!erro && <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</p>)
        : !ativo ? <SemConfiguracao gerenciar={pode.gerenciar} />
        : (
          <>
            <Avisos dados={ativo} pode={pode} />
            {ativo.premiacoes.length > 0 && <PremioEmDisputa premiacoes={ativo.premiacoes} />}
            {ativo.grupos.map((g) => <Ranking key={g.perfil.id} grupo={g} mes={mes} gerenciar={pode.gerenciar} />)}
            {ativo.equipes.length > 0 && <PorEquipe equipes={ativo.equipes} />}
          </>
        )}
    </div>
  );
}

function SemConfiguracao({ gerenciar }: { gerenciar: boolean }) {
  return (
    <div className="bg-white border border-surface-border rounded-xl text-center px-4 py-12 space-y-3" data-desempenho-inativo>
      <Trophy className="w-7 h-7 text-ink-subtle mx-auto" aria-hidden />
      <p className="text-sm text-ink font-medium">O Desempenho ainda não foi configurado.</p>
      <p className="text-sm text-ink-muted max-w-md mx-auto">Defina os perfis, os pesos e as faixas, e escolha quem participa. A medição começa no mês da configuração.</p>
      {gerenciar
        ? <Link href="/desempenho/configuracao" className="inline-flex items-center gap-2 rounded-lg bg-acento text-white text-sm font-medium px-4 py-2.5 hover:bg-acento-hover" data-ir-configurar><Settings className="w-4 h-4" /> Configurar</Link>
        : <p className="text-xs text-ink-muted">A configuração é de quem tem a permissão Desempenho › Gerenciar.</p>}
    </div>
  );
}

function Avisos({ dados, pode }: { dados: PainelDoMes; pode: PodeDesempenho }) {
  const revisar = pode.revisar && dados.aRevisar > 0;
  const semPerfil = pode.gerenciar && dados.semPerfil > 0;
  if (!revisar && !semPerfil) return null;
  const linha = "flex items-center gap-2 text-sm rounded-lg border px-3 py-2";
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-avisos-desempenho>
      {revisar && (
        <Link href="/desempenho/revisao" className={cn(linha, "border-atencao/30 bg-atencao-claro text-atencao-texto hover:brightness-95")} data-aviso-revisar>
          <ClipboardCheck className="w-4 h-4 shrink-0" aria-hidden />
          {dados.aRevisar === 1 ? "1 item espera a revisão" : `${dados.aRevisar} itens esperam a revisão`}. Só pesa depois de revisado.
        </Link>
      )}
      {semPerfil && (
        <Link href="/desempenho/configuracao" className={cn(linha, "border-surface-border bg-white text-ink-muted hover:bg-surface-alt")} data-aviso-sem-perfil>
          <UsersRound className="w-4 h-4 shrink-0" aria-hidden />
          {dados.semPerfil === 1 ? "1 colaborador ativo está fora do ranking" : `${dados.semPerfil} colaboradores ativos estão fora do ranking`} (sem perfil).
        </Link>
      )}
    </div>
  );
}

/** Os brindes do mês. `urlDaImagem` muda no modo TV (rota pública com o token). */
export function PremioEmDisputa({ premiacoes, urlDaImagem = (id) => `/api/desempenho/premiacoes/${id}/imagem`, escuro }: {
  premiacoes: PremiacaoNaTela[]; urlDaImagem?: (id: string) => string; escuro?: boolean;
}) {
  return (
    <section className={cn("rounded-xl border p-4", escuro ? "border-white/15 bg-white/5" : "border-surface-border bg-white")} data-premio-em-disputa>
      <h2 className={cn("font-semibold flex items-center gap-2", escuro ? "text-white" : "text-ink")}><Gift className="w-4 h-4" aria-hidden /> Prêmio em disputa</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {premiacoes.map((p) => (
          <li key={p.id} className={cn("flex gap-3 rounded-lg border p-3", escuro ? "border-white/15" : "border-surface-border")} data-premio={p.id}>
            {p.temImagem
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={urlDaImagem(p.id)} alt={`Imagem do prêmio: ${p.titulo}`} className="w-20 h-20 rounded-lg object-cover shrink-0 bg-surface-alt" data-premio-imagem />
              : <span className={cn("w-20 h-20 rounded-lg shrink-0 grid place-items-center", escuro ? "bg-white/10" : "bg-surface-alt")}><Gift className={cn("w-7 h-7", escuro ? "text-white/60" : "text-ink-subtle")} aria-hidden /></span>}
            <div className="min-w-0">
              <p className={cn("font-semibold break-words", escuro ? "text-white" : "text-ink")} data-premio-titulo>{p.titulo}</p>
              {p.descricao && <p className={cn("text-sm whitespace-pre-line break-words", escuro ? "text-white/70" : "text-ink-muted")}>{p.descricao}</p>}
              <p className={cn("text-xs mt-1", escuro ? "text-white/60" : "text-ink-muted")} data-premio-disputa>{p.perfil ? `Disputa do perfil ${p.perfil}` : "Disputa de todos os perfis"}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function resumoDaRegra(regra: NonNullable<GrupoRanking["regra"]>) {
  return `Meta mínima ${regra.metaMinima}% · ${regra.faixas.map((f) => `${f.nome} a partir de ${f.minimo}%`).join(" · ")}`;
}

function Ranking({ grupo, mes, gerenciar }: { grupo: GrupoRanking; mes: string; gerenciar: boolean }) {
  const { perfil, regra, linhas } = grupo;
  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-ranking={perfil.nome} data-perfil-tipo={perfil.tipo}>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink">{perfil.nome} <span className="text-xs font-normal text-ink-muted">· {ROTULO_TIPO_PERFIL[perfil.tipo]}</span></h2>
        {regra
          ? <p className="text-xs text-ink-muted" data-resumo-regra>{resumoDaRegra(regra)}</p>
          : (
            <p className="text-xs text-atencao-texto" data-sem-regra>
              Sem regra em vigor neste mês: ninguém é medido por este perfil.
              {gerenciar && <> <Link href="/desempenho/configuracao" className="underline">Definir a regra</Link></>}
            </p>
          )}
      </div>
      {linhas.length === 0 ? <p className="text-sm text-ink-muted px-4 py-6" data-ranking-vazio>Nenhum colaborador neste perfil.</p> : (
        <ol className="divide-y divide-surface-border">
          {linhas.map((l) => (
            <li key={l.tecnicoId} data-linha-ranking={l.nome} data-posicao={l.posicao ?? ""}>
              <Link href={`/desempenho/colaborador/${l.tecnicoId}?mes=${mes}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-alt/60">
                <span className={cn("w-10 text-lg font-bold tabular-nums", l.posicao === 1 ? "text-acento" : "text-ink-muted")} data-posicao-texto>{posicaoTexto(l.posicao)}</span>
                <span className="flex-1 min-w-[9rem] font-medium text-ink break-words">{l.nome}</span>
                <BarraEscore escore={l.escore} meta={regra?.metaMinima} className="w-full sm:w-64 order-last sm:order-none" />
                <span className="w-32 flex sm:justify-end"><SeloFaixa faixa={l.faixa} escore={l.escore} atingiuMeta={l.atingiuMeta} /></span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PorEquipe({ equipes }: { equipes: PainelDoMes["equipes"] }) {
  return (
    <section className="bg-white border border-surface-border rounded-xl overflow-hidden" data-por-equipe>
      <div className="px-4 py-3 border-b border-surface-border">
        <h2 className="font-semibold text-ink">Por equipe</h2>
        <p className="text-xs text-ink-muted">Média dos escores individuais dos membros que participam. A base é sempre a pessoa.</p>
      </div>
      <ul className="divide-y divide-surface-border">
        {equipes.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" data-equipe={e.nome}>
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: e.cor }} aria-hidden />
            <span className="flex-1 min-w-[9rem]">
              <span className="font-medium text-ink">{e.nome}</span>
              {e.lider && <span className="block text-xs text-ink-muted">Líder: {e.lider}</span>}
            </span>
            <span className="text-xs text-ink-muted" data-equipe-medidos>
              {e.participantes === 0 ? "Nenhum membro no Desempenho" : `${e.medidos} de ${e.participantes} com medição`}
            </span>
            <span className="w-20 text-right text-sm font-semibold text-ink tabular-nums" data-equipe-escore>{formatarEscore(e.escore)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
