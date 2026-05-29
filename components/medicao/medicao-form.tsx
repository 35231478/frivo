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
import { LABELS_TIPO_MEDICAO, MESES_PT, formatarMoeda } from "@/lib/utils";
import { AlertCircle, Tags } from "lucide-react";

interface ClienteOpt {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
}

interface ContratoOpt {
  id: string;
  numero: string;
  clienteId: string;
  status: string;
}

interface MedicaoInicial {
  id?: string;
  numero?: string;
  clienteId: string;
  contratoId?: string | null;
  tipo: string;
  mes?: number | null;
  ano?: number | null;
  descricao?: string | null;
  observacao?: string | null;
  descontoValor: number;
  descontoPercent: number;
  servicos: ItemTabela[];
  produtos: ItemTabela[];
}

interface MedicaoFormProps {
  mode: "novo" | "editar";
  clientes: ClienteOpt[];
  catalogoServicos: CatalogoItem[];
  catalogoProdutos: CatalogoItem[];
  inicial?: MedicaoInicial;
  clienteIdInicial?: string;
}

function novoId() {
  return Math.random().toString(36).slice(2);
}

export function MedicaoForm({
  mode,
  clientes,
  catalogoServicos,
  catalogoProdutos,
  inicial,
  clienteIdInicial,
}: MedicaoFormProps) {
  const router = useRouter();
  const agora = new Date();

  const [clienteId, setClienteId] = useState(inicial?.clienteId ?? clienteIdInicial ?? "");
  const [contratoId, setContratoId] = useState(inicial?.contratoId ?? "");
  const [tipo, setTipo] = useState(inicial?.tipo ?? "MENSAL_FIXO");
  const [mes, setMes] = useState<number>(inicial?.mes ?? agora.getMonth() + 1);
  const [ano, setAno] = useState<number>(inicial?.ano ?? agora.getFullYear());
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [observacao, setObservacao] = useState(inicial?.observacao ?? "");
  const [descontoValor, setDescontoValor] = useState(Number(inicial?.descontoValor ?? 0));
  const [descontoPercent, setDescontoPercent] = useState(Number(inicial?.descontoPercent ?? 0));
  const [servicos, setServicos] = useState<ItemTabela[]>(
    inicial?.servicos.map((s) => ({ ...s, id: s.id || novoId() })) ?? [],
  );
  const [produtos, setProdutos] = useState<ItemTabela[]>(
    inicial?.produtos.map((p) => ({ ...p, id: p.id || novoId() })) ?? [],
  );

  const [contratos, setContratos] = useState<ContratoOpt[]>([]);
  const [tabelaPreco, setTabelaPreco] = useState<TabelaPrecoCliente | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!clienteId) {
      setContratos([]);
      setTabelaPreco(null);
      return;
    }
    fetch(`/api/contratos?clienteId=${clienteId}`)
      .then((r) => r.json())
      .then((data) => setContratos(Array.isArray(data) ? data : []))
      .catch(() => setContratos([]));
    fetch(`/api/clientes/${clienteId}/tabela-preco`)
      .then((r) => r.json())
      .then((d) => setTabelaPreco(d && d.itens ? d : null))
      .catch(() => setTabelaPreco(null));
  }, [clienteId]);

  const valorTotal = useMemo(() => {
    const all = [...servicos, ...produtos];
    return all.reduce((acc, it) => acc + (Number(it.quantidade) || 0) * (Number(it.valorUnitario) || 0), 0);
  }, [servicos, produtos]);

  const desconto = useMemo(() => {
    const d = (Number(descontoValor) || 0) + valorTotal * ((Number(descontoPercent) || 0) / 100);
    return Math.min(valorTotal, d);
  }, [descontoValor, descontoPercent, valorTotal]);

  const valorLiquido = Math.max(0, valorTotal - desconto);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    if (!clienteId) return setErro("Selecione um cliente.");
    if (servicos.length === 0 && produtos.length === 0) {
      return setErro("Adicione ao menos um serviço ou produto.");
    }

    const mapItem = (it: ItemTabela, t: "SERVICO" | "PRODUTO") => ({
      tipo: t,
      servicoId: t === "SERVICO" ? it.catalogoId ?? null : null,
      produtoId: t === "PRODUTO" ? it.catalogoId ?? null : null,
      descricao: it.descricao.trim(),
      quantidade: Number(it.quantidade) || 0,
      valorUnitario: Number(it.valorUnitario) || 0,
      observacao: it.observacao ?? null,
    });

    const itens = [
      ...servicos.filter((s) => s.descricao.trim()).map((s) => mapItem(s, "SERVICO")),
      ...produtos.filter((p) => p.descricao.trim()).map((p) => mapItem(p, "PRODUTO")),
    ];

    const payload = {
      clienteId,
      contratoId: contratoId || null,
      tipo,
      mes,
      ano,
      descricao: descricao?.trim() || null,
      observacao: observacao?.trim() || null,
      descontoValor: Number(descontoValor) || 0,
      descontoPercent: Number(descontoPercent) || 0,
      itens,
    };

    setSalvando(true);
    try {
      const url = mode === "novo" ? "/api/medicoes" : `/api/medicoes/${inicial!.id}`;
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
      router.push(`/financeiro/medicoes/${saved.id}`);
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
        title={mode === "novo" ? "Nova Medição" : `Editar ${inicial?.numero ?? "Medição"}`}
        description={mode === "novo" ? "Crie uma medição para faturamento" : "Edite os dados desta medição"}
        backHref={mode === "novo" ? "/financeiro/medicoes" : `/financeiro/medicoes/${inicial?.id}`}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
            <Button type="submit" loading={salvando} variant="primary">
              {mode === "novo" ? "Criar medição" : "Salvar alterações"}
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

      <div className="card-padded space-y-6">
        <FormSection title="Identificação">
          <FormGrid cols={2}>
            <FormField label="Cliente" required>
              <Select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setContratoId(""); }} placeholder="Selecione...">
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Tipo">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(LABELS_TIPO_MEDICAO).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Contrato vinculado" hint="Opcional — contratos do cliente selecionado">
              <Select value={contratoId} onChange={(e) => setContratoId(e.target.value)} placeholder="Nenhum">
                {contratos.map((c) => (
                  <option key={c.id} value={c.id}>{c.numero}</option>
                ))}
              </Select>
            </FormField>
          </FormGrid>
          <FormGrid cols={2}>
            <FormField label="Mês de referência">
              <Select value={String(mes)} onChange={(e) => setMes(Number(e.target.value))}>
                {MESES_PT.map((m, i) => (
                  <option key={i} value={i + 1}>{m}</option>
                ))}
              </Select>
            </FormField>
            <FormField label="Ano de referência">
              <Input type="number" min={2000} max={2100} value={ano} onChange={(e) => setAno(Number(e.target.value) || agora.getFullYear())} />
            </FormField>
          </FormGrid>
          <FormField label="Descrição">
            <Textarea value={descricao ?? ""} onChange={(e) => setDescricao(e.target.value)} rows={2} placeholder="Ex.: Medição mensal — contrato de manutenção" />
          </FormField>
          <FormField label="Observações internas">
            <Textarea value={observacao ?? ""} onChange={(e) => setObservacao(e.target.value)} rows={2} />
          </FormField>
        </FormSection>
      </div>

      <div className="card-padded">
        <ItensTabela titulo="Serviços" labelAdicionar="Buscar serviço por nome..." catalogo={catalogoServicos} itens={servicos} onChange={setServicos} tabela={tabelaPreco} />
      </div>

      <div className="card-padded">
        <ItensTabela titulo="Produtos" labelAdicionar="Buscar produto por nome..." catalogo={catalogoProdutos} itens={produtos} onChange={setProdutos} tabela={tabelaPreco} />
      </div>

      <div className="card-padded">
        <FormSection title="Totais">
          <FormGrid cols={2}>
            <FormField label="Desconto (R$)">
              <Input type="number" step="0.01" min="0" value={descontoValor} onChange={(e) => setDescontoValor(Number(e.target.value) || 0)} />
            </FormField>
            <FormField label="Desconto (%)">
              <Input type="number" step="0.01" min="0" max="100" value={descontoPercent} onChange={(e) => setDescontoPercent(Number(e.target.value) || 0)} />
            </FormField>
          </FormGrid>
          <div className="border-t border-surface-border pt-4 space-y-2 max-w-sm ml-auto">
            <div className="flex justify-between text-sm">
              <span className="text-ink-muted">Valor bruto</span>
              <span className="font-mono text-ink">{formatarMoeda(valorTotal)}</span>
            </div>
            {desconto > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-ink-muted">Desconto</span>
                <span className="font-mono text-red-600">- {formatarMoeda(desconto)}</span>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t-2 border-success-500/40">
              <span className="text-sm font-bold uppercase tracking-wider text-ink-muted">Valor líquido</span>
              <span className="text-xl font-bold text-success-700">{formatarMoeda(valorLiquido)}</span>
            </div>
          </div>
        </FormSection>
      </div>

      <div className="flex justify-end gap-2 pb-4">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" loading={salvando}>{mode === "novo" ? "Criar medição" : "Salvar alterações"}</Button>
      </div>
    </form>
  );
}
