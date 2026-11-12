"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCheck, CheckCircle2, ChevronRight, HelpCircle, Loader2, Plus, Scissors, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { confirmar, toast } from "@/components/ui/avisos";
import { irPara, useTecnico } from "@/components/tecnico/contexto";
import { useRapida } from "@/components/tecnico/camera-rapida";
import { ModalCadastroEquipamento } from "@/components/tecnico/cadastro-equipamento";
import { srcFoto } from "@/components/tecnico/equipamento";
import {
  MOTIVO_A_IDENTIFICAR, agrupar, contarMomentos, identificar, legendaAutomatica, operacoesDoGrupo, resumoMomentos,
  type Destino, type GrupoRapido, type GrupoSalvo, type Identidade,
} from "@/lib/tecnico/camera-rapida";
import { equipamentoDoQr } from "@/lib/tecnico/offline/estado";
import type { GuardaRapida } from "@/lib/tecnico/offline/rapida";
import type { ExecucaoTela, NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

const plural = (n: number) => (n === 1 ? "1 foto" : `${n} fotos`);

/** A imagem de uma foto ainda na guarda do aparelho */
function FotoGuardada({ guarda, id, alt, className }: { guarda: GuardaRapida; id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let vivo = true; void guarda.imagem(id).then((d) => { if (vivo) setSrc(d); }); return () => { vivo = false; }; }, [guarda, id]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className={className} /> : <span className={cn("bg-surface-linha", className)} aria-hidden />;
}

/**
 * CONFERÊNCIA da câmera rápida: os grupos de fotos, em ordem.
 *  - etiqueta QR fotografada → o grupo já é do equipamento: grava sozinho e aparece com ✓;
 *  - sem etiqueta legível → "a identificar": o técnico resolve em um toque (escolher o equipamento,
 *    etiquetar um novo pelo cadastro em campo, marcar como geral da OS, ou descartar). O app NUNCA
 *    escolhe por ele.
 * Gravar um grupo = as gravações de sempre (vincular + foto antes/depois), na fila do aparelho.
 * Em cada equipamento pronto, "TUDO OK" fecha o checklist num toque; a exceção se escreve na tela do
 * equipamento (o fluxo de Atenção, com foto e observação).
 */
export function ConferenciaRapida({ r, x, registrar, onFechar, onMaisFotos }: {
  r: RetratoAtividade; x: ExecucaoTela; registrar: (ops: NovaOperacao[]) => Promise<void>;
  onFechar: () => void;
  /** Voltar para a câmera */
  onMaisFotos: () => void;
}) {
  const atividadeId = x.atividade.id;
  const { config } = useTecnico();
  const { guarda, sessao, carregada } = useRapida(atividadeId);
  const [gravando, setGravando] = useState<string | null>(null);
  const [escolher, setEscolher] = useState<GrupoRapido | null>(null);
  const [etiquetar, setEtiquetar] = useState<{ grupo: GrupoRapido; etiqueta: string | null } | null>(null);
  const [separar, setSeparar] = useState<string | null>(null);
  const emCurso = useRef(new Set<string>());

  // A mesma regra do leitor de QR da OS: a etiqueta tem de ser de um equipamento desta unidade
  const resolverQr = useCallback((qr: string) => equipamentoDoQr(r, qr)?.id ?? null, [r]);
  const naOs = useCallback((id: string) => x.equipamentos.some((e) => e.equipamento.id === id), [x.equipamentos]);
  const titulo = useCallback((id: string) => x.equipamentos.find((e) => e.equipamento.id === id)?.equipamento.titulo ?? r.equipamentosUnidade.find((e) => e.id === id)?.titulo ?? "Equipamento", [x.equipamentos, r.equipamentosUnidade]);

  const grupos = useMemo(() => agrupar(sessao.fotos).map((g) => ({ g, identidade: identificar(g, resolverQr) })), [sessao.fotos, resolverQr]);
  const pendentes = grupos.filter((p): p is { g: GrupoRapido; identidade: Extract<Identidade, { estado: "a-identificar" }> } => p.identidade.estado === "a-identificar");
  const podeCadastrar = !x.bloqueada && config.cadastrarEquipamento && !!r.cadastro?.unidadeId;

  /** Grava grupos: junta as gravações num envio só para a fila e, depois, tira as fotos da guarda. */
  const gravar = useCallback(async (itens: { g: GrupoRapido; destino: Destino; jaNaOs?: boolean }[]) => {
    if (!guarda || !itens.length) return 0;
    const ops: NovaOperacao[] = [];
    const vinculados = new Set<string>();
    for (const { g, destino, jaNaOs } of itens) {
      const fotos = (await Promise.all(g.fotos.map(async (f) => ({ id: f.id, momento: f.momento, dataUrl: await guarda.imagem(f.id) }))))
        .filter((f): f is { id: string; momento: typeof f.momento; dataUrl: string } => !!f.dataUrl);
      const dentro = destino.tipo !== "equipamento" || jaNaOs || naOs(destino.equipamentoId) || vinculados.has(destino.equipamentoId);
      if (destino.tipo === "equipamento") vinculados.add(destino.equipamentoId);
      ops.push(...operacoesDoGrupo(atividadeId, fotos, destino, dentro));
    }
    if (ops.length) await registrar(ops);
    for (const { g, destino } of itens) await guarda.gravado(atividadeId, g, destino);
    return itens.reduce((n, i) => n + i.g.fotos.length, 0);
  }, [guarda, atividadeId, registrar, naOs]);

  // Etiqueta fotografada = identidade certa: esses grupos gravam sozinhos, sem toque
  useEffect(() => {
    if (!carregada || x.bloqueada) return;
    const prontos = grupos.filter((p) => p.identidade.estado === "identificado" && !emCurso.current.has(p.g.id));
    if (!prontos.length) return;
    prontos.forEach((p) => emCurso.current.add(p.g.id));
    void gravar(prontos.map((p) => ({ g: p.g, destino: { tipo: "equipamento" as const, equipamentoId: (p.identidade as { equipamentoId: string }).equipamentoId, por: "qr" as const } })))
      .catch(() => { prontos.forEach((p) => emCurso.current.delete(p.g.id)); });
  }, [carregada, grupos, gravar, x.bloqueada]);

  async function resolver(g: GrupoRapido, destino: Destino, jaNaOs?: boolean) {
    setGravando(g.id);
    try {
      const n = await gravar([{ g, destino, jaNaOs }]);
      toast(destino.tipo === "geral" ? `${plural(n)} em Fotos do serviço (Geral da OS).` : `${plural(n)} em ${titulo(destino.equipamentoId)}.`);
    } catch { /* o aviso de falta de espaço já apareceu */ } finally { setGravando(null); }
  }
  async function descartar(g: GrupoRapido) {
    const ok = await confirmar({ titulo: "Descartar estas fotos?", mensagem: `${plural(g.fotos.length)} saem do aparelho e não vão para a OS.`, perigo: true, confirmarTexto: "Descartar" });
    if (ok) await guarda?.descartar(atividadeId, g.fotos.map((f) => f.id));
  }

  // Os grupos já gravados, um por destino (as fotos de antes e as de depois do mesmo equipamento somam)
  const salvos = useMemo(() => {
    const porDestino = new Map<string, { destino: GrupoSalvo["destino"]; antes: number; depois: number; fotoIds: string[] }>();
    for (const s of sessao.salvos) {
      const chave = s.destino.tipo === "geral" ? "geral" : s.destino.equipamentoId;
      const a = porDestino.get(chave) ?? { destino: s.destino, antes: 0, depois: 0, fotoIds: [] };
      porDestino.set(chave, { destino: a.destino, antes: a.antes + s.antes, depois: a.depois + s.depois, fotoIds: [...a.fotoIds, ...s.fotoIds] });
    }
    return [...porDestino.values()];
  }, [sessao.salvos]);

  const vazio = carregada && !grupos.length && !salvos.length;
  const outrosDaUnidade = r.equipamentosUnidade.filter((u) => !naOs(u.id));

  return (
    <Modal aberto titulo="Conferir fotos" onFechar={onFechar}>
      <div className="space-y-4" data-conferencia-rapida>
        {!carregada && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>}
        {vazio && <p className="text-sm text-ink-muted">Nenhuma foto da câmera rápida nesta OS ainda.</p>}

        {pendentes.length > 0 && (
          <section className="space-y-2" data-conferencia-pendentes>
            <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><HelpCircle className="w-4 h-4 text-atencao" /> A identificar ({pendentes.length})</h3>
            <p className="text-xs text-ink-muted">Sem etiqueta QR nas fotos, o app não escolhe o equipamento: diga de quem é cada grupo.</p>
            {pendentes.map(({ g, identidade }) => (
              <article key={g.id} className="rounded-card border border-atencao/30 bg-atencao-claro p-3 space-y-2" data-grupo={g.id} data-grupo-estado="a-identificar" data-motivo={identidade.motivo}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{plural(g.fotos.length)} · {resumoMomentos(contarMomentos(g.fotos))}</p>
                  {gravando === g.id && <Loader2 className="w-4 h-4 animate-spin text-ink-muted" />}
                </div>
                <p className="text-xs text-atencao-texto" data-grupo-motivo>{MOTIVO_A_IDENTIFICAR[identidade.motivo]}</p>
                <ul className="flex gap-2 overflow-x-auto py-1" aria-label="Fotos do grupo">
                  {g.fotos.map((f, i) => (
                    <li key={f.id} className="shrink-0">
                      <button type="button" onClick={() => setSeparar(separar === f.id ? null : f.id)} disabled={i === 0 || !!gravando} aria-pressed={separar === f.id} aria-label={`Foto ${i + 1} do grupo`} data-foto-grupo={f.id}
                        className={cn("block rounded-lg overflow-hidden border-2 touch-target", separar === f.id ? "border-primary-600" : "border-transparent")}>
                        {guarda && <FotoGuardada guarda={guarda} id={f.id} alt={`foto ${i + 1}, ${f.momento === "ANTES" ? "antes" : "depois"}`} className="block w-16 h-16 object-cover" />}
                      </button>
                    </li>
                  ))}
                </ul>
                {separar && g.fotos.some((f) => f.id === separar) && (
                  <button type="button" onClick={async () => { await guarda?.separar(atividadeId, separar); setSeparar(null); }} data-separar-aqui
                    className="w-full rounded-card border border-primary-300 bg-white text-primary-700 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
                    <Scissors className="w-4 h-4" /> Separar: outro equipamento começa nesta foto
                  </button>
                )}
                {!x.bloqueada && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setEscolher(g)} disabled={!!gravando} data-escolher-equipamento
                      className="col-span-2 rounded-card bg-primary-600 text-white py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target disabled:opacity-50">
                      Escolher o equipamento <ChevronRight className="w-4 h-4" />
                    </button>
                    {podeCadastrar && (
                      <button type="button" onClick={() => setEtiquetar({ grupo: g, etiqueta: identidade.etiqueta ?? null })} disabled={!!gravando} data-etiquetar
                        className="rounded-card border border-surface-border bg-white text-ink py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-1.5 touch-target disabled:opacity-50">
                        <Plus className="w-4 h-4" /> Etiquetar novo
                      </button>
                    )}
                    <button type="button" onClick={() => resolver(g, { tipo: "geral" })} disabled={!!gravando} data-grupo-geral
                      className={cn("rounded-card border border-surface-border bg-white text-ink py-2.5 text-sm font-semibold touch-target disabled:opacity-50", !podeCadastrar && "col-span-2")}>
                      Geral da OS
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => descartar(g)} disabled={!!gravando} data-descartar-grupo className="inline-flex items-center gap-1.5 text-xs font-semibold text-atrasado-texto touch-target">
                  <Trash2 className="w-3.5 h-3.5" /> Descartar estas fotos
                </button>
              </article>
            ))}
          </section>
        )}

        {salvos.length > 0 && (
          <section className="space-y-2" data-conferencia-salvos>
            <h3 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-success-600" /> Organizadas ({salvos.length})</h3>
            {salvos.map((s) => {
              const eq = s.destino.tipo === "equipamento" ? x.equipamentos.find((e) => e.equipamento.id === (s.destino as { equipamentoId: string }).equipamentoId) : null;
              const nome = s.destino.tipo === "geral" ? "Geral da OS" : titulo(s.destino.equipamentoId);
              const fotos = eq ? eq.fotos.filter((f) => f.clientId && s.fotoIds.includes(f.clientId)) : [];
              const semResposta = eq ? eq.itens.filter((i) => i.ativo && i.tipoResposta === "OK_ATENCAO_NA" && !eq.respostas[i.id]?.status).length : 0;
              const temChecklist = !!eq && eq.itens.some((i) => i.ativo && i.tipoResposta === "OK_ATENCAO_NA");
              return (
                <article key={s.destino.tipo === "geral" ? "geral" : s.destino.equipamentoId} className="rounded-card border border-success-200 bg-success-50 p-3 space-y-2" data-grupo-estado="salvo" data-grupo-destino={s.destino.tipo === "geral" ? "geral" : s.destino.equipamentoId}>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-success-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink truncate" data-grupo-nome>{nome}</p>
                      <p className="text-xs text-ink-muted">{plural(s.antes + s.depois)} · {resumoMomentos(s)}{s.destino.tipo === "equipamento" && s.destino.por === "qr" ? " · pela etiqueta QR" : ""}</p>
                    </div>
                  </div>
                  {fotos.length > 0 && (
                    <ul className="flex gap-2 overflow-x-auto" aria-label={`Fotos de ${nome}`}>
                      {fotos.slice(0, 8).map((f, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <li key={f.clientId ?? i} className="shrink-0"><img src={srcFoto(f)} alt={legendaAutomatica(nome, f.momento ?? "ANTES")} className="w-14 h-14 rounded-lg object-cover" /></li>
                      ))}
                    </ul>
                  )}
                  {eq && !x.bloqueada && (
                    <div className="grid grid-cols-2 gap-2">
                      {temChecklist && (
                        <button type="button" disabled={!semResposta} onClick={() => registrar([{ tipo: "tudoOk", atividadeId, equipamentoId: eq.equipamento.id }])} data-tudo-ok-rapido
                          className="rounded-card bg-success-600 text-white py-3 text-sm font-extrabold inline-flex items-center justify-center gap-1.5 touch-target disabled:bg-success-200 disabled:text-success-700">
                          <CheckCheck className="w-4 h-4" /> {semResposta ? "TUDO OK" : "Checklist OK"}
                        </button>
                      )}
                      <button type="button" onClick={() => { onFechar(); irPara({ ver: "os", a: atividadeId, e: eq.equipamento.id }); }} data-abrir-equipamento
                        className={cn("rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-1 touch-target", !temChecklist && "col-span-2")}>
                        Abrir <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          {!x.bloqueada && (
            <button type="button" onClick={onMaisFotos} data-mais-fotos className="rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
              <Camera className="w-4 h-4" /> Mais fotos
            </button>
          )}
          <button type="button" onClick={onFechar} data-fechar-conferencia className={cn("rounded-card bg-primary-600 text-white py-3 text-sm font-bold touch-target", x.bloqueada && "col-span-2")}>
            {pendentes.length ? "Resolver depois" : "Concluído"}
          </button>
        </div>
      </div>

      {escolher && (
        <Modal aberto titulo="De qual equipamento são as fotos?" onFechar={() => setEscolher(null)}>
          <div className="space-y-3" data-escolha-equipamento>
            {[{ rotulo: "Nesta OS", lista: x.equipamentos.map((e) => e.equipamento) }, { rotulo: "Outros da unidade", lista: outrosDaUnidade }].filter((b) => b.lista.length).map((bloco) => (
              <div key={bloco.rotulo} className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{bloco.rotulo}</p>
                <ul className="space-y-2">
                  {bloco.lista.map((e) => (
                    <li key={e.id}>
                      <button type="button" data-opcao-equipamento={e.id} onClick={() => { const g = escolher; setEscolher(null); void resolver(g, { tipo: "equipamento", equipamentoId: e.id, por: "tecnico" }); }}
                        className="w-full text-left rounded-card border border-surface-border bg-white p-3 touch-target active:bg-surface-alt">
                        <span className="block font-semibold text-ink">{e.titulo}</span>
                        <span className="block text-xs text-ink-muted">{[e.tipo?.nome, e.tag && `TAG ${e.tag}`, e.local].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!x.equipamentos.length && !outrosDaUnidade.length && <p className="text-sm text-ink-muted">Nenhum equipamento nesta unidade ainda. Use “Etiquetar novo”.</p>}
          </div>
        </Modal>
      )}
      {etiquetar && (
        <ModalCadastroEquipamento r={r} x={x} endereco={r.cartao.endereco} registrar={registrar} qrInicial={etiquetar.etiqueta}
          onFechar={() => setEtiquetar(null)}
          // O cadastro em campo já vincula o equipamento novo à OS: as fotos do grupo vão direto para ele
          aoCadastrar={(id) => resolver(etiquetar.grupo, { tipo: "equipamento", equipamentoId: id, por: "tecnico" }, true)} />
      )}
    </Modal>
  );
}
