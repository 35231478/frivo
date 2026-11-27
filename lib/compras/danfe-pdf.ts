/**
 * O PDF da DANFE SIMPLIFICADA da nota de compra (Baixar PDF na visualização rápida). Usa a maquinaria de
 * desenho da casa (lib/pdf/desenho, pdf-lib): A4, seções, campos, tabela de itens que continua noutra
 * folha e rodapé numerado. O conteúdo vem de `lerDanfe` (lib/compras/danfe), o mesmo da gaveta.
 *
 * Não é a DANFE oficial do emitente (layout da SEFAZ com código de barras): o próprio documento avisa.
 */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { C, Desenho, MARGEM } from "@/lib/pdf/desenho";
import type { DadosDanfe } from "@/lib/compras/danfe";
import { enderecoEmLinha } from "@/lib/compras/danfe-texto";
import { chaveEmBlocos } from "@/lib/compras/rotulos";
import { formatarCpfCnpj, formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";

export const AVISO_DANFE_SIMPLIFICADA = "DANFE simplificada para consulta, gerada a partir do XML importado. Não substitui a DANFE do emitente.";

const ou = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
const pct = (n: number) => (n ? `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—");
const doc = (d: string) => (d ? formatarCpfCnpj(d) : "—");

export async function gerarDanfePdf(d: DadosDanfe, geradoEm: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const titulo = `DANFE simplificada · NF-e ${d.numero}/${d.serie}`;
  pdf.setTitle(titulo); pdf.setAuthor(d.emitente.nome); pdf.setSubject("Nota fiscal de compra");
  pdf.setCreator("Frivo"); pdf.setProducer("Frivo"); pdf.setLanguage("pt-BR");
  const t = new Desenho(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold),
    { empresa: d.emitente.nome || "Emitente", titulo, geradoEm });

  t.novaPagina();
  t.escrever(`NF-e ${d.numero} · Série ${d.serie}`, MARGEM, t.y, { tamanho: 16, fonte: t.negrito });
  t.y += 22;
  t.escrever(ou(d.naturezaOperacao), MARGEM, t.y, { tamanho: 9.5, cor: C.apoio });
  t.y += 22;

  t.secao(1, "Identificação");
  t.campos([
    { rotulo: "Chave de acesso", valor: d.chave ? chaveEmBlocos(d.chave) : "—" },
    { rotulo: "Protocolo de autorização", valor: d.protocolo ? `${d.protocolo.numero}${d.protocolo.data ? ` · ${formatarDataHora(d.protocolo.data)}` : ""}` : "—" },
    { rotulo: "Emissão", valor: d.emissao ? formatarDataHora(d.emissao) : "—" },
    { rotulo: "Saída/entrada", valor: d.saidaEntrada ? formatarDataHora(d.saidaEntrada) : "—" },
  ]);

  t.secao(2, "Emitente");
  t.campos([
    { rotulo: "Razão social", valor: ou(d.emitente.nome) },
    { rotulo: "CNPJ / IE", valor: `${doc(d.emitente.documento)} · IE ${ou(d.emitente.ie)}` },
    { rotulo: "Endereço", valor: ou(enderecoEmLinha(d.emitente.endereco)) },
    { rotulo: "Telefone", valor: ou(d.emitente.endereco?.fone) },
  ]);

  t.secao(3, "Destinatário");
  t.campos([
    { rotulo: "Razão social", valor: ou(d.destinatario.nome) },
    { rotulo: "CNPJ/CPF / IE", valor: `${doc(d.destinatario.documento)} · IE ${ou(d.destinatario.ie)}` },
    { rotulo: "Endereço", valor: ou(enderecoEmLinha(d.destinatario.endereco)) },
  ]);

  t.secao(4, "Itens");
  t.tabela(
    [
      { titulo: "Código", largura: 56 }, { titulo: "Descrição", largura: 150 }, { titulo: "NCM", largura: 44 },
      { titulo: "CFOP", largura: 30 }, { titulo: "Un", largura: 22 }, { titulo: "Qtd", largura: 38, direita: true },
      { titulo: "Unit. (R$)", largura: 48, direita: true }, { titulo: "Total (R$)", largura: 52, direita: true },
      { titulo: "ICMS (R$)", largura: 44, direita: true }, { titulo: "IPI (R$)", largura: 27, direita: true },
    ],
    d.itens.map((i) => [i.codigo, i.descricao, i.ncm, i.cfop, i.unidade, qtd(i.quantidade), formatarMoeda(i.valorUnitario).replace("R$", "").trim(),
      formatarMoeda(i.valorTotal).replace("R$", "").trim(), i.valorIcms ? `${formatarMoeda(i.valorIcms).replace("R$", "").trim()} (${pct(i.aliquotaIcms)})` : "—",
      i.valorIpi ? formatarMoeda(i.valorIpi).replace("R$", "").trim() : "—"]),
    { tamanho: 7.5 },
  );

  t.secao(5, "Impostos e totais");
  const v = d.totais;
  t.campos([
    { rotulo: "Base de cálculo do ICMS", valor: formatarMoeda(v.baseIcms) }, { rotulo: "Valor do ICMS", valor: formatarMoeda(v.icms) },
    { rotulo: "Base de cálculo do ICMS-ST", valor: formatarMoeda(v.baseIcmsSt) }, { rotulo: "Valor do ICMS-ST", valor: formatarMoeda(v.icmsSt) },
    { rotulo: "Valor dos produtos", valor: formatarMoeda(v.produtos) }, { rotulo: "Valor do IPI", valor: formatarMoeda(v.ipi) },
    { rotulo: "Frete", valor: formatarMoeda(v.frete) }, { rotulo: "Seguro", valor: formatarMoeda(v.seguro) },
    { rotulo: "Desconto", valor: formatarMoeda(v.desconto) }, { rotulo: "Outras despesas", valor: formatarMoeda(v.outros) },
    { rotulo: "Tributos aproximados", valor: formatarMoeda(v.tributos) }, { rotulo: "VALOR TOTAL DA NOTA", valor: formatarMoeda(v.nota) },
  ]);

  t.secao(6, "Transporte e cobrança");
  t.campos([
    { rotulo: "Frete", valor: ou(d.transporte.modalidade) },
    { rotulo: "Transportadora", valor: ou(d.transporte.transportadora) },
  ]);
  if (d.duplicatas.length) {
    t.tabela([{ titulo: "Duplicata", largura: 120 }, { titulo: "Vencimento", largura: 120 }, { titulo: "Valor (R$)", largura: 120, direita: true }],
      d.duplicatas.map((x) => [x.numero, x.vencimento ? formatarData(`${x.vencimento}T12:00:00Z`) : "—", formatarMoeda(x.valor).replace("R$", "").trim()]),
      { tamanho: 8 });
  }

  if (d.informacoes) {
    t.secao(7, "Informações complementares");
    t.paragrafo(d.informacoes, { tamanho: 8.5 });
  }
  t.y += 6;
  t.paragrafo(AVISO_DANFE_SIMPLIFICADA, { tamanho: 7.5, cor: C.apoio });
  t.rodapes(t.paginas.length);
  return pdf.save();
}
