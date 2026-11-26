/**
 * PONTAS SOLTAS DE CADASTRO (leva 4): as regras puras de "pode apagar / cancelar / inativar?" que as
 * rotas e as telas usam. A regra da casa é uma só: o que já tem uso ARQUIVA (inativa, cancela), não
 * apaga; o que nunca saiu do rascunho pode ser excluído. Tudo aqui é puro (sem banco), para ser testado
 * e reaproveitado pela tela.
 */

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
    return "Este é o modelo do checklist diário obrigatório: inativado, o app deixaria de cobrar o checklist. Escolha outro modelo no checklist diário antes.";
  }
  return null;
}

/* ───────── Colaborador: a opção "Inativo" do status ───────── */

/**
 * Inativar colaborador exige "Equipes › Excluir" (como o botão Inativar). No formulário, quem só edita
 * não vê a opção, a não ser que ele já esteja inativo (o valor atual precisa continuar visível).
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
 * {entidade} sai das listas e seletores; nada é apagado…". Onde não há reativação (endereço, contato),
 * a frase não promete o "pode ser reativado depois".
 */
export function textoInativar(entidade: string, nome: string | null | undefined, genero: Genero = "m", reativavel = true): TextoInativar {
  const art = genero === "f" ? "A" : "O";
  const fim = genero === "f" ? "a" : "o";
  const n = (nome ?? "").trim();
  return {
    titulo: `Inativar ${entidade}${n ? ` ${n}` : ""}?`,
    mensagem: `Tem certeza? ${art} ${entidade} sai das listas e seletores; nada é apagado${reativavel ? ` e pode ser reativad${fim} depois` : ""}.`,
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
  if (u.contratosAtivos.length) a.push(`Tem ${pl(u.contratosAtivos.length, "contrato ativo", "contratos ativos")} (${ate3(u.contratosAtivos)}): ele${u.contratosAtivos.length === 1 ? " continua" : "s continuam"} gerando OS e cobrança até você encerrar.`);
  if (u.osAbertas.length) a.push(`Tem ${pl(u.osAbertas.length, "OS em aberto", "OS em aberto")} (${ate3(u.osAbertas)}): elas seguem normalmente.`);
  if (u.orcamentosAbertos) a.push(`Tem ${pl(u.orcamentosAbertos, "orçamento em aberto", "orçamentos em aberto")}.`);
  if (u.contasAbertas) a.push(`Tem ${pl(u.contasAbertas, "conta a receber em aberto", "contas a receber em aberto")}: a cobrança continua.`);
  if (u.pmocsAtivos) a.push(`Tem ${pl(u.pmocsAtivos, "PMOC ativo", "PMOCs ativos")}.`);
  return a;
}
