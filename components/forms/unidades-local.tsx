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
import { Plus, Pencil, Trash2, X, Check, Building2, Star, ChevronDown, ChevronRight, MapPin, Search } from "lucide-react";

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
}

export function UnidadesLocal({ unidades, onChange }: UnidadesLocalProps) {
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<UnidadeLocal>(emptyForm());
  const [buscandoCep, setBuscandoCep] = useState(false);

  const handleAutoGeocode = useCallback((coords: { lat: number; lng: number }) => {
    if (editando) {
      setForm((f) => ({ ...f, latitude: coords.lat, longitude: coords.lng }));
    }
  }, [editando]);

  useAutoGeocode(
    { logradouro: editando ? form.logradouro : "", numero: form.numero, cidade: form.cidade, estado: form.estado },
    handleAutoGeocode,
  );

  async function buscarCep() {
    const cep = form.cep.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((f) => ({
          ...f,
          logradouro: data.logradouro ?? f.logradouro,
          bairro: data.bairro ?? f.bairro,
          cidade: data.localidade ?? f.cidade,
          estado: data.uf ?? f.estado,
          complemento: data.complemento ?? f.complemento,
        }));
      }
    } catch {} finally { setBuscandoCep(false); }
  }

  function toggleExpand(id: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function abrirNova() {
    const temPrincipal = unidades.some((u) => u.principal);
    const f = emptyForm();
    f.principal = !temPrincipal;
    if (unidades.length === 0) f.nome = "Matriz";
    setForm(f);
    setEditando("novo");
  }

  function abrirEditar(u: UnidadeLocal) {
    setForm({ ...u });
    setEditando(u._tempId);
    setExpandido((prev) => { const n = new Set(prev); n.add(u._tempId); return n; });
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
      setExpandido((prev) => { const n = new Set(prev); n.add(form._tempId); return n; });
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
    if (u?.principal) return;
    onChange(unidades.filter((u) => u._tempId !== id));
  }

  const ordenadas = [...unidades].sort((a, b) => {
    if (a.principal && !b.principal) return -1;
    if (!a.principal && b.principal) return 1;
    return a.nome.localeCompare(b.nome);
  });

  function enderecoTexto(u: UnidadeLocal): string {
    return [u.logradouro, u.numero, u.bairro, u.cidade, u.estado].filter(Boolean).join(", ") || "Sem endereço";
  }

  function renderFormInline() {
    return (
      <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-frivo-800">
            {editando === "novo" ? "Novo endereço" : "Editar endereço"}
          </h4>
          <button type="button" onClick={cancelar} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <FormGrid>
          <FormField label="Nome do endereço" required>
            <Input value={form.nome} onChange={(e) => updateField("nome", e.target.value)} placeholder="Ex: Matriz, Filial, Depósito" />
          </FormField>
          <FormField label="Telefone">
            <Input value={form.telefone} onChange={(e) => updateField("telefone", e.target.value)} placeholder="(00) 0000-0000" />
          </FormField>
        </FormGrid>

        <FormField label="Logradouro" hint="Digite para buscar automaticamente">
          <EnderecoAutocomplete
            value={form.logradouro}
            onChange={(v) => updateField("logradouro", v)}
            onSelect={handleEnderecoSelect}
            placeholder="Rua, Av., etc."
          />
        </FormField>

        <FormGrid cols={3}>
          <FormField label="Número">
            <Input value={form.numero} onChange={(e) => updateField("numero", e.target.value)} />
          </FormField>
          <FormField label="Complemento" className="sm:col-span-2">
            <Input value={form.complemento} onChange={(e) => updateField("complemento", e.target.value)} />
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label="Bairro">
            <Input value={form.bairro} onChange={(e) => updateField("bairro", e.target.value)} />
          </FormField>
          <FormField label="Cidade">
            <Input value={form.cidade} onChange={(e) => updateField("cidade", e.target.value)} />
          </FormField>
          <FormField label="Estado">
            <Select value={form.estado} onChange={(e) => updateField("estado", e.target.value)} placeholder="UF">
              {ESTADOS_BR.map((uf) => (<option key={uf} value={uf}>{uf}</option>))}
            </Select>
          </FormField>
        </FormGrid>
        <FormField label="CEP" hint="Digite o CEP e clique na lupa para preencher o endereço">
          <div className="flex gap-2 max-w-[300px]">
            <Input value={form.cep} onChange={(e) => updateField("cep", e.target.value)} placeholder="00000-000" maxLength={9} />
            <Button type="button" variant="secondary" loading={buscandoCep} onClick={buscarCep} className="shrink-0 px-3">
              <Search className="w-4 h-4" />
            </Button>
          </div>
        </FormField>
        <FormField label="Observações">
          <Textarea value={form.observacoes} onChange={(e) => updateField("observacoes", e.target.value)} rows={2} />
        </FormField>

        {form.logradouro && form.cidade && form.estado && (
          <MapaEndereco logradouro={form.logradouro} numero={form.numero} cidade={form.cidade} estado={form.estado} cep={form.cep} />
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={cancelar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={!form.nome.trim()}>
            <Check className="w-4 h-4" /> {editando === "novo" ? "Adicionar" : "Salvar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ordenadas.length === 0 && !editando && (
        <p className="text-sm text-gray-400 py-2">Nenhum endereço adicionado. Adicione pelo menos o endereço principal.</p>
      )}

      {ordenadas.map((u) => {
        if (editando === u._tempId) return <div key={u._tempId}>{renderFormInline()}</div>;
        const aberto = expandido.has(u._tempId);
        const temEnd = !!(u.logradouro && u.cidade && u.estado);

        return (
          <div key={u._tempId} className="border border-gray-200 rounded-lg overflow-hidden">
            <button type="button" onClick={() => toggleExpand(u._tempId)}
              className="flex items-center justify-between w-full p-3 text-left hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{u.nome}</span>
                    {u.principal && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                        <Star className="w-2.5 h-2.5 fill-current" /> Principal
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate">{enderecoTexto(u)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {temEnd && <MapPin className="w-3 h-3 text-green-500" />}
                {aberto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </div>
            </button>

            {aberto && (
              <div className="border-t border-gray-100 p-3 space-y-3 bg-gray-50/50">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {u.logradouro && <div className="col-span-2"><span className="text-gray-400">Logradouro:</span> <span className="text-gray-700">{u.logradouro}{u.numero ? `, ${u.numero}` : ""}</span></div>}
                  {u.complemento && <div className="col-span-2"><span className="text-gray-400">Complemento:</span> <span className="text-gray-700">{u.complemento}</span></div>}
                  {u.bairro && <div><span className="text-gray-400">Bairro:</span> <span className="text-gray-700">{u.bairro}</span></div>}
                  {u.cep && <div><span className="text-gray-400">CEP:</span> <span className="text-gray-700">{u.cep}</span></div>}
                  {u.cidade && <div><span className="text-gray-400">Cidade:</span> <span className="text-gray-700">{u.cidade} — {u.estado}</span></div>}
                  {u.telefone && <div><span className="text-gray-400">Telefone:</span> <span className="text-gray-700">{u.telefone}</span></div>}
                </div>

                {temEnd && (
                  <MapaEndereco logradouro={u.logradouro} numero={u.numero} cidade={u.cidade} estado={u.estado} cep={u.cep} />
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Button type="button" variant="secondary" onClick={() => abrirEditar(u)} className="text-xs h-7 px-2.5">
                    <Pencil className="w-3 h-3" /> Editar
                  </Button>
                  {!u.principal && (
                    <>
                      <Button type="button" variant="ghost" onClick={() => marcarPrincipal(u._tempId)} className="text-xs h-7 px-2.5 text-amber-600 hover:text-amber-700">
                        <Star className="w-3 h-3" /> Tornar principal
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => remover(u._tempId)} className="text-xs h-7 px-2.5 text-red-500 hover:text-red-700">
                        <Trash2 className="w-3 h-3" /> Remover
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {editando === "novo" && renderFormInline()}

      {!editando && (
        <Button type="button" variant="secondary" onClick={abrirNova} className="w-full justify-center border-dashed mt-2">
          <Plus className="w-4 h-4" /> Adicionar endereço
        </Button>
      )}
    </div>
  );
}
