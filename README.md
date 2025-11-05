# Mapa de Horários Acadêmicos

Aplicação front-end simples para construir cronogramas semanais de cursos.

## Como usar

1. Abra o arquivo `index.html` em um navegador moderno (Chrome, Edge, Firefox).
2. Utilize o menu de ícones para abrir o painel de cadastros de períodos, professores, salas, disciplinas ou configurações. Cada painel permite adicionar, buscar, editar e remover itens conforme necessário.
3. Ao cadastrar disciplinas é possível informar um código opcional, que é validado para evitar duplicidade. Cada disciplina recebe automaticamente uma cor que é reaproveitada nas células do cronograma para facilitar a identificação visual.
4. No cadastro de professores você pode, opcionalmente, vincular um docente a uma disciplina. Esse vínculo alimenta as sugestões exibidas no modal de atribuição, mas é totalmente opcional para manter flexibilidade.
5. Selecione a visão desejada (por período, professor ou sala) e escolha o item para visualizar.
6. Clique em um bloco do cronograma para atribuir/editar uma disciplina. Ative a seleção múltipla para marcar vários horários ao mesmo tempo e aplicar a mesma configuração para todos, inclusive substituindo lançamentos existentes quando desejar. As células preenchidas exibem a disciplina com sua cor dedicada e os dias da semana permanecem fixos no topo para facilitar a navegação. Use os botões **Editar seleção** e **Limpar** para confirmar ou desfazer a seleção em lote.
7. O painel de edição sugere professores e salas livres naquele horário, indicando com destaque os docentes vinculados à disciplina escolhida e também valida conflitos ao salvar seleções múltiplas.
8. Utilize a seção **Configurações** para salvar os dados no navegador, exportar um arquivo JSON, importar configurações já existentes ou limpar tudo e começar novamente.

As informações são preservadas automaticamente no armazenamento local do navegador e podem ser exportadas/importadas pela própria interface.

### Persistência de dados

Esta aplicação é totalmente estática e não possui backend. Por isso, os dados permanecem apenas no navegador do usuário (via `localStorage`) ou em arquivos JSON exportados manualmente. Para salvar no servidor é necessário implementar uma API separada que receba e armazene os dados enviados pela interface.
