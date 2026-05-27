"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { LABELS_TIPO_INTERACAO } from "@/lib/utils";
import { formatarDataHora } from "@/lib/utils";
import { Plus, X, Check, Phone, Mail, MessageCircle, MapPin, Users } from "lucide-react";

interface Interacao {
  id: string;
  tipo: string;
  descricao: string;
  criadoEm: string | Date;
  usuario: { id: string; nome: string };
}

const ICONE_TIPO: Record<string, React.ReactNode> = {
  LIGACAO: <Phone className="w-3.5 h-3.5" />,
  VISITA: <MapPin className="w-3.5 h-3.5" />,
  EMAIL: <Mail className="w-3.5 h-3.5" />,
  WHATSAPP: <MessageCircle className="w-3.5 h-3.5" />,
  REUNIAO: <Users className="w-3.5 h-3.5" />,
};

const COR_TIPO: Record<string, string> = {
  LIGACAO: "bg-blue-100 text-blue-600",
  VISITA: "bg-purple-100 text-purple-600",
  EMAIL: "bg-gray-100 text-gray-600",
  WHATSAPP: "bg-green-100 text-green-600",
  REUNIAO: "bg-orange-100 text-orange-600",
};

interface InteracoesManagerProps {
  clienteId: string;
  interacoesIniciais: Interacao[];
}

export function InteracoesManager({ clienteId, interacoesIniciais }: InteracoesManagerProps) {
  const [interacoes, setInteracoes] = useState<Interacao[]>(interacoesIniciais);
  const [mostraForm, setMostraForm] = useState(false);
  const [tipo, setTipo] = useState("LIGACAO");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!descricao.trim()) { setErro("Descrição é obrigatória."); return; }
    setSalvando(true); setErro("");
    try {
      const res = await fetch(`/api/clientes/${clienteId}/interacoes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, descricao }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro."); return; }
      const nova = await res.json();
      setInteracoes((prev) => [nova, ...prev]);
      setMostraForm(false);
      setDescricao("");
      setTipo("LIGACAO");
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-3">
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}

      {mostraForm ? (
        <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-frivo-800">Registrar interação</h4>
            <button type="button" onClick={() => setMostraForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <FormGrid>
            <FormField label="Tipo">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(LABELS_TIPO_INTERACAO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
          </FormGrid>
          <FormField label="Descrição / Anotação" required>
            <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="O que foi tratado nesta interação…" rows={3} />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMostraForm(false)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> Registrar</Button>
          </div>
        </div>
      ) : (
        <Button type="button" variant="secondary" onClick={() => setMostraForm(true)} className="w-full justify-center border-dashed">
          <Plus className="w-4 h-4" /> Registrar interação
        </Button>
      )}

      {interacoes.length === 0 && !mostraForm && (
        <p className="text-sm text-gray-400 py-2 text-center">Nenhuma interação registrada.</p>
      )}

      {interacoes.length > 0 && (
        <div className="relative ml-4 border-l-2 border-gray-200 space-y-0">
          {interacoes.map((i) => (
            <div key={i.id} className="relative pl-6 pb-4">
              <div className={`absolute -left-[11px] top-1 w-5 h-5 rounded-full flex items-center justify-center ${COR_TIPO[i.tipo] ?? "bg-gray-100 text-gray-600"}`}>
                {ICONE_TIPO[i.tipo] ?? <MessageCircle className="w-3.5 h-3.5" />}
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-medium text-gray-600">{LABELS_TIPO_INTERACAO[i.tipo] ?? i.tipo}</span>
                  <span>•</span>
                  <span>{formatarDataHora(i.criadoEm)}</span>
                  <span>•</span>
                  <span>{i.usuario.nome}</span>
                </div>
                <p className="text-sm text-gray-700 mt-0.5">{i.descricao}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
