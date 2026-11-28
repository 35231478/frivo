"use client";

import { useState, useCallback } from "react";
import { useAutoGeocode } from "@/hooks/use-auto-geocode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { MapaEndereco } from "@/components/ui/mapa-endereco";
import { EnderecoAutocomplete, type EnderecoSelecionado } from "@/components/ui/endereco-autocomplete";
import { Plus, Pencil, Trash2, X, Check, MapPin } from "lucide-react";
import { enderecoEmUmaLinha } from "@/lib/clientes/ficha";
import { enderecoDoCep } from "@/lib/cep";
import { CampoCep } from "@/components/ui/campo-cep";

import { cn, comparaNatural } from "@/lib/utils";

const CAMPOS_ENDERECO_UNIDADE = { logradouro: "logradouro", bairro: "bairro", cidade: "cidade", estado: "estado" } as const;

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

export interface UnidadeLocal {
  _tempId: string;
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
}

const emptyForm = (): UnidadeLocal => ({
  _tempId: crypto.randomUUID(),
  nome: "", principal: false, logradouro: "", numero: "", complemento: "",
  bairro: "", cidade: "", estado: "", cep: "",
  latitude: null, longitude: null, telefone: "", observacoes: "",
});

interface UnidadesLocalProps {
  unidades: UnidadeLocal[];
  onChange: (unidades: UnidadeLocal[]) => void;
  /** Leva H: o endereço principal está nos campos do cadastro (vira o local "Principal" ao salvar): aqui só os outros */
  principalNoCadastro?: boolean;
}

export function UnidadesLocal({ unidades, onChange, principalNoCadastro = false }: UnidadesLocalProps) {
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [form, setForm] = useState<UnidadeLocal>(emptyForm());

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
    const f = emptyForm();
    f.principal = !principalNoCadastro && !temPrincipal;
    // Sem nome sugerido "Principal": o servidor já cria o "Principal" do endereço principal (não fica repetido)
    setForm(f);
    setEditando("novo");
  }

  function abrirEditar(u: UnidadeLocal) {
    setForm({ ...u });
    setEditando(u._tempId);
  }

  function cancelar() { setEditando(null); }

  function updateField(field: keyof UnidadeLocal, value: any) {
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

  function salvar() {
    if (!form.nome.trim()) return;
    if (editando === "novo") {
      onChange([...unidades, form]);
    } else {
      onChange(unidades.map((u) => (u._tempId === editando ? form : u)));
    }
    setEditando(null);
  }

  function marcarPrincipal(id: string) {
    onChange(unidades.map((u) => ({ ...u, principal: u._tempId === id })));
  }

  function remover(id: string) {
    const u = unidades.find((u) => u._tempId === id);
    const resto = unidades.filter((x) => x._tempId !== id);
    // Excluiu o principal: o próximo da lista (na ordem da tela) passa a ser o principal
    if (u?.principal && resto.length > 0 && !resto.some((x) => x.principal)) {
      const proximo = [...resto].sort((a, b) => comparaNatural(a.nome, b.nome))[0]._tempId;
      onChange(resto.map((x) => ({ ...x, principal: x._tempId === proximo })));
      return;
    }
    onChange(resto);
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
            <Input value={form.nome} onChange={(e) => updateField("nome", e.target.value)} caixa="nome" placeholder="Ex: Matriz, Filial, Depósito" />
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
            <Input value={form.complemento} onChange={(e) => updateField("complemento", e.target.value)} caixa="endereco" />
          </FormField>
          <FormField label="Bairro">
            <Input value={form.bairro} onChange={(e) => updateField("bairro", e.target.value)} caixa="endereco" />
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label="Cidade" className="sm:col-span-2">
            <Input value={form.cidade} onChange={(e) => updateField("cidade", e.target.value)} caixa="cidade" />
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

        {form.logradouro && form.cidade && form.estado && (
          <MapaEndereco logradouro={form.logradouro} numero={form.numero} cidade={form.cidade} estado={form.estado} cep={form.cep} />
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={!form.nome.trim()}>
            <Check className="w-4 h-4" /> Salvar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ordenadas.length === 0 && !editando && (
        <p className="text-sm text-ink-muted py-2" data-enderecos-vazio>Nenhum outro local de atendimento.</p>
      )}

      {ordenadas.length > 0 && (
        <ul className="rounded-lg border border-surface-border divide-y divide-surface-border bg-white" data-lista-enderecos>
          {ordenadas.map((u) => {
            if (editando === u._tempId) return <li key={u._tempId} className="p-2">{renderFormInline()}</li>;
            const linha = enderecoEmUmaLinha({ id: u._tempId, ...u });
            return (
              <li key={u._tempId} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3" data-endereco={u._tempId}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 flex-wrap text-sm font-semibold text-ink">
                    <MapPin className="w-4 h-4 text-ink-muted shrink-0" aria-hidden />
                    <span data-endereco-nome>{u.nome}</span>
                    {u.principal && !principalNoCadastro && <span className="text-[10px] font-semibold uppercase tracking-wider text-acento bg-acento-claro rounded px-1.5 py-0.5" data-endereco-principal>Principal</span>}
                  </p>
                  <p className={cn("text-sm text-ink-muted mt-0.5 sm:pl-6 break-words", !linha && "italic")}>{linha || "Sem endereço preenchido"}</p>
                </div>
                <div className="flex items-center gap-1 flex-wrap shrink-0 sm:justify-end">
                  <Button type="button" variant="ghost" onClick={() => abrirEditar(u)} className="min-h-[44px] text-sm">
                    <Pencil className="w-4 h-4" aria-hidden /> Editar
                  </Button>
                  {!u.principal && !principalNoCadastro && <Button type="button" variant="ghost" onClick={() => marcarPrincipal(u._tempId)} className="min-h-[44px] text-sm">Tornar principal</Button>}
                  {/* Ainda não foi salvo: excluir sempre vale (o principal passa para o próximo) */}
                  <Button type="button" variant="ghost" onClick={() => remover(u._tempId)} className="min-h-[44px] text-sm text-atrasado hover:text-atrasado-texto" data-excluir-endereco={u._tempId}>
                    <Trash2 className="w-4 h-4" aria-hidden /> Excluir
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editando === "novo" && renderFormInline()}

      {!editando && (
        <Button type="button" variant="secondary" onClick={abrirNova} className="min-h-[44px]" data-novo-endereco>
          <Plus className="w-4 h-4" /> Novo endereço
        </Button>
      )}
    </div>
  );
}
