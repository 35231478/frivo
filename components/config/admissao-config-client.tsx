"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import {
  CAMPOS_CONTRATO, DOCUMENTOS_PADRAO, MSG_VALIDADE, VALIDADE_MAX, VALIDADE_MIN,
  camposDesconhecidos, validadeValida, type DocumentoPedido,
} from "@/lib/admissao/admissao";

interface Config {
  contratoModelo: string;
  orientacoes: string;
  documentos: DocumentoPedido[];
  validadeDias: number;
  experienciaDias: number;
  experienciaProrrogacaoDias: number;
  camposDesconhecidos: string[];
}

const EXPERIENCIA_MAX = 90;
const idDoRotulo = (rotulo: string) =>
  rotulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/**
 * Configurações › Admissão digital: o que VARIA entre empresas — o modelo de contrato, os documentos
 * pedidos (obrigatórios × opcionais), as orientações finais, a validade do link e o período de
 * experiência. Nada disso é hardcoded no sistema.
 */
export function AdmissaoConfigClient() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [novoDoc, setNovoDoc] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admissoes/config");
        if (!res.ok) { setErro("Não foi possível carregar a configuração."); return; }
        setCfg(await res.json());
      } catch { setErro("Erro de conexão ao carregar."); }
    })();
  }, []);

  if (erro && !cfg) {
    return (
      <p className="flex items-start gap-2 text-sm text-atrasado-texto" data-config-erro>
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {erro}
      </p>
    );
  }
  if (!cfg) return <p className="text-sm text-ink-muted">Carregando…</p>;

  // `c` é o valor já conferido: as funções abaixo fecham sobre ele (o estado pode ser null)
  const c: Config = cfg;

  const set = <K extends keyof Config>(campo: K, valor: Config[K]) => setCfg((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  const desconhecidos = camposDesconhecidos(c.contratoModelo);
  const validadeOk = validadeValida(c.validadeDias);

  function addDocumento() {
    const rotulo = novoDoc.trim();
    if (!rotulo) return;
    const id = idDoRotulo(rotulo);
    if (!id || c.documentos.some((d) => d.id === id)) { setNovoDoc(""); return; }
    set("documentos", [...c.documentos, { id, rotulo, obrigatorio: false }]);
    setNovoDoc("");
  }

  async function salvar() {
    setErro("");
    if (!validadeOk) { setErro(MSG_VALIDADE); return; }
    setSalvando(true);
    try {
      const res = await fetch("/api/admissoes/config", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contratoModelo: c.contratoModelo, orientacoes: c.orientacoes, documentos: c.documentos,
          validadeDias: c.validadeDias, experienciaDias: c.experienciaDias,
          experienciaProrrogacaoDias: c.experienciaProrrogacaoDias,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d?.erro ?? "Não foi possível salvar."); return; }
      setCfg(d);
      toast("Configuração da admissão salva.");
    } catch { setErro("Erro de conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-6" data-config-admissao>
      {/* Documentos pedidos */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink flex items-center gap-1.5">
          Documentos pedidos
          <Dica rotulo="Documentos" texto="O colaborador só conclui o preenchimento depois de mandar todos os marcados como obrigatórios. Os opcionais aparecem na lista, sem travar." />
        </h3>
        <ul className="divide-y divide-surface-linha border border-surface-border rounded-lg">
          {c.documentos.map((d, i) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2.5" data-doc-config={d.id}>
              <input
                value={d.rotulo}
                onChange={(e) => set("documentos", c.documentos.map((x, y) => (y === i ? { ...x, rotulo: e.target.value } : x)))}
                aria-label={`Nome do documento ${i + 1}`}
                className="flex-1 min-w-0 bg-transparent text-sm text-ink border-0 focus:outline-none focus:ring-0 px-0"
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted shrink-0 cursor-pointer">
                <input type="checkbox" checked={d.obrigatorio} data-doc-obrigatorio={d.id}
                  onChange={(e) => set("documentos", c.documentos.map((x, y) => (y === i ? { ...x, obrigatorio: e.target.checked } : x)))}
                  className="accent-primary-600 w-4 h-4" />
                Obrigatório
              </label>
              <button type="button" onClick={() => set("documentos", c.documentos.filter((_, y) => y !== i))}
                aria-label={`Tirar ${d.rotulo}`} data-tirar-doc={d.id}
                className="p-1.5 rounded text-ink-muted hover:text-atrasado shrink-0">
                <Trash2 className="w-4 h-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input value={novoDoc} onChange={(e) => setNovoDoc(e.target.value)} placeholder="Ex.: Certificado NR-10"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDocumento(); } }} data-novo-doc />
          <Button type="button" variant="secondary" onClick={addDocumento} data-add-doc><Plus className="w-4 h-4" /> Adicionar</Button>
        </div>
        {c.documentos.length === 0 && (
          <button type="button" onClick={() => set("documentos", DOCUMENTOS_PADRAO)} className="text-sm text-primary-600 hover:underline" data-doc-padrao>
            Usar a lista padrão
          </button>
        )}
      </section>

      {/* Modelo de contrato */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink flex items-center gap-1.5">
          Modelo de contrato
          <Dica rotulo="Modelo de contrato" texto="O sistema preenche os campos entre chaves e não escreve nenhuma cláusula. Sem modelo, o colaborador preenche a ficha mas não assina: a assinatura precisa do texto da empresa." />
        </h3>
        <FormField label="Texto do contrato" hint="Use {{campo}} onde o sistema deve preencher.">
          <Textarea value={c.contratoModelo} onChange={(e) => set("contratoModelo", e.target.value)} rows={12}
            data-contrato-modelo className="font-mono text-xs" placeholder="CONTRATO DE TRABALHO&#10;&#10;{{empresa}}, CNPJ {{empresaCnpj}}, admite {{nome}}…" />
        </FormField>
        <div className="flex flex-wrap gap-1.5" data-campos-contrato>
          {CAMPOS_CONTRATO.map((campo) => (
            <code key={campo} className={cn("text-[11px] px-1.5 py-0.5 rounded border",
              c.contratoModelo.includes(`{{${campo}}}`) ? "bg-ok-claro border-ok/30 text-ok-texto" : "bg-surface-alt border-surface-border text-ink-muted")}>
              {`{{${campo}}}`}
            </code>
          ))}
        </div>
        {desconhecidos.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-atencao-texto" data-campos-desconhecidos>
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
            O modelo usa {desconhecidos.map((x) => `{{${x}}}`).join(", ")}, que o sistema não conhece: fica como está no contrato.
          </p>
        )}
      </section>

      {/* Período de experiência e validade do link */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink">Prazos</h3>
        <FormGrid cols={3}>
          <FormField label="Validade do link (dias)" required error={!validadeOk ? MSG_VALIDADE : undefined}>
            <Input type="number" min={VALIDADE_MIN} max={VALIDADE_MAX} value={c.validadeDias}
              onChange={(e) => set("validadeDias", Number(e.target.value))} data-validade-dias />
          </FormField>
          <FormField label="Experiência (dias)" dica="Vai para o contrato em {{experienciaDias}}. Zero = sem período de experiência.">
            <Input type="number" min={0} max={EXPERIENCIA_MAX} value={c.experienciaDias}
              onChange={(e) => set("experienciaDias", Number(e.target.value))} data-experiencia-dias />
          </FormField>
          <FormField label="Prorrogação (dias)" dica="O segundo período, em {{experienciaProrrogacaoDias}} — o clássico 45 + 45.">
            <Input type="number" min={0} max={EXPERIENCIA_MAX} value={c.experienciaProrrogacaoDias}
              onChange={(e) => set("experienciaProrrogacaoDias", Number(e.target.value))} data-experiencia-prorrogacao />
          </FormField>
        </FormGrid>
      </section>

      {/* Orientações finais */}
      <section className="space-y-3">
        <h3 className="text-base font-semibold text-ink flex items-center gap-1.5">
          Orientações finais
          <Dica rotulo="Orientações finais" texto="O que o colaborador lê na última tela do link, depois de assinar: exame admissional, o que levar no primeiro dia, horário, endereço e com quem falar." />
        </h3>
        <FormField label="Texto das orientações" hint="Em branco, a última tela mostra só a confirmação.">
          <Textarea value={c.orientacoes} onChange={(e) => set("orientacoes", e.target.value)} rows={6} data-orientacoes
            placeholder="Exame admissional na Clínica…, rua…, das 8h às 11h. Leve documento com foto." />
        </FormField>
      </section>

      {erro && (
        <p className="flex items-start gap-1.5 text-sm text-atrasado-texto" data-config-erro>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {erro}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="button" onClick={salvar} loading={salvando} disabled={!validadeOk} data-salvar-config>
          Salvar
        </Button>
      </div>
    </div>
  );
}
