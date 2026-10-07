import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { partesBR } from "@/lib/fuso";
import { cn, formatarMoeda } from "@/lib/utils";
import { agrupar, evolucao, folhaAtual } from "@/lib/folha/server";
import { AVISO_GESTAO, FUNCOES_CUSTO_HORA, REGIME_LABEL, competenciaDe, rotuloCompetencia } from "@/lib/folha/calculo";
import { FecharMes } from "@/components/folha/fechar-mes";
import { AlertTriangle, BadgeDollarSign, Clock, FileSpreadsheet, Info, Percent, Settings2, Users } from "lucide-react";

export const metadata: Metadata = { title: "Custo de pessoal" };

/**
 * Custo de Pessoal (gestão de folha). Gate: "Financeiro › Custo de pessoal" — o middleware só exige
 * "Financeiro › visualizar", então a página confere a permissão específica.
 */
export default async function CustoPessoalPage() {
  const session = await auth();
  const user = session!.user!;
  if (!pode(user.permissoes, "financeiro", "folha", user.role)) redirect("/sem-permissao");
  const empresaId = user.empresaId;

  const { ano, mes } = partesBR();
  const competencia = competenciaDe(ano, mes);
  const [{ linhas }, historico] = await Promise.all([folhaAtual(empresaId, competencia), evolucao(empresaId, competencia, 12)]);

  const soma = (f: (l: (typeof linhas)[number]) => number) => Math.round(linhas.reduce((s, l) => s + f(l), 0) * 100) / 100;
  const total = soma((l) => l.custo.total);
  const encargos = soma((l) => l.custo.encargos);
  const beneficios = soma((l) => l.custo.beneficios);
  const remuneracao = soma((l) => l.custo.remuneracao);
  const comDados = linhas.filter((l) => !l.semDados);
  const pendentes = linhas.filter((l) => l.semDados);
  const tecnicos = comDados.filter((l) => FUNCOES_CUSTO_HORA.includes(l.tipo));
  const custoHoraTecnico = tecnicos.length ? soma((l) => (FUNCOES_CUSTO_HORA.includes(l.tipo) ? l.custo.total : 0)) / tecnicos.reduce((s, l) => s + l.custo.horasMes, 0) : 0;

  const porFuncao = agrupar(comDados, (l) => l.funcao);
  const porEquipe = agrupar(comDados, (l) => l.equipe ?? "Sem equipe");

  // Evolução: meses fechados + o mês atual (projeção, se ainda não foi fechado)
  const fechadoAtual = historico.some((h) => h.competencia === competencia);
  const barras = [
    ...historico.map((h) => ({ competencia: h.competencia, total: h.total, projecao: false })),
    ...(fechadoAtual ? [] : [{ competencia, total, projecao: true }]),
  ];
  const maxBarra = Math.max(1, ...barras.map((b) => b.total));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><BadgeDollarSign className="w-5 h-5 text-primary-600" /></div>
          <div>
            <h1 className="page-title">Custo de pessoal</h1>
            <p className="page-subtitle first-letter:uppercase">{rotuloCompetencia(competencia, true)} · folha estimada com encargos e benefícios</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/financeiro/custo-pessoal/encargos" className="btn-secondary inline-flex items-center gap-1.5 text-sm">
            <Settings2 className="w-4 h-4" /> Encargos
          </Link>
          <Link href="/financeiro/custo-pessoal/importar" className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-acao="importar-planilha">
            <FileSpreadsheet className="w-4 h-4" /> Importar planilha
          </Link>
          <FecharMes competencia={competencia} rotulo={rotuloCompetencia(competencia, true)} jaFechado={fechadoAtual} />
        </div>
      </div>

      <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs sm:text-sm text-amber-800" data-aviso-gestao>
        <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <p>{AVISO_GESTAO} Os percentuais de encargos devem ser conferidos com o contador.</p>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Indicador titulo="Folha do mês (com encargos)" valor={formatarMoeda(total)} detalhe={`${comDados.length} colaborador(es) com dados`} icone={BadgeDollarSign} />
        <Indicador titulo="Encargos" valor={formatarMoeda(encargos)} detalhe={remuneracao > 0 ? `${((encargos / remuneracao) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% sobre a remuneração` : "—"} icone={Percent} />
        <Indicador titulo="Benefícios" valor={formatarMoeda(beneficios)} detalhe="VT, VA/VR, saúde e outros" icone={Users} />
        <Indicador titulo="Custo-hora médio (técnicos)" valor={formatarMoeda(custoHoraTecnico)} detalhe={tecnicos.length ? `${tecnicos.length} técnico(s) · insumo da margem` : "Sem técnicos com dados"} icone={Clock} />
      </div>

      {pendentes.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-surface-border bg-white px-3 py-2.5 text-sm text-ink" data-pendentes>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
          <p>
            <strong>{pendentes.length} colaborador(es) sem salário/dados de folha</strong> (entram com custo zero):{" "}
            {pendentes.slice(0, 6).map((p, i) => (
              <span key={p.id}>{i > 0 && ", "}<Link href={`/financeiro/custo-pessoal/colaborador/${p.id}`} className="text-primary-600 hover:underline">{p.nome}</Link></span>
            ))}
            {pendentes.length > 6 && ` e mais ${pendentes.length - 6}`}.
          </p>
        </div>
      )}

      {/* Evolução mês a mês (uma série: total da folha) */}
      <section className="card-padded" aria-labelledby="titulo-evolucao">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 id="titulo-evolucao" className="card-title">Evolução mês a mês</h2>
          <p className="text-xs text-ink-muted">Meses fechados (foto mensal){!fechadoAtual && " · tracejado = mês atual ainda não fechado"}<span className="sm:hidden"> · valores em R$ mil</span></p>
        </div>
        {barras.length <= 1 && historico.length === 0 ? (
          <p className="text-sm text-ink-muted mb-3">Nenhum mês fechado ainda. Use “Fechar mês” no fim de cada mês para guardar o histórico — mudanças de salário ou de encargos depois não alteram o que já foi fechado.</p>
        ) : null}
        <div className="flex items-end gap-1.5 sm:gap-3 h-48 overflow-x-auto pb-1" role="list" aria-label="Custo total da folha por mês">
          {barras.map((b) => (
            <div key={b.competencia} role="listitem" className="group relative flex-1 min-w-[38px] h-full flex flex-col justify-end items-center gap-1">
              <span className="hidden sm:inline text-[11px] font-medium text-ink tabular-nums whitespace-nowrap">{abreviar(b.total)}</span>
              <span className="sm:hidden text-[10px] font-medium text-ink tabular-nums whitespace-nowrap">{(b.total / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</span>
              <div
                className={cn("w-full max-w-[40px] rounded-t", b.projecao ? "border-2 border-dashed border-primary-400 bg-primary-50" : "bg-primary-500")}
                style={{ height: `${Math.max(2, (b.total / maxBarra) * 100)}%` }}
                title={`${rotuloCompetencia(b.competencia, true)}: ${formatarMoeda(b.total)}${b.projecao ? " (projeção, mês não fechado)" : ""}`}
              />
              <span className="text-[11px] text-ink-muted whitespace-nowrap">{rotuloCompetencia(b.competencia)}</span>
              <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 z-10 hidden group-hover:block rounded-md bg-ink px-2 py-1 text-[11px] text-white whitespace-nowrap shadow">
                {formatarMoeda(b.total)}{b.projecao ? " · projeção" : ""}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Por função e por equipe */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Distribuicao titulo="Por função / cargo" itens={porFuncao} total={total} />
        <Distribuicao titulo="Por equipe" itens={porEquipe} total={total} />
      </div>

      {/* Por colaborador */}
      <section className="bg-white rounded-xl border border-surface-border shadow-card" aria-labelledby="titulo-colaboradores">
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-surface-border">
          <h2 id="titulo-colaboradores" className="card-title">Por colaborador</h2>
          <span className="text-xs text-ink-muted">{linhas.length} ativo(s)</span>
        </div>
        {linhas.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted text-center">Nenhum colaborador ativo. Cadastre em Equipes → Colaboradores ou importe uma planilha.</p>
        ) : (
          <>
            {/* Celular: cartões */}
            <ul className="md:hidden divide-y divide-surface-border">
              {linhas.map((l) => (
                <li key={l.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/financeiro/custo-pessoal/colaborador/${l.id}`} className="text-sm font-semibold text-ink hover:text-primary-600 block truncate">{l.nome}</Link>
                      <p className="text-xs text-ink-muted truncate">{l.funcao} · {REGIME_LABEL[l.regime]}{l.equipe ? ` · ${l.equipe}` : ""}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-ink tabular-nums">{l.semDados ? "—" : formatarMoeda(l.custo.total)}</p>
                      <p className="text-[11px] text-ink-muted tabular-nums">{l.semDados ? "sem dados" : `${formatarMoeda(l.custo.custoHora)}/h`}</p>
                    </div>
                  </div>
                  {!l.semDados && (
                    <p className="mt-1 text-[11px] text-ink-muted">
                      Base {formatarMoeda(l.custo.base)} · Encargos {formatarMoeda(l.custo.encargos)} · Benefícios {formatarMoeda(l.custo.beneficios)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-ink-muted border-b border-surface-border">
                    <th className="px-4 py-2.5 font-semibold">Colaborador</th>
                    <th className="px-3 py-2.5 font-semibold">Contrato</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Base</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Adicionais + HE</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Encargos</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Benefícios</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Descontos</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Custo total</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Custo-hora</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {linhas.map((l) => (
                    <tr key={l.id} className="hover:bg-surface-alt/50">
                      <td className="px-4 py-2.5 min-w-[200px]">
                        <Link href={`/financeiro/custo-pessoal/colaborador/${l.id}`} className="font-medium text-ink hover:text-primary-600">{l.nome}</Link>
                        <p className="text-xs text-ink-muted">{l.funcao}{l.equipe ? ` · ${l.equipe}` : ""}{l.admitidoNoMes ? " · admitido neste mês" : ""}</p>
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted whitespace-nowrap">{REGIME_LABEL[l.regime]}</td>
                      {l.semDados ? (
                        <td colSpan={7} className="px-3 py-2.5 text-right text-xs text-amber-700">Sem salário/dados de folha</td>
                      ) : (
                        <>
                          <Num v={l.custo.base} />
                          <Num v={l.custo.adicional + l.custo.horasExtras} />
                          <Num v={l.custo.encargos} />
                          <Num v={l.custo.beneficios} />
                          <Num v={l.custo.descontos} negativo />
                          <td className="px-3 py-2.5 text-right font-semibold text-ink tabular-nums whitespace-nowrap">{formatarMoeda(l.custo.total)}</td>
                          <td className="px-4 py-2.5 text-right text-ink-muted tabular-nums whitespace-nowrap">{formatarMoeda(l.custo.custoHora)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-surface-border font-semibold text-ink">
                    <td className="px-4 py-3" colSpan={2}>Total</td>
                    <Num v={soma((l) => l.custo.base)} forte />
                    <Num v={soma((l) => l.custo.adicional + l.custo.horasExtras)} forte />
                    <Num v={encargos} forte />
                    <Num v={beneficios} forte />
                    <Num v={soma((l) => l.custo.descontos)} negativo forte />
                    <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">{formatarMoeda(total)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function abreviar(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return formatarMoeda(v);
}

function Num({ v, negativo, forte }: { v: number; negativo?: boolean; forte?: boolean }) {
  return (
    <td className={cn("px-3 py-2.5 text-right tabular-nums whitespace-nowrap", forte ? "py-3" : "text-ink-muted")}>
      {v === 0 ? "—" : `${negativo ? "− " : ""}${formatarMoeda(v)}`}
    </td>
  );
}

function Indicador({ titulo, valor, detalhe, icone: Icone }: { titulo: string; valor: string; detalhe: string; icone: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-white rounded-xl border border-surface-border p-4 sm:p-5 shadow-card min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{titulo}</p>
          <p className="text-2xl font-bold text-ink mt-2 tabular-nums whitespace-nowrap">{valor}</p>
          <p className="text-xs text-ink-subtle mt-1">{detalhe}</p>
        </div>
        <div className="p-2.5 rounded-xl shrink-0 bg-primary-50"><Icone className="w-5 h-5 text-primary-600" /></div>
      </div>
    </div>
  );
}

function Distribuicao({ titulo, itens, total }: { titulo: string; itens: { chave: string; qtd: number; total: number }[]; total: number }) {
  const max = Math.max(1, ...itens.map((i) => i.total));
  return (
    <section className="card-padded min-w-0">
      <h2 className="card-title mb-3">{titulo}</h2>
      {itens.length === 0 ? <p className="text-sm text-ink-muted">Sem dados.</p> : (
        <ul className="space-y-3">
          {itens.map((i) => (
            <li key={i.chave} className="min-w-0" title={`${i.chave}: ${formatarMoeda(i.total)}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink truncate">{i.chave} <span className="text-xs text-ink-muted">· {i.qtd}</span></span>
                <span className="text-ink font-medium tabular-nums whitespace-nowrap">
                  {formatarMoeda(i.total)} <span className="text-xs text-ink-muted">{total > 0 ? `${Math.round((i.total / total) * 100)}%` : ""}</span>
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-surface-alt overflow-hidden">
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.max(1, (i.total / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
