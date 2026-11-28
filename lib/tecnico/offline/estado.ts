/**
 * O que a tela do técnico mostra = o último RETRATO do servidor + as operações da fila ainda não
 * refletidas nele, aplicadas em ordem com as MESMAS regras do servidor (lib/execucao/acoes). Puro e
 * testável: sem sinal, o técnico vê exatamente o que vai ficar gravado quando sincronizar — e o que
 * falta para concluir é calculado com as regras da trava (lib/execucao/pendencias).
 */
import { completo, faltasEquipamento, paraPendencia, verificarConclusao, type StatusItem } from "@/lib/execucao/pendencias";
import { apresentarCadastro } from "@/lib/tecnico/cadastro-equipamento";
import { aplicarToque } from "@/lib/tecnico/aviso-cliente";
import { aplicarMaterial, removerMaterialDaLista } from "@/lib/tecnico/materiais";
import { aplicarComentario } from "@/lib/tecnico/comentarios";
import { calcularGrandeza, ehCalculada, grandezaDoItem, type Grandeza, type LeituraGrandeza } from "@/lib/checklist/faixas";
import type { ItemTela,
  AdicionalTela, EquipamentoTela, ExecucaoTela, FotoTela, OperacaoFila, RespostaTela, RetratoAtividade,
} from "@/lib/tecnico/offline/tipos";

const VAZIA: RespostaTela = { status: null, observacao: null, valor: null, unidade: null, audio: false, audioId: null };

/** ΔT e afins: refaz no aparelho, a partir das leituras do equipamento (a mesma regra do servidor). */
export function comCalculadas(itens: ItemTela[], respostas: Record<string, RespostaTela>): Record<string, RespostaTela> {
  const calculadas = itens.filter((i) => ehCalculada(grandezaDoItem(i)));
  if (!calculadas.length) return respostas;
  const leituras: Partial<Record<Grandeza, LeituraGrandeza>> = {};
  for (const it of itens) {
    const g = grandezaDoItem(it);
    const r = respostas[it.id];
    if (g && r && !ehCalculada(g)) leituras[g] = { valor: r.valor, unidade: r.unidade ?? it.unidade, naoSeAplica: r.status === "NAO_SE_APLICA" };
  }
  const saida = { ...respostas };
  for (const it of calculadas) {
    const c = calcularGrandeza(grandezaDoItem(it)!, leituras, it.unidade);
    const atual = respostas[it.id] ?? VAZIA;
    saida[it.id] = c === null ? { ...atual, status: null, valor: null }
      : "naoSeAplica" in c ? { ...atual, status: "NAO_SE_APLICA", valor: null }
        : { ...atual, status: null, valor: c.valor, unidade: c.unidade };
    if (c === null && !respostas[it.id]) delete saida[it.id];
  }
  return saida;
}

/** Recalcula o que falta (por equipamento e para concluir). */
export function recalcular(x: ExecucaoTela): ExecucaoTela {
  const equipamentos = x.equipamentos.map((e) => {
    const faltas = faltasEquipamento(paraPendencia(e));
    return { ...e, faltas, completo: completo(faltas) };
  });
  return { ...x, equipamentos, conclusao: verificarConclusao(equipamentos.map((e) => paraPendencia(e)), x.dispensaEquipamento ?? null) };
}

const limpar = (v: string | null | undefined) => (v ?? "").trim() || null;

/** Resolve um QR lido para um equipamento da unidade (mesma regra do servidor: URL …/qr/<token>, token ou código). */
export function equipamentoDoQr(r: RetratoAtividade, valorLido: string) {
  const valor = valorLido.trim();
  const m = valor.match(/\/qr\/([^/?#\s]+)/);
  const token = m ? m[1] : valor;
  return r.equipamentosUnidade.find((e) => e.qr && (e.qr.tokenPublico === token || e.qr.codigo === valor)) ?? null;
}

function novoEquipamento(r: RetratoAtividade, id: string, feito: boolean): EquipamentoTela | null {
  const u = r.equipamentosUnidade.find((e) => e.id === id);
  if (!u) return null;
  const { tipoEquipamentoId, qr: _qr, ...equipamento } = u;
  return {
    vinculoId: null, feito, observacao: null, equipamento, itens: tipoEquipamentoId ? (r.checklistsPorTipo[tipoEquipamentoId] ?? []) : [],
    respostas: {}, fotos: [], formulario: null, faltas: { semResposta: [], semFoto: [], semObservacao: [], formulario: null }, completo: false, pendente: true,
  };
}

/** Aplica UMA operação (cópia nova; o retrato guardado não muda). */
export function aplicar(r: RetratoAtividade, x: ExecucaoTela, op: OperacaoFila): ExecucaoTela {
  const mudarEquip = (id: string, f: (e: EquipamentoTela) => EquipamentoTela) =>
    ({ ...x, equipamentos: x.equipamentos.map((e) => (e.equipamento.id === id ? f(e) : e)) });
  const mudarAdicional = (ref: { id?: string | null; clientId?: string | null }, f: (a: AdicionalTela) => AdicionalTela | null) => ({
    ...x,
    adicionais: x.adicionais.map((a) => ((ref.clientId && a.clientId === ref.clientId) || (ref.id && a.id === ref.id) ? f(a) : a)).filter((a): a is AdicionalTela => !!a),
  });

  switch (op.tipo) {
    case "iniciar":
      return x.atividade.status === "AGENDADA" ? { ...x, atividade: { ...x.atividade, status: "EM_ANDAMENTO" } } : x;

    case "concluir":
      return { ...x, atividade: { ...x.atividade, status: "CONCLUIDA" }, bloqueada: true, pausa: null };

    // D1: a pausa vale já na tela (sem sinal também); o servidor confere o motivo ao sincronizar
    case "pausar":
      return x.atividade.status !== "EM_ANDAMENTO" || x.pausa ? x
        : { ...x, pausa: { clientId: op.dados.clientId, motivo: op.dados.motivo, impedimento: op.dados.impedimento, inicio: op.em ?? op.criadoEm, observacao: op.dados.observacao ?? null, pendente: true } };
    case "retomar":
      return x.pausa?.clientId === op.dados.pausaClientId ? { ...x, pausa: null } : x;
    case "naoConcluida":
      return x.pausa?.clientId === op.dados.pausaClientId
        ? { ...x, pausa: null, atividade: { ...x.atividade, status: "AGENDADA" }, bloqueada: true, naoConcluida: { motivo: x.pausa.motivo, em: op.em ?? op.criadoEm } }
        : x;

    case "aceite":
      // O cliente assinou no aparelho: vale já na tela (sem sinal também); a assinatura sobe pela fila
      return { ...x, aceiteLocal: { nome: op.dados.nome, em: op.em ?? op.criadoEm } };

    case "avisoCliente": {
      // O horário do toque vale já (sem sinal também). Um por evento, por dia: o que o servidor já
      // registrou hoje fica; o toque repetido não muda nada
      const avisos = aplicarToque(x.avisos, op.dados.evento, op.em ?? op.criadoEm);
      return avisos === x.avisos ? x : { ...x, avisos };
    }

    case "resposta":
      return mudarEquip(op.equipamentoId, (e) => {
        const item = e.itens.find((i) => i.id === op.itemId);
        if (!item) return e;
        const atual = e.respostas[op.itemId] ?? VAZIA;
        const d = op.dados;
        const nova: RespostaTela = { ...atual };
        if (d.observacao !== undefined) nova.observacao = limpar(d.observacao);
        if (ehCalculada(grandezaDoItem(item)) && (d.valor !== undefined || d.status !== undefined || d.unidade !== undefined)) return e; // o servidor recusa
        if (item.tipoResposta === "MEDICAO") {
          if (d.status === "OK" || d.status === "ATENCAO") return e; // o servidor recusa
          if (d.unidade !== undefined) nova.unidade = limpar(d.unidade);
          if (d.valor !== undefined) {
            nova.valor = d.valor;
            if (d.valor !== null) { nova.status = null; if (d.unidade === undefined) nova.unidade = atual.unidade ?? item.unidade ?? null; }
          }
          if (d.status !== undefined) { nova.status = d.status; if (d.status === "NAO_SE_APLICA") nova.valor = null; }
        } else {
          if ((d.valor !== undefined && d.valor !== null) || (d.unidade !== undefined && d.unidade !== null)) return e;
          if (d.status !== undefined) nova.status = d.status;
        }
        const feito = e.feito || !!(nova.status || nova.observacao || nova.valor !== null);
        return { ...e, feito, respostas: comCalculadas(e.itens, { ...e.respostas, [op.itemId]: nova }) };
      });

    case "audio":
      return mudarEquip(op.equipamentoId, (e) => {
        if (!e.itens.some((i) => i.id === op.itemId)) return e;
        const atual = e.respostas[op.itemId] ?? VAZIA;
        const com = !!op.dataUrl;
        return { ...e, feito: e.feito || com, respostas: { ...e.respostas, [op.itemId]: { ...atual, audio: com, audioLocal: op.dataUrl, audioId: com ? atual.audioId : null } } };
      });

    case "tudoOk":
      return mudarEquip(op.equipamentoId, (e) => {
        const respostas = { ...e.respostas };
        let marcou = false;
        for (const i of e.itens) {
          if (!i.ativo || i.tipoResposta !== "OK_ATENCAO_NA" || respostas[i.id]?.status) continue;
          respostas[i.id] = { ...(respostas[i.id] ?? VAZIA), status: "OK" as StatusItem };
          marcou = true;
        }
        return { ...e, feito: e.feito || marcou, respostas };
      });

    case "foto":
      return mudarEquip(op.equipamentoId, (e) => {
        if (op.dados.clientId && e.fotos.some((f) => f.clientId === op.dados.clientId)) return e;
        const foto: FotoTela = { id: null, clientId: op.dados.clientId ?? null, itemId: op.dados.itemId ?? null, momento: op.dados.momento ?? null, local: op.dados.dataUrl, pendente: true };
        return { ...e, feito: true, fotos: [...e.fotos, foto] };
      });

    case "fotoRemover":
      return {
        ...x,
        equipamentos: x.equipamentos.map((e) => ({
          ...e, fotos: e.fotos.filter((f) => !((op.dados.clientId && f.clientId === op.dados.clientId) || (op.dados.id && f.id === op.dados.id))),
        })),
      };

    case "equipamento":
      return mudarEquip(op.equipamentoId, (e) => {
        const obs = op.dados.observacao === undefined ? undefined : limpar(op.dados.observacao);
        let feito = e.feito;
        if (op.dados.feito !== undefined) feito = op.dados.feito;
        else if (obs) feito = true;
        return { ...e, feito, ...(obs !== undefined && { observacao: obs }) };
      });

    case "formulario":
      return mudarEquip(op.equipamentoId, (e) => {
        if (!e.formulario || e.formulario.id !== op.dados.formularioId) return e;
        const atual = e.formulario.respostas[op.dados.campoId] ?? { resposta: null, arquivoUrl: null };
        const nova = {
          resposta: op.dados.resposta !== undefined ? op.dados.resposta : atual.resposta,
          arquivoUrl: op.dados.arquivoUrl !== undefined ? op.dados.arquivoUrl : atual.arquivoUrl,
        };
        const feito = e.feito || !!((nova.resposta ?? "").trim() || nova.arquivoUrl);
        return { ...e, feito, formulario: { ...e.formulario, respostas: { ...e.formulario.respostas, [op.dados.campoId]: nova } } };
      });

    case "vincular": {
      const novos = op.equipamentoIds
        .filter((id) => !x.equipamentos.some((e) => e.equipamento.id === id))
        .map((id) => novoEquipamento(r, id, false))
        .filter((e): e is EquipamentoTela => !!e);
      return novos.length ? { ...x, equipamentos: [...x.equipamentos, ...novos] } : x;
    }

    case "cadastrarEquipamento": {
      // Equipamento novo, cadastrado em campo: já entra na OS (vinculado, ainda não atendido) com o
      // checklist do tipo escolhido — sem sinal, o técnico segue a execução nele normalmente
      if (x.equipamentos.some((e) => e.equipamento.id === op.dados.id)) return x;
      const { tipoEquipamentoId, ...equipamento } = apresentarCadastro(op.dados, r.cadastro?.tipos ?? []);
      const novo: EquipamentoTela = {
        vinculoId: null, feito: false, observacao: null, equipamento, itens: tipoEquipamentoId ? (r.checklistsPorTipo[tipoEquipamentoId] ?? []) : [],
        respostas: {}, fotos: [], formulario: null, faltas: { semResposta: [], semFoto: [], semObservacao: [], formulario: null }, completo: false, pendente: true,
      };
      return { ...x, equipamentos: [...x.equipamentos, novo] };
    }

    case "scan": {
      const u = equipamentoDoQr(r, op.valor);
      if (!u) return x;
      if (x.equipamentos.some((e) => e.equipamento.id === u.id)) return mudarEquip(u.id, (e) => ({ ...e, feito: true }));
      const novo = novoEquipamento(r, u.id, true);
      return novo ? { ...x, equipamentos: [...x.equipamentos, novo] } : x;
    }

    case "adicional": {
      const d = op.dados;
      const existe = x.adicionais.find((a) => (d.clientId && a.clientId === d.clientId) || (d.id && a.id === d.id));
      if (existe) return mudarAdicional(d, (a) => ({ ...a, descricao: d.descricao, ...(d.equipamentoId !== undefined && { equipamentoId: d.equipamentoId }), pendente: true }));
      const novo: AdicionalTela = {
        id: null, clientId: d.clientId ?? null, descricao: d.descricao, equipamentoId: d.equipamentoId ?? null, cobrancaDecidida: false, fotos: [], criadoPor: null, pendente: true,
      };
      return { ...x, adicionais: [...x.adicionais, novo] };
    }

    case "adicionalRemover":
      return mudarAdicional(op.dados, () => null);

    case "adicionalFoto":
      return mudarAdicional({ id: op.dados.servicoId, clientId: op.dados.servicoClientId }, (a) =>
        (op.dados.clientId && a.fotos.some((f) => f.clientId === op.dados.clientId) ? a : { ...a, fotos: [...a.fotos, { id: null, clientId: op.dados.clientId ?? null, local: op.dados.dataUrl }] }));

    case "fotoOs": {
      const lista = x.fotosServico ?? [];
      if (op.dados.clientId && lista.some((f) => f.clientId === op.dados.clientId)) return x;
      return {
        ...x,
        fotosServico: [...lista, {
          id: null, clientId: op.dados.clientId ?? null, equipamentoId: op.dados.equipamentoId, legenda: limpar(op.dados.legenda), local: op.dados.dataUrl, pendente: true,
        }],
      };
    }

    case "material":
      return { ...x, materiais: aplicarMaterial(x.materiais ?? [], op.dados) };

    case "materialRemover":
      return { ...x, materiais: removerMaterialDaLista(x.materiais ?? [], op.dados) };

    case "comentario":
      return { ...x, comentarios: aplicarComentario(x.comentarios ?? [], op.dados, op.em ?? op.criadoEm) };

    case "despesa":
      // A despesa não muda a execução: aparece em "Minhas despesas" (lida da fila e do servidor)
      return x;

    case "fotoChatEquipamento":
      // O equipamento de uma foto do chat: a tela Chat mostra a correção pela fila; a execução da OS não muda
      return x;

    case "fotoOsRemover":
      return { ...x, fotosServico: (x.fotosServico ?? []).filter((f) => !((op.dados.clientId && f.clientId === op.dados.clientId) || (op.dados.id && f.id === op.dados.id))) };

    case "fotoOsLegenda":
      return {
        ...x,
        fotosServico: (x.fotosServico ?? []).map((f) => ((op.dados.clientId && f.clientId === op.dados.clientId) || (op.dados.id && f.id === op.dados.id) ? { ...f, legenda: limpar(op.dados.legenda) } : f)),
      };

    case "adicionalFotoRemover":
      return {
        ...x,
        adicionais: x.adicionais.map((a) => ({
          ...a, fotos: a.fotos.filter((f) => !((op.dados.clientId && f.clientId === op.dados.clientId) || (op.dados.id && f.id === op.dados.id))),
        })),
      };
  }
}

/**
 * O estado da tela: retrato + operações da fila DESTA atividade (pendentes, com erro ou já enviadas
 * mas ainda não refletidas num retrato novo), em ordem.
 */
export function estadoDaAtividade(r: RetratoAtividade, fila: OperacaoFila[]): ExecucaoTela {
  const ops = fila.filter((o) => o.atividadeId === r.execucao.atividade.id).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const base: ExecucaoTela = {
    ...r.execucao,
    adicionais: r.execucao.adicionais ?? [],
    fotosServico: r.execucao.fotosServico ?? [],
    materiais: r.execucao.materiais ?? [],
    comentarios: r.execucao.comentarios ?? [],
    equipamentos: r.execucao.equipamentos.map((e) => ({ ...e, respostas: { ...e.respostas } })),
  };
  return recalcular(ops.reduce((x, op) => aplicar(r, x, op), base));
}

/**
 * O próximo equipamento a fazer depois de `atual`: o seguinte na lista que ainda não está atendido e
 * completo; não havendo, um anterior que foi atendido mas ficou incompleto; senão nenhum (volta à OS).
 */
export function proximoEquipamento(x: ExecucaoTela, atualId: string | null): string | null {
  const lista = x.equipamentos;
  const i = atualId ? lista.findIndex((e) => e.equipamento.id === atualId) : -1;
  const depois = lista.slice(i + 1).find((e) => !(e.feito && e.completo));
  if (depois) return depois.equipamento.id;
  return lista.slice(0, Math.max(i, 0)).find((e) => e.feito && !e.completo)?.equipamento.id ?? null;
}

/** O escritório já avaliou a cobrança deste adicional? (retrato novo: o sinal; retrato antigo: a situação guardada) */
export const adicionalAvaliado = (a: { cobrancaDecidida?: boolean; statusCobranca?: string }): boolean =>
  a.cobrancaDecidida ?? (!!a.statusCobranca && a.statusCobranca !== "A_AVALIAR");
