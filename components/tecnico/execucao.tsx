"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Camera, CheckCircle2, ChevronRight, CircleDashed, ClipboardCheck, HardDrive, ListPlus, Loader2, MapPin, MessageCircle, Pencil, Phone, Plus, QrCode, Search, Sparkles, Trash2, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { confirmar, toast } from "@/components/ui/avisos";
import { ScannerQR } from "@/components/os/scanner-qr";
import { BotaoFoto, Miniatura, ObservacaoVoz } from "@/components/tecnico/captura";
import { irPara, useAtividade, useTecnico } from "@/components/tecnico/contexto";
import { BotaoRota, RotaSemEndereco } from "@/components/tecnico/rota";
import { OQueLevarDaOs } from "@/components/tecnico/o-que-levar";
import { ModalCadastroEquipamento } from "@/components/tecnico/cadastro-equipamento";
import { ChegadaNaOs, useAgora } from "@/components/tecnico/aviso-cliente";
import { AceiteNaOs } from "@/components/tecnico/aceite-cliente";
import { EnviarRelatorio } from "@/components/tecnico/relatorio-cliente";
import { CameraRapida, useRapida } from "@/components/tecnico/camera-rapida";
import { ConferenciaRapida } from "@/components/tecnico/conferencia-rapida";
import { MateriaisUsados } from "@/components/tecnico/materiais";
import { SeloGarantia } from "@/components/tecnico/garantia";
import { ComentariosDaOs } from "@/components/tecnico/comentarios";
import { BotaoLancarDespesa } from "@/components/tecnico/despesas";
import { MSG_SEM_UNIDADE } from "@/lib/tecnico/cadastro-equipamento";
import { ConcluirSemEquipamento } from "@/components/os/concluir-sem-equipamento";
import { srcFoto, TelaEquipamento } from "@/components/tecnico/equipamento";
import { CartaoAtividade, ROTULO_STATUS_ATIVIDADE, SeloPrazo } from "@/components/tecnico/meu-dia";
import { guardadoDoRetrato, podeEntrar } from "@/lib/tecnico/chegada";
import { adicionalAvaliado, equipamentoDoQr, proximoEquipamento } from "@/lib/tecnico/offline/estado";
import { novoClientId } from "@/lib/tecnico/offline/motor";
import { textoFaltas } from "@/lib/execucao/pendencias";
import { LEGENDA_MAX, limparLegenda, MSG_LEGENDA, REFERENCIA_GERAL } from "@/lib/os/galeria";
import { osEncerrada } from "@/lib/os/prazo-execucao";
import type { AdicionalTela, EquipamentoTela, ExecucaoTela, FotoServicoTela, NovaOperacao, OperacaoFila, RetratoAtividade } from "@/lib/tecnico/offline/tipos";
import { Dica } from "@/components/ui/dica";
import { InputHora } from "@/components/ui/input-hora";
import { FaixaAndamento, inicioLocal } from "@/components/tecnico/andamento";
import { descricaoParaApp } from "@/lib/tecnico/cartao";
import { detalhesDaOs, linkTelefone, linkWhatsapp, PRIORIDADE_DESTAQUE, resumoEquipamentos } from "@/lib/tecnico/topo-os";
import { horarioNoDia, MSG_TERMINO_FORA, situacaoAndamento, sugerirTermino, tempoSuspeito, terminoValido, ultimaDe } from "@/lib/tecnico/andamento";
import { chaveDiaBR, horaBR } from "@/lib/fuso";
import { LABELS_PRIORIDADE } from "@/lib/utils";

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
export function VistaOs({ atividadeId, equipamentoId, camera, incluir, fim, primeiro }: {
  atividadeId: string; equipamentoId?: string | null; /** Abre já na câmera rápida (atalho do Meu dia) */ camera?: boolean;
  /** QR lido no Meu dia: equipamento da unidade fora desta atividade — pergunta se inclui */ incluir?: string | null;
  /** Acabou de concluir o último equipamento: abre já a confirmação da conclusão */ fim?: boolean;
  /** Acabou de chegar ("Cheguei"): segue para o primeiro equipamento a fazer */ primeiro?: boolean;
}) {
  const { retrato, tela, fila, aEnviar, registrar, carregando } = useAtividade(atividadeId);
  // Equipamento no centro: depois do "Cheguei", a OS vai direto ao primeiro equipamento a fazer. A OS fica no
  // histórico (o "voltar" do celular volta a ela); sem equipamento a fazer, fica na OS.
  const pronta = !!tela && podeEntrar(tela.atividade.status, tela.avisos);
  useEffect(() => {
    if (!primeiro || !tela || !pronta) return;
    const id = proximoEquipamento(tela, null);
    irPara({ ver: "os", a: atividadeId }, true);
    if (id) irPara({ ver: "os", a: atividadeId, e: id });
  }, [primeiro, pronta]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // A porta da OS é o "Cheguei" do card: agendada e sem chegada hoje, a execução não abre — por
  // nenhum caminho (link direto, atalho da câmera, voltar do navegador). Em andamento entra direto.
  if (!podeEntrar(tela.atividade.status, tela.avisos)) {
    return (
      <div className="space-y-4" data-vista="os-antes-de-chegar">
        <Voltar />
        <p className="text-sm text-ink-muted" data-trava-chegada>Toque em “Cheguei” para abrir a OS.</p>
        <CartaoAtividade c={retrato.cartao} fila={fila} guardado={guardadoDoRetrato(retrato, Number.MAX_SAFE_INTEGER)} depoisDeChegar={{ e: equipamentoId, inc: incluir }} />
      </div>
    );
  }
  const e = equipamentoId ? tela.equipamentos.find((q) => q.equipamento.id === equipamentoId) : null;
  if (e) return <TelaEquipamento x={tela} e={e} registrar={registrar} endereco={retrato.cartao.endereco}
    qr={retrato.equipamentosUnidade.find((u) => u.id === e.equipamento.id)?.qr?.codigo ?? null} />;
  return <ResumoOs r={retrato} x={tela} fila={fila} aEnviar={aEnviar} registrar={registrar} camera={camera} incluir={incluir} fim={fim} />;
}

function Voltar() {
  return (
    <button type="button" onClick={() => irPara({ ver: "dia" })} className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700 py-1 touch-target">
      <ArrowLeft className="w-4 h-4" /> Meu dia
    </button>
  );
}

function ResumoOs({ r, x, fila, aEnviar, registrar, camera, incluir, fim }: { r: RetratoAtividade; x: ExecucaoTela; fila: OperacaoFila[]; aEnviar: number; registrar: (ops: NovaOperacao[]) => Promise<void>; camera?: boolean; incluir?: string | null; fim?: boolean }) {
  const c = r.cartao;
  const atividadeId = x.atividade.id;
  const { motor, config } = useTecnico();
  const agora = useAgora(); // o selo de prazo é calculado na hora (o retrato fica guardado no aparelho)
  const so = x.bloqueada;
  const [scan, setScan] = useState(false);
  const [lista, setLista] = useState(false);
  const [cadastro, setCadastro] = useState(false);
  // "Permitir cadastrar equipamento em campo" (Equipes › App do colaborador): desligado, o botão nem aparece
  // Retrato antigo (guardado no aparelho antes desta versão) não traz `modulos`: tudo ligado
  const temEquipamentos = r.modulos?.equipamentos !== false;
  const temQr = r.modulos?.qrcodes !== false;
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
  // Concluiu o último equipamento (…&fim=1): com todos atendidos, a confirmação já abre; o atalho sai do endereço
  useEffect(() => {
    if (!fim) return;
    irPara({ ver: "os", a: atividadeId }, true);
    // Só com TODOS atendidos: com algum de fora, concluir é decisão do técnico (o botão de sempre)
    if (!so && x.conclusao.ok && !x.conclusao.naoAtendidos && !aConferir) setConcluir(true);
  }, [fim]); // eslint-disable-line react-hooks/exhaustive-deps
  // Atividade encerrada e nada a conferir: não sobra nada da câmera rápida no aparelho
  useEffect(() => { if (so && !aConferir && rapida.salvos.length) void guardaRapida?.limpar(atividadeId); }, [so, aConferir, rapida.salvos.length, guardaRapida, atividadeId]);
  async function fecharCamera() {
    setCameraAberta(false);
    const s = await guardaRapida?.sessao(atividadeId);
    if (s && (s.fotos.length || s.salvos.length)) setConferindo(true);
  }
  const st = ROTULO_STATUS_ATIVIDADE[x.atividade.status] ?? { rotulo: x.atividade.status, classe: "bg-surface-linha text-ink" };
  const atendidos = x.equipamentos.filter((e) => e.feito).length;
  // Topo: o que fazer, contato e rota (1 toque); o dado de escritório vai para "Detalhes"
  const problema = descricaoParaApp(c.descricao, config);
  const rotaVisivel = config.exibirDadosCliente && (!!c.rota || !!c.cliente);
  const tel = config.exibirContatosCliente ? linkTelefone(c.telefone) : null;
  const whats = config.exibirContatosCliente ? linkWhatsapp(r.whatsapp) : null;
  const detalhes = detalhesDaOs(c, { titulo: x.atividade.titulo !== x.atividade.tipoOs?.nome ? x.atividade.titulo : null, verDados: config.exibirDadosCliente });
  // Atividade esquecida em andamento (no aparelho, sem sinal também)
  const inicio = inicioLocal(c.iniciadaEm, fila, atividadeId);
  const andamento = situacaoAndamento({ status: x.atividade.status, inicio, agora, limiteHoras: r.andamento?.limiteHoras ?? config.alertaAndamentoHoras, jornada: r.andamento?.jornada });

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
      {/* Atividade esquecida em andamento: o aviso fica no topo até concluir */}
      <FaixaAndamento s={andamento} />
      <header className="bg-white rounded-card border border-surface-border overflow-hidden" data-topo-os>
        <div className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-muted">{c.osNumero}{x.atividade.tipoOs ? ` · ${x.atividade.tipoOs.nome}` : ""}</p>
            <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5", st.classe)} data-status={x.atividade.status}>{st.rotulo}</span>
          </div>
          {/* "Exibir dados do cliente" desligado: esconde nome e endereço do cliente (privacidade) */}
          <h1 className="text-xl font-bold text-ink leading-tight">{(config.exibirDadosCliente && c.cliente) || x.atividade.titulo || c.osNumero}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <SeloPrazo prazo={c.prazo} status={x.atividade.status} agora={agora} />
            {PRIORIDADE_DESTAQUE.has(c.prioridade) && <span className="text-xs font-semibold rounded-full px-2 py-0.5 bg-atrasado-claro text-atrasado-texto" data-prioridade-topo={c.prioridade}>{LABELS_PRIORIDADE[c.prioridade]}</span>}
          </div>
          {/* O QUE FAZER: o problema relatado (ou a descrição do serviço) — sempre; sem dados do cliente, sai só quem pediu */}
          {problema && (
            <div className="rounded-lg bg-surface-alt p-3" data-problema>
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{c.chamado ? "Problema relatado" : "O que fazer"}</h2>
              <p className="text-base text-ink whitespace-pre-line break-words" data-descricao>{problema}</p>
            </div>
          )}
          <p className="text-sm text-ink inline-flex items-center gap-1.5" data-resumo-equipamentos><HardDrive className="w-4 h-4 text-ink-subtle" /> {resumoEquipamentos(x.equipamentos.length, atendidos)}</p>
          {config.exibirDadosCliente && c.endereco && <p className="text-sm text-ink flex gap-1.5" data-endereco-topo><MapPin className="w-4 h-4 text-ink-subtle shrink-0 mt-0.5" /> {c.endereco}</p>}
        </div>
        {/* Contato e rota: um toque cada (rota depende do endereço do cliente; ligar e WhatsApp, dos contatos) */}
        {(rotaVisivel || tel || whats) && (
          <div className="grid grid-flow-col auto-cols-fr border-t border-surface-border divide-x divide-surface-border" data-acoes-topo>
            {rotaVisivel && (c.rota ? <BotaoRota rota={c.rota} className="py-4 text-base" /> : <RotaSemEndereco />)}
            {tel && <a href={tel} data-ligar className="inline-flex items-center justify-center gap-2 py-4 text-base font-semibold text-ink active:bg-surface-alt touch-target"><Phone className="w-5 h-5" /> Ligar</a>}
            {whats && <a href={whats} target="_blank" rel="noopener noreferrer" data-whatsapp-topo className="inline-flex items-center justify-center gap-2 py-4 text-base font-semibold text-ink active:bg-surface-alt touch-target"><MessageCircle className="w-5 h-5" /> WhatsApp</a>}
          </div>
        )}
        {/* Dado de escritório e materiais previstos: recolhido */}
        {(detalhes.length > 0 || (config.oQueLevar && (c.materiais?.length ?? 0) > 0)) && (
          <details className="border-t border-surface-border group" data-detalhes-os>
            <summary className="list-none cursor-pointer px-4 py-3 text-sm font-semibold text-primary-700 inline-flex items-center gap-1.5 w-full touch-target">
              <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" /> Detalhes
            </summary>
            <div className="px-4 pb-4 space-y-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                {detalhes.map((d) => (
                  <div key={d.rotulo} className="contents" data-detalhe={d.rotulo}>
                    <dt className="text-ink-muted">{d.rotulo}</dt>
                    <dd className="text-ink whitespace-pre-line break-words" {...(d.rotulo === "Orientação do escritório" && { "data-orientacao": "" })}>{d.valor}</dd>
                  </div>
                ))}
              </dl>
              <OQueLevarDaOs c={c} recolhido className="bg-surface-alt rounded-lg px-2.5" />
            </div>
          </details>
        )}
      </header>

      <ChegadaNaOs r={r} x={x} />

      <ComentariosDaOs x={x} registrar={registrar} />

      {!so && (
        <section className="space-y-2" data-camera-rapida-atalho>
          <button type="button" onClick={() => setCameraAberta(true)} data-abrir-camera-rapida
            className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold shadow-card inline-flex items-center justify-center gap-2 touch-target">
            <Camera className="w-6 h-6" /> Câmera rápida
          </button>
          <p className="text-xs text-ink-muted inline-flex items-center gap-1">Fotos com a etiqueta QR <Dica rotulo="Câmera rápida" texto="Fotografe com a etiqueta QR junto: o app põe cada foto no equipamento certo. As fotos sem etiqueta ficam para conferir no fim." /></p>
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
      {/* Concluiu a atividade que fecha a OS: é a hora do aceite do cliente (assina aqui ou recebe o link) */}
      <AceiteNaOs r={r} x={x} aEnviar={aEnviar} registrar={registrar} />
      {/* Concluída: o relatório da visita ao cliente, pelo WhatsApp (espera a conclusão subir) */}
      <EnviarRelatorio r={r} x={x} aEnviar={aEnviar} />
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
                    <SeloGarantia fim={e.equipamento.garantiaAte} className="mt-1" />
                  </span>
                  <span className={cn("text-xs font-semibold rounded-full px-2 py-0.5 shrink-0", s.classe)}>{s.rotulo}</span>
                  <ChevronRight className="w-5 h-5 text-ink-subtle shrink-0" />
                </button>
              </li>
            );
          })}
        </ul>
        {/* Campos-ponte do app: "Ler QR Code" é do módulo QR Codes; "Da lista", do Equipamentos */}
        {!so && (temQr || temEquipamentos) && (
          <div className={cn("grid gap-2", temQr && temEquipamentos ? "grid-cols-2" : "grid-cols-1")}>
            {temQr && <button type="button" onClick={() => setScan(true)} className="rounded-card border border-primary-200 bg-primary-50 text-primary-700 py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target"><QrCode className="w-5 h-5" /> Ler QR Code</button>}
            {temEquipamentos && <button type="button" onClick={() => setLista(true)} className="rounded-card border border-surface-border bg-white text-ink py-3 text-sm font-semibold inline-flex items-center justify-center gap-2 touch-target"><ListPlus className="w-5 h-5" /> Da lista</button>}
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

      <MateriaisUsados x={x} registrar={registrar} nomeEquipamento={(id) => x.equipamentos.find((e) => e.equipamento.id === id)?.equipamento.titulo ?? null} />

      <BotaoLancarDespesa atividadeId={atividadeId} osNumero={x.os.numero} />

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

      {incluir && !so && <IncluirPeloQr r={r} x={x} equipamentoId={incluir} registrar={registrar} />}
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
      {concluir && <ModalConcluir x={x} tempo={{ inicio, ultima: ultimaGravacaoLocal(r, fila), limite: r.andamento?.limiteHoras ?? config.alertaAndamentoHoras }}
        onFechar={() => setConcluir(false)} onConcluir={async (resumo, terminoEm) => {
        await registrar([{ tipo: "concluir", atividadeId, dados: { ...(resumo ? { resumo } : {}), ...(terminoEm ? { terminoEm } : {}) } }]);
        setConcluir(false);
      }} onJustificado={async () => { setConcluir(false); await motor?.baixarRetrato(atividadeId); }} />}
    </div>
  );
}

/**
 * QR lido no Meu dia de um equipamento da unidade que NÃO está nesta atividade: o app pergunta antes de
 * incluir (nada entra sozinho). Incluir fica no histórico da OS e abre o equipamento; "Agora não" volta à OS.
 */
function IncluirPeloQr({ r, x, equipamentoId, registrar }: { r: RetratoAtividade; x: ExecucaoTela; equipamentoId: string; registrar: (ops: NovaOperacao[]) => Promise<void> }) {
  const atividadeId = x.atividade.id;
  const ja = x.equipamentos.some((e) => e.equipamento.id === equipamentoId);
  const u = r.equipamentosUnidade.find((q) => q.id === equipamentoId);
  const [gravando, setGravando] = useState(false);
  // Já está na atividade (ex.: incluído agora há pouco): vai direto para ele
  useEffect(() => { if (ja) irPara({ ver: "os", a: atividadeId, e: equipamentoId }, true); }, [ja, atividadeId, equipamentoId]);
  if (ja || !u) return null;
  const fechar = () => irPara({ ver: "os", a: atividadeId }, true);
  async function incluirAgora() {
    setGravando(true);
    try {
      await registrar([{ tipo: "vincular", atividadeId, equipamentoIds: [equipamentoId], origem: "qr" }]);
      irPara({ ver: "os", a: atividadeId, e: equipamentoId }, true);
    } finally { setGravando(false); }
  }
  return (
    <Modal aberto titulo="Incluir nesta atividade?" onFechar={fechar}>
      <div className="space-y-4" data-incluir-qr={equipamentoId}>
        <div className="rounded-card border border-surface-border bg-surface-alt p-3">
          <p className="font-semibold text-ink">{u.titulo}</p>
          <p className="text-sm text-ink-muted">{[u.tipo?.nome, u.tag && `TAG ${u.tag}`, u.local].filter(Boolean).join(" · ")}</p>
        </div>
        <p className="text-sm text-ink">{x.os.numero} · {x.atividade.titulo}</p>
        <button type="button" onClick={incluirAgora} disabled={gravando} data-confirmar-incluir
          className="w-full rounded-card bg-primary-600 text-white py-4 text-base font-bold disabled:opacity-60 touch-target">Incluir e abrir</button>
        <button type="button" onClick={fechar} className="w-full rounded-card border border-surface-border bg-white py-3 font-semibold text-ink touch-target">Agora não</button>
      </div>
    </Modal>
  );
}

function OpcaoTermino({ ativo, onClick, chave, children }: { ativo: boolean; onClick: () => void; chave: string; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={ativo} onClick={onClick} data-opcao-termino={chave}
      className={cn("w-full text-left rounded-card border-2 px-3 py-3 text-base font-semibold tabular-nums touch-target", ativo ? "border-primary-600 bg-primary-50 text-ink" : "border-surface-border bg-white text-ink")}>
      {children}
    </button>
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
  // A LEGENDA se corrige enquanto a OS não estiver encerrada (também com a atividade concluída); depois, só o escritório
  const podeLegenda = !osEncerrada(x.os.status);
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const chaveDe = (f: FotoServicoTela) => f.clientId ?? f.id ?? "";
  async function salvarLegenda(f: FotoServicoTela) {
    const legenda = limparLegenda(texto);
    if (!legenda) { toast(MSG_LEGENDA, "erro"); return; }
    setEditando(null);
    if (legenda === f.legenda) return;
    await registrar([{ tipo: "fotoOsLegenda", atividadeId: x.atividade.id, dados: { ...(f.clientId ? { clientId: f.clientId } : { id: f.id! }), legenda } }]);
    toast("Legenda atualizada.");
  }
  return (
    <section className="space-y-2" data-fotos-servico>
      <h2 className="text-base font-bold text-ink inline-flex items-center gap-1.5"><Camera className="w-4 h-4 text-ink-muted" /> Fotos do serviço
        <Dica rotulo="Fotos do serviço" texto="Cada foto vai com o equipamento (ou “Geral da OS”) e uma legenda. As do checklist e as de antes/depois ficam no equipamento." />
      </h2>

      {fotos.length > 0 && (
        <ul className="space-y-2">
          {fotos.map((f, i) => (
            <li key={f.clientId ?? f.id ?? i} className="rounded-card border border-surface-border bg-white p-2.5 flex gap-3 items-center" data-foto-servico>
              <Miniatura src={srcFotoServico(x.os.id, f)} alt={f.legenda ?? `foto ${i + 1}`} pendente={f.pendente} onRemover={so ? undefined : () => remover(f)} />
              {editando === chaveDe(f) ? (
                <span className="min-w-0 flex-1 space-y-2">
                  <input value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={LEGENDA_MAX} aria-label="Legenda da foto" data-legenda-editar autoFocus
                    className="w-full rounded-lg border border-surface-border px-3 py-2 text-base" />
                  <span className="flex gap-2">
                    <button type="button" onClick={() => salvarLegenda(f)} className="btn-primary flex-1 touch-target" data-legenda-salvar>Salvar</button>
                    <button type="button" onClick={() => setEditando(null)} className="btn-secondary flex-1 touch-target">Cancelar</button>
                  </span>
                </span>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-semibold text-ink line-clamp-2">{f.legenda}</span>
                    <span className="block text-ink-muted truncate" data-referencia-foto>{nomeRef(f.equipamentoId)}</span>
                  </span>
                  {podeLegenda && (
                    <button type="button" onClick={() => { setTexto(f.legenda ?? ""); setEditando(chaveDe(f)); }} aria-label="Editar legenda" data-legenda-editar-abrir
                      className="shrink-0 p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-alt touch-target">
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </>
              )}
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

/** Gravações da execução (as que dizem que o técnico estava trabalhando): base do término sugerido */
const TIPOS_DE_TRABALHO = new Set(["resposta", "audio", "tudoOk", "foto", "equipamento", "formulario", "scan", "vincular", "cadastrarEquipamento", "adicional", "adicionalFoto", "fotoOs", "material"]);
/** A última gravação: a do servidor ou a mais recente no aparelho (sem sinal também). */
export function ultimaGravacaoLocal(r: RetratoAtividade, fila: OperacaoFila[]): Date | null {
  return ultimaDe([r.andamento?.ultimaGravacaoEm, ...fila.filter((o) => o.atividadeId === r.execucao.atividade.id && TIPOS_DE_TRABALHO.has(o.tipo)).map((o) => o.em ?? o.criadoEm)]);
}

type TempoConclusao = { inicio: string | null; ultima: Date | null; limite: number };

export function ModalConcluir({ x, tempo, onFechar, onConcluir, onJustificado }: {
  x: ExecucaoTela; /** Início, última gravação e limite: para o término sugerido quando o tempo é suspeito */ tempo?: TempoConclusao;
  onFechar: () => void; onConcluir: (resumo: string, terminoEm?: string) => void; onJustificado: () => void;
}) {
  const [resumo, setResumo] = useState("");
  const { config } = useTecnico();
  const c = x.conclusao;
  // Tempo suspeito (esqueceu de concluir): sugere a última gravação como término; o técnico confirma ou corrige
  const [abertoEm] = useState(() => Date.now());
  const suspeito = !!tempo && tempoSuspeito(tempo.inicio, abertoEm, tempo.limite);
  const sugerido = suspeito ? sugerirTermino(tempo!.inicio, tempo!.ultima, abertoEm) : null;
  const [escolha, setEscolha] = useState<"sugerido" | "agora" | "outro">(sugerido ? "sugerido" : "outro");
  const [outro, setOutro] = useState(sugerido ? horaBR(sugerido) : "");
  const outroEm = escolha === "outro" ? horarioNoDia(outro, tempo?.inicio && chaveDiaBR(tempo.inicio) !== chaveDiaBR(abertoEm) ? new Date(tempo.inicio) : abertoEm) : null;
  const outroOk = !!outroEm && terminoValido(outroEm, tempo?.inicio ?? null, abertoEm);
  const terminoEm = !suspeito || escolha === "agora" ? undefined : escolha === "sugerido" ? sugerido?.toISOString() : outroOk ? outroEm!.toISOString() : undefined;
  const faltaTermino = suspeito && escolha === "outro" && !outroOk;
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
          {suspeito && (
            <fieldset className="space-y-2" data-termino>
              <legend className="text-sm font-semibold text-ink inline-flex items-center gap-1">Horário de término
                <Dica rotulo="Horário de término" texto={`A atividade está em andamento desde ${tempo!.inicio ? `${horaBR(tempo!.inicio)}${chaveDiaBR(tempo!.inicio) !== chaveDiaBR(abertoEm) ? ` de ${chaveDiaBR(tempo!.inicio).split("-").reverse().slice(0, 2).join("/")}` : ""}` : "antes"}. Confirme quando o serviço terminou de verdade: vale para o relatório e o desempenho.`} />
              </legend>
              {sugerido && (
                <OpcaoTermino ativo={escolha === "sugerido"} onClick={() => setEscolha("sugerido")} chave="sugerido">
                  {horaBR(sugerido)} <span className="font-normal text-ink-muted">· última gravação</span>
                </OpcaoTermino>
              )}
              <OpcaoTermino ativo={escolha === "agora"} onClick={() => setEscolha("agora")} chave="agora">{horaBR(abertoEm)} <span className="font-normal text-ink-muted">· agora</span></OpcaoTermino>
              <OpcaoTermino ativo={escolha === "outro"} onClick={() => setEscolha("outro")} chave="outro">Outro horário</OpcaoTermino>
              {escolha === "outro" && (
                <div data-termino-outro>
                  <InputHora value={outro} onChange={setOutro} aria-label="Horário de término" invalido={!!outro && !outroOk} className="text-lg" />
                </div>
              )}
              {escolha === "outro" && outro && !outroOk && <p className="text-xs text-atrasado-texto" data-termino-invalido>{MSG_TERMINO_FORA}</p>}
            </fieldset>
          )}
          <button type="button" disabled={faltaResumo || faltaTermino} onClick={() => onConcluir(resumo.trim(), terminoEm)} data-confirmar-conclusao className="w-full rounded-card bg-success-600 text-white py-4 text-base font-bold touch-target disabled:opacity-40">Concluir atividade</button>
        </div>
      )}
    </Modal>
  );
}
