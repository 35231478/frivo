import type { ReactNode } from "react";
import { TelaTiposOs } from "./tipos-os";
import { TelaFormularios } from "./formularios";
import { TelaTermos } from "./termos";
import { TelaPrazos } from "./prazos";
import { TelaImpressaoOs } from "./impressao-os";
import { TelaOrcamento } from "./orcamento";
import { TelaTiposEquipamento } from "./tipos-equipamento";
import { TelaServicos } from "./servicos";
import { TelaProdutos } from "./produtos";
import { TelaTabelasPreco } from "./tabelas-preco";
import { TelaCategoriasFinanceiras } from "./categorias-financeiras";
import { TelaCentrosCusto } from "./centros-custo";
import { TelaBancoInter } from "./banco-inter";
import { TelaEmpresa } from "./empresa";
import { TelaUsuarios } from "./usuarios";
import { TelaPerfis } from "./perfis";
import { TelaCargos } from "./cargos";
import { TelaEmail } from "./email";
import { TelaEmailTemplates } from "./email-templates";
import { TelaPortal } from "./portal";
import { TelaQrCode } from "./qr-code";

/**
 * A tela COMPLETA de cada item de Configurações (as mesmas de antes, sem nada capado), pelo id
 * da URL (?secao=…). Abre dentro da gaveta da página de Configurações.
 */
const TELAS: Record<string, () => ReactNode> = {
  "tipos-os": () => <TelaTiposOs />,
  formularios: () => <TelaFormularios />,
  termos: () => <TelaTermos />,
  prazos: () => <TelaPrazos />,
  "impressao-os": () => <TelaImpressaoOs />,
  orcamento: () => <TelaOrcamento />,
  "tipos-equipamento": () => <TelaTiposEquipamento />,
  servicos: () => <TelaServicos />,
  produtos: () => <TelaProdutos />,
  "tabelas-preco": () => <TelaTabelasPreco />,
  "categorias-financeiras": () => <TelaCategoriasFinanceiras />,
  "centros-custo": () => <TelaCentrosCusto />,
  "banco-inter": () => <TelaBancoInter />,
  empresa: () => <TelaEmpresa parte="empresa" />,
  preferencias: () => <TelaEmpresa parte="preferencias" />,
  usuarios: () => <TelaUsuarios />,
  perfis: () => <TelaPerfis />,
  cargos: () => <TelaCargos />,
  email: () => <TelaEmail />,
  "email-templates": () => <TelaEmailTemplates />,
  portal: () => <TelaPortal />,
  "qr-code": () => <TelaQrCode />,
};

export const temTelaConfig = (id: string) => id in TELAS;

export function TelaConfig({ id }: { id: string }) {
  return TELAS[id]?.() ?? null;
}
