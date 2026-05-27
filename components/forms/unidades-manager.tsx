"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Plus, Pencil, Trash2, X, Check, Building2, Star, ChevronDown, ChevronRight, MapPin, Navigation, Smartphone, Search } from "lucide-react";

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
}

const emptyForm: UnidadeFormData = {
  nome: "", principal: false, logradouro: "", numero: "", complemento: "",
  bairro: "", cidade: "", estado: "", cep: "",
  latitude: null, longitude: null, telefone: "", observacoes: "",
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
  enderecoCliente?: EnderecoCliente;
}

export function UnidadesManager({ clienteId, unidadesIniciais, enderecoCliente }: UnidadesManagerProps) {
  const [unidades, setUnidades] = useState<Unidade[]>(unidadesIniciais);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<UnidadeFormData>(emptyForm);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
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

  function toggleExpand(id: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function abrirNova() {
    const temPrincipal = unidades.some((u) => u.principal);
    const f: UnidadeFormData = { ...emptyForm, principal: !temPrincipal };
    if (unidades.length === 0 && enderecoCliente) {
      f.nome = "Matriz";
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
      telefone: u.telefone ?? "", observacoes: u.observacoes ?? "",
    });
    setEditando(u.id);
    setExpandido((prev) => { const n = new Set(prev); n.add(u.id); return n; });
    setErro("");
  }

  function cancelar() { setEditando(null); setErro(""); }

  function updateField(field: keyof UnidadeFormData, value: any) {
    setForm((f) => ({ ...f, [field]: value }));
  }

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
        setExpandido((prev) => { const n = new Set(prev); n.add(nova.id); return n; });
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
    try {
      const res = await fetch(`/api/unidades/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _marcarPrincipal: true }),
      });
      if (!res.ok) return;
      setUnidades((prev) => prev.map((u) => ({ ...u, principal: u.id === id })));
    } catch {}
  }

  async function remover(id: string) {
    const u = unidades.find((u) => u.id === id);
    if (u?.principal) { setErro("Não é possível remover o endereço principal."); return; }
    if (!confirm("Tem certeza que deseja remover este endereço?")) return;
    setErro("");
    try {
      const res = await fetch(`/api/unidades/${id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao remover."); return; }
      setUnidades((prev) => prev.filter((u) => u.id !== id));
    } catch { setErro("Erro de conexão."); }
  }

  const ordenadas = [...unidades].sort((a, b) => {
    if (a.principal && !b.principal) return -1;
    if (!a.principal && b.principal) return 1;
    return a.nome.localeCompare(b.nome);
  });

  function enderecoTexto(u: Unidade): string {
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
          <Button type="button" loading={salvando} onClick={salvar}>
            <Check className="w-4 h-4" /> {editando === "novo" ? "Adicionar" : "Salvar"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {ordenadas.length === 0 && !editando && (
        <p className="text-sm text-gray-400 py-2">Nenhum endereço cadastrado.</p>
      )}

      {ordenadas.map((u) => {
        if (editando === u.id) return <div key={u.id}>{renderFormInline()}</div>;
        const aberto = expandido.has(u.id);
        const temEnd = !!(u.logradouro && u.cidade && u.estado);
        const dist = calcDistancia(u);

        return (
          <div key={u.id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button type="button" onClick={() => toggleExpand(u.id)}
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
                    {dist && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">
                        <Navigation className="w-2.5 h-2.5" /> {dist} da empresa
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
                  {u.observacoes && <div className="col-span-2 mt-1"><span className="text-gray-400">Obs:</span> <span className="text-gray-700">{u.observacoes}</span></div>}
                </div>

                {temEnd && (
                  <MapaEndereco logradouro={u.logradouro!} numero={u.numero ?? undefined} cidade={u.cidade!} estado={u.estado!} cep={u.cep ?? undefined} />
                )}

                {/* Card Técnico mais próximo */}
                <div className="flex items-center gap-3 p-2.5 bg-gray-100 rounded-lg">
                  <Smartphone className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-xs font-medium text-gray-500">Técnico mais próximo</p>
                    <p className="text-[11px] text-gray-400">App do técnico necessário — disponível em breve</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button type="button" variant="secondary" onClick={() => abrirEditar(u)} className="text-xs h-7 px-2.5">
                    <Pencil className="w-3 h-3" /> Editar
                  </Button>
                  {!u.principal && (
                    <>
                      <Button type="button" variant="ghost" onClick={() => marcarPrincipal(u.id)} className="text-xs h-7 px-2.5 text-amber-600 hover:text-amber-700">
                        <Star className="w-3 h-3" /> Tornar principal
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => remover(u.id)} className="text-xs h-7 px-2.5 text-red-500 hover:text-red-700">
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
