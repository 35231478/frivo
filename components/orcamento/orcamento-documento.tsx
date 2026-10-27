import { formatarCpfCnpj, formatarData, formatarMoeda, formatarTelefone, cn } from "@/lib/utils";
import { calcularOrcamento, versaoCliente, type EntradaCalculo, type TipoDesconto } from "@/lib/orcamentos/calculo";
import { CLASSE_ETAPA, LABELS_ETAPA, etapaCiclo } from "@/lib/orcamentos/ciclo";
import { linhasDadosBancarios } from "@/lib/orcamentos/dados-bancarios";
import {
  destinatarioOrcamento, linhasCondicoes, linhasNaoIncluso, normasDoDocumento, numeroFormalOrcamento, textoArt, timbreEmpresa,
  type ContatoPara, type UnidadePara,
} from "@/lib/orcamentos/proposta";

interface ItemDoc {
  descricao: string;
  quantidade: unknown;
  valorUnitario: unknown;
  valorTotal: unknown;
  observacao?: string | null;
}

/** Anexo da proposta já com o link (público ou interno) — ver lib/orcamentos/documento-server.ts */
export interface AnexoDocumento {
  id: string;
  tipo: "FOTO" | "ARQUIVO";
  nome: string;
  mime: string;
  tamanho: number;
  legenda: string | null;
  origem: string | null;
  url: string;
}

export interface OrcamentoDocumentoProps {
  orcamento: {
    codigo: string;
    nome: string;
    status: string;
    descricao?: string | null;
    observacao?: string | null;
    validadeEm?: Date | string | null;
    /** Prazo de execução dos serviços e forma de pagamento (texto curto); vazios não aparecem */
    prazoExecucao?: string | null;
    formaPagamento?: string | null;
    /** Garantias, "não incluso" e normas (proposta corporativa); vazios = o bloco não aparece */
    garantiaServico?: string | null;
    garantiaPecas?: string | null;
    naoIncluso?: string | null;
    normas?: string[] | null;
    artNumero?: string | null;
    responsavelTecnico?: { nome: string; crea?: string | null } | null;
    unidade?: UnidadePara | null;
    contatoCliente?: ContatoPara | null;
    criadoEm: Date | string;
    enviadoEm?: Date | string | null;
    visualizadoEm?: Date | string | null;
    assinadoEm?: Date | string | null;
    assinadoPor?: string | null;
    assinadoCpf?: string | null;
    assinaturaUrl?: string | null;
    totalServicos: unknown;
    totalProdutos: unknown;
    descontoServicos?: unknown;
    tipoDescontoServicos?: string | null;
    descontoProdutos?: unknown;
    tipoDescontoProdutos?: string | null;
    issAliquota?: unknown;
    totalGeral: unknown;
    servicos: ItemDoc[];
    produtos: ItemDoc[];
  };
  empresa: {
    nome: string;
    nomeFantasia?: string | null;
    cnpj: string;
    inscricaoEstadual?: string | null;
    inscricaoMunicipal?: string | null;
    email?: string | null;
    telefone?: string | null;
    celular?: string | null;
    site?: string | null;
    logo?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    /** Dados bancários do cadastro da empresa (sem conta e sem PIX, o bloco não aparece) */
    bancoNome?: string | null;
    bancoAgencia?: string | null;
    bancoConta?: string | null;
    bancoTipoConta?: string | null;
    bancoTitular?: string | null;
    pixChave?: string | null;
  };
  cliente: {
    nome: string;
    nomeFantasia?: string | null;
    cpfCnpj: string;
    inscricaoEstadual?: string | null;
    contato?: string | null;
    email?: string | null;
    telefone?: string | null;
    endereco?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
  };
  /** Fotos e arquivos que vão junto com a proposta */
  anexos?: AnexoDocumento[];
  variante?: "completa" | "compacta";
  /**
   * "cliente" (link público/impressão): ISS EMBUTIDO nos preços dos serviços, sem linha própria, com a
   * nota discreta "valores com impostos inclusos". "interna" (tela do escritório): ISS em linha própria,
   * status e observações internas.
   */
  versao?: "cliente" | "interna";
}

function n(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

const FORMATOS = { doc: formatarCpfCnpj, tel: formatarTelefone };

/** Título de seção do documento: não fica sozinho no pé da página (vai junto com o conteúdo) */
function Rotulo({ children }: { children: React.ReactNode }) {
  return <p className="text-xs uppercase tracking-wider text-ink-muted mb-2 font-semibold break-after-avoid">{children}</p>;
}

function tamanhoLegivel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function OrcamentoDocumento({ orcamento, empresa, cliente, anexos = [], variante = "completa", versao = "cliente" }: OrcamentoDocumentoProps) {
  // Mesmo cálculo da tela e do servidor (lib/orcamentos/calculo.ts), a partir do que está gravado
  const entrada: EntradaCalculo = {
    servicos: orcamento.servicos, produtos: orcamento.produtos,
    descontoServicos: orcamento.descontoServicos, tipoDescontoServicos: (orcamento.tipoDescontoServicos ?? "VALOR") as TipoDesconto,
    descontoProdutos: orcamento.descontoProdutos, tipoDescontoProdutos: (orcamento.tipoDescontoProdutos ?? "VALOR") as TipoDesconto,
    issAliquota: orcamento.issAliquota,
  };
  const t = calcularOrcamento(entrada);
  const banco = linhasDadosBancarios(empresa, formatarCpfCnpj);
  const vc = versao === "cliente" ? versaoCliente(entrada) : null;
  const grupoServicos: GrupoDoc = vc
    ? { itens: vc.servicos, subtotal: vc.subtotalServicos, desconto: vc.descontoServicos, total: vc.totalServicos }
    : { itens: orcamento.servicos.map((s) => ({ quantidade: n(s.quantidade), valorUnitario: n(s.valorUnitario), valorTotal: n(s.valorTotal) })), subtotal: t.subtotalServicos, desconto: t.descontoServicos, total: t.totalServicos, issAliquota: t.issAliquota, valorIss: t.valorIss };
  const grupoProdutos: GrupoDoc = vc
    ? { itens: vc.produtos, subtotal: vc.subtotalProdutos, desconto: vc.descontoProdutos, total: vc.totalProdutos }
    : { itens: orcamento.produtos.map((p) => ({ quantidade: n(p.quantidade), valorUnitario: n(p.valorUnitario), valorTotal: n(p.valorTotal) })), subtotal: t.subtotalProdutos, desconto: t.descontoProdutos, total: t.totalProdutos };

  const timbre = timbreEmpresa(empresa, FORMATOS);
  const para = destinatarioOrcamento(cliente, orcamento.unidade, orcamento.contatoCliente, FORMATOS);
  const condicoes = linhasCondicoes({
    prazoExecucao: orcamento.prazoExecucao, formaPagamento: orcamento.formaPagamento,
    garantiaServico: orcamento.garantiaServico, garantiaPecas: orcamento.garantiaPecas,
    validadeEm: orcamento.validadeEm ? formatarData(orcamento.validadeEm) : null,
  });
  // "Condições" só aparece com prazo/pagamento/garantia; a validade sozinha já está no cabeçalho
  const temCondicoes = condicoes.some((c) => c.chave !== "validade");
  const naoIncluso = linhasNaoIncluso(orcamento.naoIncluso);
  const normas = normasDoDocumento(orcamento.normas);
  const rt = orcamento.responsavelTecnico;
  const fotos = anexos.filter((a) => a.tipo === "FOTO");
  const arquivos = anexos.filter((a) => a.tipo === "ARQUIVO");

  return (
    <div className="bg-white text-ink print:text-[12px]" data-documento-orcamento={versao}>
      {/* Timbre: logo, razão social, CNPJ/IE/IM, endereço e contatos — do cadastro da empresa */}
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 sm:gap-6 pb-5 border-b-2 border-primary-500 break-inside-avoid" data-timbre>
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {empresa.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={empresa.logo} alt={`Logo ${timbre.titulo}`} className="w-16 h-16 sm:w-20 sm:h-20 object-contain shrink-0" data-logo-empresa />
          ) : (
            <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-lg bg-acento flex items-center justify-center text-white font-display text-2xl font-bold" aria-hidden>
              {timbre.titulo.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 space-y-0.5">
            <p className="text-lg sm:text-xl font-bold text-ink leading-tight">{timbre.titulo}</p>
            {timbre.razaoSocial && <p className="text-xs text-ink-muted">{timbre.razaoSocial}</p>}
            <p className="text-xs text-ink-muted" data-timbre-documentos>{timbre.documentos}</p>
            {timbre.endereco && <p className="text-xs text-ink-muted">{timbre.endereco}</p>}
            {timbre.contato && <p className="text-xs text-ink-muted [overflow-wrap:anywhere]" data-timbre-contato>{timbre.contato}</p>}
          </div>
        </div>
        <div className="sm:text-right shrink-0" data-numero-orcamento>
          <p className="text-xs uppercase tracking-wider text-ink-muted">Orçamento Nº</p>
          <p className="font-mono text-2xl font-bold text-primary-600 tabular-nums">{numeroFormalOrcamento(orcamento.codigo)}</p>
          {versao === "interna" && (
            <span className={cn("mt-2 inline-flex", CLASSE_ETAPA[etapaCiclo(orcamento)])} data-etapa-documento>
              {LABELS_ETAPA[etapaCiclo(orcamento)]}
            </span>
          )}
        </div>
      </header>

      {/* Para: (cliente destinatário) + datas */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5 py-5 border-b border-surface-border break-inside-avoid">
        <div className="md:col-span-2 min-w-0" data-para>
          <Rotulo>Para</Rotulo>
          <p className="font-semibold text-ink">{para.razaoSocial}</p>
          {para.nomeFantasia && <p className="text-xs text-ink-muted">{para.nomeFantasia}</p>}
          <p className="text-sm text-ink-muted">{para.documentos}</p>
          {para.aosCuidados && <p className="text-sm text-ink mt-1" data-para-ac><span className="text-ink-muted">A/C</span> {para.aosCuidados}</p>}
          {para.contato && <p className="text-sm text-ink-muted [overflow-wrap:anywhere]">{para.contato}</p>}
          {(para.unidade || para.endereco) && (
            <p className="text-sm text-ink-muted mt-1" data-para-endereco>
              {para.unidade && <span className="font-medium text-ink">{para.unidade}{para.endereco ? " — " : ""}</span>}
              {para.endereco}
            </p>
          )}
        </div>
        <dl className="text-sm space-y-1 md:border-l md:border-surface-border md:pl-5">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-muted">Emissão</dt>
            <dd className="font-medium text-ink">{formatarData(orcamento.criadoEm)}</dd>
          </div>
          {orcamento.validadeEm && (
            <div className="flex justify-between gap-3" data-validade-documento>
              <dt className="text-ink-muted">Válido até</dt>
              <dd className="font-medium text-ink">{formatarData(orcamento.validadeEm)}</dd>
            </div>
          )}
        </dl>
      </section>

      {/* Objeto */}
      <section className="py-5 border-b border-surface-border">
        <Rotulo>Objeto da proposta</Rotulo>
        <p className="text-base font-semibold text-ink">{orcamento.nome}</p>
        {orcamento.descricao && <p className="text-sm text-ink whitespace-pre-wrap mt-2">{orcamento.descricao}</p>}
      </section>

      {orcamento.servicos.length > 0 && (
        <TabelaGrupo titulo="Serviços" rotulo="serviços" itens={orcamento.servicos} grupo={grupoServicos} />
      )}

      {orcamento.produtos.length > 0 && (
        <div className="border-t border-surface-border">
          <TabelaGrupo titulo="Produtos" rotulo="produtos" itens={orcamento.produtos} grupo={grupoProdutos} />
        </div>
      )}

      {/* Totais */}
      <section className="py-5 border-t-2 border-primary-500 flex justify-end break-inside-avoid" data-totais-documento>
        <div className="w-full md:w-96 space-y-2">
          {orcamento.servicos.length > 0 && orcamento.produtos.length > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Total serviços</span>
                <span className="font-mono text-ink">{formatarMoeda(grupoServicos.total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Total produtos</span>
                <span className="font-mono text-ink">{formatarMoeda(grupoProdutos.total)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between items-baseline pt-2 border-t-2 border-success-500/40">
            <span className="text-sm font-bold uppercase tracking-wider text-ink-muted">Total geral</span>
            <span className="text-2xl font-bold text-success-700 tabular-nums" data-total-geral>{formatarMoeda(t.totalGeral)}</span>
          </div>
          {vc?.impostosInclusos && (
            <p className="text-right text-[11px] text-ink-subtle" data-impostos-inclusos>Valores com impostos inclusos.</p>
          )}
          {versao === "interna" && t.valorIss > 0 && (
            <p className="text-right text-[11px] text-ink-subtle print:hidden">Versão interna: no documento do cliente o ISS vem embutido nos preços dos serviços.</p>
          )}
        </div>
      </section>

      {/* Condições: prazo, pagamento, garantias e validade (só os preenchidos) */}
      {temCondicoes && (
        <section className="py-5 border-t border-surface-border break-inside-avoid" data-condicoes-documento>
          <Rotulo>Condições</Rotulo>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {condicoes.map((c) => (
              <div key={c.chave} {...{ [`data-${c.chave}`]: "" }}>
                <dt className="text-ink-muted">{c.rotulo}</dt>
                <dd className="font-medium text-ink">{c.valor}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Não incluso (exclusões do escopo) */}
      {naoIncluso.length > 0 && (
        <section className="py-5 border-t border-surface-border break-inside-avoid" data-nao-incluso-documento>
          <Rotulo>Não incluso</Rotulo>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-ink list-disc pl-5">
            {naoIncluso.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>
      )}

      {/* Responsável técnico + ART e normas atendidas */}
      {(rt || normas.length > 0) && (
        <section className="py-5 border-t border-surface-border grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 break-inside-avoid">
          {rt && (
            <div data-rt-documento>
              <Rotulo>Responsável técnico</Rotulo>
              <p className="text-sm font-semibold text-ink">{rt.nome}</p>
              {rt.crea && <p className="text-sm text-ink-muted">CREA {rt.crea}</p>}
              <p className="text-sm text-ink-muted" data-art>{textoArt(orcamento.artNumero)}</p>
            </div>
          )}
          {normas.length > 0 && (
            <div data-normas-documento className={cn(!rt && "sm:col-span-2")}>
              <Rotulo>Normas atendidas</Rotulo>
              <ul className="space-y-1.5 text-sm">
                {normas.map((nm) => (
                  <li key={nm.codigo} data-norma-documento={nm.codigo}>
                    <span className="font-semibold text-ink">{nm.titulo}</span>
                    <span className="text-ink-muted"> — {nm.descricao}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Dados bancários (do cadastro da empresa) */}
      {banco && (
        <section className="py-5 border-t border-surface-border break-inside-avoid" data-dados-bancarios>
          <Rotulo>Dados para pagamento</Rotulo>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
            {banco.map((l) => (
              <div key={l.rotulo} className={cn("flex gap-2", (l.rotulo === "Titular" || l.rotulo === "Chave PIX") && "sm:col-span-2")}>
                <dt className="text-ink-muted shrink-0">{l.rotulo}:</dt>
                <dd className="font-medium text-ink [overflow-wrap:anywhere]">{l.valor}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* Registro fotográfico (fotos da OS / enviadas para a proposta) */}
      {fotos.length > 0 && (
        <section className="py-5 border-t border-surface-border" data-fotos-documento>
          <Rotulo>Registro fotográfico</Rotulo>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {fotos.map((f) => (
              <figure key={f.id} className="break-inside-avoid rounded-lg border border-surface-border overflow-hidden bg-white" data-foto-documento={f.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${f.url}?inline=1`} alt={f.legenda ?? f.nome} className="w-full aspect-[4/3] object-cover bg-surface-alt" />
                <figcaption className="px-2 py-1.5 text-[11px] leading-snug">
                  <span className="block text-ink">{f.legenda ?? f.nome}</span>
                  {f.origem && <span className="block text-ink-subtle">{f.origem}</span>}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* Arquivos anexos (datasheet, catálogo) */}
      {arquivos.length > 0 && (
        <section className="py-5 border-t border-surface-border break-inside-avoid" data-arquivos-documento>
          <Rotulo>Anexos</Rotulo>
          <ul className="space-y-1 text-sm">
            {arquivos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-2">
                <a href={a.url} className="font-medium text-primary-600 hover:underline [overflow-wrap:anywhere] print:text-ink print:no-underline" data-arquivo-documento={a.id}>{a.nome}</a>
                <span className="text-xs text-ink-subtle">{tamanhoLegivel(a.tamanho)}{a.legenda ? ` · ${a.legenda}` : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Observações internas: só na tela do escritório (o campo do construtor é "Observações internas") */}
      {orcamento.observacao && variante === "completa" && versao === "interna" && (
        <section className="py-5 border-t border-surface-border" data-observacoes-internas>
          <Rotulo>Observações internas</Rotulo>
          <p className="text-sm text-ink whitespace-pre-wrap">{orcamento.observacao}</p>
        </section>
      )}

      {/* Bloco de assinatura */}
      {orcamento.status === "APROVADO" && orcamento.assinaturaUrl && (
        <section className="py-5 border-t-2 border-success-500 break-inside-avoid">
          <p className="text-xs uppercase tracking-wider text-success-700 mb-2 font-bold">Aprovação digital</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1 text-sm">
              <div>
                <span className="text-ink-muted">Aprovado por:</span>{" "}
                <span className="font-semibold text-ink">{orcamento.assinadoPor}</span>
              </div>
              {orcamento.assinadoCpf && (
                <div>
                  <span className="text-ink-muted">CPF:</span>{" "}
                  <span className="text-ink">{formatarCpfCnpj(orcamento.assinadoCpf)}</span>
                </div>
              )}
              {orcamento.assinadoEm && (
                <div>
                  <span className="text-ink-muted">Data:</span>{" "}
                  <span className="text-ink">{formatarData(orcamento.assinadoEm, "dd/MM/yyyy 'às' HH:mm")}</span>
                </div>
              )}
            </div>
            <div className="border-2 border-dashed border-success-500/50 rounded-lg p-2 bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={orcamento.assinaturaUrl} alt="Assinatura digital" className="w-full h-24 object-contain" />
              <p className="text-center text-[10px] text-ink-subtle mt-1">Assinatura digital</p>
            </div>
          </div>
        </section>
      )}

      {/* Rodapé */}
      <footer className="mt-6 pt-4 border-t border-surface-border text-center text-xs text-ink-subtle break-inside-avoid">
        <p>
          {timbre.titulo} · {timbre.documentos}
          {empresa.telefone && ` · ${formatarTelefone(empresa.telefone)}`}
        </p>
        <p className="mt-1">Orçamento Nº {numeroFormalOrcamento(orcamento.codigo)} · documento gerado em {formatarData(new Date(), "dd/MM/yyyy 'às' HH:mm")}</p>
      </footer>
    </div>
  );
}

interface GrupoDoc {
  itens: { quantidade: number; valorUnitario: number; valorTotal: number }[];
  subtotal: number;
  desconto: number;
  total: number;
  /** Só na versão interna: o ISS em linha própria */
  issAliquota?: number;
  valorIss?: number;
}

/**
 * Tabela de um grupo. Na impressão: o cabeçalho se repete em cada página (thead) e nenhuma linha
 * é cortada ao meio; os subtotais ficam FORA da tabela (num tfoot o navegador repetiria o
 * "Subtotal" em toda página) e não se separam da última linha.
 */
function TabelaGrupo({ titulo, rotulo, itens, grupo }: { titulo: string; rotulo: string; itens: ItemDoc[]; grupo: GrupoDoc }) {
  const comIss = (grupo.valorIss ?? 0) > 0;
  const mostrarTotal = grupo.desconto > 0 || comIss;
  return (
    <section className="py-5" data-grupo-documento={rotulo}>
      <Rotulo>{titulo}</Rotulo>
      <div className="print:overflow-visible">
        <table className="w-full text-sm">
          <thead className="[display:table-header-group]">
            <tr className="bg-surface-alt border-b border-surface-border">
              <th scope="col" className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Descrição</th>
              {/* Celular: Qtd e Unitário vão para baixo da descrição (a tabela não rola nem corta) */}
              <th scope="col" className="hidden sm:table-cell text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-16">Qtd</th>
              <th scope="col" className="hidden sm:table-cell text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-28">Unitário</th>
              <th scope="col" className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase w-28 sm:w-32">Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it, i) => (
              <tr key={i} className="border-b border-surface-border break-inside-avoid">
                <td className="px-3 py-2.5 text-ink">
                  {it.descricao}
                  {it.observacao && <p className="text-xs text-ink-muted italic whitespace-pre-line">{it.observacao}</p>}
                  <p className="sm:hidden text-xs text-ink-muted tabular-nums mt-0.5" data-qtd-unitario-celular>{n(it.quantidade)} × {formatarMoeda(grupo.itens[i]?.valorUnitario ?? 0)}</p>
                </td>
                <td className="hidden sm:table-cell px-3 py-2.5 text-right text-ink-muted tabular-nums">{n(it.quantidade)}</td>
                <td className="hidden sm:table-cell px-3 py-2.5 text-right text-ink-muted tabular-nums whitespace-nowrap">{formatarMoeda(grupo.itens[i]?.valorUnitario ?? 0)}</td>
                <td className="px-3 py-2.5 text-right font-semibold text-ink tabular-nums whitespace-nowrap">{formatarMoeda(grupo.itens[i]?.valorTotal ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-1 ml-auto w-full sm:w-80 text-sm break-inside-avoid break-before-avoid" data-subtotais-grupo={rotulo}>
        <div className="flex justify-between gap-3 px-3 py-1.5">
          <dt className="font-semibold text-ink-muted">Subtotal {rotulo}</dt>
          <dd className="font-bold text-ink tabular-nums">{formatarMoeda(grupo.subtotal)}</dd>
        </div>
        {grupo.desconto > 0 && (
          <div className="flex justify-between gap-3 px-3 py-1">
            <dt className="text-ink-muted">Desconto {rotulo}</dt>
            <dd className="font-mono text-atrasado tabular-nums">− {formatarMoeda(grupo.desconto)}</dd>
          </div>
        )}
        {comIss && (
          <div className="flex justify-between gap-3 px-3 py-1" data-linha-iss-documento>
            <dt className="font-semibold text-primary-700">ISS ({String(grupo.issAliquota).replace(".", ",")}%)</dt>
            <dd className="font-mono font-semibold text-primary-700 tabular-nums">+ {formatarMoeda(grupo.valorIss!)}</dd>
          </div>
        )}
        {mostrarTotal && (
          <div className="flex justify-between gap-3 px-3 py-1.5 border-t border-surface-linha">
            <dt className="font-semibold text-ink">Total {rotulo}{comIss ? " (com ISS)" : ""}</dt>
            <dd className="font-bold text-ink tabular-nums">{formatarMoeda(grupo.total)}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
