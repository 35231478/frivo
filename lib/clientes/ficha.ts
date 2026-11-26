/**
 * A FICHA do cliente em modo consulta: o que a tela mostra de "Dados gerais", pronto para desenhar.
 *
 * Antes, clicar num cliente abria direto /editar: o formulário inteiro, com cada campo editável, para quem
 * só queria consultar o telefone ou o endereço. A ficha mostra o cadastro como texto, só com o que está
 * preenchido (campo vazio não vira linha de "—"), e "Editar" vira uma ação.
 *
 * Função pura: a página carrega o cliente (lib/clientes/ficha-server) e a tela só desenha o que sai daqui.
 */
import { formatarCpfCnpj, formatarTelefone } from "@/lib/utils";

export interface LinhaFicha { rotulo: string; valor: string }
export interface SecaoFicha { id: string; titulo: string; linhas: LinhaFicha[] }

export interface ClienteDaFicha {
  tipoPessoa?: string | null;
  nome: string;
  nomeFantasia?: string | null;
  cpfCnpj?: string | null;
  inscricaoEstadual?: string | null;
  inscricaoMunicipal?: string | null;
  inscricaoSuframa?: string | null;
  indicadorInscricaoEstadual?: string | null;
  optanteSimples?: boolean | null;
  tabelaPreco?: { nome: string; ativo?: boolean | null } | null;
  emailsFaturamento?: string[] | null;
  whatsappFaturamento?: string | null;
  boletoUnicoMensal?: boolean | null;
  exigePcAntesNf?: boolean | null;
  agrupaAdicionais?: boolean | null;
  observacoes?: string | null;
}

export interface EnderecoDaFicha {
  id: string; nome: string; principal?: boolean | null;
  logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null;
  cidade?: string | null; estado?: string | null; cep?: string | null; telefone?: string | null;
}
export interface ContatoDaFicha {
  id: string; nome: string; principal?: boolean | null; cargo?: string | null;
  email?: string | null; telefone?: string | null; whatsapp?: string | null;
}

const INDICADOR_IE: Record<string, string> = { CONTRIBUINTE: "Contribuinte", ISENTO: "Isento", NAO_CONTRIBUINTE: "Não contribuinte" };
const texto = (v: string | null | undefined) => (typeof v === "string" ? v.trim() : "");

/** Só as linhas com valor: a ficha não mostra campo vazio. */
function linhas(pares: [string, string | null | undefined][]): LinhaFicha[] {
  return pares.map(([rotulo, v]) => ({ rotulo, valor: texto(v) })).filter((l) => l.valor !== "");
}

/** As seções de "Dados gerais" (Identificação, Fiscal, Comercial, Cobrança) — uma seção vazia some. */
export function secoesDaFicha(c: ClienteDaFicha): SecaoFicha[] {
  const pf = c.tipoPessoa === "FISICA";
  const prefs = [
    c.boletoUnicoMensal ? "Boleto único mensal" : "",
    c.exigePcAntesNf ? "Exige pedido de compra antes da NF" : "",
    c.agrupaAdicionais ? "Agrupa adicionais na fatura" : "",
  ].filter(Boolean).join(" · ");
  const secoes: SecaoFicha[] = [
    { id: "identificacao", titulo: "Identificação", linhas: linhas([
      ["Tipo", pf ? "Pessoa física" : "Pessoa jurídica"],
      [pf ? "CPF" : "CNPJ", c.cpfCnpj ? formatarCpfCnpj(c.cpfCnpj) : ""],
      [pf ? "Nome completo" : "Razão social", c.nome],
      [pf ? "Apelido" : "Nome fantasia", c.nomeFantasia],
    ]) },
    { id: "fiscal", titulo: "Informações fiscais", linhas: linhas([
      ["Simples Nacional", c.optanteSimples == null ? "" : c.optanteSimples ? "Optante" : "Não optante"],
      ["Indicador de IE", c.indicadorInscricaoEstadual ? INDICADOR_IE[c.indicadorInscricaoEstadual] ?? c.indicadorInscricaoEstadual : ""],
      ["Inscrição estadual", c.inscricaoEstadual],
      ["Inscrição municipal", c.inscricaoMunicipal],
      ["Inscrição SUFRAMA", c.inscricaoSuframa],
    ]) },
    { id: "comercial", titulo: "Comercial", linhas: linhas([
      ["Tabela de preços", c.tabelaPreco ? `${c.tabelaPreco.nome}${c.tabelaPreco.ativo === false ? " (inativa: valem os preços do catálogo)" : ""}` : "Preços do catálogo"],
    ]) },
    { id: "cobranca", titulo: "Cobrança e faturamento", linhas: linhas([
      ["E-mails de cobrança", (c.emailsFaturamento ?? []).map(texto).filter(Boolean).join(", ")],
      ["WhatsApp de cobrança", c.whatsappFaturamento ? formatarTelefone(c.whatsappFaturamento) : ""],
      ["Preferências", prefs],
    ]) },
  ];
  return secoes.filter((s) => s.linhas.length > 0);
}

/** "Rua das Flores, 120 — sala 3 · Centro · São Paulo/SP · CEP 01000-000" (só o que existe) */
export function enderecoEmUmaLinha(u: EnderecoDaFicha): string {
  const rua = [texto(u.logradouro), texto(u.numero)].filter(Boolean).join(", ");
  const comp = texto(u.complemento);
  const cidade = [texto(u.cidade), texto(u.estado)].filter(Boolean).join("/");
  const cep = texto(u.cep);
  return [rua + (comp ? ` — ${comp}` : ""), texto(u.bairro), cidade, cep ? `CEP ${cep}` : ""].filter(Boolean).join(" · ");
}

/** Principal primeiro, depois pelo nome — a mesma ordem da edição. */
export function emOrdem<T extends { principal?: boolean | null; nome: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => Number(!!b.principal) - Number(!!a.principal) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Os meios de contato de uma pessoa, na ordem em que se usa: telefone, WhatsApp, e-mail. */
export function meiosDoContato(c: ContatoDaFicha): string[] {
  const tel = texto(c.telefone), zap = texto(c.whatsapp), mail = texto(c.email);
  return [tel ? formatarTelefone(tel) : "", zap && zap !== tel ? `WhatsApp ${formatarTelefone(zap)}` : "", mail].filter(Boolean);
}
