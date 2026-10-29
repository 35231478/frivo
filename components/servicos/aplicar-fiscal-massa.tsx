"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ComboboxCodigo } from "@/components/ui/combobox-codigo";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { useApoioFiscal } from "@/components/servicos/secao-fiscal-servico";
import { LISTA_LC116 } from "@/lib/nfse/lc116";
import { opcoesCodigoMunicipal } from "@/lib/nfse/busca-codigo";
import { formatarCnae, TRIBUTACOES_ISS } from "@/lib/nfse/servico";
import { formDoModelo, totalCampos, type FormAplicarFiscal, type ModoCnae } from "@/lib/nfse/aplicar-fiscal";

const NAO_ALTERAR = "Não alterar";
const SELECT = "w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15";

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-label={titulo}>
      <h5 className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{titulo}</h5>
      {children}
    </section>
  );
}

/**
 * Formulário do "Aplicar dados fiscais (NFS-e)" em massa: cada campo começa em "Não alterar" (vazio).
 * Dá para copiar tudo de um serviço já configurado (modelo) e ajustar antes de aplicar.
 */
export function FormAplicarFiscalMassa({ valor: f, onChange }: { valor: FormAplicarFiscal; onChange: (f: FormAplicarFiscal) => void }) {
  const apoio = useApoioFiscal();
  const [modelo, setModelo] = useState<{ id: string; nome: string } | null>(null);
  const opcoesMunicipais = useMemo(() => opcoesCodigoMunicipal(apoio?.servicos ?? [], LISTA_LC116), [apoio]);
  const muda = <K extends keyof FormAplicarFiscal>(k: K, v: FormAplicarFiscal[K]) => onChange({ ...f, [k]: v });
  const cnaeEmpresa = apoio?.cnaeEmpresa ? formatarCnae(apoio.cnaeEmpresa) : null;
  const n = totalCampos(f);

  return (
    <div className="space-y-5" data-form-aplicar-fiscal>
      <FormField label="Copiar de um serviço modelo (opcional)" hint={modelo ? `Copiado de “${modelo.nome}”: revise e ajuste antes de aplicar.` : "Preenche tudo com os dados fiscais de um serviço já configurado."}>
        <SeletorCadastro
          entidade="servicos" semCriar valor={modelo?.id ?? ""} placeholder="Escolha um serviço…"
          onChange={(id, item) => {
            if (!id || !item) { setModelo(null); return; }
            setModelo({ id, nome: String(item.nome) });
            onChange(formDoModelo(item));
          }}
        />
      </FormField>

      <Bloco titulo="Classificação do serviço">
        <FormField label="Código do serviço (LC 116)">
          <ComboboxCodigo value={f.codigoLc116} onChange={(v) => muda("codigoLc116", v)} opcoes={LISTA_LC116} placeholder={NAO_ALTERAR} />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <FormField label="Código municipal">
            <ComboboxCodigo value={f.codigoMunicipal} onChange={(v) => muda("codigoMunicipal", v)} opcoes={opcoesMunicipais} placeholder={NAO_ALTERAR} />
          </FormField>
          <div className="flex flex-col gap-1.5" data-campo="cnae">
            <FormField label="CNAE">
              <select value={f.cnaeModo} onChange={(e) => muda("cnaeModo", e.target.value as ModoCnae)} className={SELECT}>
                <option value="manter">{NAO_ALTERAR}</option>
                <option value="empresa">Usar o CNAE principal da empresa{cnaeEmpresa ? ` (${cnaeEmpresa})` : ""}</option>
                <option value="proprio">CNAE próprio…</option>
              </select>
            </FormField>
            {f.cnaeModo === "proprio" && (
              <Input
                value={f.cnae} onChange={(e) => muda("cnae", e.target.value)} placeholder="Ex: 4322-3/02"
                inputMode="numeric" maxLength={12} aria-label="CNAE próprio" autoFocus={!f.cnae}
              />
            )}
          </div>
        </div>
      </Bloco>

      <Bloco titulo="Tributação">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <FormField label="Tributação do ISS">
            <select value={f.nfseTributacao} onChange={(e) => muda("nfseTributacao", e.target.value)} className={SELECT}>
              <option value="">{NAO_ALTERAR}</option>
              {TRIBUTACOES_ISS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </FormField>
          <FormField label="Alíquota de ISS (%)">
            <Input value={f.aliquotaISS} onChange={(e) => muda("aliquotaISS", e.target.value)} placeholder={NAO_ALTERAR} inputMode="decimal" />
          </FormField>
          <FormField label="ISS retido pelo tomador">
            <select value={f.issRetido} onChange={(e) => muda("issRetido", e.target.value as FormAplicarFiscal["issRetido"])} className={SELECT}>
              <option value="">{NAO_ALTERAR}</option>
              <option value="false">Não</option>
              <option value="true">Sim — o tomador retém e recolhe o ISS</option>
            </select>
          </FormField>
        </div>
      </Bloco>

      <Bloco titulo="Discriminação">
        <FormField label="Discriminação padrão">
          <Textarea value={f.discriminacaoPadrao} onChange={(e) => muda("discriminacaoPadrao", e.target.value)} placeholder={NAO_ALTERAR} rows={2} />
        </FormField>
      </Bloco>

      <p className="text-xs text-ink-muted" data-total-campos aria-live="polite">
        {n ? `${n} ${n === 1 ? "campo será aplicado" : "campos serão aplicados"}. Os outros ficam como estão em cada serviço.` : "Preencha ao menos um campo. Campo vazio não muda nada."}
      </p>
    </div>
  );
}
