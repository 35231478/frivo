/**
 * A DANFE SIMPLIFICADA da nota de compra — puro (sem banco): lê do XML importado o que a visualização
 * rápida, o PDF e as colunas da lista mostram.
 *
 * Diferente de `lerNfe` (lib/compras/nfe), que é ESTRITO porque decide se a nota entra, esta leitura é
 * TOLERANTE: a nota já está no sistema, então campo faltando vira vazio/zero e nada derruba a tela. Só
 * não lê o que não é uma NF-e (sem <infNFe>), o vazio, o grande demais e o XML com DOCTYPE/ENTITY (sem XXE).
 *
 * Não é a DANFE oficial (layout do Manual da SEFAZ, com código de barras): é um espelho legível dos dados
 * da nota, para consulta. O documento diz isso no rodapé.
 */
import { XMLParser } from "fast-xml-parser";
import { TAMANHO_MAX_XML } from "@/lib/compras/nfe";
import type { EnderecoDanfe } from "@/lib/compras/danfe-texto";
export type { EnderecoDanfe } from "@/lib/compras/danfe-texto";

export interface ParteDanfe { nome: string; fantasia: string; documento: string; ie: string; endereco: EnderecoDanfe | null }
export interface ItemDanfe {
  numero: number; codigo: string; descricao: string; ncm: string; cst: string; cfop: string; unidade: string;
  quantidade: number; valorUnitario: number; valorTotal: number;
  baseIcms: number; aliquotaIcms: number; valorIcms: number; valorIpi: number; aliquotaIpi: number;
}
export interface TotaisDanfe {
  baseIcms: number; icms: number; baseIcmsSt: number; icmsSt: number; produtos: number; frete: number; seguro: number;
  desconto: number; outros: number; ipi: number; nota: number; tributos: number;
}
export interface DadosDanfe {
  chave: string;
  numero: string;
  serie: string;
  emissao: Date | null;
  saidaEntrada: Date | null;
  naturezaOperacao: string;
  /** tpNF: 0 = entrada, 1 = saída (do ponto de vista do emitente) */
  tipo: "ENTRADA" | "SAIDA" | null;
  protocolo: { numero: string; data: Date | null } | null;
  emitente: ParteDanfe;
  destinatario: ParteDanfe;
  itens: ItemDanfe[];
  totais: TotaisDanfe;
  transporte: { modalidade: string; transportadora: string };
  duplicatas: { numero: string; vencimento: string; valor: number }[];
  informacoes: string;
}

const leitor = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: "@", removeNSPrefix: true, parseTagValue: false, parseAttributeValue: false,
  trimValues: true, processEntities: true, isArray: (nome) => nome === "det" || nome === "dup",
});

const txt = (v: unknown): string => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v)).trim();
const num = (v: unknown): number => { const n = Number(txt(v)); return Number.isFinite(n) ? n : 0; };
const data = (v: unknown): Date | null => { const t = txt(v); if (!t) return null; const d = new Date(t); return Number.isNaN(d.getTime()) ? null : d; };
const so = (s: string) => s.replace(/\D/g, "");
/** O primeiro subgrupo do imposto (ICMS00, ICMS20, ICMSSN102… muda com a tributação) */
const subgrupo = (g: unknown) => Object.values((g ?? {}) as Record<string, unknown>).find((x) => x && typeof x === "object") as Record<string, unknown> | undefined;

/** Modalidade do frete (transp/modFrete) */
export const MODALIDADE_FRETE: Record<string, string> = {
  "0": "Por conta do emitente", "1": "Por conta do destinatário", "2": "Por conta de terceiros",
  "3": "Próprio, por conta do remetente", "4": "Próprio, por conta do destinatário", "9": "Sem frete",
};

function endereco(e: Record<string, unknown> | undefined, foneFora?: unknown): EnderecoDanfe | null {
  if (!e) return null;
  return {
    logradouro: txt(e.xLgr), numero: txt(e.nro), complemento: txt(e.xCpl), bairro: txt(e.xBairro), municipio: txt(e.xMun),
    uf: txt(e.UF), cep: so(txt(e.CEP)), fone: so(txt(e.fone) || txt(foneFora)),
  };
}

function parte(p: Record<string, any> | undefined, chaveEndereco: "enderEmit" | "enderDest"): ParteDanfe {
  return {
    nome: txt(p?.xNome), fantasia: txt(p?.xFant), documento: so(txt(p?.CNPJ) || txt(p?.CPF)), ie: txt(p?.IE),
    endereco: endereco(p?.[chaveEndereco], p?.fone),
  };
}

/** A DANFE do XML guardado. null = não há o que mostrar (sem XML, XML que não é NF-e, grande demais ou inseguro). */
export function lerDanfe(xml: string | null | undefined): DadosDanfe | null {
  if (!xml || !xml.trim()) return null;
  if (Buffer.byteLength(xml, "utf8") > TAMANHO_MAX_XML) return null;
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return null;
  let raiz: Record<string, any>;
  try { raiz = leitor.parse(xml); } catch { return null; }
  const proc = raiz?.nfeProc;
  const inf = (proc?.NFe ?? raiz?.NFe)?.infNFe;
  if (!inf || typeof inf !== "object") return null;

  const ide = inf.ide ?? {};
  const prot = proc?.protNFe?.infProt;
  const tot = inf.total?.ICMSTot ?? {};
  const tpNF = txt(ide.tpNF);
  const itens: ItemDanfe[] = (inf.det ?? []).map((d: any, i: number) => {
    const p = d?.prod ?? {};
    const icms = subgrupo(d?.imposto?.ICMS);
    const ipi = d?.imposto?.IPI?.IPITrib ?? {};
    return {
      numero: Number(txt(d?.["@nItem"])) || i + 1,
      codigo: txt(p.cProd), descricao: txt(p.xProd), ncm: txt(p.NCM),
      cst: `${txt(icms?.orig)}${txt(icms?.CST) || txt(icms?.CSOSN)}`,
      cfop: txt(p.CFOP), unidade: txt(p.uCom),
      quantidade: num(p.qCom), valorUnitario: num(p.vUnCom), valorTotal: num(p.vProd),
      baseIcms: num(icms?.vBC), aliquotaIcms: num(icms?.pICMS), valorIcms: num(icms?.vICMS),
      valorIpi: num(ipi.vIPI), aliquotaIpi: num(ipi.pIPI),
    };
  });

  return {
    chave: so(txt(inf["@Id"])) || so(txt(prot?.chNFe)),
    numero: txt(ide.nNF),
    serie: txt(ide.serie),
    emissao: data(ide.dhEmi) ?? data(ide.dEmi),
    saidaEntrada: data(ide.dhSaiEnt) ?? data(ide.dSaiEnt),
    naturezaOperacao: txt(ide.natOp),
    tipo: tpNF === "0" ? "ENTRADA" : tpNF === "1" ? "SAIDA" : null,
    protocolo: prot && txt(prot.nProt) ? { numero: txt(prot.nProt), data: data(prot.dhRecbto) } : null,
    emitente: parte(inf.emit, "enderEmit"),
    destinatario: parte(inf.dest, "enderDest"),
    itens,
    totais: {
      baseIcms: num(tot.vBC), icms: num(tot.vICMS), baseIcmsSt: num(tot.vBCST), icmsSt: num(tot.vST), produtos: num(tot.vProd),
      frete: num(tot.vFrete), seguro: num(tot.vSeg), desconto: num(tot.vDesc), outros: num(tot.vOutro), ipi: num(tot.vIPI),
      nota: num(tot.vNF), tributos: num(tot.vTotTrib),
    },
    transporte: {
      modalidade: MODALIDADE_FRETE[txt(inf.transp?.modFrete)] ?? "",
      transportadora: txt(inf.transp?.transporta?.xNome),
    },
    duplicatas: (inf.cobr?.dup ?? []).map((d: any, i: number) => ({ numero: txt(d?.nDup) || String(i + 1).padStart(3, "0"), vencimento: txt(d?.dVenc), valor: num(d?.vDup) })),
    informacoes: txt(inf.infAdic?.infCpl),
  };
}

/** Os valores da nota que viram colunas na lista (null = sem XML legível: a coluna mostra "—") */
export interface ValoresNota { produtos: number; frete: number; desconto: number; icms: number; icmsSt: number; ipi: number }
export function valoresDaNota(xml: string | null | undefined): ValoresNota | null {
  const d = lerDanfe(xml);
  if (!d) return null;
  const t = d.totais;
  return { produtos: t.produtos, frete: t.frete, desconto: t.desconto, icms: t.icms, icmsSt: t.icmsSt, ipi: t.ipi };
}
