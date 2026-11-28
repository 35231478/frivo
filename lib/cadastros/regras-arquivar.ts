/**
 * PONTAS SOLTAS DE CADASTRO (leva 4): as regras puras de "pode apagar / cancelar / inativar?" que as
 * rotas e as telas usam. A regra da casa é uma só: o que já tem uso ARQUIVA (inativa, cancela), não
 * apaga; o que nunca saiu do rascunho pode ser excluído. Tudo aqui é puro (sem banco), para ser testado
 * e reaproveitado pela tela.
 */
import { formatarMoeda } from "@/lib/utils";

/* ───────── Medição (fatura): excluir de verdade só o rascunho que não gerou nada ───────── */

export interface MedicaoExclusao {
  status: string;
  nfNumero?: string | null;
  /** contas a receber ligadas (qualquer status) */
  contasReceber: number;
  /** notas fiscais (NFS-e) ligadas */
  notasFiscais: number;
}

/**
 * Excluir apaga a medição e os itens (cascata). Só vale para o RASCUNHO que não gerou conta nem nota:
 * o resto já é documento (foi ao cliente, virou cobrança ou nota) e segue o caminho do cancelamento.
 * Antes, a rota apagava em qualquer etapa (e com conta ligada estourava na chave estrangeira).
 */
export function motivoNaoExcluirMedicao(m: MedicaoExclusao): string | null {
  if (m.status !== "RASCUNHO") return "Só o rascunho pode ser excluído. Depois de enviada, a medição é cancelada, não apagada.";
  if (m.contasReceber > 0) return "Esta medição já gerou conta a receber. Cancele em vez de excluir.";
  if (m.notasFiscais > 0 || (m.nfNumero ?? "").trim()) return "Esta medição já tem nota fiscal. Cancele em vez de excluir.";
  return null;
}

/* ───────── Conta a pagar: cancelar e editar ───────── */

export interface ContaPagarSituacao { status: string }

/**
 * Cancelar UMA conta (pela tela dela). Paga não cancela: o dinheiro já saiu, e cancelar sumiria com a
 * saída do caixa. Com pagamento parcial pode, olhando o histórico (o lote é mais rígido: ver
 * `motivoNaoCancelarPagar` em lib/financeiro/acoes-lote).
 */
export function motivoNaoCancelarContaPagar(c: ContaPagarSituacao): string | null {
  if (c.status === "CANCELADO") return "Esta conta já está cancelada.";
  if (c.status === "PAGO_TOTAL") return "Conta paga não pode ser cancelada.";
  return null;
}

/** Editar: conta paga ou cancelada está encerrada; a tela já esconde o botão e a rota passa a recusar. */
export function motivoNaoEditarContaPagar(c: ContaPagarSituacao): string | null {
  if (c.status === "CANCELADO") return "Conta cancelada não muda.";
  // a mesma frase da despesa recorrente (lib/financeiro/conta-pagar-recorrencia-server)
  if (c.status === "PAGO_TOTAL") return "Conta já paga não muda: lance um estorno ou um ajuste.";
  return null;
}

/* ───────── Modelo de checklist: o do checklist diário obrigatório não sai ───────── */

export interface ConfigChecklistDiario { checklistDiarioAtivo: boolean; checklistDiarioTemplateId: string | null }

/**
 * Com o checklist diário ligado, o app do técnico só cobra o checklist se o modelo configurado
 * estiver ATIVO (lib/checklist-diario/servidor › resumoPorteiro). Inativá-lo desligaria a obrigação
 * em silêncio, sem ninguém perceber. Desligado (ou outro modelo), inativa normalmente.
 */
export function motivoNaoInativarModeloChecklist(modeloId: string, cfg: ConfigChecklistDiario | null): string | null {
  if (cfg?.checklistDiarioAtivo && cfg.checklistDiarioTemplateId === modeloId) {
    return "Modelo do checklist diário obrigatório: troque o modelo do checklist diário antes de inativar.";
  }
  return null;
}

/* ───────── Colaborador e veículo: a opção "Inativo" do status ───────── */

/**
 * Inativar exige a permissão de excluir do módulo ("Equipes › Excluir" para colaborador, "Veículos ›
 * Excluir" para veículo), como o botão Inativar. No formulário, quem só edita não vê a opção, a não ser
 * que o registro já esteja inativo (o valor atual precisa continuar visível).
 */
export function mostrarOpcaoInativo(podeInativar: boolean, statusAtual: string | null | undefined): boolean {
  return podeInativar || statusAtual === "INATIVO";
}

/* ───────── O texto da confirmação: um jeito só ───────── */

export type Genero = "m" | "f";

export interface TextoInativar {
  titulo: string;
  mensagem: string;
  confirmar: string;
}

/**
 * O mesmo texto em todo lugar que inativa: título "Inativar {entidade} {nome}?" e "Tem certeza? O
 * {entidade} sai das listas e seletores; nada é apagado e pode ser reativado depois." (desde a leva 5,
 * endereço e contato também reativam pela tela: a promessa vale para todos).
 */
export function textoInativar(entidade: string, nome: string | null | undefined, genero: Genero = "m"): TextoInativar {
  const art = genero === "f" ? "A" : "O";
  const fim = genero === "f" ? "a" : "o";
  const n = (nome ?? "").trim();
  return {
    titulo: `Inativar ${entidade}${n ? ` ${n}` : ""}?`,
    mensagem: `Tem certeza? ${art} ${entidade} sai das listas e seletores; nada é apagado e pode ser reativad${fim} depois.`,
    confirmar: "Sim, inativar",
  };
}

export function textoReativar(entidade: string, nome: string | null | undefined, genero: Genero = "m"): TextoInativar {
  const art = genero === "f" ? "A" : "O";
  const n = (nome ?? "").trim();
  return {
    titulo: `Reativar ${entidade}${n ? ` ${n}` : ""}?`,
    mensagem: `${art} ${entidade} volta a aparecer nas listas e nos seletores.`,
    confirmar: "Reativar",
  };
}

/* ───────── Cliente: inativar não bloqueia, mas avisa o que continua andando ───────── */

export interface UsoCliente {
  contratosAtivos: string[];
  osAbertas: string[];
  orcamentosAbertos: number;
  contasAbertas: number;
  pmocsAtivos: number;
}

const pl = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
const ate3 = (xs: string[]) => xs.slice(0, 3).join(", ") + (xs.length > 3 ? ` e mais ${xs.length - 3}` : "");

/**
 * Cliente nunca é apagado e inativar nunca é bloqueado (o histórico é dele). O que já está em
 * andamento continua: o aviso diz o quê, para a pessoa decidir se encerra antes.
 */
export function avisosInativarCliente(u: UsoCliente): string[] {
  const a: string[] = [];
  const ct = u.contratosAtivos, os = u.osAbertas;
  if (ct.length) {
    const qtd = pl(ct.length, "contrato ativo", "contratos ativos");
    const segue = ct.length === 1 ? "continua" : "continuam";
    a.push(`Tem ${qtd} (${ate3(ct)}): ${segue} gerando OS e cobrança até o encerramento.`);
  }
  if (os.length) {
    const segue = os.length === 1 ? "segue" : "seguem";
    a.push(`Tem ${pl(os.length, "OS em aberto", "OS em aberto")} (${ate3(os)}): ${segue} normalmente.`);
  }
  if (u.orcamentosAbertos) a.push(`Tem ${pl(u.orcamentosAbertos, "orçamento em aberto", "orçamentos em aberto")}.`);
  if (u.contasAbertas) a.push(`Tem ${pl(u.contasAbertas, "conta a receber em aberto", "contas a receber em aberto")}: a cobrança continua.`);
  if (u.pmocsAtivos) a.push(`Tem ${pl(u.pmocsAtivos, "PMOC ativo", "PMOCs ativos")}.`);
  return a;
}

/* ───────── Endereço (unidade): o que bloqueia e o que continua andando naquele local ───────── */

export interface UsoEndereco {
  principal: boolean;
  equipamentosAtivos: number;
  /** contratos ATIVOS que incluem este local */
  contratosAtivos: string[];
  /** PMOC ativos deste local (nome) */
  pmocsAtivos: string[];
  /** OS em aberto neste local (número) */
  osAbertas: string[];
}

/**
 * Bloqueia só o que deixaria um dado sem lugar: o principal (o cliente ficaria sem endereço padrão) e
 * os equipamentos ativos (ficariam num local que some dos seletores).
 */
export function bloqueioInativarEndereco(u: Pick<UsoEndereco, "principal" | "equipamentosAtivos">): string | null {
  if (u.principal) return "Endereço principal não pode ser inativado: marque outro endereço como principal antes.";
  if (u.equipamentosAtivos > 0) {
    const qtd = pl(u.equipamentosAtivos, "equipamento ativo", "equipamentos ativos");
    return `Tem ${qtd} neste endereço: mova ou inative os equipamentos antes.`;
  }
  return null;
}

/** O que segue valendo naquele local: avisa, não bloqueia (a pessoa decide se encerra antes). */
export function avisosInativarEndereco(u: Pick<UsoEndereco, "contratosAtivos" | "pmocsAtivos" | "osAbertas">): string[] {
  const a: string[] = [];
  const ct = u.contratosAtivos, pm = u.pmocsAtivos, os = u.osAbertas;
  if (ct.length) {
    const qtd = pl(ct.length, "contrato ativo", "contratos ativos"), segue = ct.length === 1 ? "continua" : "continuam";
    a.push(`Está em ${qtd} (${ate3(ct)}): ${segue} atendendo este local até ser alterado.`);
  }
  if (pm.length) {
    const qtd = pl(pm.length, "PMOC ativo", "PMOCs ativos"), segue = pm.length === 1 ? "continua" : "continuam";
    a.push(`Tem ${qtd} (${ate3(pm)}): ${segue} valendo até ser inativado.`);
  }
  if (os.length) {
    const segue = os.length === 1 ? "segue" : "seguem";
    a.push(`Tem ${pl(os.length, "OS em aberto", "OS em aberto")} (${ate3(os)}): ${segue} normalmente.`);
  }
  return a;
}

/* ───────── Contato do cliente: inativar nunca bloqueia ───────── */

export interface UsoContato { principal: boolean; temAcessoPortal: boolean }

/** O login do portal só aceita contato ativo (lib/auth-portal): inativar corta o acesso na hora. */
export function avisosInativarContato(c: UsoContato): string[] {
  const a: string[] = [];
  if (c.temAcessoPortal) a.push("Tem acesso ao Portal do Cliente: o acesso fica bloqueado enquanto estiver inativo.");
  if (c.principal) a.push("É o contato principal: escolha outro contato principal depois.");
  return a;
}

/* ───────── Contrato: cancelar tem permissão própria; sair de Ativo mostra o que é cancelado junto ───────── */

/**
 * Cancelar o contrato exige "Contratos › Excluir" (como cancelar OS e orçamento); as outras trocas de
 * status (suspender, encerrar, renovar, reativar) seguem com "Contratos › Editar".
 */
export function acaoDoStatusContrato(novo: string): "editar" | "excluir" {
  return novo === "CANCELADO" ? "excluir" : "editar";
}

export interface SaidaContrato {
  /** OS agendadas e intocadas que a saída de Ativo cancela */
  osACancelar: string[];
  /** previsões de cobrança em aberto que são canceladas */
  previsoes: number;
  valorPrevisoes: number;
  /** OS do contrato que já andaram: seguem */
  osSeguem: string[];
}

/** O que acontece ao sair de Ativo (lib/financeiro-server › encerrarFinanceiroDoContrato), dito antes. */
export function avisosSaidaContrato(s: SaidaContrato): string[] {
  const a: string[] = [];
  const os = s.osACancelar, seguem = s.osSeguem;
  if (os.length) {
    const um = os.length === 1, qtd = pl(os.length, "OS agendada", "OS agendadas");
    const comecou = um ? "ainda não começou" : "ainda não começaram", sai = um ? "sai" : "saem";
    a.push(`Cancela ${qtd} que ${comecou} (${ate3(os)}): ${sai} da agenda.`);
  }
  if (s.previsoes > 0) {
    const qtd = pl(s.previsoes, "previsão de cobrança", "previsões de cobrança"), valor = formatarMoeda(s.valorPrevisoes);
    a.push(`Cancela ${qtd} em aberto (${valor}): o que já foi faturado ou recebido não muda.`);
  }
  if (seguem.length) {
    const qtd = pl(seguem.length, "OS já em andamento", "OS já em andamento");
    a.push(`Tem ${qtd} (${ate3(seguem)}): ${seguem.length === 1 ? "segue" : "seguem"} normalmente.`);
  }
  return a;
}

/* ───────── Modelos de checklist e de formulário: o uso aparece antes de inativar ───────── */

/** O que já foi feito com o modelo continua no histórico; o aviso diz quanto. */
export function avisosInativarModeloChecklist(preenchimentos: number): string[] {
  if (preenchimentos <= 0) return [];
  const vezes = pl(preenchimentos, "vez", "vezes");
  return [`Já foi preenchido ${vezes}: os preenchimentos continuam no histórico.`];
}

export function avisosInativarFormulario(vinculos: number): string[] {
  if (vinculos <= 0) return [];
  const qtd = pl(vinculos, "combinação", "combinações");
  return [`Em uso em ${qtd} de equipamento e tipo de OS: sai das próximas OS; as respostas já dadas ficam.`];
}

/* ───────── Nota de compra: descartar só a importada por engano, antes de lançar ───────── */

export interface NotaDescarte {
  status: string;
  /** contas a pagar ligadas (só existem depois de lançar) */
  contasPagar: number;
}

/**
 * Descartar APAGA a nota (com os itens e a conciliação) e deixa o registro em NotaCompraDescarte. Vale
 * só antes de lançar: a lançada já virou entrada no estoque e conta a pagar, e o caminho é o estorno.
 */
export function motivoNaoDescartarNota(n: NotaDescarte): string | null {
  if (n.status === "LANCADA" || n.contasPagar > 0) {
    return "Nota já lançada não se descarta: o estorno é pela conta a pagar e pelo ajuste de estoque.";
  }
  return null;
}

/* ───────── Nota de compra descartada: restaurar (Leva I.2) ───────── */

export const MSG_DESCARTE_SEM_XML = "Este descarte é de antes de guardar o XML da nota: importe o XML de novo.";
export const MSG_DESCARTE_JA_RESTAURADO = "Esta nota já foi restaurada.";

/**
 * Restaurar reimporta a nota pelo XML guardado no descarte (o mesmo caminho da importação). Não dá
 * quando o descarte é antigo (sem o XML) ou já foi restaurado. A chave já importada de novo é conferida
 * no servidor (precisa do banco): restaurarNotaDescartada.
 */
export function motivoNaoRestaurarNota(d: { temXml: boolean; restauradaEm: Date | string | null }): string | null {
  if (d.restauradaEm) return MSG_DESCARTE_JA_RESTAURADO;
  if (!d.temXml) return MSG_DESCARTE_SEM_XML;
  return null;
}

/** A nota já foi importada de novo (alguém subiu o XML depois do descarte): restaurar duplicaria. */
export const msgNotaJaImportadaDeNovo = (n: { numero: string; serie: string; em: string }) =>
  `A NF ${n.numero}/${n.serie} já foi importada de novo em ${n.em}: não há o que restaurar. Abra a nota importada.`;
