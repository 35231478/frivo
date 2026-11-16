import type { Metadata } from "next";
import { Dica } from "@/components/ui/dica";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { partesBR } from "@/lib/fuso";
import { cn, formatarMoeda } from "@/lib/utils";
import { agrupar, evolucao, folhaAtual } from "@/lib/folha/server";
import { AVISO_GESTAO, FUNCOES_CUSTO_HORA, REGIME_LABEL, competenciaDe, rotuloCompetencia } from "@/lib/folha/calculo";
import { FecharMes } from "@/components/folha/fechar-mes";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { PLANILHA } from "@/lib/planilha";
import { AlertTriangle, BadgeDollarSign, Clock, FileSpreadsheet, Info, Percent, Settings2, Users } from "lucide-react";

export const metadata: Metadata = { title: "Custo de pessoal" };

const AJUDA = "O custo de cada colaborador no mês: remuneração, adicionais e horas extras, mais encargos e benefícios pelos percentuais de Encargos. Os dados vêm do cadastro do colaborador — a planilha importada preenche os mesmos campos. \"Fechar o mês\" guarda a foto do custo: reajuste depois não muda mês fechado.";

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
          <div className="p-2 bg-surface-alt rounded-lg"><BadgeDollarSign className="w-5 h-5 text-ink-muted" /></div>
          <div>
            <h1 className="page-title flex items-center gap-1.5">Custo de pessoal <Dica texto={AJUDA} rotulo="Custo de pessoal" lado="direita" /></h1>
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

      <div className="flex gap-2 rounded-lg border border-atencao/20 bg-atencao-claro px-3 py-2.5 text-xs sm:text-sm text-atencao-texto" data-aviso-gestao>
        <Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <p>{AVISO_GESTAO} Os percentuais de encargos devem ser conferidos com o contador.</p>
      </div>

      {/* Indicadores */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Indicador titulo="Folha do mês (com encargos)" valor={formatarMoeda(total)} detalhe={`${plural(comDados.length, "colaborador", "colaboradores")} com dados`} icone={BadgeDollarSign} />
        <Indicador titulo="Encargos" valor={formatarMoeda(encargos)} detalhe={remuneracao > 0 ? `${((encargos / remuneracao) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% sobre a remuneração` : "—"} icone={Percent} />
        <Indicador titulo="Benefícios" valor={formatarMoeda(beneficios)} detalhe="VT, VA/VR, saúde e outros" icone={Users} />
        <Indicador titulo="Custo-hora médio (técnicos)" valor={formatarMoeda(custoHoraTecnico)} detalhe={tecnicos.length ? `${plural(tecnicos.length, "técnico", "técnicos")} · insumo da margem` : "Sem técnicos com dados"} icone={Clock} />
      </div>

      {pendentes.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-surface-border bg-white px-3 py-2.5 text-sm text-ink" data-pendentes>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-atencao-texto" aria-hidden />
          <p>
            <strong>{plural(pendentes.length, "colaborador", "colaboradores")} sem salário ou dados de folha</strong> (entram com custo zero):{" "}
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
          <p className="flex items-center gap-1 text-sm text-ink-muted mb-3">Nenhum mês fechado. Use “Fechar mês” para guardar o histórico. <Dica rotulo="Fechar mês" texto="Mudanças posteriores de salário ou encargos não alteram os meses já fechados." /></p>
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

      {/* Por colaborador — tabela da casa: colunas escolhíveis, cartões no celular */}
      <section className="bg-white rounded-card border border-surface-border shadow-card overflow-hidden" aria-labelledby="titulo-colaboradores">
        <h2 id="titulo-colaboradores" className="sr-only">Por colaborador</h2>
        {linhas.length === 0 ? (
          <ListaVazia mensagem="Nenhum colaborador ativo. Cadastre em Equipes › Colaboradores ou importe uma planilha." />
        ) : (
          <TabelaPro
            tela="custo-pessoal"
            atributos={{ "data-tabela-custo-pessoal": true }}
            barra={
              <p className="text-xs text-ink-muted" data-resumo-folha>
                Por colaborador · {plural(linhas.length, "ativo", "ativos")}
                <span className="hidden sm:inline">
                  {" · "}Base {formatarMoeda(soma((l) => l.custo.base))}
                  {" · "}Adicionais e HE {formatarMoeda(soma((l) => l.custo.adicional + l.custo.horasExtras))}
                  {" · "}Descontos {formatarMoeda(soma((l) => l.custo.descontos))}
                </span>
              </p>
            }
            cartoes={
              <>
                {/* No celular a faixa da tabela não aparece: o título e a contagem vêm aqui */}
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-surface-border">
                  <h3 className="text-sm font-semibold text-ink">Por colaborador</h3>
                  <span className="text-xs text-ink-muted">{plural(linhas.length, "ativo", "ativos")}</span>
                </div>
                <ul className="divide-y divide-surface-border" data-cartoes>
                  {linhas.map((l) => (
                      <li key={l.id} className="px-4 py-3" data-colaborador={l.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link href={`/financeiro/custo-pessoal/colaborador/${l.id}`} className="text-sm font-semibold text-ink hover:text-primary-600 block truncate">{l.nome}</Link>
                            <p className="text-xs text-ink-muted truncate">{l.funcao} · {REGIME_LABEL[l.regime]}{l.equipe ? ` · ${l.equipe}` : ""}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={cn(PLANILHA.numero, "text-sm font-semibold text-ink")}>{l.semDados ? "—" : formatarMoeda(l.custo.total)}</p>
                            <p className={cn(PLANILHA.numero, "text-[11px] text-ink-muted")}>{l.semDados ? "sem dados" : `${formatarMoeda(l.custo.custoHora)}/h`}</p>
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
              </>
            }
            colunas={[
              { id: "nome", titulo: "Colaborador", minimo: 200, obrigatoria: true, classe: "truncate" },
              { id: "contrato", titulo: "Contrato", largura: 130 },
              { id: "base", titulo: "Base", alinhar: "direita", largura: 110 },
              { id: "adicionais", titulo: "Adicionais e HE", alinhar: "direita", largura: 130 },
              { id: "encargos", titulo: "Encargos", alinhar: "direita", largura: 110 },
              { id: "beneficios", titulo: "Benefícios", alinhar: "direita", largura: 110 },
              { id: "descontos", titulo: "Descontos", alinhar: "direita", largura: 110, oculta: true },
              { id: "total", titulo: "Custo total", alinhar: "direita", largura: 120, obrigatoria: true },
              { id: "hora", titulo: "Custo-hora", alinhar: "direita", largura: 110 },
            ]}
            linhas={linhas.map((l) => ({
              id: l.id,
              atributos: { "data-linha": l.id },
              titulos: { nome: l.nome },
              celulas: {
                nome: (
                  <>
                    <Link href={`/financeiro/custo-pessoal/colaborador/${l.id}`} className="font-medium text-ink hover:text-primary-600">{l.nome}</Link>
                    <p className="text-xs text-ink-muted truncate">{l.funcao}{l.equipe ? ` · ${l.equipe}` : ""}{l.admitidoNoMes ? " · admitido neste mês" : ""}</p>
                  </>
                ),
                contrato: <span className={PLANILHA.apagado}>{REGIME_LABEL[l.regime]}</span>,
                base: <Num v={l.custo.base} vazio={l.semDados} />,
                adicionais: <Num v={l.custo.adicional + l.custo.horasExtras} vazio={l.semDados} />,
                encargos: <Num v={l.custo.encargos} vazio={l.semDados} />,
                beneficios: <Num v={l.custo.beneficios} vazio={l.semDados} />,
                descontos: <Num v={l.custo.descontos} negativo vazio={l.semDados} />,
                total: l.semDados
                  ? <span className="text-xs text-atencao-texto">Sem dados de folha</span>
                  : <span className={cn(PLANILHA.numero, "font-semibold text-ink")}>{formatarMoeda(l.custo.total)}</span>,
                hora: <Num v={l.custo.custoHora} vazio={l.semDados} />,
              },
            }))}
          />
        )}
      </section>
    </div>
  );
}

/** "1 colaborador" / "8 colaboradores": o plural escrito do manifesto. */
const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;

function abreviar(v: number) {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return formatarMoeda(v);
}

/** Valor da planilha: alinhado pelos algarismos; zero e sem dados viram travessão. */
function Num({ v, negativo, vazio }: { v: number; negativo?: boolean; vazio?: boolean }) {
  return (
    <span className={cn(PLANILHA.numero, "text-ink-muted")}>
      {vazio || v === 0 ? "—" : `${negativo ? "− " : ""}${formatarMoeda(v)}`}
    </span>
  );
}

function Indicador({ titulo, valor, detalhe, icone: Icone }: { titulo: string; valor: string; detalhe: string; icone: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="bg-white rounded-card border border-surface-border p-4 sm:p-5 shadow-card min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{titulo}</p>
          <p className="text-2xl font-bold text-ink mt-2 tabular-nums whitespace-nowrap">{valor}</p>
          <p className="text-xs text-ink-subtle mt-1">{detalhe}</p>
        </div>
        <div className="p-2.5 rounded-card shrink-0 bg-primary-50"><Icone className="w-5 h-5 text-primary-600" /></div>
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
