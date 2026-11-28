"use client";

import { InativarRegistro } from "@/components/ui/inativar-registro";
import { SecaoInativos } from "@/components/forms/secao-inativos";
import { useState, useEffect, useCallback } from "react";

import { enderecoDoCep } from "@/lib/cep";
import { CampoCep } from "@/components/ui/campo-cep";

import { useAutoGeocode } from "@/hooks/use-auto-geocode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { MapaEndereco } from "@/components/ui/mapa-endereco";
import { EnderecoAutocomplete, type EnderecoSelecionado } from "@/components/ui/endereco-autocomplete";
import { haversine, formatarDistancia } from "@/lib/geo";
import type { Unidade } from "@prisma/client";
import { Plus, Pencil, X, Check, Navigation, MapPin } from "lucide-react";
import { enderecoEmUmaLinha } from "@/lib/clientes/ficha";
import { MODOS_PEDIDO, ROTULO_HERDA, ROTULO_MODO_PEDIDO } from "@/lib/pedido-cliente/regra";
import { cn, comparaNatural } from "@/lib/utils";

const CAMPOS_ENDERECO_UNIDADE = { logradouro: "logradouro", bairro: "bairro", cidade: "cidade", estado: "estado" } as const;

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

interface UnidadeFormData {
  nome: string;
  principal: boolean;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  latitude: number | null;
  longitude: number | null;
  telefone: string;
  observacoes: string;
  /** Pedido do cliente nesta unidade; "" = como o cliente */
  exigePedido: string;
}

const emptyForm: UnidadeFormData = {
  nome: "", principal: false, logradouro: "", numero: "", complemento: "",
  bairro: "", cidade: "", estado: "", cep: "",
  latitude: null, longitude: null, telefone: "", observacoes: "", exigePedido: "",
};

interface EnderecoCliente {
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  cep?: string | null;
  telefone?: string | null;
}

interface EmpresaCoords {
  latitude: number | null;
  longitude: number | null;
}

interface UnidadesManagerProps {
  clienteId: string;
  unidadesIniciais: Unidade[];
  /** Endereços inativados: a seção "Inativos" reativa por aqui */
  inativosIniciais?: Unidade[];
  /** Endereço legado do cliente, usado para pré-preencher o 1º "Novo endereço" (não vem da consulta). */
  enderecoCliente?: EnderecoCliente;
  /** Consulta de quem não pode editar o cliente: só a lista, sem ações */
  somenteLeitura?: boolean;
}

export function UnidadesManager({ clienteId, unidadesIniciais, inativosIniciais = [], enderecoCliente, somenteLeitura = false }: UnidadesManagerProps) {
  const [unidades, setUnidades] = useState<Unidade[]>(unidadesIniciais);
  const [inativas, setInativas] = useState<Unidade[]>(inativosIniciais);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState<UnidadeFormData>(emptyForm);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [empresaCoords, setEmpresaCoords] = useState<EmpresaCoords>({ latitude: null, longitude: null });

  useEffect(() => {
    fetch("/api/empresa")
      .then((r) => r.json())
      .then((e) => setEmpresaCoords({ latitude: e.latitude, longitude: e.longitude }))
      .catch(() => {});
  }, []);

  function calcDistancia(u: Unidade): string | null {
    if (!empresaCoords.latitude || !empresaCoords.longitude) return null;
    const lat = (u as any).latitude as number | null;
    const lng = (u as any).longitude as number | null;
    if (!lat || !lng) return null;
    return formatarDistancia(haversine(empresaCoords.latitude, empresaCoords.longitude, lat, lng));
  }

  const handleAutoGeocode = useCallback((coords: { lat: number; lng: number }) => {
    if (editando) {
      setForm((f) => ({ ...f, latitude: coords.lat, longitude: coords.lng }));
    }
  }, [editando]);

  useAutoGeocode(
    { logradouro: editando ? form.logradouro : "", numero: form.numero, cidade: form.cidade, estado: form.estado },
    handleAutoGeocode,
  );

  function abrirNova() {
    const temPrincipal = unidades.some((u) => u.principal);
    const f: UnidadeFormData = { ...emptyForm, principal: !temPrincipal };
    if (unidades.length === 0 && enderecoCliente) {
      f.nome = "Principal";
      f.logradouro = enderecoCliente.endereco ?? "";
      f.numero = enderecoCliente.numero ?? "";
      f.complemento = enderecoCliente.complemento ?? "";
      f.bairro = enderecoCliente.bairro ?? "";
      f.cidade = enderecoCliente.cidade ?? "";
      f.estado = enderecoCliente.estado ?? "";
      f.cep = enderecoCliente.cep ?? "";
      f.telefone = enderecoCliente.telefone ?? "";
    }
    setForm(f);
    setEditando("novo");
    setErro("");
  }

  function abrirEditar(u: Unidade) {
    setForm({
      nome: u.nome, principal: u.principal,
      logradouro: u.logradouro ?? "", numero: u.numero ?? "",
      complemento: u.complemento ?? "", bairro: u.bairro ?? "",
      cidade: u.cidade ?? "", estado: u.estado ?? "", cep: u.cep ?? "",
      latitude: u.latitude, longitude: u.longitude,
      telefone: u.telefone ?? "", observacoes: u.observacoes ?? "", exigePedido: (u as { exigePedido?: string | null }).exigePedido ?? "",
    });
    setEditando(u.id);
    setErro("");
  }

  function cancelar() { setEditando(null); setErro(""); }

  function updateField(field: keyof UnidadeFormData, value: any) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleEnderecoSelect(e: EnderecoSelecionado) {
    setForm((f) => ({
      ...f,
      logradouro: e.logradouro,
      numero: e.numero || f.numero,
      bairro: e.bairro,
      cidade: e.cidade,
      estado: e.estado,
      cep: e.cep,
      latitude: e.latitude,
      longitude: e.longitude,
    }));
  }

  async function salvar() {
    if (!form.nome.trim()) { setErro("Nome do endereço é obrigatório."); return; }
    setSalvando(true); setErro("");
    const payload = { ...form, clienteId };
    try {
      if (editando === "novo") {
        const res = await fetch("/api/unidades", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar endereço."); return; }
        const nova = await res.json();
        setUnidades((prev) => [...prev, nova]);
      } else {
        const res = await fetch(`/api/unidades/${editando}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao atualizar."); return; }
        const atualizada = await res.json();
        setUnidades((prev) => prev.map((u) => (u.id === editando ? atualizada : u)));
      }
      setEditando(null);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function marcarPrincipal(id: string) {
    setErro("");
    try {
      const res = await fetch(`/api/unidades/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _marcarPrincipal: true }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Não foi possível tornar este endereço o principal."); return; }
      setUnidades((prev) => prev.map((u) => ({ ...u, principal: u.id === id })));
    } catch { setErro("Erro de conexão."); }
  }

  // Inativar e reativar pelo botão padrão dos cadastros (InativarRegistro): o mesmo texto, o impacto
  // daquele local (GET /api/unidades/[id]/impacto) e o bloqueio do principal e dos equipamentos ativos.
  function inativada(u: Unidade) {
    setUnidades((prev) => prev.filter((x) => x.id !== u.id));
    setInativas((prev) => [...prev, { ...u, ativo: false }].sort((a, b) => comparaNatural(a.nome, b.nome)));
  }
  function reativada(u: Unidade, dados?: Unidade) {
    setInativas((prev) => prev.filter((x) => x.id !== u.id));
    setUnidades((prev) => [...prev, { ...u, ...dados, ativo: true }]);
  }

  const ordenadas = [...unidades].sort((a, b) => {
    if (a.principal && !b.principal) return -1;
    if (!a.principal && b.principal) return 1;
    return comparaNatural(a.nome, b.nome);
  });

  function renderFormInline() {
    return (
      <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-frivo-800">
            {editando === "novo" ? "Novo endereço" : "Editar endereço"}
          </h4>
          <button type="button" onClick={cancelar} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
        </div>

        <FormGrid>
          <FormField label="Nome do endereço" required>
            <Input value={form.nome} onChange={(e) => updateField("nome", e.target.value)} placeholder="Ex: Matriz, Filial, Depósito" />
          </FormField>
          <FormField label="Telefone">
            <Input value={form.telefone} onChange={(e) => updateField("telefone", e.target.value)} placeholder="(00) 0000-0000" />
          </FormField>
        </FormGrid>

        <FormGrid cols={3}>
          <CampoCep valor={form.cep} onValor={(v) => updateField("cep", v)}
            onEndereco={(d) => setForm((f) => ({ ...f, ...enderecoDoCep(f, d, CAMPOS_ENDERECO_UNIDADE) }))} />
          <FormField label="Logradouro" className="sm:col-span-2">
            <EnderecoAutocomplete
              value={form.logradouro}
              onChange={(v) => updateField("logradouro", v)}
              onSelect={handleEnderecoSelect}
              placeholder="Rua, avenida…"
            />
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label="Número">
            <Input value={form.numero} onChange={(e) => updateField("numero", e.target.value)} />
          </FormField>
          <FormField label="Complemento">
            <Input value={form.complemento} onChange={(e) => updateField("complemento", e.target.value)} />
          </FormField>
          <FormField label="Bairro">
            <Input value={form.bairro} onChange={(e) => updateField("bairro", e.target.value)} />
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label="Cidade" className="sm:col-span-2">
            <Input value={form.cidade} onChange={(e) => updateField("cidade", e.target.value)} />
          </FormField>
          <FormField label="UF">
            <Select value={form.estado} onChange={(e) => updateField("estado", e.target.value)} placeholder="UF">
              {ESTADOS_BR.map((uf) => (<option key={uf} value={uf}>{uf}</option>))}
            </Select>
          </FormField>
        </FormGrid>
        <FormField label="Observações">
          <Textarea value={form.observacoes} onChange={(e) => updateField("observacoes", e.target.value)} rows={2} />
        </FormField>
        <FormField label="Exige pedido do cliente" dica="Uma unidade pode ter a regra dela (ex.: uma filial que paga com o pedido de compra dela). Sem escolher, vale a do cliente.">
          <Select value={form.exigePedido} onChange={(e) => updateField("exigePedido", e.target.value)} aria-label="Exige pedido do cliente nesta unidade" data-unidade-pedido className="max-w-[300px]">
            <option value="">{ROTULO_HERDA}</option>
            {MODOS_PEDIDO.map((m) => <option key={m} value={m}>{ROTULO_MODO_PEDIDO[m]}</option>)}
          </Select>
        </FormField>

        {form.logradouro && form.cidade && form.estado && (
          <MapaEndereco logradouro={form.logradouro} numero={form.numero} cidade={form.cidade} estado={form.estado} cep={form.cep} />
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar}>
            <Check className="w-4 h-4" /> Salvar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {erro && <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-enderecos>{erro}</div>}

      {ordenadas.length === 0 && !editando && (
        <p className="text-sm text-ink-muted py-2" data-enderecos-vazio>Nenhum local de atendimento cadastrado.</p>
      )}

      {/* Leva H: lista enxuta — nome, selo Principal e o endereço numa linha; as ações ao lado (sem sanfona) */}
      {ordenadas.length > 0 && (
        <ul className="rounded-lg border border-surface-border divide-y divide-surface-border bg-white" data-lista-enderecos>
          {ordenadas.map((u) => {
            if (editando === u.id) return <li key={u.id} className="p-2">{renderFormInline()}</li>;
            const linha = enderecoEmUmaLinha(u);
            const dist = calcDistancia(u);
            return (
              <li key={u.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3" data-endereco={u.id}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 flex-wrap text-sm font-semibold text-ink">
                    <MapPin className="w-4 h-4 text-ink-muted shrink-0" aria-hidden />
                    <span data-endereco-nome>{u.nome}</span>
                    {u.principal && <span className="text-[10px] font-semibold uppercase tracking-wider text-acento bg-acento-claro rounded px-1.5 py-0.5" data-endereco-principal>Principal</span>}
                    {dist && <span className="inline-flex items-center gap-0.5 text-[11px] font-normal text-ink-muted"><Navigation className="w-3 h-3" aria-hidden /> {dist}</span>}
                  </p>
                  <p className={cn("text-sm mt-0.5 sm:pl-6 break-words", linha ? "text-ink-muted" : "text-ink-muted italic")}>{linha || "Sem endereço preenchido"}</p>
                </div>
                {!somenteLeitura && (
                  <div className="flex items-center gap-1 flex-wrap shrink-0 sm:justify-end">
                    <Button type="button" variant="ghost" onClick={() => abrirEditar(u)} className="min-h-[44px] text-sm" data-editar-endereco={u.id}>
                      <Pencil className="w-4 h-4" aria-hidden /> Editar
                    </Button>
                    {!u.principal && (
                      <>
                        <Button type="button" variant="ghost" onClick={() => marcarPrincipal(u.id)} className="min-h-[44px] text-sm" data-tornar-principal={u.id}>
                          Tornar principal
                        </Button>
                        <InativarRegistro url={`/api/unidades/${u.id}`} modulo="clientes" acaoInativar="editar" acaoReativar="editar"
                          ativo nome={u.nome} entidade="endereço" variante="botao" comMotivo={false}
                          className="min-h-[44px] text-sm border-transparent bg-transparent"
                          aoConcluir={() => inativada(u)} />
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editando === "novo" && renderFormInline()}

      <SecaoInativos itens={inativas} detalhe={(u) => [u.logradouro, u.numero].filter(Boolean).join(", ") || u.cidade}
        acao={(u) => somenteLeitura ? null : (
          <InativarRegistro url={`/api/unidades/${u.id}`} modulo="clientes" acaoInativar="editar" acaoReativar="editar"
            ativo={false} nome={u.nome} entidade="endereço" aoConcluir={(_, dados) => reativada(u, dados)} />
        )} />

      {!editando && !somenteLeitura && (
        <Button type="button" variant="secondary" onClick={abrirNova} className="min-h-[44px]" data-novo-endereco>
          <Plus className="w-4 h-4" /> Novo endereço
        </Button>
      )}
    </div>
  );
}
