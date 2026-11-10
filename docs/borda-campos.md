# Borda dos campos de digitação: #CFD5DE (um token só)

Ajuste visual global, sem schema. A identidade define a borda do **campo de digitação** em **#CFD5DE**
(um tom acima da borda do **card**, que continua **#E4E7EC**). Na prática os campos renderizavam com a
mesma borda quase-branca do card; agora saem do quase-branco, sem virar caixa pesada.

## Token único

- `lib/ui/tokens.ts`: novo `neutro.bordaCampo = "#CFD5DE"` (contorno de campo), separado de
  `neutro.borda = "#E4E7EC"` (contorno de card).
- `tailwind.config.ts`: expõe como `surface.campo` → classe **`border-surface-campo`**, reusada em
  todos os componentes de campo.

## Onde foi aplicado

Componentes-base de formulário (a borda padrão passou de `border-surface-border` → `border-surface-campo`):

- Texto: `input`, `textarea` (+ textareas de inativação/aviso), `phone-input`, `whatsapp-input`.
- Seleção: `select`, `busca-select`, `select-cadastro-rapido` (gatilho e campos).
- Data: `input-data`, `input-data-hora`.
- Busca: `CampoBusca` (listagem-ui).
- Campos com addon (CNPJ + Consultar, CEP + buscar) e autocomplete herdam do `input` base.

Mantidos: **raio 8px** (`rounded-lg`), **foco** no acento da marca (`focus:border-acento` / `#0E7490`),
**desabilitado** e **erro/válido** como estavam. **Cards, menus, divisórias e dropdowns continuam
em `#E4E7EC`** — só a superfície de digitação mudou.

## Testes

- `design-system`: `neutro.bordaCampo === "#CFD5DE"`, `surface.campo` mapeado no Tailwind, e o
  `Input` renderiza `border-surface-campo` (não `border-surface-border`); o Card segue em
  `border-surface-border`.
- Ratchet e glossário verdes; suíte completa (PG real) verde.

## Prints

Em `docs/prints/borda-campos/` (desktop e celular, antes e depois) + um recorte lado a lado
(`05-comparacao.png`).
