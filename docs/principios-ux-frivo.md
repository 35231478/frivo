# Princípios de UX do Frivo

Os seis primeiros princípios estão descritos e medidos na auditoria de UX
(`docs/auditoria-ux-2026-10-22.md`):

1. Criação inline: criar sem sair da tela.
2. CRUD visível conforme a permissão.
3. Feedback sempre.
4. Responsivo de verdade.
5. Escala: busca, filtro e paginação.
6. Consistência entre telas.

A identidade visual (cores, tipografia, componentes-base) está em `docs/design-system.md`.

## Princípio 7: tom profissional, texto curto e ajuda na dica (ⓘ)

O Frivo deve ter cara de software profissional. A tela mostra o essencial; a explicação fica a um
toque, no ícone ⓘ.

### Regras de conteúdo

1. **Rótulo curto na tela, explicação na dica.** Parágrafos de orientação, "como funciona" e regras de
   preenchimento saem da tela e vão para o ⓘ ao lado do rótulo, do título da seção ou do título da
   página.
2. **Sempre visível, nunca na dica:**
   - avisos de segurança e privacidade (o que é enviado, criptografado ou não armazenado);
   - campos fiscais e legais que o contador precisa enxergar, e o significado do valor escolhido (ex.: a
     descrição do código LC 116, o CNAE que vai na nota);
   - mensagens de erro, de estado e de permissão (ex.: "Somente leitura: requer a permissão…",
     pendências, ambiente de homologação).
3. **Tom formal e direto.** Frases curtas, sem gíria, sem exclamação, sem tutorial. Preferir "Em
   branco, …" a "Vazio = …"; "Somente leitura: requer a permissão X" a "Só quem … pode alterar".
4. **Títulos em caixa de frase:** "Dados da empresa", "Tipos de equipamento", não "Dados da Empresa".
5. **Descrição de página com no máximo uma linha curta.** O detalhe vai para a dica do título.
6. **Sem emoji e sem cara de IA.** Nada de "✨", "Ótimo!", "Pronto!" ou tom de conversa.

### Como aplicar no código

Há um componente de dica, e só um: `components/ui/dica.tsx` (`Dica`). Não crie outro tooltip.

| Onde | Como |
|---|---|
| Campo de formulário | `<FormField label="CNAE" dica="…">` |
| Seção de formulário | `<FormSection title="Endereço" dica="…">` |
| Título de card | `<CardTitulo dica="…">Emitente</CardTitulo>` |
| Título da página | `<PageHeader title="…" description="…" dica="…" />` |
| Interruptor | `<ToggleSwitch label="…" dica="…" />` e `<ToggleGroup title="…" dica="…">` |
| Cadastro padrão | prop `ajuda` do `CadastroPadrao` (vira ⓘ ao lado das abas); erros vão em `aviso`, visíveis |
| Campo do registro de cadastros | `ajuda` no `CampoCadastro` (`lib/cadastros/registro.ts`) vira a dica do campo; `descrever` (o que o valor significa) continua visível |
| Qualquer outro lugar | `<Dica texto="…" rotulo="Do que a dica fala" />` |

**Prop `hint` × prop `dica`.** O `hint` (texto sob o campo) fica para mensagens curtas de estado ou
de valor, que precisam ser vistas sem abrir nada. Explicação vai em `dica`.

### Comportamento da dica (acessibilidade)

- Desktop: abre no hover do mouse e fecha ao sair.
- Celular: abre e fecha no toque; toque fora ou rolagem da tela fecham.
- Teclado: abre no foco; Esc fecha; Enter ou Espaço alternam.
- Leitor de tela: o botão se chama "Ajuda: <rótulo>" e é descrito pelo balão (`aria-describedby`,
  `role="tooltip"`). O balão fica no DOM mesmo fechado.
- O balão é renderizado no `body` (portal, posição fixa). Não é cortado por gaveta, modal ou tabela
  com rolagem, abre para cima perto do rodapé e nunca sai da tela.
- Clicar na dica não aciona o que está em volta: não foca o campo, não liga o switch e não clica no card.
- O visual segue `docs/design-system.md`: balão escuro (`bg-ink`), texto branco de 12 px, ícone
  `Info` em `text-ink-subtle`.
