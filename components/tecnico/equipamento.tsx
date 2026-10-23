"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, CheckCheck, CircleSlash, ClipboardList, Ruler } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { CampoFormulario } from "@/components/os/execucao-equipamento";
import { BotaoFoto, Miniatura, ObservacaoVoz } from "@/components/tecnico/captura";
import { irPara } from "@/components/tecnico/contexto";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { proximoEquipamento } from "@/lib/tecnico/offline/estado";
import { UNIDADES_SUGERIDAS } from "@/lib/checklist/tipo";
import { listaCurta, respondido, type StatusItem } from "@/lib/execucao/pendencias";
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
  ATENCAO: { rotulo: "Atenção", ativo: "bg-amber-500 border-amber-500 text-white", Icone: AlertTriangle },
  NAO_SE_APLICA: { rotulo: "N/A", ativo: "bg-slate-600 border-slate-600 text-white", Icone: CircleSlash },
};

interface Props {
  x: ExecucaoTela;
  e: EquipamentoTela;
  registrar: (ops: NovaOperacao[]) => Promise<void>;
}

/**
 * UM equipamento, guiado e no "dedão": fotos ANTES → TUDO OK (marca OK o que está sem resposta) →
 * ajusta o que não está OK (Atenção pede foto + observação, que pode ser falada) → medições (número +
 * unidade, sem avaliar) → fotos DEPOIS → "Concluir equipamento" leva ao próximo. Tudo grava no aparelho.
 */
export function TelaEquipamento({ x, e, registrar }: Props) {
  const atividadeId = x.atividade.id;
  const equipamentoId = e.equipamento.id;
  const so = x.bloqueada;
  const [atencao, setAtencao] = useState<ItemTela | null>(null);
  const [mostrarFaltas, setMostrarFaltas] = useState(false);
  const [naoAtendido, setNaoAtendido] = useState(false);
  const topo = useRef<HTMLDivElement>(null);

  const ativos = e.itens.filter((i) => i.ativo);
  const feitos = ativos.filter((i) => respondido(i, e.respostas[i.id])).length;
  const semResposta = ativos.filter((i) => i.tipoResposta === "OK_ATENCAO_NA" && !e.respostas[i.id]?.status).length;
  const fotosDe = (itemId: string | null, momento: "ANTES" | "DEPOIS" | null) => e.fotos.filter((f) => f.itemId === itemId && (itemId ? true : f.momento === momento));
  const faltando = useMemo(() => new Set([...e.faltas.semResposta, ...e.faltas.semFoto, ...e.faltas.semObservacao]), [e.faltas]);
  const posicao = x.equipamentos.findIndex((q) => q.equipamento.id === equipamentoId);

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
  const responder = (itemId: string, dados: Record<string, unknown>) => registrar([op({ tipo: "resposta", itemId, dados })]);
  const foto = (dataUrl: string, extra: { itemId?: string | null; momento?: "ANTES" | "DEPOIS" | null }) =>
    registrar([op({ tipo: "foto", dados: { dataUrl, clientId: novoClientId(), ...extra } })]);
  const tirarFoto = (f: FotoTela) => registrar([{ tipo: "fotoRemover", atividadeId, dados: f.clientId ? { clientId: f.clientId } : { id: f.id! } }]);

  function tocarStatus(item: ItemTela, s: StatusItem) {
    if (so) return;
    if (s === "ATENCAO") { setAtencao(item); return; }
    void responder(item.id, { status: s });
  }

  async function concluirEquipamento() {
    if (!e.completo) {
      setMostrarFaltas(true);
      topo.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (!e.feito) await registrar([op({ tipo: "equipamento", dados: { feito: true } })]);
    const prox = proximoEquipamento(x, equipamentoId);
    irPara(prox ? { ver: "os", a: atividadeId, e: prox } : { ver: "os", a: atividadeId }, true);
  }

  return (
    <div className="space-y-4 pb-32" data-vista="equipamento" data-equipamento={equipamentoId}>
      <div ref={topo} />
      <button type="button" onClick={() => irPara({ ver: "os", a: atividadeId })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
        <ArrowLeft className="w-4 h-4" /> Equipamentos da OS
      </button>

      <header className="bg-white rounded-2xl border border-surface-border p-4 space-y-2">
        <p className="text-xs font-semibold text-ink-muted">Equipamento {posicao + 1} de {x.equipamentos.length}</p>
        <h1 className="text-xl font-bold text-ink leading-tight">{e.equipamento.titulo}</h1>
        <p className="text-sm text-ink-muted">
          {[e.equipamento.tipo?.nome, e.equipamento.tag && `TAG ${e.equipamento.tag}`, e.equipamento.local].filter(Boolean).join(" · ")}
        </p>
        <div className="flex items-center gap-2">
          <div className="h-2.5 flex-1 rounded-full bg-surface-page overflow-hidden">
            <div className={cn("h-full rounded-full transition-all", e.completo ? "bg-success-500" : "bg-primary-500")} style={{ width: `${ativos.length ? (feitos / ativos.length) * 100 : 0}%` }} />
          </div>
          <span className="text-xs font-semibold text-ink-muted" data-progresso>{feitos} de {ativos.length}</span>
        </div>
        {/* G11: o número sozinho não diz O QUE está sendo contado */}
        <p className="text-[11px] text-ink-muted" data-progresso-legenda>
          Itens do checklist e medições respondidos. Fotos e observações pedidas contam à parte.
        </p>
      </header>

      {so && <p className="rounded-xl bg-success-50 border border-success-200 p-3 text-sm text-success-800">Atividade concluída: só leitura.</p>}
      {mostrarFaltas && !e.completo && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800" role="alert" data-faltas>
          <p className="font-semibold">Para concluir este equipamento, falta:</p>
          <ul className="mt-1 space-y-0.5">
            {pendencias.map((p) => (
              <li key={p.chave}>
                <button type="button" data-pendencia onClick={() => irAoItem(p.alvo)}
                  className="w-full text-left py-1 underline underline-offset-2 decoration-red-300 active:text-red-950 touch-target">
                  {p.rotulo} ›
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Secao titulo="Fotos ANTES do serviço" Icone={Camera}>
        <Fotos fotos={fotosDe(null, "ANTES")} onRemover={so ? undefined : tirarFoto} />
        {!so && <BotaoFoto rotulo="Foto antes" onFoto={(d) => foto(d, { momento: "ANTES" })} />}
      </Secao>

      {ativos.length > 0 && !so && (
        <button type="button" onClick={() => registrar([op({ tipo: "tudoOk" })])} disabled={!semResposta} data-tudo-ok
          className="w-full rounded-2xl bg-success-600 text-white py-5 text-lg font-extrabold tracking-wide shadow-card active:bg-success-700 disabled:bg-success-200 disabled:text-success-700 inline-flex items-center justify-center gap-2 touch-target">
          <CheckCheck className="w-6 h-6" /> {semResposta ? "TUDO OK" : "Tudo respondido"}
        </button>
      )}
      {ativos.length > 0 && !so && semResposta > 0 && <p className="-mt-2 text-center text-xs text-ink-muted">Marca OK os {semResposta} itens ainda sem resposta. Depois é só ajustar o que não está OK.</p>}

      <Secao titulo="Checklist" Icone={ClipboardList}>
        {!e.itens.length && <p className="text-sm text-ink-muted">Este tipo de equipamento ainda não tem checklist. Registre as fotos e a observação.</p>}
        <ol className="space-y-3">
          {e.itens.map((it) => (
            <li key={it.id} data-item={it.id} className={cn("rounded-xl border p-3 space-y-2 bg-white", mostrarFaltas && faltando.has(it.texto) ? "border-red-400 ring-2 ring-red-100" : "border-surface-border", !it.ativo && "opacity-70")}>
              {it.tipoResposta === "MEDICAO"
                ? <ItemMedicao item={it} r={e.respostas[it.id]} so={so} onResponder={(d) => responder(it.id, d)} />
                : <ItemChips item={it} r={e.respostas[it.id]} so={so} onStatus={(s) => tocarStatus(it, s)} onEditarAtencao={() => setAtencao(it)} />}
              {(it.pedirFoto || e.respostas[it.id]?.status === "ATENCAO" || fotosDe(it.id, null).length > 0) && e.respostas[it.id]?.status !== "NAO_SE_APLICA" && (
                <div className="flex flex-wrap items-center gap-2">
                  <Fotos fotos={fotosDe(it.id, null)} onRemover={so ? undefined : tirarFoto} />
                  {/* Y9: depois de anexar, o rótulo confirma — o técnico não reabre "ver o que falta" à toa */}
                  {!so && <BotaoFoto rotulo={fotosDe(it.id, null).length ? `Foto ✓ (${fotosDe(it.id, null).length})` : it.pedirFoto ? "Foto (pedida)" : "Foto"} onFoto={(d) => foto(d, { itemId: it.id })} />}
                </div>
              )}
              {it.pedirObservacao && e.respostas[it.id]?.status !== "ATENCAO" && e.respostas[it.id]?.status !== "NAO_SE_APLICA" && (
                <ObservacaoVoz rotulo={(e.respostas[it.id]?.observacao ?? "").trim() || srcAudio(e.respostas[it.id]) ? "Observação ✓" : "Observação (pedida)"} valor={e.respostas[it.id]?.observacao ?? ""} desabilitado={so}
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

      <Secao titulo="Fotos DEPOIS do serviço" Icone={Camera}>
        <Fotos fotos={fotosDe(null, "DEPOIS")} onRemover={so ? undefined : tirarFoto} />
        {!so && <BotaoFoto rotulo="Foto depois" onFoto={(d) => foto(d, { momento: "DEPOIS" })} />}
      </Secao>

      {!so && (
        <div className="text-center">
          <button type="button" onClick={() => setNaoAtendido(true)} className="text-sm font-semibold text-ink-muted underline underline-offset-2 py-2 touch-target">
            {e.feito ? "Não deu para atender este equipamento" : "Marcar como não atendido"}
          </button>
        </div>
      )}

      {!so && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-4 pb-2 pt-2 bg-gradient-to-t from-surface-page via-surface-page to-transparent">
          <button type="button" onClick={concluirEquipamento} data-concluir-equipamento
            className={cn("w-full rounded-2xl py-4 text-base font-bold shadow-elevated inline-flex items-center justify-center gap-2 touch-target", e.completo ? "bg-primary-600 text-white active:bg-primary-700" : "bg-white text-ink border border-surface-border")}>
            {e.completo ? <>Concluir equipamento <ArrowRight className="w-5 h-5" /></> : <>Concluir equipamento — ver o que falta</>}
          </button>
        </div>
      )}

      {atencao && (
        <ModalAtencao item={atencao} r={e.respostas[atencao.id]} fotos={fotosDe(atencao.id, null)}
          onFechar={() => setAtencao(null)}
          onFoto={(d) => foto(d, { itemId: atencao.id })} onRemoverFoto={tirarFoto}
          onAudio={(a) => registrar([op({ tipo: "audio", itemId: atencao.id, dataUrl: a })])}
          onSalvar={async (obs) => { await responder(atencao.id, { status: "ATENCAO", observacao: obs }); setAtencao(null); }} />
      )}
      {naoAtendido && (
        <Modal aberto titulo="Não atendido" onFechar={() => setNaoAtendido(false)} tamanho="sm">
          <div className="space-y-3">
            <p className="text-sm text-ink-muted">O que já foi registrado fica guardado. O equipamento sai como “não atendido” no relatório. Diga o motivo, se puder.</p>
            <ObservacaoVoz rotulo="Motivo" valor={e.observacao ?? ""} onSalvar={(t) => registrar([op({ tipo: "equipamento", dados: { observacao: t } })])} />
            <button type="button" className="w-full rounded-xl bg-slate-700 text-white py-3 font-semibold touch-target"
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

function Secao({ titulo, Icone, children }: { titulo: string; Icone: typeof Camera; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-ink flex items-center gap-1.5"><Icone className="w-4 h-4 text-ink-muted" /> {titulo}</h2>
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
              className={cn("rounded-xl border-2 py-3 text-sm font-bold inline-flex items-center justify-center gap-1 touch-target transition-colors", ativo ? c.ativo : "bg-white border-surface-border text-ink-muted active:bg-surface-alt")}>
              <c.Icone className="w-4 h-4" /> {c.rotulo}
            </button>
          );
        })}
      </div>
      {r?.status === "ATENCAO" && (
        <button type="button" onClick={onEditarAtencao} disabled={so} className="w-full text-left rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900" data-resumo-atencao>
          {r.observacao ? `“${r.observacao}”` : r.audio ? "Observação em áudio" : "Falta a observação"}{!so && <span className="ml-1 font-semibold underline">editar</span>}
        </button>
      )}
    </>
  );
}

function ItemMedicao({ item, r, so, onResponder }: { item: ItemTela; r?: RespostaTela; so: boolean; onResponder: (d: Record<string, unknown>) => void }) {
  const [texto, setTexto] = useState(mostrarNumero(r?.valor ?? null));
  const [erro, setErro] = useState<string | null>(null);
  const [focado, setFocado] = useState(false);
  const atual = mostrarNumero(r?.valor ?? null);
  const unidade = r?.unidade ?? item.unidade ?? "";
  const na = r?.status === "NAO_SE_APLICA";
  // O valor gravado mudou (sincronizou, N/A…): o campo acompanha — mas nunca enquanto o técnico digita
  useEffect(() => { if (!focado) { setTexto(atual); setErro(null); } }, [atual]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <input type="text" inputMode="decimal" enterKeyHint="done" autoComplete="off" disabled={so || na} value={na ? "" : texto} placeholder={na ? "Não se aplica" : "0,0"}
          aria-label={`${item.texto} (${unidade})`} onFocus={() => setFocado(true)}
          onChange={(ev) => { setTexto(ev.target.value); setErro(null); }} onBlur={gravar} onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }}
          className="min-w-0 flex-1 rounded-xl border-2 border-surface-border px-3 py-3 text-xl font-bold text-ink focus:outline-none focus:border-primary-500 disabled:bg-surface-alt" />
        <select aria-label="Unidade" disabled={so || na} value={unidade} onChange={(ev) => onResponder(r?.valor !== null && r?.valor !== undefined ? { valor: r.valor, unidade: ev.target.value } : { unidade: ev.target.value })}
          className="w-24 rounded-xl border-2 border-surface-border bg-white px-2 text-base font-semibold text-ink">
          {opcoes.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <button type="button" disabled={so} aria-pressed={na} data-chip="NAO_SE_APLICA" onClick={() => onResponder(na ? { status: null } : { status: "NAO_SE_APLICA" })}
          className={cn("rounded-xl border-2 px-3 text-sm font-bold touch-target", na ? CHIP.NAO_SE_APLICA.ativo : "bg-white border-surface-border text-ink-muted")}>N/A</button>
      </div>
      {erro && <p className="text-xs text-red-600">{erro}</p>}
    </div>
  );
}

/** "Atenção": exige foto do item + observação (escrita, ditada ou em áudio) — o escritório precisa ver o problema. */
function ModalAtencao({ item, r, fotos, onFechar, onFoto, onRemoverFoto, onAudio, onSalvar }: {
  item: ItemTela; r?: RespostaTela; fotos: FotoTela[];
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
          <p className="text-sm font-semibold text-ink">Foto do problema <span className="text-red-600">*</span></p>
          <div className="flex flex-wrap gap-2">
            {fotos.map((f, i) => <Miniatura key={f.clientId ?? f.id ?? i} src={srcFoto(f)} alt={`foto ${i + 1}`} pendente={f.pendente} onRemover={() => onRemoverFoto(f)} />)}
          </div>
          <BotaoFoto grande rotulo={fotos.length ? "Mais uma foto" : "Tirar foto"} onFoto={onFoto} />
        </div>
        <ObservacaoVoz rotulo="O que está errado" obrigatoria valor={obs} onSalvar={setObs} aoDigitar={setObs} audio={srcAudio(r)} onAudio={onAudio}
          placeholder="Ex.: bandeja com lodo, dreno entupido" />
        {!pode && <p className="text-xs text-amber-700">Para marcar Atenção: pelo menos 1 foto e a observação (escrita, ditada ou em áudio).</p>}
        <button type="button" disabled={!pode} onClick={() => onSalvar(obs.trim())} data-salvar-atencao
          className="w-full rounded-xl bg-amber-500 text-white py-4 text-base font-bold disabled:opacity-40 touch-target">Marcar Atenção</button>
      </div>
    </Modal>
  );
}
