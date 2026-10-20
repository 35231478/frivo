"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft, CheckCircle2, ChevronRight, CircleDashed, ClipboardCheck, HardDrive, ListPlus, Loader2, MapPin, Navigation, Phone, Plus, QrCode, Search, Sparkles, Trash2, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { ScannerQR } from "@/components/os/scanner-qr";
import { BotaoFoto, Miniatura, ObservacaoVoz } from "@/components/tecnico/captura";
import { irPara, useAtividade } from "@/components/tecnico/contexto";
import { srcFoto, TelaEquipamento } from "@/components/tecnico/equipamento";
import { ROTULO_STATUS_ATIVIDADE } from "@/components/tecnico/meu-dia";
import { equipamentoDoQr } from "@/lib/tecnico/offline/estado";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { textoFaltas } from "@/lib/execucao/pendencias";
import type { AdicionalTela, EquipamentoTela, ExecucaoTela, NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

/** Situação do equipamento (chip da lista). */
export function situacao(e: EquipamentoTela) {
  if (!e.feito) {
    const mexeu = Object.values(e.respostas).some((r) => r.status || r.valor !== null) || e.fotos.length > 0;
    return mexeu ? { chave: "nao-atendido", rotulo: "Não atendido", classe: "bg-slate-100 text-slate-600" } : { chave: "nao-iniciado", rotulo: "A fazer", classe: "bg-primary-50 text-primary-700" };
  }
  if (e.completo) return { chave: "completo", rotulo: "Completo", classe: "bg-success-100 text-success-700" };
  const n = e.faltas.semResposta.length + e.faltas.semFoto.length + e.faltas.semObservacao.length + (e.faltas.formulario ? 1 : 0);
  return { chave: "pendente", rotulo: n === 1 ? "Falta 1" : `Faltam ${n}`, classe: "bg-amber-100 text-amber-800" };
}

/** A OS no app: local, equipamentos (com o que falta), serviço extra e a conclusão (com a trava da Etapa 1). */
export function VistaOs({ atividadeId, equipamentoId }: { atividadeId: string; equipamentoId?: string | null }) {
  const { retrato, tela, aEnviar, registrar, carregando } = useAtividade(atividadeId);

  if (carregando) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>;
  if (!retrato || !tela) {
    return (
      <div className="space-y-4" data-vista="os-indisponivel">
        <Voltar />
        <div className="rounded-2xl bg-white border border-surface-border p-6 text-center space-y-2">
          <WifiOff className="w-8 h-8 text-ink-subtle mx-auto" />
          <p className="font-semibold text-ink">Esta OS ainda não está no aparelho</p>
          <p className="text-sm text-ink-muted">Abra-a uma vez com sinal (ou abra o Meu dia com internet: as OS do dia já ficam guardadas).</p>
        </div>
      </div>
    );
  }
  const e = equipamentoId ? tela.equipamentos.find((q) => q.equipamento.id === equipamentoId) : null;
  if (e) return <TelaEquipamento x={tela} e={e} registrar={registrar} />;
  return <ResumoOs r={retrato} x={tela} aEnviar={aEnviar} registrar={registrar} />;
}

function Voltar() {
  return (
    <button type="button" onClick={() => irPara({ ver: "dia" })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
      <ArrowLeft className="w-4 h-4" /> Meu dia
    </button>
  );
}

function ResumoOs({ r, x, aEnviar, registrar }: { r: RetratoAtividade; x: ExecucaoTela; aEnviar: number; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const c = r.cartao;
  const atividadeId = x.atividade.id;
  const so = x.bloqueada;
  const [scan, setScan] = useState(false);
  const [lista, setLista] = useState(false);
  const [adicional, setAdicional] = useState<AdicionalTela | "novo" | null>(null);
  const [concluir, setConcluir] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const st = ROTULO_STATUS_ATIVIDADE[x.atividade.status] ?? { rotulo: x.atividade.status, classe: "bg-slate-100 text-slate-700" };
  const atendidos = x.equipamentos.filter((e) => e.feito).length;

  async function lerQr(valor: string) {
    setScan(false);
    const u = equipamentoDoQr(r, valor);
    // Sem sinal, o QR é resolvido no aparelho (lista da unidade); o servidor confere de novo ao sincronizar
    if (!u && !navigator.onLine) { setAviso({ tipo: "erro", texto: "QR não é de um equipamento desta unidade (ou o cadastro é novo): vincule pela lista." }); return; }
    await registrar([{ tipo: "scan", atividadeId, valor }]);
    if (u) { setAviso({ tipo: "ok", texto: `${u.titulo}: vinculado e marcado como atendido.` }); irPara({ ver: "os", a: atividadeId, e: u.id }); }
    else setAviso({ tipo: "ok", texto: "QR enviado: o escritório confere o equipamento ao sincronizar." });
  }

  return (
    <div className="space-y-4 pb-32" data-vista="os">
      <Voltar />
      <header className="bg-white rounded-2xl border border-surface-border overflow-hidden">
        <div className="p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-muted">{c.osNumero}{x.atividade.tipoOs ? ` · ${x.atividade.tipoOs.nome}` : ""}</p>
            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", st.classe)} data-status={x.atividade.status}>{st.rotulo}</span>
          </div>
          <h1 className="text-xl font-bold text-ink leading-tight">{c.cliente}</h1>
          <p className="text-sm text-ink-muted">{x.atividade.titulo}{c.unidade ? ` · ${c.unidade}` : ""}{c.hora ? ` · ${c.hora}` : ""}</p>
          {c.endereco && <p className="text-sm text-ink flex gap-1 pt-1"><MapPin className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" /> {c.endereco}</p>}
          {c.descricao && <p className="text-sm text-ink bg-surface-alt rounded-lg p-2.5 mt-2 whitespace-pre-line" data-descricao>{c.descricao}</p>}
        </div>
        {(c.rota || c.telefone) && (
          <div className="flex border-t border-surface-border divide-x divide-surface-border">
            {c.rota && <a href={c.rota} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-primary-700 touch-target"><Navigation className="w-4 h-4" /> Rota no mapa</a>}
            {c.telefone && <a href={`tel:${c.telefone.replace(/[^\d+]/g, "")}`} className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-ink touch-target"><Phone className="w-4 h-4" /> Ligar</a>}
          </div>
        )}
      </header>

      {aEnviar > 0 && <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900" data-a-enviar>{aEnviar === 1 ? "1 gravação" : `${aEnviar} gravações`} desta OS no aparelho — sobe sozinho quando houver sinal.</p>}
      {so && <p className="rounded-xl bg-success-50 border border-success-200 px-3 py-2 text-sm text-success-800 inline-flex items-center gap-2 w-full"><CheckCircle2 className="w-4 h-4" /> Atividade concluída{aEnviar ? " no aparelho (a enviar)" : ""}. Só leitura.</p>}
      {aviso && <p role="status" className={cn("rounded-xl px-3 py-2 text-sm", aviso.tipo === "ok" ? "bg-success-50 text-success-800" : "bg-red-50 text-red-800")}>{aviso.texto}</p>}

      <section className="space-y-2">
        <div className="flex items-end justify-between">
          <h2 className="text-base font-bold text-ink">Equipamentos</h2>
          <span className="text-sm text-ink-muted" data-atendidos>{atendidos} de {x.equipamentos.length} atendidos</span>
        </div>
        {!x.equipamentos.length && <p className="rounded-xl bg-white border border-surface-border p-4 text-sm text-ink-muted">Nenhum equipamento nesta OS ainda. Escaneie o QR do equipamento ou escolha na lista da unidade.</p>}
        <ul className="space-y-2">
          {x.equipamentos.map((e) => {
            const s = situacao(e);
            return (
              <li key={e.equipamento.id}>
                <button type="button" onClick={() => irPara({ ver: "os", a: atividadeId, e: e.equipamento.id })} data-equip-linha={e.equipamento.id} data-situacao={s.chave}
                  className="w-full text-left bg-white rounded-xl border border-surface-border p-3 flex items-center gap-3 active:bg-surface-alt">
                  {s.chave === "completo" ? <CheckCircle2 className="w-6 h-6 text-success-600 shrink-0" /> : s.chave === "nao-iniciado" ? <CircleDashed className="w-6 h-6 text-ink-subtle shrink-0" /> : <HardDrive className="w-6 h-6 text-ink-muted shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink truncate">{e.equipamento.titulo}</span>
                    <span className="block text-xs text-ink-muted truncate">{[e.equipamento.tipo?.nome, e.equipamento.tag && `TAG ${e.equipamento.tag}`, e.equipamento.local].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 shrink-0", s.classe)}>{s.rotulo}</span>
                  <ChevronRight className="w-5 h-5 text-ink-subtle shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
        {!so && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setScan(true)} className="rounded-xl border border-primary-200 bg-primary-50 text-primary-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target"><QrCode className="w-5 h-5" /> Ler QR Code</button>
            <button type="button" onClick={() => setLista(true)} className="rounded-xl border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target"><ListPlus className="w-5 h-5" /> Da lista</button>
          </div>
        )}
      </section>

      <section className="space-y-2" data-adicionais>
        <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-600" /> Serviço extra pedido na visita</h2>
        {x.adicionais.map((a, i) => {
          const eq = a.equipamentoId ? (x.equipamentos.find((e) => e.equipamento.id === a.equipamentoId)?.equipamento ?? r.equipamentosUnidade.find((u) => u.id === a.equipamentoId)) : null;
          return (
            <button key={a.clientId ?? a.id ?? i} type="button" disabled={so} onClick={() => setAdicional(a)} data-adicional
              className="w-full text-left rounded-xl border-2 border-violet-200 bg-violet-50 p-3 space-y-1 disabled:opacity-90">
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-violet-700">Adicional</span>
                <span className="text-xs font-semibold rounded-full bg-white text-violet-700 px-2 py-0.5">{a.pendente ? "no aparelho" : "escritório avalia a cobrança"}</span>
              </span>
              <span className="block text-sm font-semibold text-ink">{a.descricao}</span>
              <span className="block text-xs text-ink-muted">{[eq?.titulo, a.fotos.length ? `${a.fotos.length} foto${a.fotos.length > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "Sem equipamento"}</span>
            </button>
          );
        })}
        {!so && (
          <button type="button" onClick={() => setAdicional("novo")} data-novo-adicional className="w-full rounded-xl border-2 border-dashed border-violet-300 text-violet-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
            <Plus className="w-5 h-5" /> Adicionar serviço extra
          </button>
        )}
      </section>

      {!so && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-4 pb-2 pt-2 bg-gradient-to-t from-surface-page via-surface-page to-transparent">
          <button type="button" onClick={() => setConcluir(true)} data-concluir-atividade
            className={cn("w-full rounded-2xl py-4 text-base font-bold shadow-elevated inline-flex items-center justify-center gap-2 touch-target", x.conclusao.ok ? "bg-success-600 text-white" : "bg-white text-ink border border-surface-border")}>
            <ClipboardCheck className="w-5 h-5" /> Concluir atividade
          </button>
        </div>
      )}

      {scan && <ScannerQR onFechar={() => setScan(false)} onLer={lerQr} />}
      {lista && <ListaUnidade r={r} x={x} onFechar={() => setLista(false)} onVincular={async (ids) => { setLista(false); await registrar([{ tipo: "vincular", atividadeId, equipamentoIds: ids }]); }} />}
      {adicional && <ModalAdicional x={x} r={r} a={adicional === "novo" ? null : adicional} onFechar={() => setAdicional(null)} registrar={registrar} />}
      {concluir && <ModalConcluir x={x} onFechar={() => setConcluir(false)} onConcluir={async (resumo) => {
        await registrar([{ tipo: "concluir", atividadeId, dados: resumo ? { resumo } : {} }]);
        setConcluir(false);
        setAviso({ tipo: "ok", texto: "Atividade concluída. Vai para o escritório na sincronização." });
      }} />}
    </div>
  );
}

function ListaUnidade({ r, x, onFechar, onVincular }: { r: RetratoAtividade; x: ExecucaoTela; onFechar: () => void; onVincular: (ids: string[]) => void }) {
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const ja = new Set(x.equipamentos.map((e) => e.equipamento.id));
  const lista = useMemo(() => {
    const q = busca.trim().toLocaleLowerCase("pt-BR");
    return r.equipamentosUnidade.filter((u) => !ja.has(u.id) && (!q || [u.titulo, u.tag, u.local, u.tipo?.nome, u.fabricante].join(" ").toLocaleLowerCase("pt-BR").includes(q)));
  }, [busca, r.equipamentosUnidade, ja]);
  return (
    <Modal aberto titulo="Equipamentos da unidade" onFechar={onFechar}>
      <div className="space-y-3" data-lista-unidade>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, TAG, local" aria-label="Buscar equipamento"
            className="w-full rounded-xl border border-surface-border pl-9 pr-3 py-3 text-base" />
        </div>
        {!lista.length && <p className="text-sm text-ink-muted">Nenhum outro equipamento ativo nesta unidade.</p>}
        <ul className="divide-y divide-surface-border max-h-[50vh] overflow-y-auto">
          {lista.map((u) => (
            <li key={u.id}>
              <label className="flex items-center gap-3 py-3 touch-target">
                <input type="checkbox" className="w-5 h-5" checked={marcados.has(u.id)} onChange={() => setMarcados((m) => { const n = new Set(m); if (n.has(u.id)) n.delete(u.id); else n.add(u.id); return n; })} />
                <span className="min-w-0">
                  <span className="block font-semibold text-ink truncate">{u.titulo}</span>
                  <span className="block text-xs text-ink-muted truncate">{[u.tipo?.nome, u.tag && `TAG ${u.tag}`, u.local].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <button type="button" disabled={!marcados.size} onClick={() => onVincular([...marcados])} className="w-full rounded-xl bg-primary-600 text-white py-3 font-semibold disabled:opacity-40 touch-target">
          Vincular {marcados.size || ""}
        </button>
      </div>
    </Modal>
  );
}

/** Serviço extra: entra na MESMA OS e no MESMO relatório (destacado como "Adicional"); o escritório avalia a cobrança. */
function ModalAdicional({ x, r, a, onFechar, registrar }: { x: ExecucaoTela; r: RetratoAtividade; a: AdicionalTela | null; onFechar: () => void; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const atividadeId = x.atividade.id;
  const [descricao, setDescricao] = useState(a?.descricao ?? "");
  const [equipamentoId, setEquipamentoId] = useState(a?.equipamentoId ?? "");
  const [fotosNovas, setFotosNovas] = useState<string[]>([]);
  const ref = a?.clientId ? { clientId: a.clientId } : a?.id ? { id: a.id } : null;
  const opcoes = [
    ...x.equipamentos.map((e) => ({ id: e.equipamento.id, titulo: e.equipamento.titulo })),
    ...r.equipamentosUnidade.filter((u) => !x.equipamentos.some((e) => e.equipamento.id === u.id)).map((u) => ({ id: u.id, titulo: u.titulo })),
  ];
  async function salvar() {
    const clientId = a?.clientId ?? (a?.id ? undefined : novoClientId());
    const ops: NovaOperacao[] = [{ tipo: "adicional", atividadeId, dados: { ...(clientId ? { clientId } : { id: a!.id! }), descricao: descricao.trim(), equipamentoId: equipamentoId || null } }];
    for (const d of fotosNovas) ops.push({ tipo: "adicionalFoto", atividadeId, dados: { ...(clientId ? { servicoClientId: clientId } : { servicoId: a!.id! }), dataUrl: d, clientId: novoClientId() } });
    await registrar(ops);
    onFechar();
  }
  return (
    <Modal aberto titulo={a ? "Serviço extra" : "Adicionar serviço extra"} onFechar={onFechar}>
      <div className="space-y-4" data-modal-adicional>
        <p className="text-sm text-ink-muted">O cliente pediu algo a mais nesta visita? Registre aqui: entra nesta OS e no relatório como <b>Adicional</b>. Não cria outra OS — o escritório decide a cobrança.</p>
        <ObservacaoVoz rotulo="O que foi feito / pedido" obrigatoria valor={descricao} onSalvar={setDescricao} aoDigitar={setDescricao} placeholder="Ex.: troca do controle remoto da sala 2" />
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">Equipamento (opcional)</span>
          <select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)} className="w-full rounded-xl border border-surface-border bg-white px-3 py-3 text-base" aria-label="Equipamento do serviço extra">
            <option value="">Nenhum</option>
            {opcoes.map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
          </select>
        </label>
        <div className="space-y-2">
          <span className="text-sm font-semibold text-ink">Fotos</span>
          <div className="flex flex-wrap gap-2">
            {a?.fotos.map((f, i) => <Miniatura key={f.clientId ?? f.id ?? i} src={srcFoto(f)} alt={`foto ${i + 1}`} pendente={!f.id}
              onRemover={() => registrar([{ tipo: "adicionalFotoRemover", atividadeId, dados: f.clientId ? { clientId: f.clientId } : { id: f.id! } }])} />)}
            {fotosNovas.map((d, i) => <Miniatura key={`n${i}`} src={d} alt={`foto nova ${i + 1}`} pendente onRemover={() => setFotosNovas((l) => l.filter((_, j) => j !== i))} />)}
          </div>
          <BotaoFoto rotulo="Foto do serviço extra" onFoto={(d) => setFotosNovas((l) => [...l, d])} />
        </div>
        <button type="button" disabled={descricao.trim().length < 3} onClick={salvar} data-salvar-adicional className="w-full rounded-xl bg-violet-600 text-white py-4 text-base font-bold disabled:opacity-40 touch-target">
          {a ? "Salvar" : "Adicionar à OS"}
        </button>
        {a && ref && (
          <button type="button" onClick={async () => { await registrar([{ tipo: "adicionalRemover", atividadeId, dados: ref }]); onFechar(); }}
            className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-red-600 py-2 touch-target"><Trash2 className="w-4 h-4" /> Tirar este serviço extra</button>
        )}
      </div>
    </Modal>
  );
}

function ModalConcluir({ x, onFechar, onConcluir }: { x: ExecucaoTela; onFechar: () => void; onConcluir: (resumo: string) => void }) {
  const [resumo, setResumo] = useState("");
  const c = x.conclusao;
  return (
    <Modal aberto titulo="Concluir atividade" onFechar={onFechar}>
      {!c.ok ? (
        <div className="space-y-3" data-pendencias>
          <p className="text-sm font-semibold text-red-700">Ainda não dá para concluir:</p>
          {c.semEquipamento
            ? <p className="text-sm text-ink">{c.mensagem}</p>
            : (
              <ul className="space-y-2">
                {c.pendencias.map((p) => (
                  <li key={p.equipamentoId}>
                    <button type="button" onClick={() => { onFechar(); irPara({ ver: "os", a: x.atividade.id, e: p.equipamentoId }); }}
                      className="w-full text-left rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
                      <span className="block font-semibold text-ink">{p.titulo}</span>
                      <span className="block text-red-800">{textoFaltas(p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          <button type="button" onClick={onFechar} className="w-full rounded-xl border border-surface-border py-3 font-semibold touch-target">Voltar</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink">{c.atendidos === 1 ? "1 equipamento atendido" : `${c.atendidos} equipamentos atendidos`}{c.naoAtendidos ? ` · ${c.naoAtendidos} não atendido${c.naoAtendidos > 1 ? "s" : ""}` : ""}{x.adicionais.length ? ` · ${x.adicionais.length} serviço${x.adicionais.length > 1 ? "s" : ""} extra` : ""}.</p>
          <ObservacaoVoz rotulo="Resumo para o escritório (opcional)" valor={resumo} onSalvar={setResumo} aoDigitar={setResumo} />
          <button type="button" onClick={() => onConcluir(resumo.trim())} data-confirmar-conclusao className="w-full rounded-xl bg-success-600 text-white py-4 text-base font-bold touch-target">Concluir atividade</button>
        </div>
      )}
    </Modal>
  );
}
