"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Camera, ChevronDown, CircleCheck, CircleDashed, ImagePlus, MessageSquareText, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ROTULO_STATUS, STATUS_ITEM, textoFaltas, type FaltasEquipamento, type StatusItem } from "@/lib/execucao/pendencias";

/* ───────── Tipos (o JSON de GET .../execucao) ───────── */
export interface ItemTela { id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; ativo: boolean; ordem: number }
export interface CampoTela { id: string; label: string; tipo: string; obrigatorio: boolean; ordem: number; opcoes: unknown; ativo: boolean }
export interface EquipamentoTela {
  vinculoId: string;
  feito: boolean;
  observacao: string | null;
  equipamento: { id: string; titulo: string; descricao: string; fabricante: string; tag: string | null; numeroSerie: string | null; local: string | null; unidade: string | null; ativo: boolean; tipo: { id: string; nome: string } | null };
  itens: ItemTela[];
  respostas: Record<string, { status: StatusItem | null; observacao: string | null }>;
  fotos: { id: string; itemId: string | null; criadoEm: string }[];
  formulario: { id: string; nome: string; obrigatorioConcluir: boolean; campos: CampoTela[]; respostas: Record<string, { resposta: string | null; arquivoUrl: string | null }> } | null;
  faltas: FaltasEquipamento;
  completo: boolean;
}

export interface AcoesEquipamento {
  responder: (itemId: string, status: StatusItem) => void;
  observarItem: (itemId: string, texto: string) => void;
  adicionarFoto: (itemId: string | null, arquivo: File) => void;
  removerFoto: (fotoId: string) => void;
  observarEquipamento: (texto: string) => void;
  marcarAtendido: (feito: boolean) => void;
  responderCampo: (campo: CampoTela, valor: { resposta?: string | null; arquivoUrl?: string | null }) => void;
}

const COR_STATUS: Record<StatusItem, string> = {
  OK: "bg-success-600 border-success-600 text-white",
  ATENCAO: "bg-amber-500 border-amber-500 text-white",
  NAO_SE_APLICA: "bg-slate-500 border-slate-500 text-white",
};
const opcoesCampo = (o: unknown): string[] => Array.isArray(o) ? o.map(String) : o && Array.isArray((o as { opcoes?: unknown[] }).opcoes) ? (o as { opcoes: unknown[] }).opcoes.map(String) : [];

/** Situação do equipamento na atividade (o chip do cabeçalho do cartão). */
export function situacaoEquipamento(e: EquipamentoTela): { rotulo: string; classe: string; chave: string } {
  const respondidos = e.itens.filter((i) => e.respostas[i.id]?.status).length;
  if (!e.feito) return respondidos || e.fotos.length
    ? { chave: "nao-atendido", rotulo: "Não atendido", classe: "bg-slate-100 text-slate-600" }
    : { chave: "nao-iniciado", rotulo: "Não iniciado", classe: "bg-slate-100 text-slate-500" };
  if (e.completo) return { chave: "completo", rotulo: "Completo", classe: "bg-success-50 text-success-700" };
  const n = e.faltas.semResposta.length + e.faltas.semFoto.length + e.faltas.semObservacao.length + (e.faltas.formulario ? 1 : 0);
  return { chave: "pendente", rotulo: `Falta${n === 1 ? "" : "m"} ${n}`, classe: "bg-amber-50 text-amber-700" };
}

/**
 * Cartão de UM equipamento na execução: o checklist do tipo dele (OK / Atenção / Não se aplica, com a
 * foto e a observação que cada item pede), as fotos DELE, a observação e o formulário do tipo. Cada
 * toque grava na hora, só aquele campo.
 */
export function EquipamentoExecucaoCard({ e, aberto, onAlternar, acoes, somenteLeitura }: {
  e: EquipamentoTela; aberto: boolean; onAlternar: () => void; acoes: AcoesEquipamento; somenteLeitura: boolean;
}) {
  const fotoRef = useRef<HTMLInputElement>(null);
  const alvoFoto = useRef<string | null>(null);
  const sit = situacaoEquipamento(e);
  const respondidos = e.itens.filter((i) => i.ativo && e.respostas[i.id]?.status).length;
  const totalAtivos = e.itens.filter((i) => i.ativo).length;
  const eq = e.equipamento;

  function escolherFoto(itemId: string | null) { alvoFoto.current = itemId; fotoRef.current?.click(); }
  function aoEscolherFoto(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = [...(ev.target.files ?? [])];
    if (fotoRef.current) fotoRef.current.value = "";
    for (const a of arquivos) acoes.adicionarFoto(alvoFoto.current, a);
  }

  return (
    <section className={cn("bg-white rounded-xl border overflow-hidden", sit.chave === "completo" ? "border-success-200" : "border-gray-200")} data-equipamento-card={eq.id} data-situacao={sit.chave}>
      <button type="button" onClick={onAlternar} aria-expanded={aberto} className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900">{eq.titulo}</span>
            {eq.tag && <span className="font-mono text-[10px] font-semibold border border-gray-200 rounded px-1.5 py-0.5 text-gray-600">TAG {eq.tag}</span>}
          </span>
          <span className="block text-xs text-gray-500 mt-0.5">{[eq.tipo?.nome, eq.local, eq.fabricante].filter(Boolean).join(" · ")}</span>
          {totalAtivos > 0 && <span className="block text-[11px] text-gray-400 mt-0.5" data-progresso>{respondidos} de {totalAtivos} itens respondidos</span>}
        </span>
        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap", sit.classe)} data-chip-situacao>{sit.rotulo}</span>
        <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform", aberto && "rotate-180")} />
      </button>

      {aberto && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-4">
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" multiple onChange={aoEscolherFoto} className="hidden" data-input-foto={eq.id} />

          {e.feito && !e.completo && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 flex gap-2" data-faltas>
              <AlertTriangle className="w-4 h-4 shrink-0" /> <span>Falta: {textoFaltas(e.faltas)}.</span>
            </p>
          )}

          {/* ── Checklist do tipo ── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Checklist{eq.tipo ? ` — ${eq.tipo.nome}` : ""}</p>
            {e.itens.length === 0 ? (
              <p className="text-xs text-gray-400" data-sem-checklist>
                {eq.tipo ? `O tipo “${eq.tipo.nome}” ainda não tem checklist: cadastre em Configurações › Tipos de equipamento.` : "Equipamento sem tipo: defina o tipo no cadastro para ter checklist."}
              </p>
            ) : (
              <ol className="space-y-2.5">
                {e.itens.map((it, n) => {
                  const r = e.respostas[it.id];
                  const status = r?.status ?? null;
                  const fotosItem = e.fotos.filter((f) => f.itemId === it.id);
                  const exigeExtra = status !== null && status !== "NAO_SE_APLICA";
                  const mostraObs = it.pedirObservacao || status === "ATENCAO" || !!r?.observacao;
                  const mostraFoto = it.pedirFoto || status === "ATENCAO" || fotosItem.length > 0;
                  const faltaFoto = it.ativo && exigeExtra && it.pedirFoto && fotosItem.length === 0;
                  const faltaObs = it.ativo && exigeExtra && it.pedirObservacao && !(r?.observacao ?? "").trim();
                  return (
                    <li key={it.id} className="rounded-lg border border-gray-100 p-2.5 space-y-2" data-item={it.id}>
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-gray-400 w-5 shrink-0 pt-0.5 text-right">{n + 1}.</span>
                        <p className={cn("text-sm flex-1", it.ativo ? "text-gray-800" : "text-gray-400")}>
                          {it.texto}
                          {!it.ativo && <span className="ml-1.5 text-[10px] font-semibold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">saiu do checklist</span>}
                          {it.pedirFoto && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-gray-400"><Camera className="w-3 h-3" /> foto</span>}
                          {it.pedirObservacao && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-gray-400"><MessageSquareText className="w-3 h-3" /> observação</span>}
                        </p>
                      </div>
                      <div className="flex gap-1.5 pl-7" role="group" aria-label={`Resposta: ${it.texto}`}>
                        {STATUS_ITEM.map((s) => (
                          <button key={s} type="button" disabled={somenteLeitura} aria-pressed={status === s} data-resposta={s}
                            onClick={() => acoes.responder(it.id, s)}
                            className={cn("flex-1 min-h-9 px-2 rounded-lg text-xs font-semibold border transition-colors disabled:cursor-default",
                              status === s ? COR_STATUS[s] : "bg-white border-gray-200 text-gray-600 hover:border-gray-300")}>
                            {ROTULO_STATUS[s]}
                          </button>
                        ))}
                      </div>
                      {mostraObs && (
                        <div className="pl-7">
                          <Textarea rows={2} defaultValue={r?.observacao ?? ""} disabled={somenteLeitura} data-obs-item={it.id}
                            placeholder={it.pedirObservacao ? "Observação (ex.: o valor medido)" : "Descreva o que precisa de atenção"}
                            onBlur={(ev) => { if (ev.target.value.trim() !== (r?.observacao ?? "").trim()) acoes.observarItem(it.id, ev.target.value); }}
                            className={cn(faltaObs && "border-amber-400")} aria-label={`Observação: ${it.texto}`} />
                          {faltaObs && <p className="text-[11px] text-amber-700 mt-0.5">Este item pede observação.</p>}
                        </div>
                      )}
                      {mostraFoto && (
                        <div className="pl-7">
                          <Fotos fotos={fotosItem} somenteLeitura={somenteLeitura} onRemover={acoes.removerFoto} onAdicionar={() => escolherFoto(it.id)} dataAttr={`foto-item-${it.id}`} />
                          {faltaFoto && <p className="text-[11px] text-amber-700 mt-0.5">Este item pede foto.</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* ── Fotos e observação DESTE equipamento ── */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Fotos do equipamento</p>
            <Fotos fotos={e.fotos.filter((f) => !f.itemId)} somenteLeitura={somenteLeitura} onRemover={acoes.removerFoto} onAdicionar={() => escolherFoto(null)} dataAttr="fotos-equipamento" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Observação do equipamento</p>
            <Textarea rows={2} defaultValue={e.observacao ?? ""} disabled={somenteLeitura} data-obs-equipamento placeholder="O que foi feito, peças trocadas, recomendações…"
              onBlur={(ev) => { if (ev.target.value.trim() !== (e.observacao ?? "").trim()) acoes.observarEquipamento(ev.target.value); }} aria-label="Observação do equipamento" />
          </div>

          {/* ── Formulário do tipo (tipo de OS × tipo de equipamento), deste equipamento ── */}
          {e.formulario && (
            <div className="rounded-lg border border-primary-100 bg-primary-50/30 p-3 space-y-3" data-formulario={e.formulario.id}>
              <p className="text-xs font-semibold text-primary-800">
                Formulário: {e.formulario.nome}
                {e.formulario.obrigatorioConcluir && <span className="ml-1.5 text-[10px] font-semibold bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">obrigatório para concluir</span>}
              </p>
              {e.formulario.campos.map((c) => (
                <CampoFormulario key={c.id} campo={c} valor={e.formulario!.respostas[c.id]} somenteLeitura={somenteLeitura}
                  onSalvar={(v) => acoes.responderCampo(c, v)} />
              ))}
            </div>
          )}

          {!somenteLeitura && (
            <div className="flex justify-end">
              {e.feito ? (
                <button type="button" onClick={() => acoes.marcarAtendido(false)} className="text-xs font-medium text-gray-500 hover:text-gray-800 inline-flex items-center gap-1" data-nao-atendido>
                  <CircleDashed className="w-3.5 h-3.5" /> Marcar como não atendido
                </button>
              ) : (
                <button type="button" onClick={() => acoes.marcarAtendido(true)} className="text-xs font-medium text-primary-600 hover:text-primary-700 inline-flex items-center gap-1" data-atendido>
                  <CircleCheck className="w-3.5 h-3.5" /> Marcar como atendido
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Fotos({ fotos, somenteLeitura, onRemover, onAdicionar, dataAttr }: {
  fotos: { id: string }[]; somenteLeitura: boolean; onRemover: (id: string) => void; onAdicionar: () => void; dataAttr: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-fotos={dataAttr}>
      {fotos.map((f) => (
        <span key={f.id} className="relative" data-foto={f.id}>
          <a href={`/api/fotos-atendimento/${f.id}`} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/fotos-atendimento/${f.id}`} alt="Foto do atendimento" className="w-16 h-16 rounded-lg object-cover border border-gray-200" loading="lazy" />
          </a>
          {!somenteLeitura && (
            <button type="button" onClick={() => onRemover(f.id)} aria-label="Remover foto" className="absolute -top-1.5 -right-1.5 bg-white border border-gray-200 rounded-full p-0.5 text-gray-500 hover:text-red-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {!somenteLeitura && (
        <button type="button" onClick={onAdicionar} className="w-16 h-16 rounded-lg border border-dashed border-gray-300 text-gray-400 hover:text-primary-600 hover:border-primary-300 flex flex-col items-center justify-center text-[10px] gap-0.5" data-adicionar-foto>
          <ImagePlus className="w-4 h-4" /> Foto
        </button>
      )}
      {somenteLeitura && fotos.length === 0 && <span className="text-xs text-gray-400">Sem fotos.</span>}
    </div>
  );
}

/** Um campo do formulário do tipo; grava ao sair do campo (texto) ou ao escolher (botões/lista/foto). */
function CampoFormulario({ campo: c, valor, somenteLeitura, onSalvar }: {
  campo: CampoTela; valor?: { resposta: string | null; arquivoUrl: string | null }; somenteLeitura: boolean;
  onSalvar: (v: { resposta?: string | null; arquivoUrl?: string | null }) => void;
}) {
  const fotoRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const v = valor?.resposta ?? "";
  const aoSair = (novo: string) => { if (novo !== v) onSalvar({ resposta: novo }); };
  return (
    <div className="space-y-1" data-campo-form={c.id}>
      <label className={cn("text-sm font-medium", c.ativo ? "text-gray-700" : "text-gray-400")}>
        {c.label}{c.obrigatorio && <span className="text-red-500 ml-0.5">*</span>}{!c.ativo && <span className="ml-1 text-[10px]">(removido)</span>}
      </label>
      {c.tipo === "TEXTO_CURTO" && <Input defaultValue={v} disabled={somenteLeitura} onBlur={(e) => aoSair(e.target.value)} aria-label={c.label} />}
      {c.tipo === "TEXTO_LONGO" && <Textarea rows={2} defaultValue={v} disabled={somenteLeitura} onBlur={(e) => aoSair(e.target.value)} aria-label={c.label} />}
      {c.tipo === "NUMERO" && <Input type="number" defaultValue={v} disabled={somenteLeitura} onBlur={(e) => aoSair(e.target.value)} aria-label={c.label} />}
      {c.tipo === "DATA" && <Input type="date" defaultValue={v} disabled={somenteLeitura} onBlur={(e) => aoSair(e.target.value)} aria-label={c.label} />}
      {c.tipo === "ASSINATURA" && <Input defaultValue={v} disabled={somenteLeitura} placeholder="Nome de quem assina" aria-label={c.label}
        onBlur={(e) => { if (e.target.value !== v) onSalvar({ resposta: e.target.value, arquivoUrl: e.target.value }); }} />}
      {c.tipo === "SIM_NAO" && (
        <div className="flex gap-2">
          {["Sim", "Não"].map((op) => (
            <button key={op} type="button" disabled={somenteLeitura} aria-pressed={v === op} onClick={() => onSalvar({ resposta: op })}
              className={cn("px-4 py-2 rounded-lg text-sm font-medium border", v === op ? "bg-primary-600 border-primary-600 text-white" : "bg-white border-gray-200 text-gray-600")}>{op}</button>
          ))}
        </div>
      )}
      {c.tipo === "MULTIPLA_ESCOLHA" && (
        <Select defaultValue={v} disabled={somenteLeitura} onChange={(e) => onSalvar({ resposta: e.target.value })} placeholder="Selecione" aria-label={c.label}>
          {opcoesCampo(c.opcoes).map((op) => <option key={op} value={op}>{op}</option>)}
        </Select>
      )}
      {c.tipo === "FOTO" && (
        <div className="flex items-center gap-3">
          {valor?.arquivoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={valor.arquivoUrl} alt={c.label} className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
          )}
          {!somenteLeitura && (
            <button type="button" disabled={lendo} onClick={() => fotoRef.current?.click()} className="text-xs font-medium border border-gray-200 rounded-lg px-3 py-1.5 inline-flex items-center gap-1 text-gray-600 hover:border-gray-300">
              <Camera className="w-4 h-4" /> {valor?.arquivoUrl ? "Trocar foto" : "Tirar foto"}
            </button>
          )}
          <input ref={fotoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            setLendo(true);
            try {
              const { reduzirImagem, FOTO_GALERIA } = await import("@/lib/imagem-cliente");
              const { imagem } = await reduzirImagem(f, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade);
              onSalvar({ arquivoUrl: imagem.dataUrl });
            } finally { setLendo(false); }
          }} />
        </div>
      )}
    </div>
  );
}

