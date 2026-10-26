"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import { PageHeader } from "@/components/ui/page-header";
import { ItensTabela, type ItemTabela, type CatalogoItem, type TabelaPrecoCliente, type CadastroCatalogo } from "@/components/orcamento/itens-tabela";
import { SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, PRODUTO, SERVICO } from "@/components/cadastro-rapido/definicoes";
import { OsVinculadas } from "@/components/orcamento/os-vinculadas";
import { TotaisBloco, type DescontoGrupoState } from "@/components/orcamento/totais-bloco";
import { PropostaCampos, PROPOSTA_VAZIA, type PropostaState } from "@/components/orcamento/proposta-campos";
import { cn, LABELS_TIPO_ORCAMENTO } from "@/lib/utils";
import type { TipoDesconto, TipoOrcamento } from "@prisma/client";
import { AlertCircle, Tags, Calculator, FileSignature, Sparkles, RefreshCw } from "lucide-react";
import { chaveDiaCivil, chaveHojeBR } from "@/lib/fuso";
import { calcularOrcamento, DIAS_VALIDADE_PADRAO, totalDoItem, validadePadrao } from "@/lib/orcamentos/calculo";
import { confirmar, toast } from "@/components/ui/avisos";
import { nomeAutomaticoOrcamento, type ContextoNomeOrcamento } from "@/lib/orcamentos/nome";

interface ClienteOpt {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
}

interface TecnicoOpt {
  id: string;
  nome: string;
  crea?: string | null;
}

interface TermoTemplateOpt {
  id: string;
  nome: string;
  conteudo: string;
}

interface EquipamentoOpt {
  id: string;
  rotulo: string;
}

interface PropostaInicial {
  valorMensal?: number | null;
  frequenciaContrato?: string | null;
  diaExecucao?: number | null;
  dataInicioContrato?: Date | string | null;
  vigenciaMeses?: number | null;
  condicaoPagamento?: string | null;
  diaFaturamento?: number | null;
  perfilFaturamento?: string | null;
  exigePcAntesNf?: boolean | null;
  responsavelTecnicoId?: string | null;
  artNumero?: string | null;
  termoReferencia?: string | null;
  visitasPorPeriodo?: number | null;
  equipamentosCobertos?: string[];
  prazoEmergencial?: number | null;
  prazoNormal?: number | null;
  horarioAtendimento?: string | null;
}

interface OsItem {
  id: string;
  numero: string;
  descricao: string;
  status: string;
}

interface OrcamentoInicial {
  id?: string;
  nome: string;
  clienteId: string;
  tipo?: TipoOrcamento;
  descricao?: string | null;
  observacao?: string | null;
  validadeEm?: Date | string | null;
  prazoExecucao?: string | null;
  formaPagamento?: string | null;
  descontoServicos: number;
  tipoDescontoServicos: TipoDesconto;
  descontoProdutos: number;
  tipoDescontoProdutos: TipoDesconto;
  /** Alíquota de ISS congelada neste orçamento */
  issAliquota: number;
  servicos: ItemTabela[];
  produtos: ItemTabela[];
  ordensServicoIds: string[];
  osPreCarregadas?: OsItem[];
  codigo?: string;
  proposta?: PropostaInicial;
}

interface OrcamentoFormProps {
  mode: "novo" | "editar";
  clientes: ClienteOpt[];
  catalogoServicos: CatalogoItem[];
  catalogoProdutos: CatalogoItem[];
  tecnicos?: TecnicoOpt[];
  termoTemplates?: TermoTemplateOpt[];
  inicial?: OrcamentoInicial;
  clienteIdInicial?: string;
  osInicialId?: string;
  osInicial?: OsItem;
  /** Alíquota de ISS da empresa hoje (%): o orçamento novo nasce com ela; na edição, oferece atualizar */
  issAliquota?: number;
  /** Há chave da IA no servidor? Sem ela o botão "Gerar descrição" fica desabilitado com aviso */
  iaDisponivel?: boolean;
  /** Da OS de origem: tipo, unidade e equipamento principal (prévia do nome automático) */
  contextoNome?: Omit<ContextoNomeOrcamento, "cliente" | "itens">;
  /**
   * Construtor dentro de outra tela (gaveta "Criar orçamento" da OS): sem cabeçalho de página, o
   * cliente fica o da OS, a OS nunca sai do vínculo, e salvar/cancelar devolvem para quem abriu
   * em vez de navegar. O resto é o MESMO formulário e a MESMA API.
   */
  embutido?: { osId: string; onSalvo: (orcamento: any) => void; onCancelar: () => void };
}

function toInput(v: number | null | undefined): string {
  return v == null ? "" : String(v);
}

function propostaInicialToState(p?: PropostaInicial): PropostaState {
  if (!p) return PROPOSTA_VAZIA;
  return {
    valorMensal: toInput(p.valorMensal),
    frequenciaContrato: p.frequenciaContrato ?? "MENSAL",
    diaExecucao: toInput(p.diaExecucao),
    dataInicioContrato: p.dataInicioContrato ? chaveDiaCivil(p.dataInicioContrato) : "",
    vigenciaMeses: p.vigenciaMeses ? String(p.vigenciaMeses) : "12",
    condicaoPagamento: p.condicaoPagamento ?? "",
    diaFaturamento: toInput(p.diaFaturamento),
    perfilFaturamento: p.perfilFaturamento ?? "",
    exigePcAntesNf: p.exigePcAntesNf ?? false,
    responsavelTecnicoId: p.responsavelTecnicoId ?? "",
    artNumero: p.artNumero ?? "",
    termoReferencia: p.termoReferencia ?? "",
    visitasPorPeriodo: toInput(p.visitasPorPeriodo),
    equipamentosCobertos: p.equipamentosCobertos ?? [],
    prazoEmergencial: toInput(p.prazoEmergencial),
    prazoNormal: toInput(p.prazoNormal),
    horarioAtendimento: p.horarioAtendimento ?? "",
  };
}

/** Sugestões (o campo é texto livre) */
const PRAZOS_SUGERIDOS = ["Imediato, após aprovação", "1 dia útil após aprovação", "3 dias úteis após aprovação", "5 dias úteis após aprovação", "10 dias úteis após aprovação", "A combinar"];
const FORMAS_PAGAMENTO_SUGERIDAS = ["À vista", "PIX à vista", "Boleto à vista", "Boleto em 2x (30/60 dias)", "Cartão de crédito em até 3x", "50% na aprovação e 50% na conclusão", "Transferência bancária"];

function novoId() {
  return Math.random().toString(36).slice(2);
}

function toInputDate(d: Date | string | null | undefined): string {
  return d ? chaveDiaCivil(d) : "";
}

export function OrcamentoForm({
  mode,
  clientes: clientesIniciais,
  catalogoServicos: servicosIniciais,
  catalogoProdutos: produtosIniciais,
  tecnicos = [],
  termoTemplates = [],
  inicial,
  clienteIdInicial,
  osInicialId,
  osInicial,
  issAliquota: issAliquotaEmpresa = 0,
  iaDisponivel = false,
  contextoNome,
  embutido,
}: OrcamentoFormProps) {
  const router = useRouter();

  // Listas locais: itens criados no cadastro rápido entram aqui sem recarregar a página
  const [clientes, setClientes] = useState<ClienteOpt[]>(clientesIniciais);
  const [catalogoServicos, setCatalogoServicos] = useState<CatalogoItem[]>(servicosIniciais);
  const [catalogoProdutos, setCatalogoProdutos] = useState<CatalogoItem[]>(produtosIniciais);
  const cadastroServico: CadastroCatalogo = {
    entidade: SERVICO.entidade, campos: SERVICO.campos, permissao: SERVICO.permissao, link: SERVICO.link,
    criar: async (v) => {
      const s = await SERVICO.criar(v);
      const item = { ...s, valorPadrao: s.valorPadrao != null ? Number(s.valorPadrao) : null };
      setCatalogoServicos((l) => [...l, item]);
      return item;
    },
  };
  const cadastroProduto: CadastroCatalogo = {
    entidade: PRODUTO.entidade, campos: PRODUTO.campos, permissao: PRODUTO.permissao, link: PRODUTO.link,
    criar: async (v) => {
      const p = await PRODUTO.criar(v);
      const item = { ...p, valorPadrao: p.valorPadrao != null ? Number(p.valorPadrao) : null };
      setCatalogoProdutos((l) => [...l, item]);
      return item;
    },
  };

  // Dentro da OS só existe "Orçamento" (proposta de contrato é coisa do módulo Comercial)
  const tiposPermitidos: TipoOrcamento[] = embutido ? ["COMUM"] : ["COMUM", "PROPOSTA_CONTRATO"];
  const [tipo, setTipo] = useState<TipoOrcamento>(embutido ? "COMUM" : inicial?.tipo ?? "COMUM");
  const [proposta, setProposta] = useState<PropostaState>(propostaInicialToState(inicial?.proposta));
  const [equipamentos, setEquipamentos] = useState<EquipamentoOpt[]>([]);
  const patchProposta = (patch: Partial<PropostaState>) => setProposta((p) => ({ ...p, ...patch }));

  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [clienteId, setClienteId] = useState(inicial?.clienteId ?? clienteIdInicial ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [prazoExecucao, setPrazoExecucao] = useState(inicial?.prazoExecucao ?? "");
  const [formaPagamento, setFormaPagamento] = useState(inicial?.formaPagamento ?? "");
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  // Validade: no novo, a data de hoje (a do orçamento) + 10 dias — editável
  const [validadeEm, setValidadeEm] = useState(
    inicial ? toInputDate(inicial.validadeEm ?? null) : validadePadrao(chaveHojeBR()),
  );
  const [descontoServicos, setDescontoServicos] = useState<DescontoGrupoState>({ valor: Number(inicial?.descontoServicos ?? 0), tipo: inicial?.tipoDescontoServicos ?? "VALOR" });
  const [descontoProdutos, setDescontoProdutos] = useState<DescontoGrupoState>({ valor: Number(inicial?.descontoProdutos ?? 0), tipo: inicial?.tipoDescontoProdutos ?? "VALOR" });
  // ISS: novo = a da empresa; edição = a congelada no orçamento (até alguém pedir a atual)
  const [issAliquota, setIssAliquota] = useState(inicial ? Number(inicial.issAliquota ?? 0) : issAliquotaEmpresa);
  const [atualizarIss, setAtualizarIss] = useState(false);
  // IA: texto sugerido aguardando decisão (nunca substitui a descrição sem o usuário pedir)
  const [gerandoIa, setGerandoIa] = useState(false);
  const [sugestaoIa, setSugestaoIa] = useState<string | null>(null);
  const [servicos, setServicos] = useState<ItemTabela[]>(
    inicial?.servicos.map((s) => ({ ...s, id: s.id || novoId() })) ?? [],
  );
  const [produtos, setProdutos] = useState<ItemTabela[]>(
    inicial?.produtos.map((p) => ({ ...p, id: p.id || novoId() })) ?? [],
  );
  const [ordensIds, setOrdensIds] = useState<string[]>(
    inicial?.ordensServicoIds ?? (osInicialId ? [osInicialId] : []),
  );

  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [tabelaPreco, setTabelaPreco] = useState<TabelaPrecoCliente | null>(null);

  useEffect(() => {
    if (!clienteId) { setTabelaPreco(null); return; }
    let ativo = true;
    fetch(`/api/clientes/${clienteId}/tabela-preco`)
      .then((r) => r.json())
      .then((d) => { if (ativo) setTabelaPreco(d && d.itens ? d : null); })
      .catch(() => { if (ativo) setTabelaPreco(null); });
    return () => { ativo = false; };
  }, [clienteId]);

  // Carrega equipamentos do cliente para o escopo da proposta
  useEffect(() => {
    if (!clienteId) { setEquipamentos([]); return; }
    let ativo = true;
    fetch(`/api/equipamentos?clienteId=${clienteId}`)
      .then((r) => r.json())
      .then((d: any[]) => {
        if (!ativo) return;
        setEquipamentos(
          (Array.isArray(d) ? d : []).map((e) => ({
            id: e.id,
            rotulo: [e.marca, e.modelo, e.numeroSerie ? `(${e.numeroSerie})` : "", e.unidade?.nome ? `— ${e.unidade.nome}` : ""].filter(Boolean).join(" "),
          })),
        );
      })
      .catch(() => { if (ativo) setEquipamentos([]); });
    return () => { ativo = false; };
  }, [clienteId]);

  // O mesmo cálculo que o servidor grava (lib/orcamentos/calculo.ts)
  const totais = useMemo(() => calcularOrcamento({
    servicos: servicos.filter((s) => s.descricao.trim()),
    produtos: produtos.filter((p) => p.descricao.trim()),
    descontoServicos: descontoServicos.valor, tipoDescontoServicos: descontoServicos.tipo,
    descontoProdutos: descontoProdutos.valor, tipoDescontoProdutos: descontoProdutos.tipo,
    issAliquota,
  }), [servicos, produtos, descontoServicos, descontoProdutos, issAliquota]);

  // Prévia do nome automático: tipo da OS, equipamento, cliente/unidade ou os itens
  const clienteSel = clientes.find((c) => c.id === clienteId);
  const nomeAuto = nomeAutomaticoOrcamento({
    ...contextoNome,
    cliente: clienteSel ? (clienteSel.nomeFantasia || clienteSel.nome) : null,
    itens: [...servicos, ...produtos].map((i) => i.descricao),
  });

  const osDaIa = embutido?.osId ?? (ordensIds.length === 1 ? ordensIds[0] : null);
  async function gerarDescricaoIa() {
    if (!iaDisponivel || gerandoIa) return;
    const itens = (lista: ItemTabela[]) => lista.filter((i) => i.descricao.trim()).map((i) => ({ descricao: i.descricao.trim(), observacao: i.observacao ?? null }));
    setGerandoIa(true);
    try {
      const res = await fetch("/api/orcamentos/descricao-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osId: osDaIa, nome: nome.trim() || null, servicos: itens(servicos), produtos: itens(produtos) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.descricao) { toast(d.erro ?? "Não foi possível gerar a descrição.", "erro"); return; }
      if (!descricao.trim()) {
        setDescricao(d.descricao);
        setSugestaoIa(null);
        toast("Descrição gerada pela IA — revise antes de salvar.");
      } else {
        // Já havia texto: mostra a sugestão ao lado; só troca se o usuário pedir
        setSugestaoIa(d.descricao);
      }
    } catch {
      toast("Erro de conexão ao gerar a descrição.", "erro");
    } finally {
      setGerandoIa(false);
    }
  }
  async function usarSugestaoIa() {
    if (!sugestaoIa) return;
    const ok = await confirmar({ titulo: "Substituir a descrição?", mensagem: "O texto atual da descrição será trocado pelo texto sugerido pela IA.", confirmarTexto: "Substituir" });
    if (!ok) return;
    setDescricao(sugestaoIa);
    setSugestaoIa(null);
  }

  const osPreCarregadas = useMemo<OsItem[]>(() => {
    const lista: OsItem[] = inicial?.osPreCarregadas ?? [];
    if (osInicial && !lista.find((o) => o.id === osInicial.id)) {
      return [...lista, osInicial];
    }
    return lista;
  }, [inicial?.osPreCarregadas, osInicial]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!clienteId) return setErro("Selecione um cliente.");
    if (servicos.length === 0 && produtos.length === 0) {
      return setErro("Adicione ao menos um serviço ou produto.");
    }
    if (tipo === "PROPOSTA_CONTRATO" && (!proposta.valorMensal || Number(proposta.valorMensal) <= 0)) {
      return setErro("Informe o valor mensal do contrato proposto.");
    }
    const limpar = (it: ItemTabela) => ({
      catalogoId: it.catalogoId ?? null,
      descricao: it.descricao.trim(),
      quantidade: Number(it.quantidade) || 0,
      valorUnitario: Number(it.valorUnitario) || 0,
      // O total que vale para a linha (o digitado manda; o servidor confere com unitário × qtd)
      valorTotal: totalDoItem(it),
      observacao: it.observacao?.trim() || null,
    });
    const servPayload = servicos.filter((s) => s.descricao.trim()).map(limpar);
    const prodPayload = produtos.filter((p) => p.descricao.trim()).map(limpar);

    const payload: Record<string, any> = {
      // Em branco = o servidor compõe o nome automático (a mesma regra da prévia)
      nome: nome.trim() || null,
      prazoExecucao: prazoExecucao.trim() || null,
      formaPagamento: formaPagamento.trim() || null,
      clienteId,
      tipo,
      descricao: descricao?.trim() || null,
      observacao: observacao?.trim() || null,
      validadeEm: validadeEm || null,
      descontoServicos: descontoServicos.valor,
      tipoDescontoServicos: descontoServicos.tipo,
      descontoProdutos: descontoProdutos.valor,
      tipoDescontoProdutos: descontoProdutos.tipo,
      atualizarIss,
      servicos: servPayload,
      produtos: prodPayload,
      // Embutido na OS: a OS de origem vai sempre (desmarcar na lista não a tira)
      ordensServicoIds: embutido && !ordensIds.includes(embutido.osId) ? [...ordensIds, embutido.osId] : ordensIds,
    };

    if (tipo === "PROPOSTA_CONTRATO") {
      Object.assign(payload, {
        valorMensal: proposta.valorMensal || null,
        frequenciaContrato: proposta.frequenciaContrato || null,
        diaExecucao: proposta.diaExecucao || null,
        dataInicioContrato: proposta.dataInicioContrato || null,
        vigenciaMeses: proposta.vigenciaMeses || null,
        condicaoPagamento: proposta.condicaoPagamento?.trim() || null,
        diaFaturamento: proposta.diaFaturamento || null,
        perfilFaturamento: proposta.perfilFaturamento || null,
        exigePcAntesNf: proposta.exigePcAntesNf,
        responsavelTecnicoId: proposta.responsavelTecnicoId || null,
        artNumero: proposta.artNumero?.trim() || null,
        termoReferencia: proposta.termoReferencia || null,
        visitasPorPeriodo: proposta.visitasPorPeriodo || null,
        equipamentosCobertos: proposta.equipamentosCobertos,
        prazoEmergencial: proposta.prazoEmergencial || null,
        prazoNormal: proposta.prazoNormal || null,
        horarioAtendimento: proposta.horarioAtendimento?.trim() || null,
      });
    }

    setSalvando(true);
    try {
      const url = mode === "novo" ? "/api/orcamentos" : `/api/orcamentos/${inicial!.id}`;
      const method = mode === "novo" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setErro(err.erro ?? "Erro ao salvar.");
        return;
      }
      const saved = await res.json();
      if (embutido) { embutido.onSalvo(saved); return; }
      router.push(`/orcamentos/${saved.id}`);
      router.refresh();
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-6" data-orcamento-form={embutido ? "embutido" : mode}>
      {!embutido && <PageHeader
        title={mode === "novo" ? "Novo Orçamento" : `Editar ${inicial?.codigo ?? "Orçamento"}`}
        description={mode === "novo" ? "Crie uma proposta comercial para o cliente" : "Edite os dados deste orçamento"}
        backHref={mode === "novo" ? "/orcamentos" : `/orcamentos/${inicial?.id}`}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancelar
            </Button>
            <Button type="submit" loading={salvando} variant="primary">
              {mode === "novo" ? "Criar orçamento" : "Salvar alterações"}
            </Button>
          </>
        }
      />}

      {erro && (
        <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {erro}
        </div>
      )}

      {tabelaPreco && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 bg-success-50 text-success-700 text-xs font-semibold rounded-full px-3 py-1">
            <Tags className="w-3.5 h-3.5" /> Tabela: {tabelaPreco.nome}
          </span>
          {tabelaPreco.vinculadaInativa && (
            <span className="text-xs text-atencao-texto" data-aviso-tabela-inativa>A tabela do cliente (“{tabelaPreco.vinculadaInativa.nome}”) está inativa: valem os preços da Padrão.</span>
          )}
          {tabelaPreco.precosBloqueados && (
            <span className="text-xs text-ink-muted">Preços bloqueados por contrato</span>
          )}
        </div>
      )}

      {tiposPermitidos.length > 1 && <div className="card-padded">
        <FormSection title="Tipo de documento">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tiposPermitidos.map((t) => {
              const ativo = tipo === t;
              const Icone = t === "COMUM" ? Calculator : FileSignature;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border-2 px-4 py-3 text-left transition-all",
                    ativo
                      ? t === "COMUM" ? "border-primary-500 bg-primary-50/60" : "border-success-500 bg-success-50/60"
                      : "border-surface-border hover:border-surface-border/80 bg-white",
                  )}
                >
                  <Icone className={cn("w-5 h-5 mt-0.5 shrink-0", ativo ? (t === "COMUM" ? "text-primary-600" : "text-success-600") : "text-ink-subtle")} />
                  <div>
                    <p className="text-sm font-semibold text-ink">{LABELS_TIPO_ORCAMENTO[t]}</p>
                    <p className="text-xs text-ink-muted">
                      {t === "COMUM" ? "Proposta comercial avulsa de serviços/produtos." : "Contrato de manutenção que pode ser convertido em contrato ao ser aprovado."}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </FormSection>
      </div>}

      <div className="card-padded space-y-6">
        <FormSection title="Identificação">
          <FormGrid cols={2}>
            <FormField label="Nome do orçamento" hint={nome.trim() ? "Nome digitado por você (apague para voltar ao automático)" : "Automático pelo tipo da OS, equipamento, cliente ou itens — pode editar"}>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={nomeAuto} data-nome-orcamento />
            </FormField>
            <FormField label="Cliente" required>
              <SelectCadastroRapido
                value={clienteId}
                onChange={setClienteId}
                disabled={!!embutido}
                textoDesabilitado={embutido ? clientes.filter((c) => c.id === clienteId).map((c) => CLIENTE.opcao(c).label)[0] ?? "Cliente da OS" : undefined}
                opcoes={clientes.map(CLIENTE.opcao)}
                entidade={CLIENTE.entidade}
                placeholder="Selecione..."
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
              />
            </FormField>
            <FormField label="Validade" hint={`Padrão: ${DIAS_VALIDADE_PADRAO} dias após a data do orçamento. Depois dela o orçamento não pode mais ser aprovado.`}>
              <InputData value={validadeEm} onChange={setValidadeEm} aria-label="Validade" />
            </FormField>
            {tipo !== "PROPOSTA_CONTRATO" && (<>
              <FormField label="Prazo de execução dos serviços" hint="Sai no orçamento do cliente">
                <Input value={prazoExecucao} onChange={(e) => setPrazoExecucao(e.target.value)} list="sugestoes-prazo-execucao" maxLength={200} placeholder="Ex.: 5 dias úteis após aprovação" data-prazo-execucao />
              </FormField>
              <FormField label="Forma de pagamento" hint="Sai no orçamento do cliente">
                <Input value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} list="sugestoes-forma-pagamento" maxLength={200} placeholder="Ex.: PIX à vista ou boleto em 2x" data-forma-pagamento />
              </FormField>
              <datalist id="sugestoes-prazo-execucao">
                {PRAZOS_SUGERIDOS.map((v) => <option key={v} value={v} />)}
              </datalist>
              <datalist id="sugestoes-forma-pagamento">
                {FORMAS_PAGAMENTO_SUGERIDAS.map((v) => <option key={v} value={v} />)}
              </datalist>
            </>)}
          </FormGrid>
          <div className="space-y-2" data-descricao-orcamento>
            <FormField label="Descrição" hint="Resumo da proposta para o cliente">
              <Textarea value={descricao ?? ""} onChange={(e) => setDescricao(e.target.value)} rows={Math.min(14, Math.max(5, (descricao ?? "").split("\n").length + 1))} />
            </FormField>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={gerarDescricaoIa}
                loading={gerandoIa}
                disabled={!iaDisponivel}
                data-gerar-descricao-ia
                title={iaDisponivel ? "Rascunha o texto com a descrição da OS, os equipamentos, as fotos e os itens — revise antes de salvar" : "IA não configurada"}
              >
                {descricao.trim() ? <RefreshCw className="w-3.5 h-3.5" aria-hidden /> : <Sparkles className="w-3.5 h-3.5" aria-hidden />}
                {descricao.trim() ? "Gerar outra descrição (IA)" : "Gerar descrição profissional (IA)"}
              </Button>
              {!iaDisponivel ? (
                <span className="text-xs text-ink-muted" data-ia-indisponivel>IA não configurada</span>
              ) : (
                <span className="text-xs text-ink-muted">
                  Usa {osDaIa ? "a OS (descrição, equipamentos e fotos) e " : ""}os itens do orçamento. Nada é inventado; revise antes de salvar.
                </span>
              )}
            </div>
            {sugestaoIa && (
              <div className="rounded-lg border border-primary-200 bg-primary-50/60 p-3 space-y-2" data-sugestao-ia role="region" aria-label="Sugestão da IA">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary-700">Sugestão da IA</p>
                <p className="text-sm text-ink whitespace-pre-line">{sugestaoIa}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={usarSugestaoIa}>Substituir a descrição</Button>
                  <Button type="button" size="sm" variant="secondary" onClick={gerarDescricaoIa} loading={gerandoIa}>Gerar de novo</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSugestaoIa(null)}>Descartar</Button>
                </div>
              </div>
            )}
          </div>
          <FormField label="Observações internas">
            <Textarea value={observacao ?? ""} onChange={(e) => setObservacao(e.target.value)} rows={2} />
          </FormField>
        </FormSection>
      </div>

      <div className="card-padded">
        <ItensTabela
          titulo={tipo === "PROPOSTA_CONTRATO" ? "Serviços inclusos no contrato" : "Serviços"}
          labelAdicionar="Buscar serviço por nome..."
          catalogo={catalogoServicos}
          itens={servicos}
          onChange={setServicos}
          tabela={tabelaPreco}
          cadastro={cadastroServico}
          totalEditavel
        />
      </div>

      <div className="card-padded">
        <ItensTabela
          titulo="Produtos"
          labelAdicionar="Buscar produto por nome..."
          catalogo={catalogoProdutos}
          itens={produtos}
          onChange={setProdutos}
          tabela={tabelaPreco}
          cadastro={cadastroProduto}
          totalEditavel
        />
      </div>

      {tipo === "PROPOSTA_CONTRATO" && (
        <PropostaCampos
          proposta={proposta}
          onChange={patchProposta}
          tecnicos={tecnicos}
          termoTemplates={termoTemplates}
          equipamentos={equipamentos}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-padded">
          <FormSection title="Ordens de serviço vinculadas">
            <OsVinculadas
              clienteId={clienteId || null}
              selecionadas={ordensIds}
              onChange={setOrdensIds}
              osPreCarregadas={osPreCarregadas}
            />
          </FormSection>
        </div>

        <div>
          <TotaisBloco
            totais={totais}
            descontoServicos={descontoServicos}
            descontoProdutos={descontoProdutos}
            onDescontoServicos={setDescontoServicos}
            onDescontoProdutos={setDescontoProdutos}
            issAliquotaEmpresa={mode === "editar" ? issAliquotaEmpresa : undefined}
            onUsarIssEmpresa={() => { setIssAliquota(issAliquotaEmpresa); setAtualizarIss(true); }}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pb-4">
        <Button type="button" variant="secondary" onClick={() => (embutido ? embutido.onCancelar() : router.back())}>Cancelar</Button>
        <Button type="submit" loading={salvando}>
          {mode === "novo" ? "Criar orçamento" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
