"use client";

import { ROTULO_SITUACAO_APP, comissoesDaTela, type ComissaoRetrato } from "@/lib/tecnico/comissao";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCheck, ChevronLeft, ChevronRight, CircleSlash, ClipboardList, Ruler } from "lucide-react";
import { faixaSomenteLeitura } from "@/lib/tecnico/somente-leitura";
import { FaixaPausa } from "@/components/tecnico/pausa";
import { cn, formatarMoeda } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { CampoFormulario } from "@/components/os/execucao-equipamento";
import { BotaoFoto, Miniatura, ObservacaoVoz, type MarcaFoto } from "@/components/tecnico/captura";
import { BotaoCamera, CameraSequencia, cameraAoVivoDisponivel, type PassoFoto } from "@/components/tecnico/camera-sequencia";
import { irPara } from "@/components/tecnico/contexto";
import { MateriaisUsados } from "@/components/tecnico/materiais";
import { SeloGarantia } from "@/components/tecnico/garantia";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { proximoEquipamento } from "@/lib/tecnico/offline/estado";
import { UNIDADES_SUGERIDAS } from "@/lib/checklist/tipo";
import { avaliarFaixa, avisoFaixa, ehCalculada, faixaNaUnidade, GRANDEZA, grandezaDoItem, textoFaixa } from "@/lib/checklist/faixas";
import { listaCurta, progressoDoChecklist, type StatusItem } from "@/lib/execucao/pendencias";
import type { EquipamentoTela, ExecucaoTela, FotoTela, ItemTela, NovaOperacao, RespostaTela } from "@/lib/tecnico/offline/tipos";

export const srcFoto = (f: { id: string | null; local?: string }) => f.local ?? `/api/fotos-atendimento/${f.id}`;
const srcAudio = (r?: RespostaTela) => (r?.audioLocal ? r.audioLocal : r?.audioId ? `/api/checklist-respostas/${r.audioId}/audio` : null);

/** Número digitado no celular ("12,5", "-3", "1.234,5") → número; vazio → null; inválido → NaN. */
export function lerNumero(t: string): number | null {
  const s = t.trim().replace(/\s/g, "");
  if (!s) return null;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}
const mostrarNumero = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));

const CHIP: Record<StatusItem, { rotulo: string; ativo: string; Icone: typeof Check }> = {
  OK: { rotulo: "OK", ativo: "bg-success-600 border-success-600 text-white", Icone: Check },
  ATENCAO: { rotulo: "Atenção", ativo: "bg-atencao border-atencao text-white", Icone: AlertTriangle },
  NAO_SE_APLICA: { rotulo: "N/A", ativo: "bg-ink-muted border-ink-muted text-white", Icone: CircleSlash },
};

interface Props {
  x: ExecucaoTela;
  e: EquipamentoTela;
  registrar: (ops: NovaOperacao[]) => Promise<void>;
  /** Endereço da OS (vem do cartão) para a marca d'água das fotos, quando ligada */
  endereco?: string | null;
  /** Código do QR do equipamento (ex.: o número gerado no cadastro em campo), para o técnico anotar */
  qr?: string | null;
  /** COM-2B: a comissão de quem está com o aparelho (vem do retrato); null/ausente = não se aplica */
  comissao?: ComissaoRetrato | null;
}

/**
 * UM equipamento, guiado e no "dedão": fotos ANTES → TUDO OK (marca OK o que está sem resposta) →
 * ajusta o que não está OK (Atenção pede foto + observação, que pode ser falada) → medições (número +
 * unidade, sem avaliar) → fotos DEPOIS → "Concluir equipamento" leva ao próximo. Tudo grava no aparelho.
 */
export function TelaEquipamento({ x, e, registrar, endereco, qr, comissao }: Props) {
  const atividadeId = x.atividade.id;
  const equipamentoId = e.equipamento.id;
  const so = x.bloqueada;
  const marca = { osNumero: x.os.numero, endereco };
  const [atencao, setAtencao] = useState<ItemTela | null>(null);
  const [mostrarFaltas, setMostrarFaltas] = useState(false);
  const [naoAtendido, setNaoAtendido] = useState(false);
  const topo = useRef<HTMLDivElement>(null);

  const ativos = e.itens.filter((i) => i.ativo);
  const { feitos, total: totalItens } = progressoDoChecklist(e.itens, e.respostas);
  const semResposta = ativos.filter((i) => i.tipoResposta === "OK_ATENCAO_NA" && !e.respostas[i.id]?.status).length;
  const fotosDe = (itemId: string | null, momento: "ANTES" | "DEPOIS" | null) => e.fotos.filter((f) => f.itemId === itemId && (itemId ? true : f.momento === momento));
  const faltando = useMemo(() => new Set([...e.faltas.semResposta, ...e.faltas.semFoto, ...e.faltas.semObservacao]), [e.faltas]);
  const posicao = x.equipamentos.findIndex((q) => q.equipamento.id === equipamentoId);
  const total = x.equipamentos.length;
  const anterior = posicao > 0 ? x.equipamentos[posicao - 1].equipamento.id : null;
  const seguinte = posicao >= 0 && posicao < total - 1 ? x.equipamentos[posicao + 1].equipamento.id : null;
  // Para onde o "Concluir equipamento" leva: o próximo ainda por fazer (ou a OS, quando acabou)
  const proxId = proximoEquipamento(x, equipamentoId);
  const prox = proxId ? x.equipamentos.find((q) => q.equipamento.id === proxId) ?? null : null;
  const proxPosicao = prox ? x.equipamentos.indexOf(prox) + 1 : 0;
  const pular = (id: string) => irPara({ ver: "os", a: atividadeId, e: id }, true);

  // Y8: cada pendência do banner vira um botão que PULA ao item (as faltas guardam o TEXTO do item)
  const pendencias = useMemo(() => {
    const idDoTexto = (t: string) => e.itens.find((i) => i.texto === t)?.id ?? null;
    const lista: { chave: string; rotulo: string; alvo: string | null }[] = [];
    for (const t of e.faltas.semResposta) lista.push({ chave: `r:${t}`, rotulo: `Responder: ${t}`, alvo: idDoTexto(t) });
    for (const t of e.faltas.semFoto) lista.push({ chave: `f:${t}`, rotulo: `Foto: ${t}`, alvo: idDoTexto(t) });
    for (const t of e.faltas.semObservacao) lista.push({ chave: `o:${t}`, rotulo: `Observação: ${t}`, alvo: idDoTexto(t) });
    if (e.faltas.formulario) lista.push({ chave: "form", rotulo: `Formulário “${e.faltas.formulario.nome}”: ${listaCurta(e.faltas.formulario.campos)}`, alvo: "formulario" });
    return lista;
  }, [e.faltas, e.itens]);
  const irAoItem = (alvo: string | null) => {
    if (!alvo) return;
    document.querySelector(alvo === "formulario" ? "[data-form-equipamento]" : `[data-item="${alvo}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  /** Operação deste equipamento (a forma de cada tipo é conferida pelo servidor e pelo estado local). */
  const op = (o: { tipo: NovaOperacao["tipo"] } & Record<string, unknown>) => ({ ...o, atividadeId, equipamentoId }) as NovaOperacao;
  // A última gravação de resposta: "Concluir" espera por ela (o número digitado grava ao sair do campo)
  const gravacao = useRef<Promise<unknown>>(Promise.resolve());
  const ultimaResposta = useRef<{ itemId: string; valor: unknown } | null>(null);
  const ultimo = useRef(e);
  ultimo.current = e;
  const responder = (itemId: string, dados: Record<string, unknown>) => {
    const p = registrar([op({ tipo: "resposta", itemId, dados })]);
    gravacao.current = p;
    ultimaResposta.current = "valor" in dados ? { itemId, valor: dados.valor ?? null } : null;
    return p;
  };
  const foto = (dataUrl: string, extra: { itemId?: string | null; momento?: "ANTES" | "DEPOIS" | null }) =>
    registrar([op({ tipo: "foto", dados: { dataUrl, clientId: novoClientId(), ...extra } })]);
  /**
   * A câmera segue sozinha pelas fotos que faltam depois deste item: as PEDIDAS seguintes (na ordem do checklist)
   * e, sem foto "depois" ainda, a do equipamento pronto. "Pular" passa uma; o X fecha.
   */
  const passosDesde = (it: ItemTela): PassoFoto[] => {
    const passo = (q: ItemTela): PassoFoto => ({ chave: q.id, rotulo: q.texto, onFoto: (d) => foto(d, { itemId: q.id }) });
    const depois = e.itens.slice(e.itens.indexOf(it) + 1).filter((q) => q.ativo && q.pedirFoto && !fotosDe(q.id, null).length && e.respostas[q.id]?.status !== "NAO_SE_APLICA");
    const fotoDepois: PassoFoto[] = fotosDe(null, "DEPOIS").length ? [] : [{ chave: "depois", rotulo: "Foto depois do serviço", onFoto: (d) => foto(d, { momento: "DEPOIS" }) }];
    return [passo(it), ...depois.map(passo), ...fotoDepois];
  };
  /**
   * Fotos feitas: a tela já desce até a primeira medição vazia (o próximo passo fica sob o dedão). Só rola: o
   * teclado não abre sozinho fora de um toque no iPhone, e um campo focado sem teclado confunde.
   */
  const rolarAteMedicaoVazia = () => window.setTimeout(() => {
    const campo = [...document.querySelectorAll<HTMLInputElement>("input[data-campo-medicao]:not(:disabled)")].find((c) => !c.value.trim());
    campo?.closest("[data-medicao]")?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, 50);
  // TUDO OK com fotos PEDIDAS faltando: a câmera já abre nelas (são obrigatórias para concluir); o X fecha
  const [sequencia, setSequencia] = useState<PassoFoto[] | null>(null);
  async function tudoOk() {
    await registrar([op({ tipo: "tudoOk" })]);
    const primeira = e.itens.find((q) => q.ativo && q.pedirFoto && !fotosDe(q.id, null).length && e.respostas[q.id]?.status !== "NAO_SE_APLICA");
    if (!primeira) return;
    if (cameraAoVivoDisponivel()) setSequencia(passosDesde(primeira));
    else document.querySelector(`[data-item="${primeira.id}"]`)?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
  const tirarFoto = (f: FotoTela) => registrar([{ tipo: "fotoRemover", atividadeId, dados: f.clientId ? { clientId: f.clientId } : { id: f.id! } }]);

  function tocarStatus(item: ItemTela, s: StatusItem) {
    if (so) return;
    if (s === "ATENCAO") { setAtencao(item); return; }
    void responder(item.id, { status: s });
  }

  async function concluirEquipamento() {
    // Digitou a última medição e tocou direto aqui: grava o número antes de conferir o que falta
    const ativo = document.activeElement;
    if (ativo instanceof HTMLInputElement && ativo.matches("[data-campo-medicao]")) ativo.blur();
    await gravacao.current.catch(() => undefined);
    // A tela relê o aparelho logo depois da gravação: espera a última resposta aparecer nela (até 0,5 s)
    const chegou = () => { const u = ultimaResposta.current; return !u || JSON.stringify(ultimo.current.respostas[u.itemId]?.valor ?? null) === JSON.stringify(u.valor); };
    for (let i = 0; i < 20 && !chegou(); i++) await new Promise((ok) => window.setTimeout(ok, 25));
    const e = ultimo.current;
    if (!e.completo) {
      setMostrarFaltas(true);
      topo.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (!e.feito) await registrar([op({ tipo: "equipamento", dados: { feito: true } })]);
    const prox = proximoEquipamento(x, equipamentoId);
    // O último: volta à OS já na confirmação da conclusão (quando a atividade pode ser concluída)
    irPara(prox ? { ver: "os", a: atividadeId, e: prox } : { ver: "os", a: atividadeId, fim: true }, true);
  }

  return (
    <div className="space-y-4 pb-32" data-vista="equipamento" data-equipamento={equipamentoId}>
      {/* D1: pausada — a faixa (Retomar) aparece também no equipamento */}
      <FaixaPausa x={x} registrar={registrar} />
      {/* Uma linha só para voltar, a posição e as setas: a tela fica curta e o TUDO OK sobe para o dedão */}
      <div ref={topo} className="flex items-center justify-between gap-2 -mt-1">
        <button type="button" onClick={() => irPara({ ver: "os", a: atividadeId })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
          <ArrowLeft className="w-4 h-4" /> Equipamentos da OS
        </button>
        <div className="flex items-center gap-0.5 -mr-2">
          {total > 1 && (
            <button type="button" disabled={!anterior} onClick={() => anterior && pular(anterior)} aria-label="Equipamento anterior" data-nav-equipamento="anterior"
              className="inline-flex items-center justify-center rounded-lg text-primary-700 active:bg-primary-50 disabled:text-ink-subtle disabled:opacity-40 touch-target"><ChevronLeft className="w-6 h-6" /></button>
          )}
          <p className="text-xs font-semibold text-ink-muted tabular-nums" data-posicao-equipamento aria-label={`Equipamento ${posicao + 1} de ${total}`}>
            <span className="sr-only">Equipamento </span>{posicao + 1} de {total}
          </p>
          {total > 1 && (
            <button type="button" disabled={!seguinte} onClick={() => seguinte && pular(seguinte)} aria-label="Próximo equipamento" data-nav-equipamento="proximo"
              className="inline-flex items-center justify-center rounded-lg text-primary-700 active:bg-primary-50 disabled:text-ink-subtle disabled:opacity-40 touch-target"><ChevronRight className="w-6 h-6" /></button>
          )}
        </div>
      </div>

      <header className="bg-white rounded-card border border-surface-border p-4 space-y-2">
        <h1 className="text-xl font-bold text-ink leading-tight">{e.equipamento.titulo}</h1>
        <p className="text-sm text-ink-muted">
          {[e.equipamento.tipo?.nome, e.equipamento.tag && `TAG ${e.equipamento.tag}`, e.equipamento.local, qr].filter(Boolean).join(" · ")}
        </p>
        <SeloGarantia fim={e.equipamento.garantiaAte} />
        {e.pendente && !e.vinculoId && <p className="text-xs text-atencao-texto" data-equipamento-no-aparelho>No aparelho: sobe sozinho quando houver sinal.</p>}
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 rounded-full bg-surface-page overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", e.completo ? "bg-success-500" : "bg-primary-500")} style={{ width: `${totalItens ? (feitos / totalItens) * 100 : 0}%` }} />
          </div>
          <span className="text-xs font-semibold text-ink-muted" data-progresso>{feitos} de {totalItens}</span>
          {/* G11: o número sozinho não diz O QUE está sendo contado (na dica: a tela fica curta, o TUDO OK sob o dedão) */}
          <Dica rotulo="Progresso" texto="Itens do checklist e medições respondidos. Fotos e observações pedidas contam à parte." lado="direita" />
        </div>
        {/* COM-2B: completou o relatório → a comissão dele aparece na hora (o servidor confirma no envio) */}
        {(() => {
          const com = comissoesDaTela([e], comissao).get(equipamentoId);
          return com ? (
            <p key={com.situacao} className="anim-comissao inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-1 text-sm font-semibold text-success-800" data-comissao-equip={equipamentoId} data-situacao-comissao={com.situacao}>
              Sua comissão: {formatarMoeda(com.valor)} · {ROTULO_SITUACAO_APP[com.situacao]}
            </p>
          ) : null;
        })()}
      </header>

      {so && (() => {
        const f = faixaSomenteLeitura(x.atividade.status);
        return <p className={cn("rounded-card border p-3 text-sm", f.tom === "ok" ? "bg-success-50 border-success-200 text-success-800" : "bg-atencao-claro border-atencao/20 text-atencao-texto")} data-somente-leitura-faixa={f.tom}>{f.texto}</p>;
      })()}
      {mostrarFaltas && !e.completo && (
        <div className="rounded-card bg-atrasado-claro border border-atrasado/20 p-3 text-sm text-atrasado-texto" role="alert" data-faltas>
          <p className="font-semibold">Para concluir este equipamento, falta:</p>
          <ul className="mt-1 space-y-0.5">
            {pendencias.map((p) => (
              <li key={p.chave}>
                <button type="button" data-pendencia onClick={() => irAoItem(p.alvo)}
                  className="w-full text-left py-1 underline underline-offset-2 decoration-atrasado-claro active:text-atrasado-texto touch-target">
                  {p.rotulo} ›
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Secao titulo="Fotos ANTES" Icone={Camera} contagem={fotosDe(null, "ANTES").length} chave="antes"
        acao={!so && <BotaoCamera rotulo="Foto antes" titulo={e.equipamento.titulo} marca={marca} passos={() => [{ chave: "antes", rotulo: "Foto antes do serviço", onFoto: (d) => foto(d, { momento: "ANTES" }) }]} />}>
        <Fotos fotos={fotosDe(null, "ANTES")} onRemover={so ? undefined : tirarFoto} />
      </Secao>

      {ativos.length > 0 && !so && (
        <button type="button" onClick={tudoOk} disabled={!semResposta} data-tudo-ok
          aria-label={semResposta ? `TUDO OK: marca OK os ${semResposta} itens ainda sem resposta` : undefined}
          className="w-full rounded-card bg-success-600 text-white py-5 text-lg font-extrabold tracking-wide shadow-card active:bg-success-700 disabled:bg-success-200 disabled:text-success-700 inline-flex items-center justify-center gap-2 touch-target">
          <CheckCheck className="w-6 h-6" /> {semResposta ? "TUDO OK" : "Tudo respondido"}
        </button>
      )}

      <Secao titulo="Checklist" Icone={ClipboardList}>
        {!e.itens.length && <p className="text-sm text-ink-muted">Este tipo de equipamento ainda não tem checklist. Registre as fotos e a observação.</p>}
        <ol className="space-y-3">
          {e.itens.map((it) => (
            <li key={it.id} data-item={it.id} className={cn("rounded-card border p-3 space-y-2 bg-white", mostrarFaltas && faltando.has(it.texto) ? "border-atrasado ring-2 ring-atrasado/20" : "border-surface-border", !it.ativo && "opacity-70")}>
              {it.tipoResposta === "MEDICAO"
                ? <ItemMedicao item={it} r={e.respostas[it.id]} so={so} onResponder={(d) => responder(it.id, d)}
                  onAudio={(a) => registrar([op({ tipo: "audio", itemId: it.id, dataUrl: a })])} audio={srcAudio(e.respostas[it.id])} />
                : <ItemChips item={it} r={e.respostas[it.id]} so={so} onStatus={(s) => tocarStatus(it, s)} onEditarAtencao={() => setAtencao(it)} />}
              {(it.pedirFoto || e.respostas[it.id]?.status === "ATENCAO" || fotosDe(it.id, null).length > 0) && e.respostas[it.id]?.status !== "NAO_SE_APLICA" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Fotos fotos={fotosDe(it.id, null)} onRemover={so ? undefined : tirarFoto} />
                  {/* Y9: depois de anexar, o rótulo confirma — o técnico não reabre "ver o que falta" à toa */}
                  {!so && <BotaoCamera rotulo={fotosDe(it.id, null).length ? `Foto registrada (${fotosDe(it.id, null).length})` : it.pedirFoto ? "Foto (pedida)" : "Foto"} titulo={e.equipamento.titulo} marca={marca} passos={() => passosDesde(it)} aoCompletar={rolarAteMedicaoVazia} />}
                </div>
              )}
              {it.pedirObservacao && e.respostas[it.id]?.status !== "ATENCAO" && e.respostas[it.id]?.status !== "NAO_SE_APLICA" && (
                <ObservacaoVoz rotulo={(e.respostas[it.id]?.observacao ?? "").trim() || srcAudio(e.respostas[it.id]) ? "Observação registrada" : "Observação (pedida)"} valor={e.respostas[it.id]?.observacao ?? ""} desabilitado={so}
                  onSalvar={(t) => responder(it.id, { observacao: t })}
                  audio={srcAudio(e.respostas[it.id])} onAudio={(a) => registrar([op({ tipo: "audio", itemId: it.id, dataUrl: a })])} />
              )}
            </li>
          ))}
        </ol>
      </Secao>

      {e.formulario && (
        <Secao titulo={`Formulário: ${e.formulario.nome}${e.formulario.obrigatorioConcluir ? " (obrigatório)" : ""}`} Icone={ClipboardList}>
          <div className="space-y-3" data-form-equipamento>
            {e.formulario.campos.map((c) => (
              <CampoFormulario key={c.id} campo={c} valor={e.formulario!.respostas[c.id]} somenteLeitura={so}
                onSalvar={(v) => registrar([op({ tipo: "formulario", dados: { formularioId: e.formulario!.id, campoId: c.id, ...v } })])} />
            ))}
          </div>
        </Secao>
      )}

      <Secao titulo="Observação do equipamento" Icone={ClipboardList}>
        <ObservacaoVoz rotulo="O que encontrou / fez (opcional)" valor={e.observacao ?? ""} desabilitado={so}
          onSalvar={(t) => registrar([op({ tipo: "equipamento", dados: { observacao: t } })])} />
      </Secao>

      <Secao titulo="Fotos DEPOIS" Icone={Camera} contagem={fotosDe(null, "DEPOIS").length} chave="depois"
        acao={!so && <BotaoCamera rotulo="Foto depois" titulo={e.equipamento.titulo} marca={marca} passos={() => [{ chave: "depois", rotulo: "Foto depois do serviço", onFoto: (d) => foto(d, { momento: "DEPOIS" }) }]} />}>
        <Fotos fotos={fotosDe(null, "DEPOIS")} onRemover={so ? undefined : tirarFoto} />
      </Secao>

      <MateriaisUsados x={x} registrar={registrar} equipamentoId={equipamentoId} />

      {!so && (
        <div className="text-center">
          <button type="button" onClick={() => setNaoAtendido(true)} className="text-sm font-semibold text-ink-muted underline underline-offset-2 py-2 touch-target">
            {e.feito ? "Não deu para atender este equipamento" : "Marcar como não atendido"}
          </button>
        </div>
      )}

      {!so && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-4 pb-2 pt-2 bg-surface-page/95 backdrop-blur border-t border-surface-border">
          <button type="button" onClick={concluirEquipamento} data-concluir-equipamento
            className={cn("w-full rounded-card py-4 text-base font-bold shadow-elevated inline-flex items-center justify-center gap-2 touch-target", e.completo ? "bg-primary-600 text-white active:bg-primary-700" : "bg-white text-ink border border-surface-border")}>
            {e.completo
              ? (
                <span className="flex flex-col items-center leading-tight">
                  <span className="inline-flex items-center gap-2">{prox ? "Concluir e ir ao próximo" : "Concluir equipamento"} <ArrowRight className="w-5 h-5" /></span>
                  <span className="text-xs font-medium opacity-90 max-w-full truncate" data-destino-concluir>
                    {prox ? `${prox.equipamento.titulo} · equipamento ${proxPosicao} de ${total}` : "Volta para a OS para concluir a atividade"}
                  </span>
                </span>
              )
              : <span data-faltam={pendencias.length}>{pendencias.length === 1 ? "Falta 1 — ver o que falta" : `Faltam ${pendencias.length} — ver o que falta`}</span>}
          </button>
        </div>
      )}

      {sequencia && <CameraSequencia passos={sequencia} titulo={e.equipamento.titulo} marca={marca} onFechar={(completou) => { setSequencia(null); if (completou) rolarAteMedicaoVazia(); }} />}

      {atencao && (
        <ModalAtencao item={atencao} r={e.respostas[atencao.id]} fotos={fotosDe(atencao.id, null)} marca={marca}
          onFechar={() => setAtencao(null)}
          onFoto={(d) => foto(d, { itemId: atencao.id })} onRemoverFoto={tirarFoto}
          onAudio={(a) => registrar([op({ tipo: "audio", itemId: atencao.id, dataUrl: a })])}
          onSalvar={async (obs) => { await responder(atencao.id, { status: "ATENCAO", observacao: obs }); setAtencao(null); }} />
      )}
      {naoAtendido && (
        <Modal aberto titulo="Não atendido" onFechar={() => setNaoAtendido(false)} tamanho="sm">
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">O registrado fica guardado; o equipamento sai como “não atendido” no relatório. Informe o motivo.</p>
            <ObservacaoVoz rotulo="Motivo" valor={e.observacao ?? ""} onSalvar={(t) => registrar([op({ tipo: "equipamento", dados: { observacao: t } })])} />
            <button type="button" className="w-full rounded-card bg-ink text-white py-3 font-semibold touch-target"
              onClick={async () => {
                await registrar([op({ tipo: "equipamento", dados: { feito: false } })]);
                setNaoAtendido(false);
                const prox = proximoEquipamento(x, equipamentoId);
                irPara(prox ? { ver: "os", a: atividadeId, e: prox } : { ver: "os", a: atividadeId }, true);
              }}>Marcar como não atendido</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Secao({ titulo, Icone, children, contagem, chave, acao }: {
  titulo: string; Icone: typeof Camera; children?: React.ReactNode; /** Quantas fotos a seção já tem */ contagem?: number; chave?: string;
  /** O botão da seção na mesma linha do título (tela mais curta: o próximo passo sobe) */ acao?: React.ReactNode;
}) {
  return (
    <section className="space-y-2" data-secao={chave}>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-ink flex items-center gap-1.5 min-w-0">
          <Icone className="w-4 h-4 text-ink-muted shrink-0" /> {titulo}
          {!!contagem && <span className="text-xs font-semibold rounded-full bg-surface-linha text-ink px-2 py-0.5" data-contagem-fotos>{contagem}</span>}
        </h2>
        {acao && <div className="ml-auto shrink-0">{acao}</div>}
      </div>
      {children}
    </section>
  );
}

function Fotos({ fotos, onRemover }: { fotos: FotoTela[]; onRemover?: (f: FotoTela) => void }) {
  if (!fotos.length) return null;
  return (
    <div className="flex flex-wrap gap-2 py-1">
      {fotos.map((f, i) => <Miniatura key={f.clientId ?? f.id ?? i} src={srcFoto(f)} alt={`foto ${i + 1}`} pendente={f.pendente} onRemover={onRemover ? () => onRemover(f) : undefined} />)}
    </div>
  );
}

function ItemChips({ item, r, so, onStatus, onEditarAtencao }: {
  item: ItemTela; r?: RespostaTela; so: boolean; onStatus: (s: StatusItem) => void; onEditarAtencao: () => void;
}) {
  return (
    <>
      <p className="text-[15px] font-semibold text-ink leading-snug">
        {item.texto}
        {!item.ativo && <span className="ml-1 text-xs font-normal text-ink-muted">(saiu do checklist)</span>}
      </p>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={item.texto}>
        {(["OK", "ATENCAO", "NAO_SE_APLICA"] as StatusItem[]).map((s) => {
          const c = CHIP[s];
          const ativo = r?.status === s;
          return (
            <button key={s} type="button" disabled={so} aria-pressed={ativo} data-chip={s} onClick={() => onStatus(s)}
              className={cn("rounded-card border-2 py-3 text-sm font-bold inline-flex items-center justify-center gap-1 touch-target transition-colors", ativo ? c.ativo : "bg-white border-surface-border text-ink-muted active:bg-surface-alt")}>
              <c.Icone className="w-4 h-4" /> {c.rotulo}
            </button>
          );
        })}
      </div>
      {r?.status === "ATENCAO" && (
        <button type="button" onClick={onEditarAtencao} disabled={so} className="w-full text-left rounded-lg bg-atencao-claro border border-atencao/20 px-3 py-2 text-sm text-atencao-texto" data-resumo-atencao>
          {r.observacao ? `“${r.observacao}”` : r.audio ? "Observação em áudio" : "Falta a observação"}{!so && <span className="ml-1 font-semibold underline">editar</span>}
        </button>
      )}
    </>
  );
}

/** O próximo campo de medição da tela (pula o ΔT calculado e o "Não se aplica"); null = era o último */
export function proximaMedicao(atual: HTMLInputElement): HTMLInputElement | null {
  const campos = [...document.querySelectorAll<HTMLInputElement>("input[data-campo-medicao]:not(:disabled)")];
  return campos[campos.indexOf(atual) + 1] ?? null;
}
function irParaProximaMedicao(atual: HTMLInputElement) {
  const prox = proximaMedicao(atual);
  if (!prox) { atual.blur(); return; }
  prox.focus();
  prox.scrollIntoView?.({ block: "center", behavior: "smooth" });
}

function ItemMedicao({ item, r, so, onResponder, audio, onAudio }: {
  item: ItemTela; r?: RespostaTela; so: boolean; onResponder: (d: Record<string, unknown>) => void; audio?: string | null; onAudio?: (a: string | null) => void;
}) {
  const [texto, setTexto] = useState(mostrarNumero(r?.valor ?? null));
  const [erro, setErro] = useState<string | null>(null);
  const [focado, setFocado] = useState(false);
  const [abrirObs, setAbrirObs] = useState(false);
  const atual = mostrarNumero(r?.valor ?? null);
  const unidade = r?.unidade ?? item.unidade ?? "";
  const na = r?.status === "NAO_SE_APLICA";
  const grandeza = grandezaDoItem(item);
  // Faixa esperada na unidade em uso; enquanto digita, o alerta já acompanha o número
  const faixa = faixaNaUnidade({ valorMin: item.valorMin ?? null, valorMax: item.valorMax ?? null, unidade: item.unidade, grandeza }, unidade);
  const digitado = focado ? lerNumero(texto) : r?.valor ?? null;
  const situacao = na ? null : avaliarFaixa(Number.isNaN(digitado) ? null : digitado, faixa);
  const aviso = avisoFaixa(situacao, faixa, unidade);
  const obs = (r?.observacao ?? "").trim();
  // O valor gravado mudou (sincronizou, N/A…): o campo acompanha — mas nunca enquanto o técnico digita
  useEffect(() => { if (!focado) { setTexto(atual); setErro(null); } }, [atual]); // eslint-disable-line react-hooks/exhaustive-deps
  // ΔT: calculado das leituras do equipamento — só mostra
  if (ehCalculada(grandeza)) {
    const [a, b] = GRANDEZA[grandeza!].calculo!;
    return (
      <div className="space-y-2" data-medicao data-calculada>
        <p className="text-[15px] font-semibold text-ink leading-snug inline-flex items-center gap-1.5"><Ruler className="w-4 h-4 text-primary-600" /> {item.texto}</p>
        <div className={cn("rounded-card border-2 px-3 py-3 flex items-baseline justify-between gap-2", aviso ? "border-atencao bg-atencao-claro" : "border-surface-border bg-surface-alt")}>
          <span className="text-xl font-bold text-ink tabular-nums" data-valor-calculado>{na ? "Não se aplica" : r?.valor !== null && r?.valor !== undefined ? `${mostrarNumero(r.valor)} ${unidade}` : "—"}</span>
          <span className="text-xs text-ink-muted text-right">{GRANDEZA[a].nome.replace("Temperatura de ", "")} − {GRANDEZA[b].nome.replace("Temperatura de ", "")}</span>
        </div>
        {faixa && <p className="text-xs text-ink-muted" data-faixa>Esperado: {textoFaixa(faixa, unidade)}</p>}
        {aviso && <AvisoFaixa aviso={aviso} obs={obs} so={so} aberto={abrirObs} onAbrir={() => setAbrirObs(true)} />}
        {aviso && abrirObs && !item.pedirObservacao && (
          <ObservacaoVoz rotulo="Observação" valor={r?.observacao ?? ""} desabilitado={so} autoFocus onSalvar={(t) => onResponder({ observacao: t })} audio={audio} onAudio={onAudio} />
        )}
      </div>
    );
  }

  function gravar() {
    setFocado(false);
    const n = lerNumero(texto);
    if (Number.isNaN(n)) { setErro("Número inválido (use vírgula para decimais)."); return; }
    setErro(null);
    if (n === (r?.valor ?? null)) return;
    onResponder({ valor: n });
  }
  const opcoes = [...new Set([item.unidade, r?.unidade, ...UNIDADES_SUGERIDAS].filter(Boolean) as string[])];
  return (
    <div className="space-y-2" data-medicao>
      <p className="text-[15px] font-semibold text-ink leading-snug inline-flex items-center gap-1.5"><Ruler className="w-4 h-4 text-primary-600" /> {item.texto}</p>
      <div className="flex gap-2">
        {/* "Próximo" no teclado: grava e já vai para a próxima medição (sem rolar nem tocar no campo) */}
        <input type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off" disabled={so || na} value={na ? "" : texto} placeholder={na ? "Não se aplica" : "0,0"}
          aria-label={`${item.texto} (${unidade})`} data-campo-medicao
          onFocus={(ev) => { setFocado(true); ev.currentTarget.enterKeyHint = proximaMedicao(ev.currentTarget) ? "next" : "done"; }}
          onChange={(ev) => { setTexto(ev.target.value); setErro(null); }} onBlur={gravar}
          onKeyDown={(ev) => { if (ev.key !== "Enter") return; ev.preventDefault(); irParaProximaMedicao(ev.currentTarget); }}
          className="min-w-0 flex-1 rounded-card border-2 border-surface-border px-3 py-3 text-xl font-bold text-ink focus:outline-none focus:border-primary-500 disabled:bg-surface-alt" />
        <select aria-label="Unidade" disabled={so || na} value={unidade} onChange={(ev) => onResponder(r?.valor !== null && r?.valor !== undefined ? { valor: r.valor, unidade: ev.target.value } : { unidade: ev.target.value })}
          className="w-24 rounded-card border-2 border-surface-border bg-white px-2 text-base font-semibold text-ink">
          {opcoes.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <button type="button" disabled={so} aria-pressed={na} data-chip="NAO_SE_APLICA" onClick={() => onResponder(na ? { status: null } : { status: "NAO_SE_APLICA" })}
          className={cn("rounded-card border-2 px-3 text-sm font-bold touch-target", na ? CHIP.NAO_SE_APLICA.ativo : "bg-white border-surface-border text-ink-muted")}>N/A</button>
      </div>
      {erro && <p className="text-xs text-atrasado">{erro}</p>}
      {faixa && !aviso && <p className="text-xs text-ink-muted" data-faixa>Esperado: {textoFaixa(faixa, unidade)}</p>}
      {aviso && <AvisoFaixa aviso={aviso} obs={obs} so={so} aberto={abrirObs || !!obs || item.pedirObservacao} onAbrir={() => setAbrirObs(true)} />}
      {/* Observação opcional em 1 toque ao lado do alerta (o item que já pede observação mostra o campo dele) */}
      {aviso && (abrirObs || !!obs) && !item.pedirObservacao && (
        <ObservacaoVoz rotulo="Observação" valor={r?.observacao ?? ""} desabilitado={so} autoFocus={abrirObs && !obs} onSalvar={(t) => onResponder({ observacao: t })} audio={audio} onAudio={onAudio} />
      )}
    </div>
  );
}

/** Fora da faixa: só alerta (não bloqueia, não exige observação). A observação fica a 1 toque. */
function AvisoFaixa({ aviso, obs, so, aberto, onAbrir }: { aviso: string; obs: string; so: boolean; aberto: boolean; onAbrir: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-card bg-atencao-claro px-3 py-2" data-fora-da-faixa role="status">
      <AlertTriangle className="w-5 h-5 shrink-0 text-atencao-texto" />
      <span className="flex-1 text-sm font-semibold text-atencao-texto" data-aviso-faixa>{aviso}</span>
      {!so && !aberto && !obs && (
        <button type="button" onClick={onAbrir} data-observar-faixa className="shrink-0 rounded-card border-2 border-atencao-texto/40 bg-white px-3 text-sm font-bold text-atencao-texto touch-target">Observação</button>
      )}
    </div>
  );
}

/** "Atenção": exige foto do item + observação (escrita, ditada ou em áudio) — o escritório precisa ver o problema. */
function ModalAtencao({ item, r, fotos, marca, onFechar, onFoto, onRemoverFoto, onAudio, onSalvar }: {
  item: ItemTela; r?: RespostaTela; fotos: FotoTela[]; marca?: MarcaFoto;
  onFechar: () => void; onFoto: (d: string) => void; onRemoverFoto: (f: FotoTela) => void; onAudio: (d: string | null) => void; onSalvar: (obs: string) => void;
}) {
  const [obs, setObs] = useState(r?.observacao ?? "");
  const temAudio = !!(r?.audioLocal || r?.audioId);
  const pode = fotos.length > 0 && (!!obs.trim() || temAudio);
  return (
    <Modal aberto titulo="Atenção" onFechar={onFechar}>
      <div className="space-y-4" data-modal-atencao>
        <p className="text-base font-semibold text-ink">{item.texto}</p>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Foto do problema <span className="text-atrasado">*</span></p>
          <div className="flex flex-wrap gap-2">
            {fotos.map((f, i) => <Miniatura key={f.clientId ?? f.id ?? i} src={srcFoto(f)} alt={`foto ${i + 1}`} pendente={f.pendente} onRemover={() => onRemoverFoto(f)} />)}
          </div>
          <BotaoFoto grande rotulo={fotos.length ? "Mais uma foto" : "Tirar foto"} marca={marca} onFoto={onFoto} />
        </div>
        <ObservacaoVoz rotulo="O que está errado" obrigatoria valor={obs} onSalvar={setObs} aoDigitar={setObs} audio={srcAudio(r)} onAudio={onAudio}
          placeholder="Ex.: bandeja com lodo, dreno entupido" />
        {!pode && (
          <p className="text-xs text-atencao-texto" data-falta-atencao>
            {!fotos.length && !(obs.trim() || temAudio) ? "Para marcar Atenção: pelo menos 1 foto e a observação."
              : !fotos.length ? "Falta a foto do problema." : "Falta a observação do que está errado."}
          </p>
        )}
        <button type="button" disabled={!pode} onClick={() => onSalvar(obs.trim())} data-salvar-atencao
          className="w-full rounded-card bg-atencao text-white py-4 text-base font-bold disabled:opacity-40 touch-target">Marcar atenção</button>
      </div>
    </Modal>
  );
}
