"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Camera, CheckCircle2, ChevronRight, CircleDashed, ClipboardCheck, HardDrive, ListPlus, Loader2, MapPin, Phone, Plus, QrCode, Search, Sparkles, Trash2, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { confirmar, toast } from "@/components/ui/avisos";
import { ScannerQR } from "@/components/os/scanner-qr";
import { BotaoFoto, Miniatura, ObservacaoVoz } from "@/components/tecnico/captura";
import { irPara, useAtividade, useTecnico } from "@/components/tecnico/contexto";
import { BotaoRota } from "@/components/tecnico/rota";
import { ModalCadastroEquipamento } from "@/components/tecnico/cadastro-equipamento";
import { AvisoClienteOs } from "@/components/tecnico/aviso-cliente";
import { CameraRapida, useRapida } from "@/components/tecnico/camera-rapida";
import { ConferenciaRapida } from "@/components/tecnico/conferencia-rapida";
import { MSG_SEM_UNIDADE } from "@/lib/tecnico/cadastro-equipamento";
import { ConcluirSemEquipamento } from "@/components/os/concluir-sem-equipamento";
import { srcFoto, TelaEquipamento } from "@/components/tecnico/equipamento";
import { ROTULO_STATUS_ATIVIDADE } from "@/components/tecnico/meu-dia";
import { adicionalAvaliado, equipamentoDoQr } from "@/lib/tecnico/offline/estado";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { textoFaltas } from "@/lib/execucao/pendencias";
import { LEGENDA_MAX, limparLegenda, REFERENCIA_GERAL } from "@/lib/os/galeria";
import type { AdicionalTela, EquipamentoTela, ExecucaoTela, FotoServicoTela, NovaOperacao, RetratoAtividade } from "@/lib/tecnico/offline/tipos";

/** Situação do equipamento (chip da lista). */
export function situacao(e: EquipamentoTela) {
  if (!e.feito) {
    // Marcado como não atendido (com o motivo) ou já mexido: "Não atendido"; senão ainda "A fazer"
    const mexeu = Object.values(e.respostas).some((r) => r.status || r.valor !== null) || e.fotos.length > 0 || !!e.observacao;
    return mexeu ? { chave: "nao-atendido", rotulo: "Não atendido", classe: "bg-surface-linha text-ink-muted" } : { chave: "nao-iniciado", rotulo: "A fazer", classe: "bg-primary-50 text-primary-700" };
  }
  if (e.completo) return { chave: "completo", rotulo: "Completo", classe: "bg-success-100 text-success-700" };
  const n = e.faltas.semResposta.length + e.faltas.semFoto.length + e.faltas.semObservacao.length + (e.faltas.formulario ? 1 : 0);
  return { chave: "pendente", rotulo: n === 1 ? "Falta 1" : `Faltam ${n}`, classe: "bg-atencao-claro text-atencao-texto" };
}

/** A OS no app: local, equipamentos (com o que falta), serviço extra e a conclusão (com a trava da Etapa 1). */
export function VistaOs({ atividadeId, equipamentoId, camera }: { atividadeId: string; equipamentoId?: string | null; /** Abre já na câmera rápida (atalho do Meu dia) */ camera?: boolean }) {
  const { retrato, tela, aEnviar, registrar, carregando } = useAtividade(atividadeId);

  if (carregando) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div>;
  if (!retrato || !tela) {
    return (
      <div className="space-y-4" data-vista="os-indisponivel">
        <Voltar />
        <div className="rounded-card bg-white border border-surface-border p-6 text-center space-y-2">
          <WifiOff className="w-8 h-8 text-ink-subtle mx-auto" />
          <p className="font-semibold text-ink">Esta OS ainda não está no aparelho</p>
          <p className="text-sm text-ink-muted">Abra-a uma vez com sinal (ou abra o Meu dia com internet: as OS do dia já ficam guardadas).</p>
        </div>
      </div>
    );
  }
  const e = equipamentoId ? tela.equipamentos.find((q) => q.equipamento.id === equipamentoId) : null;
  if (e) return <TelaEquipamento x={tela} e={e} registrar={registrar} endereco={retrato.cartao.endereco}
    qr={retrato.equipamentosUnidade.find((u) => u.id === e.equipamento.id)?.qr?.codigo ?? null} />;
  return <ResumoOs r={retrato} x={tela} aEnviar={aEnviar} registrar={registrar} camera={camera} />;
}

function Voltar() {
  return (
    <button type="button" onClick={() => irPara({ ver: "dia" })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
      <ArrowLeft className="w-4 h-4" /> Meu dia
    </button>
  );
}

function ResumoOs({ r, x, aEnviar, registrar, camera }: { r: RetratoAtividade; x: ExecucaoTela; aEnviar: number; registrar: (ops: NovaOperacao[]) => Promise<void>; camera?: boolean }) {
  const c = r.cartao;
  const atividadeId = x.atividade.id;
  const { motor, config } = useTecnico();
  const so = x.bloqueada;
  const [scan, setScan] = useState(false);
  const [lista, setLista] = useState(false);
  const [cadastro, setCadastro] = useState(false);
  // "Permitir cadastrar equipamento em campo" (Equipes › App do colaborador): desligado, o botão nem aparece
  const podeCadastrar = !so && config.cadastrarEquipamento && !!r.cadastro;
  const [adicional, setAdicional] = useState<AdicionalTela | "novo" | null>(null);
  const [concluir, setConcluir] = useState(false);
  const [fotoServico, setFotoServico] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  // Câmera rápida: fotos em rajada que o app organiza pelo QR; as sem equipamento esperam a conferência
  const { guarda: guardaRapida, sessao: rapida } = useRapida(atividadeId);
  const [cameraAberta, setCameraAberta] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const aConferir = rapida.fotos.length;
  // Atalho do Meu dia (…&cam=1): abre direto na câmera e tira o atalho do endereço (voltar não reabre)
  useEffect(() => {
    if (!camera || so) return;
    setCameraAberta(true);
    irPara({ ver: "os", a: atividadeId }, true);
  }, [camera, so, atividadeId]);
  // Atividade encerrada e nada a conferir: não sobra nada da câmera rápida no aparelho
  useEffect(() => { if (so && !aConferir && rapida.salvos.length) void guardaRapida?.limpar(atividadeId); }, [so, aConferir, rapida.salvos.length, guardaRapida, atividadeId]);
  async function fecharCamera() {
    setCameraAberta(false);
    const s = await guardaRapida?.sessao(atividadeId);
    if (s && (s.fotos.length || s.salvos.length)) setConferindo(true);
  }
  const st = ROTULO_STATUS_ATIVIDADE[x.atividade.status] ?? { rotulo: x.atividade.status, classe: "bg-surface-linha text-ink" };
  const atendidos = x.equipamentos.filter((e) => e.feito).length;

  async function lerQr(valor: string) {
    setScan(false);
    const u = equipamentoDoQr(r, valor);
    // Sem sinal, o QR é resolvido no aparelho (lista da unidade); o servidor confere de novo ao sincronizar
    if (!u && !navigator.onLine) {
      const saida = podeCadastrar && r.cadastro?.unidadeId ? "vincule pela lista ou cadastre o equipamento." : "vincule pela lista.";
      setAviso({ tipo: "erro", texto: `QR não é de um equipamento desta unidade (ou o cadastro é novo): ${saida}` }); return;
    }
    await registrar([{ tipo: "scan", atividadeId, valor }]);
    if (u) { setAviso({ tipo: "ok", texto: `${u.titulo}: vinculado e marcado como atendido.` }); irPara({ ver: "os", a: atividadeId, e: u.id }); }
    else setAviso({ tipo: "ok", texto: "QR enviado: o escritório confere o equipamento ao sincronizar." });
  }

  return (
    <div className="space-y-4 pb-32" data-vista="os">
      <Voltar />
      <header className="bg-white rounded-card border border-surface-border overflow-hidden">
        <div className="p-4 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-muted">{c.osNumero}{x.atividade.tipoOs ? ` · ${x.atividade.tipoOs.nome}` : ""}</p>
            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", st.classe)} data-status={x.atividade.status}>{st.rotulo}</span>
          </div>
          {/* "Exibir dados do cliente" desligado: esconde nome, endereço e descrição do cliente (privacidade) */}
          <h1 className="text-xl font-bold text-ink leading-tight">{(config.exibirDadosCliente && c.cliente) || x.atividade.titulo || c.osNumero}</h1>
          <p className="text-sm text-ink-muted">{[config.exibirDadosCliente && c.cliente && x.atividade.titulo !== x.atividade.tipoOs?.nome && x.atividade.titulo, config.exibirDadosCliente && c.unidade, c.hora].filter(Boolean).join(" · ")}</p>
          {config.exibirDadosCliente && c.endereco && <p className="text-sm text-ink flex gap-1 pt-1"><MapPin className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" /> {c.endereco}</p>}
          {config.exibirDadosCliente && c.descricao && <p className="text-sm text-ink bg-surface-alt rounded-lg p-2.5 mt-2 whitespace-pre-line" data-descricao>{c.descricao}</p>}
        </div>
        {((config.exibirDadosCliente && c.rota) || (config.exibirContatosCliente && c.telefone)) && (
          <div className="flex border-t border-surface-border divide-x divide-surface-border">
            {/* Rota depende do endereço do cliente (dados); Ligar é contato do cliente */}
            {config.exibirDadosCliente && c.rota && <BotaoRota rota={c.rota} />}
            {config.exibirContatosCliente && c.telefone && <a href={`tel:${c.telefone.replace(/[^\d+]/g, "")}`} className="flex-1 inline-flex items-center justify-center gap-2 py-3 text-sm font-semibold text-ink touch-target"><Phone className="w-4 h-4" /> Ligar</a>}
          </div>
        )}
      </header>

      <AvisoClienteOs r={r} x={x} registrar={registrar} />

      {!so && (
        <section className="space-y-2" data-camera-rapida-atalho>
          <button type="button" onClick={() => setCameraAberta(true)} data-abrir-camera-rapida
            className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold shadow-card inline-flex items-center justify-center gap-2 touch-target">
            <Camera className="w-6 h-6" /> Câmera rápida
          </button>
          <p className="text-xs text-ink-muted">Fotografe à vontade, com a etiqueta QR junto: o app põe cada foto no equipamento certo.</p>
        </section>
      )}
      {aConferir > 0 && (
        <button type="button" onClick={() => setConferindo(true)} data-conferir-fotos
          className="w-full text-left rounded-card bg-atencao-claro border border-atencao/20 px-3 py-3 text-sm text-atencao-texto font-semibold inline-flex items-center justify-between gap-2 touch-target">
          <span>{aConferir === 1 ? "1 foto a identificar" : `${aConferir} fotos a identificar`} — toque para conferir</span> <ChevronRight className="w-5 h-5 shrink-0" />
        </button>
      )}

      {aEnviar > 0 && <p className="rounded-card bg-atencao-claro border border-atencao/20 px-3 py-2 text-sm text-atencao-texto" data-a-enviar>{aEnviar === 1 ? "1 gravação" : `${aEnviar} gravações`} desta OS no aparelho — sobe sozinho quando houver sinal.</p>}
      {so && <p className="rounded-card bg-success-50 border border-success-200 px-3 py-2 text-sm text-success-800 inline-flex items-center gap-2 w-full"><CheckCircle2 className="w-4 h-4" /> Atividade concluída{aEnviar ? " no aparelho (a enviar)" : ""}. Só leitura.</p>}
      {aviso && <p role="status" className={cn("rounded-card px-3 py-2 text-sm", aviso.tipo === "ok" ? "bg-success-50 text-success-800" : "bg-atrasado-claro text-atrasado-texto")}>{aviso.texto}</p>}

      <section className="space-y-2">
        <div className="flex items-end justify-between">
          <h2 className="text-base font-bold text-ink">Equipamentos</h2>
          <span className="text-sm text-ink-muted" data-atendidos>{atendidos} de {x.equipamentos.length} atendidos</span>
        </div>
        {!x.equipamentos.length && <p className="rounded-card bg-white border border-surface-border p-4 text-sm text-ink-muted">Nenhum equipamento nesta OS ainda. Escaneie o QR do equipamento ou escolha na lista da unidade.</p>}
        <ul className="space-y-2">
          {x.equipamentos.map((e) => {
            const s = situacao(e);
            return (
              <li key={e.equipamento.id}>
                <button type="button" onClick={() => irPara({ ver: "os", a: atividadeId, e: e.equipamento.id })} data-equip-linha={e.equipamento.id} data-situacao={s.chave}
                  className="w-full text-left bg-white rounded-card border border-surface-border p-3 flex items-center gap-3 active:bg-surface-alt">
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
            <button type="button" onClick={() => setScan(true)} className="rounded-card border border-primary-200 bg-primary-50 text-primary-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target"><QrCode className="w-5 h-5" /> Ler QR Code</button>
            <button type="button" onClick={() => setLista(true)} className="rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target"><ListPlus className="w-5 h-5" /> Da lista</button>
          </div>
        )}
        {/* Não está na unidade (nem pelo QR, nem na lista): cadastra em campo, já vinculado a esta OS */}
        {podeCadastrar && (r.cadastro!.unidadeId ? (
          <button type="button" onClick={() => setCadastro(true)} data-cadastrar-equipamento
            className="w-full rounded-card border-2 border-dashed border-primary-300 text-primary-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
            <Plus className="w-5 h-5" /> Cadastrar novo equipamento
          </button>
        ) : <p className="text-xs text-ink-muted" data-cadastro-sem-unidade>{MSG_SEM_UNIDADE}</p>)}
      </section>

      <FotosServico x={x} so={so} onAdicionar={() => setFotoServico(true)} registrar={registrar} />

      <section className="space-y-2" data-adicionais>
        <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-acento" /> Serviço extra pedido na visita</h2>
        {x.adicionais.map((a, i) => {
          const eq = a.equipamentoId ? (x.equipamentos.find((e) => e.equipamento.id === a.equipamentoId)?.equipamento ?? r.equipamentosUnidade.find((u) => u.id === a.equipamentoId)) : null;
          return (
            <button key={a.clientId ?? a.id ?? i} type="button" disabled={so} onClick={() => setAdicional(a)} data-adicional data-avaliado={adicionalAvaliado(a) || undefined}
              className="w-full text-left rounded-card border-2 border-acento/20 bg-acento-claro p-3 space-y-1 disabled:opacity-90 touch-target">
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-acento-hover">Adicional</span>
                <span className="text-xs font-semibold rounded-full bg-white text-acento-hover px-2 py-0.5">{a.pendente ? "no aparelho" : adicionalAvaliado(a) ? "escritório já avaliou" : "escritório avalia a cobrança"}</span>
              </span>
              <span className="block text-sm font-semibold text-ink">{a.descricao}</span>
              <span className="block text-xs text-ink-muted">{[eq?.titulo, a.fotos.length ? `${a.fotos.length} foto${a.fotos.length > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ") || "Sem equipamento"}</span>
            </button>
          );
        })}
        {!so && (
          <button type="button" onClick={() => setAdicional("novo")} data-novo-adicional className="w-full rounded-card border-2 border-dashed border-acento/40 text-acento-hover py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
            <Plus className="w-5 h-5" /> Adicionar serviço extra
          </button>
        )}
      </section>

      {!so && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 px-4 pb-2 pt-2 bg-surface-page/95 backdrop-blur border-t border-surface-border">
          <button type="button" data-concluir-atividade onClick={() => {
            // Foto sem equipamento não fica para trás: concluir espera a conferência
            if (aConferir > 0) { toast("Antes de concluir, diga de qual equipamento são as fotos.", "info"); setConferindo(true); return; }
            setConcluir(true);
          }}
            className={cn("w-full rounded-card py-4 text-base font-bold shadow-elevated inline-flex items-center justify-center gap-2 touch-target", x.conclusao.ok ? "bg-success-600 text-white" : "bg-white text-ink border border-surface-border")}>
            <ClipboardCheck className="w-5 h-5" /> Concluir atividade
          </button>
        </div>
      )}

      {cameraAberta && (
        <CameraRapida atividadeId={atividadeId} marca={{ osNumero: x.os.numero, endereco: c.endereco }} onPronto={fecharCamera}
          resolverQr={(qr) => equipamentoDoQr(r, qr)?.id ?? null}
          nomeDoEquipamento={(id) => x.equipamentos.find((e) => e.equipamento.id === id)?.equipamento.titulo ?? r.equipamentosUnidade.find((u) => u.id === id)?.titulo ?? "Equipamento"} />
      )}
      {conferindo && <ConferenciaRapida r={r} x={x} registrar={registrar} onFechar={() => setConferindo(false)} onMaisFotos={() => { setConferindo(false); setCameraAberta(true); }} />}
      {scan && <ScannerQR onFechar={() => setScan(false)} onLer={lerQr} />}
      {lista && <ListaUnidade r={r} x={x} onFechar={() => setLista(false)} onVincular={async (ids) => { setLista(false); await registrar([{ tipo: "vincular", atividadeId, equipamentoIds: ids }]); }}
        onCadastrar={podeCadastrar && r.cadastro!.unidadeId ? () => { setLista(false); setCadastro(true); } : undefined} />}
      {cadastro && <ModalCadastroEquipamento r={r} x={x} endereco={c.endereco} onFechar={() => setCadastro(false)} registrar={registrar} />}
      {fotoServico && <ModalFotoServico x={x} endereco={c.endereco} onFechar={() => setFotoServico(false)} registrar={registrar} />}
      {adicional && <ModalAdicional x={x} r={r} a={adicional === "novo" ? null : adicional} onFechar={() => setAdicional(null)} registrar={registrar} />}
      {concluir && <ModalConcluir x={x} onFechar={() => setConcluir(false)} onConcluir={async (resumo) => {
        await registrar([{ tipo: "concluir", atividadeId, dados: resumo ? { resumo } : {} }]);
        setConcluir(false);
      }} onJustificado={async () => { setConcluir(false); await motor?.baixarRetrato(atividadeId); }} />}
    </div>
  );
}

const srcFotoServico = (osId: string, f: FotoServicoTela) => f.local ?? `/api/ordens/${osId}/anexos/${f.id}?inline=1`;

/**
 * Fotos do serviço (fora do checklist): toda foto diz A QUE SE REFERE — um equipamento da OS ou
 * "Geral da OS" — e tem legenda. Vão para "Fotos & Anexos do serviço" da OS (organizadas por equipamento).
 */
function FotosServico({ x, so, onAdicionar, registrar }: { x: ExecucaoTela; so: boolean; onAdicionar: () => void; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const fotos = x.fotosServico ?? [];
  const nomeRef = (id: string | null) => {
    if (!id) return "Geral da OS";
    const e = x.equipamentos.find((q) => q.equipamento.id === id)?.equipamento;
    return e ? [e.titulo, e.fabricante, e.tag && `TAG ${e.tag}`].filter(Boolean).join(" · ") : "Equipamento da OS";
  };
  async function remover(f: FotoServicoTela) {
    const ok = await confirmar({ titulo: "Excluir foto?", mensagem: `A foto “${f.legenda ?? "sem legenda"}” sai desta OS.`, perigo: true, confirmarTexto: "Excluir" });
    if (!ok) return;
    await registrar([{ tipo: "fotoOsRemover", atividadeId: x.atividade.id, dados: f.clientId ? { clientId: f.clientId } : { id: f.id! } }]);
    toast("Foto removida.");
  }
  return (
    <section className="space-y-2" data-fotos-servico>
      <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5"><Camera className="w-4 h-4 text-ink-muted" /> Fotos do serviço</h2>
      {!fotos.length && (
        <p className="rounded-card bg-white border border-surface-border p-3 text-sm text-ink-muted">
          Cada foto vai com o equipamento (ou “Geral da OS”) e uma legenda; checklist e antes/depois ficam lá.
        </p>
      )}
      {fotos.length > 0 && (
        <ul className="space-y-2">
          {fotos.map((f, i) => (
            <li key={f.clientId ?? f.id ?? i} className="rounded-card border border-surface-border bg-white p-2.5 flex gap-3 items-center" data-foto-servico>
              <Miniatura src={srcFotoServico(x.os.id, f)} alt={f.legenda ?? `foto ${i + 1}`} pendente={f.pendente} onRemover={so ? undefined : () => remover(f)} />
              <span className="min-w-0 text-sm">
                <span className="block font-semibold text-ink line-clamp-2">{f.legenda}</span>
                <span className="block text-ink-muted truncate" data-referencia-foto>{nomeRef(f.equipamentoId)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!so && (
        <button type="button" onClick={onAdicionar} data-nova-foto-servico
          className="w-full rounded-card border-2 border-dashed border-primary-300 bg-primary-50 text-primary-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target">
          <Camera className="w-5 h-5" /> Adicionar foto do serviço
        </button>
      )}
    </section>
  );
}

/** Foto do serviço: a QUE SE REFERE (obrigatório) + legenda (obrigatória) + a foto (comprimida no aparelho). Grava no aparelho. */
function ModalFotoServico({ x, endereco, onFechar, registrar }: { x: ExecucaoTela; /** Endereço da OS para a marca d'água */ endereco?: string | null; onFechar: () => void; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const [referencia, setReferencia] = useState("");
  const [legenda, setLegenda] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const pronta = !!referencia && !!limparLegenda(legenda) && !!foto;
  async function salvar() {
    if (!pronta) return;
    await registrar([{
      tipo: "fotoOs", atividadeId: x.atividade.id,
      dados: { dataUrl: foto!, equipamentoId: referencia === REFERENCIA_GERAL ? null : referencia, legenda: legenda.trim(), clientId: novoClientId() },
    }]);
    toast(typeof navigator !== "undefined" && !navigator.onLine ? "Foto guardada no aparelho: sobe sozinha quando houver sinal." : "Foto adicionada à OS.");
    onFechar();
  }
  return (
    <Modal aberto titulo="Foto do serviço" onFechar={onFechar}>
      <div className="space-y-4" data-modal-foto-servico>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">A que esta foto se refere? <span className="text-atrasado">*</span></span>
          <select value={referencia} onChange={(e) => setReferencia(e.target.value)} aria-label="A que a foto se refere" data-referencia
            className="w-full rounded-card border border-surface-border bg-white px-3 py-3 text-base">
            <option value="">Escolha…</option>
            {x.equipamentos.map((e) => (
              <option key={e.equipamento.id} value={e.equipamento.id}>{[e.equipamento.titulo, e.equipamento.fabricante, e.equipamento.tag && `TAG ${e.equipamento.tag}`, e.equipamento.local].filter(Boolean).join(" — ")}</option>
            ))}
            <option value={REFERENCIA_GERAL}>Geral da OS (não é de um equipamento)</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">Legenda <span className="text-atrasado">*</span></span>
          <input value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={LEGENDA_MAX} aria-label="Legenda da foto" data-legenda
            placeholder="Ex.: placa da condensadora" className="w-full rounded-card border border-surface-border px-3 py-3 text-base" />
        </label>
        <div className="space-y-2">
          {foto && <Miniatura src={foto} alt="foto nova" pendente onRemover={() => setFoto(null)} />}
          {!foto && <BotaoFoto grande rotulo="Tirar a foto" marca={{ osNumero: x.os.numero, endereco }} onFoto={setFoto} />}
        </div>
        {!pronta && <p className="text-xs text-ink-muted">Para adicionar: escolha a que a foto se refere, escreva a legenda e tire a foto.</p>}
        <button type="button" disabled={!pronta} onClick={salvar} data-salvar-foto-servico
          className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold disabled:opacity-40 touch-target">Adicionar à OS</button>
      </div>
    </Modal>
  );
}

function ListaUnidade({ r, x, onFechar, onVincular, onCadastrar }: { r: RetratoAtividade; x: ExecucaoTela; onFechar: () => void; onVincular: (ids: string[]) => void; /** Com a permissão: o equipamento que não está na lista é cadastrado em campo */ onCadastrar?: () => void }) {
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
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar por nome, TAG, local" aria-label="Pesquisar equipamento"
            className="w-full rounded-card border border-surface-border pl-9 pr-3 py-3 text-base" />
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
        <button type="button" disabled={!marcados.size} onClick={() => onVincular([...marcados])} className="w-full rounded-card bg-primary-600 text-white py-3 font-semibold disabled:opacity-40 touch-target">
          Vincular {marcados.size || ""}
        </button>
        {onCadastrar && (
          <button type="button" onClick={onCadastrar} data-cadastrar-da-lista className="w-full py-3 text-sm font-semibold text-primary-700 inline-flex items-center justify-center gap-2 touch-target">
            <Plus className="w-5 h-5" /> Não está na lista? Cadastrar novo
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Foto de serviço adicional: a guardada no aparelho ou, já sincronizada, a do servidor (rota própria — não é a das fotos de equipamento). */
export const srcFotoAdicional = (f: { id: string | null; local?: string }) => f.local ?? `/api/servicos-adicionais/fotos/${f.id}`;

/** Serviço extra: entra na MESMA OS e no MESMO relatório (destacado como "Adicional"); o escritório avalia a cobrança. */
function ModalAdicional({ x, r, a, onFechar, registrar }: { x: ExecucaoTela; r: RetratoAtividade; a: AdicionalTela | null; onFechar: () => void; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const atividadeId = x.atividade.id;
  const [descricao, setDescricao] = useState(a?.descricao ?? "");
  const [equipamentoId, setEquipamentoId] = useState(a?.equipamentoId ?? "");
  const [fotosNovas, setFotosNovas] = useState<string[]>([]);
  const ref = a?.clientId ? { clientId: a.clientId } : a?.id ? { id: a.id } : null;
  // G13: "Split Hi-Wall" 2× não diz qual é qual — a TAG e o local diferenciam no select
  const rotuloEquip = (q: { titulo: string; tag?: string | null; local?: string | null }) =>
    [q.titulo, [q.tag && `TAG ${q.tag}`, q.local].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
  const opcoes = [
    ...x.equipamentos.map((e) => ({ id: e.equipamento.id, titulo: rotuloEquip(e.equipamento) })),
    ...r.equipamentosUnidade.filter((u) => !x.equipamentos.some((e) => e.equipamento.id === u.id)).map((u) => ({ id: u.id, titulo: rotuloEquip(u) })),
  ];
  async function salvar() {
    const clientId = a?.clientId ?? (a?.id ? undefined : novoClientId());
    const ops: NovaOperacao[] = [{ tipo: "adicional", atividadeId, dados: { ...(clientId ? { clientId } : { id: a!.id! }), descricao: descricao.trim(), equipamentoId: equipamentoId || null } }];
    for (const d of fotosNovas) ops.push({ tipo: "adicionalFoto", atividadeId, dados: { ...(clientId ? { servicoClientId: clientId } : { servicoId: a!.id! }), dataUrl: d, clientId: novoClientId() } });
    await registrar(ops);
    onFechar();
  }
  // O escritório já avaliou a cobrança: o técnico só consulta (não altera nem tira o que tem decisão do escritório)
  if (a && adicionalAvaliado(a)) {
    const eq = opcoes.find((o) => o.id === a.equipamentoId);
    return (
      <Modal aberto titulo="Serviço extra" onFechar={onFechar}>
        <div className="space-y-4" data-modal-adicional data-somente-leitura>
          <p className="rounded-card bg-surface-alt border border-surface-border px-3 py-2 text-sm text-ink" data-adicional-avaliado>
            O escritório já avaliou a cobrança deste serviço. Para alterar ou tirar, fale com o escritório.
          </p>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink-muted">O que foi feito / pedido</p>
            <p className="text-base text-ink whitespace-pre-line">{a.descricao}</p>
          </div>
          {eq && <p className="text-sm text-ink-muted">Equipamento: <span className="text-ink font-semibold">{eq.titulo}</span></p>}
          {a.fotos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {a.fotos.map((f, i) => <Miniatura key={f.clientId ?? f.id ?? i} src={srcFotoAdicional(f)} alt={`foto ${i + 1}`} pendente={!f.id} />)}
            </div>
          )}
          <button type="button" onClick={onFechar} className="w-full rounded-card border border-surface-border bg-white py-3 font-semibold text-ink touch-target">Fechar</button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal aberto titulo={a ? "Serviço extra" : "Adicionar serviço extra"} onFechar={onFechar}>
      <div className="space-y-4" data-modal-adicional>
        <p className="text-sm text-ink-muted">O cliente pediu algo a mais nesta visita? Registre aqui: entra nesta OS e no relatório como <b>Adicional</b>. Não cria outra OS — o escritório decide a cobrança.</p>
        <ObservacaoVoz rotulo="O que foi feito / pedido" obrigatoria valor={descricao} onSalvar={setDescricao} aoDigitar={setDescricao} placeholder="Ex.: troca do controle remoto da sala 2" />
        <label className="block space-y-1">
          <span className="text-sm font-semibold text-ink">Equipamento (opcional)</span>
          <select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)} className="w-full rounded-card border border-surface-border bg-white px-3 py-3 text-base" aria-label="Equipamento do serviço extra">
            <option value="">Nenhum</option>
            {opcoes.map((o) => <option key={o.id} value={o.id}>{o.titulo}</option>)}
          </select>
        </label>
        <div className="space-y-2">
          <span className="text-sm font-semibold text-ink">Fotos</span>
          <div className="flex flex-wrap gap-2">
            {a?.fotos.map((f, i) => <Miniatura key={f.clientId ?? f.id ?? i} src={srcFotoAdicional(f)} alt={`foto ${i + 1}`} pendente={!f.id}
              onRemover={() => registrar([{ tipo: "adicionalFotoRemover", atividadeId, dados: f.clientId ? { clientId: f.clientId } : { id: f.id! } }])} />)}
            {fotosNovas.map((d, i) => <Miniatura key={`n${i}`} src={d} alt={`foto nova ${i + 1}`} pendente onRemover={() => setFotosNovas((l) => l.filter((_, j) => j !== i))} />)}
          </div>
          <BotaoFoto rotulo="Foto do serviço extra" marca={{ osNumero: x.os.numero, endereco: r.cartao.endereco }} onFoto={(d) => setFotosNovas((l) => [...l, d])} />
        </div>
        <button type="button" disabled={descricao.trim().length < 3} onClick={salvar} data-salvar-adicional className="w-full rounded-card bg-acento text-white py-4 text-base font-bold disabled:opacity-40 touch-target">
          {a ? "Salvar" : "Adicionar à OS"}
        </button>
        {a && ref && (
          <button type="button" onClick={async () => { await registrar([{ tipo: "adicionalRemover", atividadeId, dados: ref }]); onFechar(); }}
            className="w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-atrasado py-2 touch-target"><Trash2 className="w-4 h-4" /> Tirar este serviço extra</button>
        )}
      </div>
    </Modal>
  );
}

export function ModalConcluir({ x, onFechar, onConcluir, onJustificado }: { x: ExecucaoTela; onFechar: () => void; onConcluir: (resumo: string) => void; onJustificado: () => void }) {
  const [resumo, setResumo] = useState("");
  const { config } = useTecnico();
  const c = x.conclusao;
  // "Campo de conclusão obrigatório": sem o resumo, não conclui
  const faltaResumo = config.conclusaoObrigatoria && !resumo.trim();
  return (
    <Modal aberto titulo="Concluir atividade" onFechar={onFechar}>
      {!c.ok ? (
        <div className="space-y-3" data-pendencias>
          <p className="text-sm font-semibold text-atrasado-texto">Ainda não dá para concluir:</p>
          {c.semEquipamento
            ? (
              <div className="space-y-3">
                <p className="text-sm text-ink">{c.mensagem}</p>
                {/* Exceção justificada: precisa de sinal (o motivo vai direto para o escritório) */}
                {typeof navigator !== "undefined" && navigator.onLine && (
                  <ConcluirSemEquipamento osId={x.os.id} atividadeId={x.atividade.id} onConcluido={onJustificado}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-card border border-atencao/20 bg-atencao-claro text-atencao-texto py-3 font-semibold touch-target" />
                )}
              </div>
            )
            : (
              <ul className="space-y-2">
                {c.pendencias.map((p) => (
                  <li key={p.equipamentoId}>
                    <button type="button" onClick={() => { onFechar(); irPara({ ver: "os", a: x.atividade.id, e: p.equipamentoId }); }}
                      className="w-full text-left rounded-card border border-atrasado/20 bg-atrasado-claro p-3 text-sm">
                      <span className="block font-semibold text-ink">{p.titulo}</span>
                      <span className="block text-atrasado-texto">{textoFaltas(p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          <button type="button" onClick={onFechar} className="w-full rounded-card border border-surface-border py-3 font-semibold touch-target">Voltar</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink">{c.atendidos === 1 ? "1 equipamento atendido" : `${c.atendidos} equipamentos atendidos`}{c.naoAtendidos ? ` · ${c.naoAtendidos} não atendido${c.naoAtendidos > 1 ? "s" : ""}` : ""}{x.adicionais.length ? ` · ${x.adicionais.length} serviço${x.adicionais.length > 1 ? "s" : ""} extra` : ""}.</p>
          <ObservacaoVoz rotulo={config.conclusaoObrigatoria ? "Resumo para o escritório (obrigatório)" : "Resumo para o escritório (opcional)"} obrigatoria={config.conclusaoObrigatoria} valor={resumo} onSalvar={setResumo} aoDigitar={setResumo} />
          {faltaResumo && <p className="text-xs text-ink-muted" data-falta-resumo>Preencha o resumo da conclusão para concluir a atividade.</p>}
          <button type="button" disabled={faltaResumo} onClick={() => onConcluir(resumo.trim())} data-confirmar-conclusao className="w-full rounded-card bg-success-600 text-white py-4 text-base font-bold touch-target disabled:opacity-40">Concluir atividade</button>
        </div>
      )}
    </Modal>
  );
}
