"use client";

import { useState, useEffect, useRef } from "react";
import { useAvisoSairSemSalvar } from "@/components/ui/proteger-saida";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { ErrosDoFormulario, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import type { ErrosDeCampo } from "@/lib/forms/erros";
import { LABELS_PRIORIDADE } from "@/lib/utils";
import { EditarNoContexto, SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, UNIDADE, EQUIPAMENTO, TIPO_OS } from "@/components/cadastro-rapido/definicoes";
import type { OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import { Inbox, Link2, Wrench, X } from "lucide-react";
import { SeletorExecucao, VALOR_EXECUCAO_VAZIO, aplicarExecutor, corpoExecucao, temExecutor, useOpcoesExecucao, type ValorExecucao } from "@/components/os/seletor-execucao";
import { Sugestao, useSugestoesAbertura } from "@/components/os/sugestao-abertura";
import { MSG_SEM_EXECUTOR_TELA } from "@/lib/atividade-equipe";
import { GavetaEquipamentos } from "@/components/os/gaveta-equipamentos";
import { useModulos } from "@/components/providers/modulos-provider";
import { detalheEquipamento, rotuloEquipamento, type EquipamentoResumo } from "@/lib/os/vincular-equipamentos";
import { InputData } from "@/components/ui/input-data";
import { InputDataHora } from "@/components/ui/input-data-hora";
import { chaveDiaCivil, paraLocalBR } from "@/lib/fuso";
import { useAgora } from "@/lib/ui/use-agora";
import { prazoPadrao } from "@/lib/os/prazo-execucao";
import { AlertaPerdasCliente, type PerdasCliente } from "@/components/financeiro/alerta-perdas-cliente";

type Item = { id: string; nome: string; nomeFantasia?: string | null };
type UnidadeItem = { id: string; nome: string; cidade?: string | null };
type ContratoItem = { id: string; numero: string };
type EquipItem = { id: string; nome?: string | null; marca: string; modelo: string; unidadeId?: string; unidade?: { id: string; nome: string } | null };
type Solicitacao = { id: string; numero: string; cliente: string; pendente: boolean; equipamentoCliente: string | null; equipamentoRotulo: string | null };

const rotuloEquip = (e: EquipItem) => {
  const base = `${e.marca} ${e.modelo}`.trim();
  return e.nome ? `${e.nome} — ${base}` : base;
};
const opcaoEquip = (e: EquipItem): OpcaoCadastro => ({ value: e.id, label: rotuloEquip(e), descricao: e.unidade?.nome });

/** Princípio 7: a regra de vínculo dos equipamentos fica no ⓘ da seção */
const DICA_EQUIPAMENTOS = "Opcional na abertura: os equipamentos podem ser vinculados durante a execução, pelo QR Code ou pela lista. Para concluir a OS, ao menos um equipamento precisa ser atendido, com o checklist respondido.";

export default function NovaOrdemPage() {
  // Sair sem salvar (lib/ui/sair-sem-salvar): o aviso de toda tela de edição
  const raizRef = useRef<HTMLDivElement>(null);
  useAvisoSairSemSalvar(raizRef);
  const router = useRouter();
  // Campo-ponte: a empresa sem o módulo Equipamentos não vê vínculo nem seletor de equipamento
  const temEquipamentos = useModulos().tem("equipamentos");
  const [clientes, setClientes] = useState<Item[]>([]);
  const [unidades, setUnidades] = useState<UnidadeItem[]>([]);
  const [contratos, setContratos] = useState<ContratoItem[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [carregandoUnidades, setCarregandoUnidades] = useState(false);
  // ERRO NO CAMPO: cada erro no campo dele (cliente, data/hora, quem executa, descrição); a faixa é o resumo
  const erros = useErrosDoFormulario();
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    prioridade: "NORMAL", descricao: "", unidadeId: "", contratoId: "",
    prazoExecucao: "", observacoes: "",
  });
  // Modo "aceitar solicitação" (vindo da gaveta de Solicitações do calendário):
  // a MESMA OS do chamado é agendada — nada de OS nova.
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(null);
  const [carregandoSolicitacao, setCarregandoSolicitacao] = useState(false);
  const [dataHora, setDataHora] = useState("");
  // Quem executa (OBRIGATÓRIO) + veículo — vira a 1ª atividade da OS
  const opcoesExecucao = useOpcoesExecucao();
  const [execucao, setExecucao] = useState<ValorExecucao>(VALOR_EXECUCAO_VAZIO);
  const [faltaExecutor, setFaltaExecutor] = useState(false);
  const [tiposOs, setTiposOs] = useState<{ id: string; nome: string; ativo: boolean; prazoExecucaoDias?: number | null }[]>([]);
  const [tipoOsId, setTipoOsId] = useState("");
  const [agendarPara, setAgendarPara] = useState("");
  // PRAZO SUGERIDO pelo tipo de OS: o dia agendado + os dias do tipo. Enquanto a pessoa não mexe no
  // campo, ele acompanha o tipo e o agendamento; depois que ela digita (ou apaga), vale o que ela pôs.
  const [prazoMexido, setPrazoMexido] = useState(false);
  // CHAMADO DO CLIENTE (OS lançada à mão): a hora em que ele pediu — é dela que conta o prazo de atendimento do contrato
  const [chamado, setChamado] = useState(false);
  // A hora de abertura do chamado é a do sistema (o servidor grava ao salvar): aqui ela só é mostrada
  const agora = useAgora();
  const diasDoTipo = tiposOs.find((t) => t.id === tipoOsId)?.prazoExecucaoDias ?? null;
  const sugerido = prazoPadrao(agendarPara || null, diasDoTipo);
  const prazoSugerido = sugerido ? chaveDiaCivil(sugerido) : "";
  useEffect(() => {
    if (!prazoMexido) setForm((f) => (f.prazoExecucao === prazoSugerido ? f : { ...f, prazoExecucao: prazoSugerido }));
  }, [prazoSugerido, prazoMexido]);
  // Data escolhida sem hora válida: não salva (nada de 08:00 escondido nem de hora anterior valendo)
  const [horaRuim, setHoraRuim] = useState<string | null>(null);
  const aoProblemaHora = (p: string | null) => { setHoraRuim(p); if (!p) { erros.limpar("dataHora"); erros.limpar("agendarPara"); } };
  const [equipamentoId, setEquipamentoId] = useState("");
  const [equipamentos, setEquipamentos] = useState<EquipItem[]>([]);
  // Equipamentos atendidos (opcional na abertura; dá para vincular na execução) — escolhidos na gaveta
  const [atendidos, setAtendidos] = useState<EquipamentoResumo[]>([]);
  const [gavetaAberta, setGavetaAberta] = useState(false);
  const [avisoSemCliente, setAvisoSemCliente] = useState(false);
  const [verTodosAtendidos, setVerTodosAtendidos] = useState(false);
  // Princípio 9: o histórico do cliente SUGERE o tipo e quem executa — nada é preenchido no escuro
  const sugestoes = useSugestoesAbertura(clienteId);
  // o mesmo tipo que o seletor usa para filtrar por competência (na solicitação, nenhum)
  const tipoDoFiltro = solicitacao ? "" : tipoOsId;
  const execSugerido = sugestoes.executor ? aplicarExecutor(sugestoes.executor, opcoesExecucao, tipoDoFiltro) : null;

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(Array.isArray(d) ? d : [])).catch(() => {})
      .finally(() => setCarregandoClientes(false));
    fetch("/api/tipos-os").then((r) => (r.ok ? r.json() : [])).then((d) => setTiposOs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Pré-preenchimento opcional via URL (ex.: "Abrir OS" na ficha do equipamento)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const solId = sp.get("solicitacao");
    if (solId) {
      setCarregandoSolicitacao(true);
      fetch(`/api/ordens/${solId}`).then(async (r) => {
        const os = await r.json().catch(() => null);
        if (!r.ok || !os) { erros.definirGeral(os?.erro ?? "Solicitação não encontrada."); return; }
        const pendente = os.origem === "PORTAL_CLIENTE" && os.status === "AGUARDANDO_ATENDIMENTO";
        setSolicitacao({ id: os.id, numero: os.chamadoNumero ?? os.numero, cliente: os.cliente?.nomeFantasia ?? os.cliente?.nome ?? "", pendente, equipamentoCliente: os.equipamentoId ?? null, equipamentoRotulo: os.equipamento ? rotuloEquip(os.equipamento) : null });
        if (!pendente) erros.definirGeral("Esta solicitação já foi tratada (aceita ou recusada).");
        setClienteId(os.clienteId);
        setEquipamentoId(os.equipamentoId ?? "");
        setForm((f) => ({
          ...f, descricao: os.descricao ?? "", unidadeId: os.unidadeId ?? "", prioridade: os.prioridade ?? "NORMAL",
          contratoId: os.contratoId ?? "", observacoes: os.observacoes ?? "",
        }));
      }).catch(() => erros.definirGeral("Erro de conexão.")).finally(() => setCarregandoSolicitacao(false));
      return;
    }
    const cli = sp.get("clienteId");
    if (cli) setClienteId(cli);
    const unidadeId = sp.get("unidadeId") ?? "";
    const descricao = sp.get("descricao") ?? "";
    if (unidadeId || descricao) setForm((f) => ({ ...f, unidadeId: unidadeId || f.unidadeId, descricao: descricao || f.descricao }));
  }, []);

  useEffect(() => {
    if (!clienteId) { setUnidades([]); setContratos([]); return; }
    setCarregandoUnidades(true);
    fetch(`/api/unidades?clienteId=${clienteId}`).then((r) => r.json()).then((d) => setUnidades(Array.isArray(d) ? d : [])).catch(() => {})
      .finally(() => setCarregandoUnidades(false));
    fetch(`/api/contratos?clienteId=${clienteId}`).then((r) => r.json()).then(setContratos).catch(() => {});
  }, [clienteId]);

  // Aviso antes de atender: o cliente teve perda (inadimplência) nos últimos 12 meses — só informa.
  // Sem permissão para ver o cliente (403) ou erro: nenhum aviso.
  const [perdas12m, setPerdas12m] = useState<PerdasCliente | null>(null);
  useEffect(() => {
    setPerdas12m(null);
    if (!clienteId) return;
    let vivo = true;
    fetch(`/api/clientes/${clienteId}/status-financeiro`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setPerdas12m(d?.perdas12m ?? null); }).catch(() => {});
    return () => { vivo = false; };
  }, [clienteId]);

  useEffect(() => {
    if (!solicitacao || !clienteId) return;
    fetch(`/api/equipamentos?clienteId=${clienteId}`).then((r) => r.json()).then((d) => setEquipamentos(Array.isArray(d) ? d : [])).catch(() => {});
  }, [solicitacao, clienteId]);

  async function aceitarSolicitacao() {
    if (!solicitacao) return;
    // Tudo o que falta de uma vez, cada um no campo dele; o primeiro (na ordem da tela) recebe o foco
    const faltando: ErrosDeCampo = {};
    if (horaRuim) faltando.dataHora = horaRuim;
    else if (!dataHora) faltando.dataHora = "Escolha a data e a hora do atendimento.";
    if (form.descricao.trim().length < 5) faltando.descricao = "Descrição muito curta.";
    if (!temExecutor(execucao)) { setFaltaExecutor(true); faltando.execucao = MSG_SEM_EXECUTOR_TELA; }
    if (!erros.validar(faltando)) return;
    setSalvando(true);
    try {
      const res = await fetch(`/api/solicitacoes/${solicitacao.id}/aceitar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // dataHora vai como "AAAA-MM-DDTHH:mm" de Brasília (o que a rota de aceitar espera)
          dataHora: paraLocalBR(dataHora), descricao: form.descricao, prioridade: form.prioridade, unidadeId: form.unidadeId || null,
          contratoId: form.contratoId || null, observacoes: form.observacoes || null,
          equipamentoId: equipamentoId || null, ...corpoExecucao(execucao),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { erros.erroDaApi(d, "Não foi possível aceitar a solicitação."); return; }
      const [y, m, dia] = String(d.data).split("-").map(Number);
      router.push(`/calendario?mes=${m}&ano=${y}&dia=${dia}&view=semanal`);
      router.refresh();
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); } finally { setSalvando(false); }
  }

  async function salvar() {
    const faltando: ErrosDeCampo = {};
    if (!clienteId) faltando.clienteId = "Selecione o cliente.";
    if (horaRuim) faltando.agendarPara = horaRuim;
    if (!temExecutor(execucao)) { setFaltaExecutor(true); faltando.execucao = MSG_SEM_EXECUTOR_TELA; }
    if (!form.descricao.trim()) faltando.descricao = "Descreva o serviço ou problema.";
    if (!erros.validar(faltando)) return;
    setSalvando(true);
    try {
      const res = await fetch("/api/ordens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, clienteId,
          // a pessoa apagou o prazo sugerido: a OS nasce sem prazo próprio (o servidor não reaplica o padrão)
          ...(prazoMexido ? { usarPrazoPadrao: false } : {}),
          // chamado do cliente em contrato: o servidor grava a hora da abertura (não vai daqui)
          ...(chamado && form.contratoId ? { chamadoDoCliente: true } : {}),
          ...(atendidos.length ? { equipamentoIds: atendidos.map((e) => e.id) } : {}),
          // dataAgendada: instante (ISO) da hora de Brasília escolhida
          execucao: { tipoOsId: tipoOsId || null, dataAgendada: agendarPara || null, ...corpoExecucao(execucao) },
        }),
      });
      if (!res.ok) { erros.erroDaApi(await res.json().catch(() => ({})), "Erro ao criar OS."); return; }
      const os = await res.json();
      router.push(`/ordens/${os.id}`);
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); } finally { setSalvando(false); }
  }

  return (
    <ErrosDoFormulario valor={erros}>
    <div ref={(el) => { (raizRef as React.MutableRefObject<HTMLDivElement | null>).current = el; erros.ref(el); }} className="max-w-3xl mx-auto">
      <PageHeader
        title={solicitacao ? `Aceitar solicitação ${solicitacao.numero}` : "Nova ordem de serviço"}
        backHref={solicitacao ? "/calendario" : "/ordens"}
      />
      <div className="bg-white rounded-card border border-surface-border p-6 space-y-6">
        {/* A faixa do topo é só o resumo: o erro mora no campo (ERRO NO CAMPO) */}
        <ResumoDeErros />
        {solicitacao && (
          <div className="flex items-start gap-3 bg-acento-claro border border-acento/20 text-acento-hover text-sm rounded-lg px-4 py-3">
            <Inbox className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              Solicitação <strong>{solicitacao.numero}</strong>, preenchida pelo cliente. Defina a <strong>data e a hora</strong> do atendimento:
              ao salvar, a OS passa para <strong>Agendada</strong> e entra no calendário.
            </p>
          </div>
        )}

        <FormSection title="Informações gerais">
          <FormField label="Cliente" required name="clienteId" valor={clienteId}>
            {solicitacao ? (
              <p data-cliente-solicitacao className="text-sm text-ink bg-surface-alt rounded-lg px-3 py-2.5 border border-surface-border">{solicitacao.cliente}</p>
            ) : (
            <SelectCadastroRapido
              value={clienteId}
              onChange={(v) => { setClienteId(v); setAtendidos([]); setAvisoSemCliente(false); setForm((f) => ({ ...f, unidadeId: "", contratoId: "" })); }}
              opcoes={clientes.map(CLIENTE.opcao)}
              entidade={CLIENTE.entidade}
              placeholder="Selecione o cliente"
              carregando={carregandoClientes}
              campos={CLIENTE.campos}
              valoresIniciais={CLIENTE.valoresIniciais}
              campoBusca="nome"
              permissao={CLIENTE.permissao}
              linkCadastroCompleto={CLIENTE.link}
              criar={async (v) => {
                const c = await CLIENTE.criar(v);
                setClientes((l) => [...l, c]);
                return CLIENTE.opcao(c);
              }}
              edicao={CLIENTE.edicao()}
            />
            )}
            {clienteId && <AlertaPerdasCliente clienteId={clienteId} perdas={perdas12m} className="mt-2" />}
          </FormField>
          <FormGrid>
            <FormField label="Endereço do cliente" name="unidadeId" valor={form.unidadeId}>
              <SelectCadastroRapido
                value={form.unidadeId}
                onChange={(v) => setForm((f) => ({ ...f, unidadeId: v }))}
                opcoes={unidades.map(UNIDADE.opcao)}
                entidade={UNIDADE.entidade}
                contexto="para este cliente"
                placeholder="Selecione"
                disabled={!clienteId}
                textoDesabilitado="Selecione um cliente primeiro"
                carregando={carregandoUnidades}
                campos={UNIDADE.campos}
                campoBusca="nome"
                permissao={UNIDADE.permissao}
                linkCadastroCompleto={clienteId ? UNIDADE.link(clienteId) : undefined}
                criar={async (v) => {
                  const u = await UNIDADE.criar(clienteId, v, unidades.length === 0);
                  setUnidades((l) => [...l, u]);
                  return UNIDADE.opcao(u);
                }}
                edicao={UNIDADE.edicao<UnidadeItem>(clienteId, (u) => setUnidades((l) => l.map((x) => (x.id === u.id ? { ...x, ...u } : x))))}
              />
            </FormField>
            <FormField label="Contrato vinculado" name="contratoId">
              <Select value={form.contratoId} onChange={(e) => setForm((f) => ({ ...f, contratoId: e.target.value }))} placeholder="Sem contrato" disabled={!clienteId}>
                {contratos.map((c) => (<option key={c.id} value={c.id}>{c.numero}</option>))}
              </Select>
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Prioridade" required>
              <Select value={form.prioridade} onChange={(e) => setForm((f) => ({ ...f, prioridade: e.target.value }))}>
                {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
            {solicitacao ? (
              <FormField label="Data e hora do atendimento" required name="dataHora" valor={dataHora}>
                <InputDataHora aria-label="Data e hora do atendimento" value={dataHora} onChange={setDataHora} onProblema={aoProblemaHora} />
              </FormField>
            ) : (
              // Data e hora da 1ª atividade (é ela que aparece no calendário)
              <FormField label="Agendar para" name="agendarPara" valor={agendarPara} dica="Opcional. Data e hora da primeira atividade, exibida no calendário.">
                <InputDataHora aria-label="Agendar para" value={agendarPara} onChange={setAgendarPara} onProblema={aoProblemaHora} />
              </FormField>
            )}
          </FormGrid>
          {/* Só com contrato (é ele que promete prazo de atendimento) e fora do chamado do portal, que já tem a hora da abertura */}
          {!solicitacao && form.contratoId && (
            <div className="space-y-3" data-chamado-do-cliente>
              <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={chamado} data-e-chamado
                  onChange={(e) => setChamado(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                <span>
                  Chamado do cliente
                  <span className="block text-xs text-ink-muted">O cliente pediu este atendimento. O prazo de atendimento do contrato conta a partir de agora.</span>
                </span>
              </label>
              {chamado && (
                <FormGrid>
                  <FormField label="Chamado aberto em" hint="Preenchido pelo sistema ao salvar. Não pode ser alterado.">
                    {/* Travado: quem preenche é o sistema, então não há hora inválida para avisar ao formulário */}
                    <InputDataHora aria-label="Chamado aberto em" disabled value={new Date(agora).toISOString()} onChange={() => {}} onProblema={() => {}} />
                  </FormField>
                </FormGrid>
              )}
            </div>
          )}
          {/* O equipamento que o cliente vinculou no chamado continua à vista mesmo sem o módulo */}
          {solicitacao && (temEquipamentos || solicitacao.equipamentoCliente) && (
            <FormGrid>
              <FormField label="Equipamento" name="equipamentoId" valor={equipamentoId}>
                {solicitacao.equipamentoCliente ? (
                  <p className="text-sm text-ink bg-surface-alt rounded-lg px-3 py-2.5 border border-surface-border">
                    {solicitacao.equipamentoRotulo}
                    <span className="block text-xs text-ink-muted">Vinculado pelo cliente na solicitação</span>
                  </p>
                ) : (
                  <SelectCadastroRapido
                    value={equipamentoId}
                    onChange={setEquipamentoId}
                    opcoes={equipamentos.filter((e) => !form.unidadeId || (e.unidade?.id ?? e.unidadeId) === form.unidadeId).map(opcaoEquip)}
                    entidade={EQUIPAMENTO.entidade}
                    contexto={form.unidadeId ? "neste endereço" : "para este cliente"}
                    placeholder="Opcional — o cliente não vinculou"
                    campos={EQUIPAMENTO.campos(form.unidadeId ? undefined : unidades.map(UNIDADE.opcao))}
                    permissao={EQUIPAMENTO.permissao}
                    linkCadastroCompleto={EQUIPAMENTO.link}
                    criar={async (v) => {
                      const e = await EQUIPAMENTO.criar(form.unidadeId, v);
                      setEquipamentos((l) => [...l, e]);
                      return opcaoEquip(e);
                    }}
                    edicao={EQUIPAMENTO.edicao<EquipItem>((e) => setEquipamentos((l) => l.map((x) => (x.id === e.id ? { ...x, ...e } : x))))}
                  />
                )}
              </FormField>
            </FormGrid>
          )}
        </FormSection>

        {/* Campo-ponte: sem o módulo Equipamentos, a seção inteira some da Nova OS */}
        {!solicitacao && temEquipamentos && (
          <FormSection title="Equipamentos atendidos" dica={DICA_EQUIPAMENTOS}>
            {atendidos.length > 0 && (
              <div data-equipamentos-escolhidos>
                <p className="text-xs font-medium text-ink-muted mb-1.5" data-qtd-atendidos>
                  {atendidos.length === 1 ? "1 equipamento selecionado" : `${atendidos.length} equipamentos selecionados`}
                </p>
                <ul className="divide-y divide-surface-linha rounded-lg border border-surface-border bg-white">
                  {(verTodosAtendidos ? atendidos : atendidos.slice(0, 5)).map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-3 py-2" data-equipamento-escolhido={e.id}>
                      <Wrench className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink truncate">{rotuloEquipamento(e)}</span>
                        <span className="block text-xs text-ink-muted truncate">{detalheEquipamento(e, true)}</span>
                      </span>
                      <EditarNoContexto id={e.id} rotulo={`Editar o equipamento ${rotuloEquipamento(e)}`}
                        edicao={EQUIPAMENTO.edicao<EquipamentoResumo>((novo) => setAtendidos((l) => l.map((x) => (x.id === novo.id ? { ...x, ...novo } : x))))} />
                      <button type="button" onClick={() => setAtendidos((l) => l.filter((x) => x.id !== e.id))}
                        aria-label={`Tirar ${rotuloEquipamento(e)} da OS`} className="p-1 rounded text-ink-subtle hover:text-atrasado hover:bg-atrasado-claro">
                        <X className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                {atendidos.length > 5 && (
                  <button type="button" onClick={() => setVerTodosAtendidos((v) => !v)} className="mt-1.5 text-xs font-semibold text-acento hover:underline" data-ver-todos-atendidos>
                    {verTodosAtendidos ? "Mostrar menos" : `Mostrar todos (${atendidos.length})`}
                  </button>
                )}
              </div>
            )}
            <div>
              <Button
                type="button" variant="secondary" data-vincular-equipamento aria-describedby={avisoSemCliente ? "aviso-sem-cliente" : undefined}
                onClick={() => { if (!clienteId) { setAvisoSemCliente(true); return; } setGavetaAberta(true); }}
              >
                <Link2 className="w-4 h-4" aria-hidden="true" /> {atendidos.length ? "Editar equipamentos" : "Vincular equipamento"}
              </Button>
              {avisoSemCliente && !clienteId && (
                <p id="aviso-sem-cliente" role="alert" data-aviso-sem-cliente className="mt-2 text-xs text-atencao-texto bg-atencao-claro border border-atencao/20 rounded-lg px-3 py-2">
                  Selecione o <strong>cliente</strong> antes: os equipamentos vêm dos endereços dele.
                </p>
              )}
            </div>
            {clienteId && (
              <GavetaEquipamentos
                aberto={gavetaAberta} onFechar={() => setGavetaAberta(false)}
                clienteId={clienteId} unidadeId={form.unidadeId || null} unidades={unidades.map(UNIDADE.opcao)}
                selecionados={atendidos} onConfirmar={setAtendidos}
              />
            )}
          </FormSection>
        )}

        <FormSection title="Quem executa">
          {!solicitacao && (
            <FormGrid>
              <FormField label="Tipo de OS" dica="Filtra os colaboradores pela competência no tipo de serviço.">
                {/* UX-8 (Y3): tipo novo nasce aqui mesmo, sem abandonar a OS */}
                <SelectCadastroRapido
                  value={tipoOsId} onChange={setTipoOsId}
                  opcoes={tiposOs.filter((t) => t.ativo !== false).map((t) => ({ value: t.id, label: t.nome }))}
                  entidade={TIPO_OS.entidade} placeholder="Sem tipo definido"
                  campos={TIPO_OS.campos} campoBusca="nome" permissao={TIPO_OS.permissao} linkCadastroCompleto={TIPO_OS.link}
                  criar={async (v) => {
                    const t = await TIPO_OS.criar(v);
                    setTiposOs((l) => [...l, { id: t.id, nome: t.nome, ativo: true }]);
                    return { value: t.id, label: t.nome };
                  }}
                  edicao={TIPO_OS.edicao(tiposOs, (t) => setTiposOs((l) => l.map((x) => (x.id === t.id ? { ...x, ...t } : x))))}
                />
                {sugestoes.tipoOs && (
                  <Sugestao oQue="tipo" atributo="tipo" nome={sugestoes.tipoOs.nome} vezes={sugestoes.tipoOs.vezes}
                    escondida={!!tipoOsId} onUsar={() => setTipoOsId(sugestoes.tipoOs!.id)} />
                )}
              </FormField>
              {/* O prazo da OS: é o que a central usa para dizer se está no prazo ou atrasada */}
              <FormField label="Prazo para finalizar" name="prazoExecucao" formato="data" dica="Opcional. Após esta data, a OS é sinalizada como atrasada. Se o tipo de OS tem prazo padrão, o campo já vem sugerido a partir do dia agendado — dá para ajustar."
                hint={prazoSugerido && !prazoMexido ? `Sugerido pelo tipo de OS: ${diasDoTipo === 0 ? "no dia agendado" : `${diasDoTipo} dia${diasDoTipo === 1 ? "" : "s"} após o agendamento`}.` : undefined}>
                <InputData aria-label="Prazo para finalizar" value={form.prazoExecucao} onChange={(v) => { setPrazoMexido(true); setForm((f) => ({ ...f, prazoExecucao: v })); }} />
                {prazoMexido && prazoSugerido && form.prazoExecucao !== prazoSugerido && (
                  <button type="button" onClick={() => setPrazoMexido(false)} className="text-xs font-medium text-acento hover:underline text-left" data-usar-prazo-sugerido>
                    Usar o prazo do tipo de OS ({prazoSugerido.split("-").reverse().join("/")})
                  </button>
                )}
              </FormField>
            </FormGrid>
          )}
          <FormField label="Equipe ou colaboradores" required name="execucao" valor={temExecutor(execucao)}>
            <SeletorExecucao opcoes={opcoesExecucao} tipoOsId={solicitacao ? "" : tipoOsId} valor={execucao} onChange={(v) => { setExecucao(v); if (temExecutor(v)) setFaltaExecutor(false); }} erro={faltaExecutor} />
            {sugestoes.executor && execSugerido && (
              <Sugestao oQue="executor" atributo="executor" nome={sugestoes.executor.nome} vezes={sugestoes.executor.vezes}
                escondida={temExecutor(execucao)} onUsar={() => { setExecucao(execSugerido); setFaltaExecutor(false); }} />
            )}
          </FormField>
        </FormSection>

        <FormSection title="Descrição">
          <FormField label={solicitacao ? "O que o cliente pediu (pode ajustar)" : "Descreva o serviço ou problema"} required name="descricao">
            <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={4} placeholder="Descreva o que precisa ser feito…" />
          </FormField>
          <FormField label="Observações">
            <Textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} placeholder="Informações adicionais…" />
          </FormField>
        </FormSection>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-linha">
          <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          {solicitacao ? (
            <Button loading={salvando} onClick={aceitarSolicitacao} disabled={!solicitacao.pendente || carregandoSolicitacao}>Aceitar e agendar</Button>
          ) : (
            <Button loading={salvando} onClick={salvar}>Abrir ordem de serviço</Button>
          )}
        </div>
      </div>
    </div>
    </ErrosDoFormulario>
  );
}
