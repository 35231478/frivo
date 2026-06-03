"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import { PageHeader } from "@/components/ui/page-header";
import { ItensTabela, type ItemTabela, type CatalogoItem, type TabelaPrecoCliente } from "@/components/orcamento/itens-tabela";
import { OsVinculadas } from "@/components/orcamento/os-vinculadas";
import { TotaisBloco } from "@/components/orcamento/totais-bloco";
import { PropostaCampos, PROPOSTA_VAZIA, type PropostaState } from "@/components/orcamento/proposta-campos";
import { cn, LABELS_TIPO_ORCAMENTO } from "@/lib/utils";
import type { TipoDesconto, TipoOrcamento } from "@prisma/client";
import { AlertCircle, Tags, Calculator, FileSignature } from "lucide-react";

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
  desconto: number;
  tipoDesconto: TipoDesconto;
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
    dataInicioContrato: p.dataInicioContrato ? new Date(p.dataInicioContrato).toISOString().slice(0, 10) : "",
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

function novoId() {
  return Math.random().toString(36).slice(2);
}

function toInputDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const data = typeof d === "string" ? new Date(d) : d;
  return data.toISOString().slice(0, 10);
}

export function OrcamentoForm({
  mode,
  clientes,
  catalogoServicos,
  catalogoProdutos,
  tecnicos = [],
  termoTemplates = [],
  inicial,
  clienteIdInicial,
  osInicialId,
  osInicial,
}: OrcamentoFormProps) {
  const router = useRouter();

  const [tipo, setTipo] = useState<TipoOrcamento>(inicial?.tipo ?? "COMUM");
  const [proposta, setProposta] = useState<PropostaState>(propostaInicialToState(inicial?.proposta));
  const [equipamentos, setEquipamentos] = useState<EquipamentoOpt[]>([]);
  const patchProposta = (patch: Partial<PropostaState>) => setProposta((p) => ({ ...p, ...patch }));

  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [clienteId, setClienteId] = useState(inicial?.clienteId ?? clienteIdInicial ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const [validadeEm, setValidadeEm] = useState(toInputDate(inicial?.validadeEm ?? null));
  const [desconto, setDesconto] = useState(Number(inicial?.desconto ?? 0));
  const [tipoDesconto, setTipoDesconto] = useState<TipoDesconto>(inicial?.tipoDesconto ?? "VALOR");
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

  const totalServicos = useMemo(
    () => servicos.reduce((acc, it) => acc + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0), 0),
    [servicos],
  );
  const totalProdutos = useMemo(
    () => produtos.reduce((acc, it) => acc + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0), 0),
    [produtos],
  );

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

    if (!nome.trim()) return setErro("Informe o nome do orçamento.");
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
      observacao: it.observacao ?? null,
    });
    const servPayload = servicos.filter((s) => s.descricao.trim()).map(limpar);
    const prodPayload = produtos.filter((p) => p.descricao.trim()).map(limpar);

    const payload: Record<string, any> = {
      nome: nome.trim(),
      clienteId,
      tipo,
      descricao: descricao?.trim() || null,
      observacao: observacao?.trim() || null,
      validadeEm: validadeEm || null,
      desconto: Number(desconto) || 0,
      tipoDesconto,
      servicos: servPayload,
      produtos: prodPayload,
      ordensServicoIds: ordensIds,
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
      router.push(`/orcamentos/${saved.id}`);
      router.refresh();
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-6">
      <PageHeader
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
      />

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {erro}
        </div>
      )}

      {tabelaPreco && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 bg-success-50 text-success-700 text-xs font-semibold rounded-full px-3 py-1">
            <Tags className="w-3.5 h-3.5" /> Tabela: {tabelaPreco.nome}
          </span>
          {tabelaPreco.precosBloqueados && (
            <span className="text-xs text-ink-muted">Preços bloqueados por contrato</span>
          )}
        </div>
      )}

      <div className="card-padded">
        <FormSection title="Tipo de documento">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["COMUM", "PROPOSTA_CONTRATO"] as TipoOrcamento[]).map((t) => {
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
      </div>

      <div className="card-padded space-y-6">
        <FormSection title="Identificação">
          <FormGrid cols={2}>
            <FormField label="Nome do orçamento" required>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Manutenção mensal — split sala XYZ" />
            </FormField>
            <FormField label="Cliente" required>
              <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)} placeholder="Selecione...">
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nomeFantasia ?? c.nome}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Validade" hint="Após esta data o orçamento não pode mais ser aprovado">
              <Input type="date" value={validadeEm} onChange={(e) => setValidadeEm(e.target.value)} />
            </FormField>
          </FormGrid>
          <FormField label="Descrição" hint="Resumo da proposta para o cliente">
            <Textarea value={descricao ?? ""} onChange={(e) => setDescricao(e.target.value)} rows={3} />
          </FormField>
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
            totalServicos={totalServicos}
            totalProdutos={totalProdutos}
            desconto={desconto}
            tipoDesconto={tipoDesconto}
            onDescontoChange={setDesconto}
            onTipoDescontoChange={setTipoDesconto}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pb-4">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" loading={salvando}>
          {mode === "novo" ? "Criar orçamento" : "Salvar alterações"}
        </Button>
      </div>
    </form>
  );
}
