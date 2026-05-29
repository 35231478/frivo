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
import type { TipoDesconto } from "@prisma/client";
import { AlertCircle, Tags } from "lucide-react";

interface ClienteOpt {
  id: string;
  nome: string;
  nomeFantasia?: string | null;
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
}

interface OrcamentoFormProps {
  mode: "novo" | "editar";
  clientes: ClienteOpt[];
  catalogoServicos: CatalogoItem[];
  catalogoProdutos: CatalogoItem[];
  inicial?: OrcamentoInicial;
  clienteIdInicial?: string;
  osInicialId?: string;
  osInicial?: OsItem;
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
  inicial,
  clienteIdInicial,
  osInicialId,
  osInicial,
}: OrcamentoFormProps) {
  const router = useRouter();

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
    const limpar = (it: ItemTabela) => ({
      catalogoId: it.catalogoId ?? null,
      descricao: it.descricao.trim(),
      quantidade: Number(it.quantidade) || 0,
      valorUnitario: Number(it.valorUnitario) || 0,
      observacao: it.observacao ?? null,
    });
    const servPayload = servicos.filter((s) => s.descricao.trim()).map(limpar);
    const prodPayload = produtos.filter((p) => p.descricao.trim()).map(limpar);

    const payload = {
      nome: nome.trim(),
      clienteId,
      descricao: descricao?.trim() || null,
      observacao: observacao?.trim() || null,
      validadeEm: validadeEm || null,
      desconto: Number(desconto) || 0,
      tipoDesconto,
      servicos: servPayload,
      produtos: prodPayload,
      ordensServicoIds: ordensIds,
    };

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
          titulo="Serviços"
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
