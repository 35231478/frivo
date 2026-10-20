/**
 * Leitura do XML da NF-e de compra (layout 4.00, modelo 55). Arquivo puro (sem banco): devolve a
 * nota pronta para importar ou um erro claro. Aceita o XML com protocolo (<nfeProc>, o que o
 * fornecedor manda) ou só a <NFe>.
 *
 * O que sai: chave de acesso (44 dígitos, dígito verificador conferido), número, série, emissão,
 * emitente (fornecedor), destinatário, itens (det/prod), totais e duplicatas (cobr/dup).
 * Valores numéricos da NF usam ponto decimal; nada é arredondado aqui além do que a NF já traz.
 *
 * Segurança: o leitor não resolve entidades externas (sem XXE) e o tamanho é limitado. A
 * assinatura digital NÃO é conferida nesta fase (a captura pela SEFAZ, futura, traz a nota oficial).
 */
import { XMLParser } from "fast-xml-parser";

export const TAMANHO_MAX_XML = 2 * 1024 * 1024; // 2 MB

export class ErroNfe extends Error {}

export interface ItemNfe {
  numeroItem: number;
  codigo: string;
  descricao: string;
  ean: string | null;
  ncm: string | null;
  cfop: string | null;
  cest: string | null;
  /** origem da mercadoria (0 a 8) do grupo ICMS do item */
  origem: string | null;
  /** unidade tributável (uTrib) */
  unidadeTributavel: string | null;
  /** unidade comercial (uCom): a quantidade e o valor unitário estão nela */
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
}
export interface DuplicataNfe { numero: string; vencimento: string; valor: number }
export interface NotaNfe {
  chave: string;
  numero: string;
  serie: string;
  dataEmissao: Date;
  emitente: { cnpj: string; nome: string; fantasia: string | null; telefone: string | null; email: string | null };
  destinatario: { documento: string | null; nome: string | null };
  itens: ItemNfe[];
  totais: { produtos: number; frete: number; desconto: number; outros: number; ipi: number; st: number; nota: number };
  duplicatas: DuplicataNfe[];
  /** cStat do protocolo (100/150 = autorizada); null quando o XML veio sem protocolo */
  status: { codigo: string; motivo: string } | null;
  informacoes: string | null;
}

const leitor = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  parseTagValue: false, // tudo como texto: números são lidos aqui, sem perder zeros/casas
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (nome) => nome === "det" || nome === "dup" || nome === "detPag",
});

const txt = (v: unknown): string => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v)).trim();
const opc = (v: unknown) => txt(v) || null;
const num = (v: unknown, campo: string, obrigatorio = true): number => {
  const t = txt(v);
  if (!t) { if (obrigatorio) throw new ErroNfe(`XML sem o campo ${campo}.`); return 0; }
  const n = Number(t);
  if (!Number.isFinite(n)) throw new ErroNfe(`Valor inválido em ${campo}: "${t}".`);
  return n;
};
const so = (s: string) => s.replace(/\D/g, "");

/** Dígito verificador da chave de acesso (módulo 11, pesos 2..9 da direita para a esquerda). */
export function dvChave(chave43: string): string {
  let soma = 0;
  for (let i = 0; i < chave43.length; i++) soma += Number(chave43[chave43.length - 1 - i]) * (2 + (i % 8));
  const r = soma % 11;
  return r < 2 ? "0" : String(11 - r);
}
export const chaveValida = (chave: string) => /^\d{44}$/.test(chave) && dvChave(chave.slice(0, 43)) === chave[43];

/** Lê o XML. Erro (ErroNfe) com mensagem para o usuário quando não é uma NF-e 4.00 válida. */
export function lerNfe(xml: string): NotaNfe {
  if (!xml || !xml.trim()) throw new ErroNfe("Arquivo vazio.");
  if (Buffer.byteLength(xml, "utf8") > TAMANHO_MAX_XML) throw new ErroNfe("Arquivo grande demais para uma NF-e (máx. 2 MB).");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ErroNfe("XML com DOCTYPE/ENTITY não é aceito.");
  let raiz: Record<string, any>;
  try { raiz = leitor.parse(xml); } catch { throw new ErroNfe("O arquivo não é um XML válido."); }

  const proc = raiz.nfeProc;
  const nfe = proc?.NFe ?? raiz.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new ErroNfe("Este XML não é uma NF-e (não tem <infNFe>). Envie o XML da nota de compra.");
  if (txt(inf["@versao"]) !== "4.00") throw new ErroNfe(`Layout ${txt(inf["@versao"]) || "desconhecido"} não suportado: só NF-e 4.00.`);
  const ide = inf.ide ?? {};
  if (txt(ide.mod) !== "55") throw new ErroNfe(`Modelo ${txt(ide.mod) || "?"} não suportado: só NF-e modelo 55 (NFC-e e outros ficam de fora).`);

  const chave = so(txt(inf["@Id"]));
  if (!chaveValida(chave)) throw new ErroNfe("Chave de acesso inválida (44 dígitos com dígito verificador).");
  const prot = proc?.protNFe?.infProt;
  if (prot && txt(prot.chNFe) && so(txt(prot.chNFe)) !== chave) throw new ErroNfe("O protocolo não é desta nota (chave diferente).");
  const status = prot ? { codigo: txt(prot.cStat), motivo: txt(prot.xMotivo) } : null;
  if (status && !["100", "150"].includes(status.codigo)) throw new ErroNfe(`NF-e não autorizada (${status.codigo} — ${status.motivo}).`);

  const emit = inf.emit ?? {};
  const cnpjEmit = so(txt(emit.CNPJ) || txt(emit.CPF));
  if (!cnpjEmit) throw new ErroNfe("XML sem o CNPJ/CPF do emitente.");
  const dataTxt = txt(ide.dhEmi) || txt(ide.dEmi);
  const dataEmissao = new Date(dataTxt);
  if (!dataTxt || Number.isNaN(dataEmissao.getTime())) throw new ErroNfe("XML sem data de emissão válida.");

  const dets: any[] = inf.det ?? [];
  if (!dets.length) throw new ErroNfe("A nota não tem itens.");
  const itens: ItemNfe[] = dets.map((d, i) => {
    const p = d.prod ?? {};
    const gtin = (v: unknown) => { const t = txt(v); return t && t.toUpperCase() !== "SEM GTIN" ? t : null; };
    // ICMS vem num subgrupo que muda com a tributação (ICMS00, ICMS20, ICMSSN102…): a origem é igual em todos
    const icms = Object.values((d.imposto?.ICMS ?? {}) as Record<string, unknown>).find((g) => g && typeof g === "object") as Record<string, unknown> | undefined;
    const origem = txt(icms?.orig);
    return {
      numeroItem: Number(txt(d["@nItem"])) || i + 1,
      codigo: txt(p.cProd) || `ITEM-${i + 1}`,
      descricao: txt(p.xProd),
      ean: gtin(p.cEAN) ?? gtin(p.cEANTrib),
      ncm: opc(p.NCM),
      cfop: opc(p.CFOP),
      cest: opc(p.CEST),
      origem: /^[0-8]$/.test(origem) ? origem : null,
      unidadeTributavel: opc(p.uTrib),
      unidade: txt(p.uCom) || "UN",
      quantidade: num(p.qCom, `qCom do item ${i + 1}`),
      valorUnitario: num(p.vUnCom, `vUnCom do item ${i + 1}`),
      valorTotal: num(p.vProd, `vProd do item ${i + 1}`),
    };
  });
  if (itens.some((it) => !it.descricao)) throw new ErroNfe("Há item sem descrição (xProd).");
  if (itens.some((it) => it.quantidade <= 0)) throw new ErroNfe("Há item com quantidade zero ou negativa.");

  const tot = inf.total?.ICMSTot ?? {};
  const duplicatas: DuplicataNfe[] = (inf.cobr?.dup ?? []).map((d: any, i: number) => {
    const venc = txt(d.dVenc);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(venc)) throw new ErroNfe(`Duplicata ${i + 1} sem vencimento válido.`);
    return { numero: txt(d.nDup) || String(i + 1).padStart(3, "0"), vencimento: venc, valor: num(d.vDup, `vDup da duplicata ${i + 1}`) };
  });

  return {
    chave,
    numero: txt(ide.nNF),
    serie: txt(ide.serie) || "0",
    dataEmissao,
    emitente: {
      cnpj: cnpjEmit,
      nome: txt(emit.xNome),
      fantasia: opc(emit.xFant),
      telefone: opc(emit.enderEmit?.fone),
      email: opc(emit.email),
    },
    destinatario: { documento: so(txt(inf.dest?.CNPJ) || txt(inf.dest?.CPF)) || null, nome: opc(inf.dest?.xNome) },
    itens,
    totais: {
      produtos: num(tot.vProd, "vProd (total)", false),
      frete: num(tot.vFrete, "vFrete", false),
      desconto: num(tot.vDesc, "vDesc", false),
      outros: num(tot.vOutro, "vOutro", false),
      ipi: num(tot.vIPI, "vIPI", false),
      st: num(tot.vST, "vST", false),
      nota: num(tot.vNF, "vNF (valor da nota)"),
    },
    duplicatas,
    status,
    informacoes: opc(inf.infAdic?.infCpl),
  };
}

/**
 * Parcelas da conta a pagar: as duplicatas da nota; sem duplicata, uma parcela única no valor da
 * nota com vencimento na emissão (à vista). Vencimento gravado ao meio-dia UTC (mesmo dia no Brasil).
 */
export function parcelasDaNota(n: { duplicatas: DuplicataNfe[]; valorTotal: number; dataEmissao: Date }): { numero: string; vencimento: Date; valor: number }[] {
  const dia = (d: string) => new Date(`${d}T12:00:00.000Z`);
  if (n.duplicatas.length) return n.duplicatas.map((d) => ({ numero: d.numero, vencimento: dia(d.vencimento), valor: d.valor }));
  return [{ numero: "001", vencimento: dia(diaNoBrasil(n.dataEmissao)), valor: n.valorTotal }];
}

/** "AAAA-MM-DD" da data no fuso de Brasília (emissão às 23h30 continua sendo o mesmo dia) */
export const diaNoBrasil = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** CNPJ da nota é desta empresa? (mesma raiz de 8 dígitos = matriz ou filial) */
export const mesmaRaizCnpj = (a: string | null | undefined, b: string | null | undefined) => {
  const x = so(a ?? ""), y = so(b ?? "");
  return x.length === 14 && y.length === 14 && x.slice(0, 8) === y.slice(0, 8);
};

/** Chave do de-para para um item: o código do fornecedor (cProd), sem espaços nas pontas. */
export const chaveDePara = (codigo: string) => codigo.trim().toUpperCase();
