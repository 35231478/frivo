/**
 * RELATÓRIO DA ATIVIDADE em PDF, no servidor (pdf-lib: a mesma maquinaria do documento do PMOC; cabe numa função da
 * Vercel). O mesmo conteúdo da página pública: equipamentos atendidos com o checklist e as medições (com a faixa
 * esperada e o "fora do esperado"), fotos antes/depois, serviços extras, fotos do serviço, materiais usados, a
 * execução e as assinaturas (técnico e cliente, quando o cliente já confirmou).
 *
 * Fotos: só as que abrem (JPG/PNG em data URL); o PDF tem teto de tamanho — passou, as fotos seguintes saem e o
 * documento avisa que estão no link.
 */
import { PDFDocument, StandardFonts, type PDFImage } from "pdf-lib";
import { formatarData } from "@/lib/utils";
import { textoFaixa } from "@/lib/checklist/faixas";
import { ROTULO_STATUS } from "@/lib/execucao/pendencias";
import { C, Desenho, MARGEM } from "@/lib/pdf/desenho";
import { embutirFoto } from "@/lib/pdf/imagem";
import type { AdicionalRelatorio, BlocoEquipamento, FotoRelatorio } from "@/lib/relatorio-os/dados";

/** Teto das fotos dentro do PDF (a resposta de uma função da Vercel vai até 4,5 MB) */
export const MAX_BYTES_FOTOS = 3_500_000;

export interface DadosRelatorioAtividadePdf {
  empresa: { nome: string; nomeFantasia?: string | null; cnpj?: string | null; telefone?: string | null; email?: string | null };
  os: { numero: string; criadoEm: Date | string; dataConclusao?: Date | string | null; cliente: { nome: string; nomeFantasia?: string | null }; unidade?: { nome: string } | null };
  atividade: {
    titulo: string; tipoOs?: { nome: string } | null; tecnico?: { nome: string } | null; tecnicosEquipe?: { tecnico: { nome: string } }[];
    dataAgendada?: Date | string | null; duracaoMin?: number | null; observacao?: string | null; resumo?: string | null;
  };
  equipamentos: BlocoEquipamento[];
  adicionais: AdicionalRelatorio[];
  fotosServico: FotoRelatorio[];
  materiais: { descricao: string; quantidade: number; unidade: string; equipamento: string | null }[];
  aceite: { nome: string | null; assinatura: string | null; confirmadoEm: Date | string | null; noLocal: boolean } | null;
  numero: string;
  geradoEm: Date;
}

const num = (n: number, casas = 3) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas });
/** A fonte padrão do PDF não tem o Δ: "ΔT" vira "delta T" */
export const semDelta = (t: string) => t.replace(/Δ/g, "delta ");

/** O resultado de um item do checklist como vai na tabela */
export function resultadoItem(it: BlocoEquipamento["checklistTipo"][number]["itens"][number]): string {
  if (it.status) return ROTULO_STATUS[it.status];
  if (!it.medicao) return "-";
  const base = `${num(it.medicao.valor)}${it.medicao.unidade ? ` ${it.medicao.unidade}` : ""}`;
  const faixa = it.medicao.faixa ? textoFaixa(it.medicao.faixa, it.medicao.unidade) : null;
  if (!faixa) return base;
  return it.medicao.fora ? `${base} - FORA DO ESPERADO (${faixa})` : `${base} (esperado ${faixa})`;
}

/** Nome do arquivo baixado: "Relatório REL-12 - OS-1301.pdf" */
export const nomeArquivoRelatorio = (numero: string, osNumero: string) => `Relatório ${numero} - ${osNumero}.pdf`.replace(/[\\/:*?"<>|]/g, "-");

class Fotos {
  usados = 0;
  cortadas = 0;
  constructor(readonly doc: PDFDocument) {}
  async abrir(f: FotoRelatorio): Promise<PDFImage | null> {
    const tamanho = f.url.length * 0.75; // base64 → bytes
    if (this.usados + tamanho > MAX_BYTES_FOTOS) { this.cortadas++; return null; }
    const img = await embutirFoto(this.doc, f.url);
    if (img) this.usados += tamanho;
    return img;
  }
}

/** Grade de fotos (3 por linha), com a legenda embaixo de cada uma */
async function gradeFotos(d: Desenho, fotos: FotoRelatorio[], f: Fotos) {
  const abertas = (await Promise.all(fotos.map(async (x) => ({ x, img: await f.abrir(x) })))).filter((y) => y.img);
  const porLinha = 3, gap = 8, largura = (d.util - gap * (porLinha - 1)) / porLinha, alturaImg = largura * 0.75;
  for (let i = 0; i < abertas.length; i += porLinha) {
    d.garantir(alturaImg + 18);
    abertas.slice(i, i + porLinha).forEach(({ x, img }, k) => {
      const esq = MARGEM + k * (largura + gap);
      const esc = Math.min(largura / img!.width, alturaImg / img!.height);
      const [w, h] = [img!.width * esc, img!.height * esc];
      d.caixa(esq, d.y, largura, alturaImg, C.fundo);
      d.pagina.drawImage(img!, { x: esq + (largura - w) / 2, y: d.altura - d.y - alturaImg + (alturaImg - h) / 2, width: w, height: h });
      d.escrever(d.caber(x.legenda, largura, 7.5), esq, d.y + alturaImg + 4, { tamanho: 7.5, cor: C.apoio });
    });
    d.y += alturaImg + 18;
  }
}

function capa(d: Desenho, x: DadosRelatorioAtividadePdf) {
  d.escrever("RELATÓRIO DE ATIVIDADE", MARGEM, d.y, { tamanho: 16, fonte: d.negrito });
  const n = x.numero;
  d.escrever(n, d.largura - MARGEM - d.negrito.widthOfTextAtSize(d.limpo(n), 12), d.y + 2, { tamanho: 12, fonte: d.negrito, cor: C.acento });
  d.y += 26;
  const e = x.empresa;
  d.paragrafo([e.nomeFantasia || e.nome, e.cnpj && `CNPJ ${e.cnpj}`, e.telefone, e.email].filter(Boolean).join(" · "), { tamanho: 9, cor: C.apoio, depois: 10 });
  d.campos([
    { rotulo: "Cliente", valor: x.os.cliente.nomeFantasia || x.os.cliente.nome },
    { rotulo: "OS", valor: x.os.numero },
    { rotulo: "Unidade", valor: x.os.unidade?.nome ?? "-" },
    { rotulo: "Abertura", valor: formatarData(x.os.criadoEm) },
    { rotulo: "Conclusão", valor: x.os.dataConclusao ? formatarData(x.os.dataConclusao) : "-" },
    { rotulo: "Atividade", valor: [x.atividade.titulo, x.atividade.tipoOs?.nome].filter(Boolean).join(" · ") },
  ], { colunas: 3 });
}

async function equipamentos(d: Desenho, x: DadosRelatorioAtividadePdf, f: Fotos, n: number) {
  d.secao(n, `Equipamentos atendidos (${x.equipamentos.length})`);
  if (!x.equipamentos.length) d.paragrafo("Nenhum equipamento atendido nesta atividade.", { tamanho: 9, cor: C.apoio });
  for (const b of x.equipamentos) {
    d.garantir(80);
    const local = [b.local.principal, b.local.complemento, b.local.unidade].filter(Boolean).join(" · ");
    d.escrever(d.caber(`${b.titulo}${b.tag ? ` · TAG ${b.tag}` : ""}`, d.util, 11.5, d.negrito), MARGEM, d.y, { tamanho: 11.5, fonte: d.negrito });
    d.y += 15;
    d.paragrafo([local, b.titulo !== b.descricao ? b.descricao : null, b.fabricante, b.numeroSerie && `S/N ${b.numeroSerie}`].filter(Boolean).join(" · "), { tamanho: 8.5, cor: C.apoio, depois: 4 });
    const r = b.resumoChecklist;
    const resumo = [`${r.ok} OK`, r.atencao && `${r.atencao} atenção`, r.naoSeAplica && `${r.naoSeAplica} não se aplica`, r.medicoes && `${r.medicoes} medições`, r.foraDaFaixa && `${r.foraDaFaixa} fora do esperado`].filter(Boolean).join(" · ");
    if (r.ok + r.atencao + r.naoSeAplica + r.medicoes > 0) d.paragrafo(resumo, { tamanho: 8.5, fonte: d.negrito, cor: r.foraDaFaixa || r.atencao ? C.atrasado : C.ok, depois: 4 });
    for (const g of b.checklistTipo) {
      d.tabela([{ titulo: "Item", largura: d.util * 0.58 }, { titulo: "Resultado", largura: d.util * 0.42, negrito: true }],
        g.itens.map((it) => [semDelta(it.observacao ? `${it.texto}\nObs.: ${it.observacao}` : it.texto), resultadoItem(it)]), { tamanho: 8.5 });
    }
    for (const g of b.checklist) {
      d.tabela([{ titulo: g.formulario, largura: d.util * 0.58 }, { titulo: "Resposta", largura: d.util * 0.42 }], g.itens.map((i) => [i.label, i.valor || "-"]), { tamanho: 8.5 });
    }
    for (const o of b.observacoes) d.paragrafo(`Observação: ${o}`, { tamanho: 9, depois: 4 });
    if (b.fotos.length) await gradeFotos(d, b.fotos, f);
    d.y += 8;
  }
}

/** O relatório da atividade em PDF. */
export async function gerarRelatorioAtividadePdf(x: DadosRelatorioAtividadePdf): Promise<{ bytes: Uint8Array; nomeArquivo: string }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Relatório ${x.numero} - ${x.os.numero}`);
  pdf.setProducer("Frivo");
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  const d = new Desenho(pdf, normal, negrito, {
    empresa: x.empresa.nomeFantasia || x.empresa.nome, titulo: `Relatório de atividade ${x.numero}`, geradoEm: formatarData(x.geradoEm, "dd/MM/yyyy 'às' HH:mm"),
  });
  const f = new Fotos(pdf);
  d.novaPagina();
  capa(d, x);
  let n = 1;
  await equipamentos(d, x, f, n++);

  if (x.adicionais.length) {
    d.secao(n++, "Serviço extra pedido na visita");
    for (const a of x.adicionais) {
      d.paragrafo(`${a.descricao}${a.equipamento ? ` · ${a.equipamento}` : ""}`, { tamanho: 9.5, depois: 4 });
      if (a.fotos.length) await gradeFotos(d, a.fotos, f);
    }
  }
  if (x.fotosServico.length) {
    d.secao(n++, "Fotos do serviço");
    await gradeFotos(d, x.fotosServico, f);
  }
  if (x.materiais.length) {
    d.secao(n++, "Materiais usados");
    d.tabela([{ titulo: "Material", largura: d.util * 0.5 }, { titulo: "Equipamento", largura: d.util * 0.3 }, { titulo: "Quantidade", largura: d.util * 0.2, direita: true }],
      x.materiais.map((m) => [m.descricao, m.equipamento ?? "-", `${num(m.quantidade)} ${m.unidade}`]), { tamanho: 9 });
  }

  d.secao(n++, "Execução técnica");
  const a = x.atividade;
  const equipe = (a.tecnicosEquipe ?? []).map((t) => t.tecnico.nome);
  d.campos([
    { rotulo: "Técnico", valor: a.tecnico?.nome ?? "-" },
    ...(equipe.length ? [{ rotulo: "Equipe", valor: equipe.join(", ") }] : []),
    { rotulo: "Agendada para", valor: a.dataAgendada ? formatarData(a.dataAgendada, "dd/MM/yyyy 'às' HH:mm") : "-" },
    { rotulo: "Duração prevista", valor: a.duracaoMin ? `${Math.floor(a.duracaoMin / 60)}h${String(a.duracaoMin % 60).padStart(2, "0")}` : "-" },
  ], { colunas: 2 });
  const texto = (a.observacao || a.resumo || "").trim();
  if (texto) d.paragrafo(texto, { tamanho: 9.5, depois: 6 });
  if (f.cortadas) d.paragrafo(`${f.cortadas} foto(s) não couberam neste PDF e estão no link do relatório.`, { tamanho: 8.5, cor: C.apoio, depois: 6 });

  // Assinaturas: técnico e, quando o cliente já confirmou, o cliente (com a assinatura colhida no local)
  d.garantir(110);
  d.y += 30;
  const meia = (d.util - 30) / 2;
  const assinatura = x.aceite?.assinatura ? await embutirFoto(pdf, x.aceite.assinatura) : null;
  if (assinatura) {
    const esc = Math.min(meia / assinatura.width, 50 / assinatura.height);
    d.pagina.drawImage(assinatura, { x: MARGEM + meia + 30 + (meia - assinatura.width * esc) / 2, y: d.altura - d.y - 4, width: assinatura.width * esc, height: assinatura.height * esc });
  }
  d.y += 8;
  d.reta(MARGEM, d.y, MARGEM + meia, d.y, C.texto);
  d.escrever(d.caber(a.tecnico?.nome ?? "Técnico executor", meia, 9), MARGEM, d.y + 4, { tamanho: 9 });
  d.escrever("Técnico responsável", MARGEM, d.y + 16, { tamanho: 8, cor: C.apoio });
  if (x.aceite) {
    const xi = MARGEM + meia + 30;
    d.reta(xi, d.y, xi + meia, d.y, C.texto);
    d.escrever(d.caber(x.aceite.nome ?? "Cliente", meia, 9), xi, d.y + 4, { tamanho: 9 });
    const quando = x.aceite.confirmadoEm ? ` em ${formatarData(x.aceite.confirmadoEm, "dd/MM/yyyy 'às' HH:mm")}` : "";
    d.escrever(d.caber(`Cliente · ${x.aceite.noLocal ? "assinou no local" : "confirmou pelo link"}${quando}`, meia, 8), xi, d.y + 16, { tamanho: 8, cor: C.apoio });
  }
  d.y += 30;

  d.rodapes(d.paginas.length);
  return { bytes: await pdf.save(), nomeArquivo: nomeArquivoRelatorio(x.numero, x.os.numero) };
}
