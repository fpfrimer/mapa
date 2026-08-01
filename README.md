# Mapa de Horários Acadêmicos

Aplicação web para montar, validar, salvar e imprimir mapas semanais por período, docente ou sala. O projeto usa JavaScript no navegador e um servidor HTTP em Node.js, sem dependências de runtime.

## Documentação

- [Manual do Usuário](docs/manual/manual-usuario.tex): acesso, semestres, cadastros, grade, conflitos e impressão.
- [Manual do Administrador](docs/manual/manual-administrador.tex): implantação Ubuntu/systemd, segurança, usuários, backup, restauração e diagnóstico.
- [Fontes e figuras dos manuais](docs/manual/): documentos A4 em português, identidade UTFPR e capturas Playwright com dados sintéticos.

Os PDFs são compilados pela CI e publicados no artefato `manuais-mapa-horarios`; os binários não são mantidos no histórico Git.

## Requisitos e início rápido

- Node.js 20 ou superior.
- Um segredo JWT com pelo menos 32 caracteres para uso em produção.
- Pelo menos um usuário cadastrado para acessar a biblioteca de semestres.

```bash
npm ci
./scripts/add-user.sh editor 'uma-senha-forte'
JWT_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")" npm start
```

O servidor escuta apenas em `127.0.0.1:3000` por padrão. Acesse `http://127.0.0.1:3000`. Para disponibilizá-lo diretamente na rede interna, configure `HOST=0.0.0.0` e restrinja a porta com firewall; prefira um proxy reverso com HTTPS.

## Segurança e autenticação

Somente os arquivos da interface (`index.html`, CSS, JavaScript e sprites SVG) são publicados. Arquivos em `data/`, scripts administrativos, código do servidor e metadados Git nunca são servidos por HTTP.

Todas as operações de `/api/configurations`, inclusive leitura, exigem `Authorization: Bearer <token>`. Tokens ficam no `sessionStorage` e expiram após uma hora por padrão. O login limita tentativas inválidas por endereço durante uma janela de 15 minutos.

Variáveis de ambiente:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `JWT_SECRET` | temporário apenas em desenvolvimento | Segredo de no mínimo 32 caracteres; obrigatório com `NODE_ENV=production`. |
| `AUTH_TOKEN_TTL_MS` | `3600000` | Duração da sessão em milissegundos. |
| `HOST` | `127.0.0.1` | Endereço em que o servidor escuta. |
| `PORT` | `3000` | Porta HTTP. |
| `MAPA_DATA_DIR` | `./data` | Diretório externo ou local usado para usuários e configurações. |

Não salve `JWT_SECRET` no repositório. O `setup.sh` cria `/etc/mapa-horarios.env` com permissão restrita e referencia esse arquivo no serviço systemd.

## Persistência e migração

O navegador mantém um rascunho no `localStorage`. A biblioteca compartilhada usa:

- `data/configurations.json` para semestres salvos;
- `data/users.json` para usuários e hashes `scrypt`.

Esses arquivos são dados de runtime e não são mais versionados. Uma atualização não os remove do disco; faça backup antes de implantar:

```bash
cp data/configurations.json data/configurations.backup.json
cp data/users.json data/users.backup.json
```

Instalações novas podem partir dos arquivos `data/*.example.json`. As gravações usam arquivo temporário e fila de mutações para evitar JSON parcial. Cada semestre possui `schemaVersion`, `revision`, datas e autores de criação/atualização. Registros antigos recebem esses campos em memória e só são migrados no próximo salvamento.

Atualizações e exclusões usam revisão otimista: o cliente envia `If-Match: "<revision>"`. A ausência da revisão retorna `428`; uma revisão antiga retorna `409` com a revisão e o editor atuais. Na interface, um conflito nunca é sobrescrito automaticamente: é possível recarregar o servidor ou salvar o trabalho local como cópia.

Como hashes e configurações já apareceram no histórico Git, após atualizar a implantação:

1. Troque o `JWT_SECRET` e reinicie o serviço, invalidando sessões antigas.
2. Mantenha uma segunda conta administrativa válida e redefina cada senha com `./scripts/remove-user.sh <usuário>` seguido de `./scripts/add-user.sh <usuário> <nova-senha>`.
3. Revise o acesso ao repositório e aos backups. A reescrita do histórico não faz parte desta mudança e só deve ser feita com coordenação de todos os clones.

## Uso da aplicação

Após o login, crie ou abra um semestre. Os painéis laterais cadastram períodos, docentes, salas e disciplinas. A grade permite atribuição simples ou múltipla, arrastar horários compatíveis e visualizar conflitos e carga prevista.

O modal de impressão aceita a visão atual ou todos os períodos, docentes e salas. “Visualizar” abre o documento sem imprimir; “Imprimir” usa o mesmo documento e chama a caixa de impressão. Os layouts normal e compacto geram uma página por mapa e preservam as cores das disciplinas.

As configurações podem ser salvas no servidor, exportadas para JSON ou importadas novamente. O formato existente permanece compatível, mas entradas excessivamente grandes, profundas, com campos desconhecidos ou chaves perigosas são rejeitadas pela API.

O cabeçalho usa localmente a marca oficial da UTFPR, sem alterações de cor ou proporção, acompanhada por “Campus Toledo” como texto independente. O arquivo `assets/brand/utfpr-logo.png` foi obtido da [página oficial da marca](https://www.utfpr.edu.br/comunicacao/design/marca-da-utfpr). Aplicam-se o [manual de identidade visual](https://www.utfpr.edu.br/comunicacao/design/manual-de-uso-da-identidade-visual-da-utfpr/identidade-visual-utfpr-2016-a4-1.pdf/@@download/file) e as orientações do [Ofício Circular SEI](https://sei.utfpr.edu.br/sei/publicacoes/controlador_publicacoes.php?acao=publicacao_visualizar&id_documento=6226788&id_orgao_publicacao=0).

Os ícones da interface usam exclusivamente [Lucide](https://lucide.dev/) outline, em grade 24×24 e traço de 2 px. Somente os símbolos utilizados são versionados no sprite local `assets/icons/lucide-icons.svg`; não há CDN, webfont ou dependência em runtime. A licença ISC e os avisos dos ícones derivados do Feather estão em `assets/icons/LICENSE-LUCIDE.txt`.

## Administração de usuários

```bash
./scripts/add-user.sh <username> <senha>
./scripts/remove-user.sh <username|id>
```

Ambos aceitam `--file <caminho>`. `add-user.sh` também aceita `--id <valor>`. Restrinja o diretório de dados ao usuário do serviço; o `setup.sh` aplica diretórios `750` e arquivos `640`.

## Desenvolvimento e verificações

```bash
npm ci
npm run lint
npm test
npm run test:e2e
npm run check
```

- `npm test` cobre exposição de arquivos, autenticação, tokens, rate limit, validação e CRUD concorrente.
- `npm run test:e2e` usa Playwright/Chromium para verificar login, edição, conflito, identidade responsiva e pré-visualização de impressão. O CI publica `utfpr-home.png` como artefato.
- `npm run check:icons` verifica referências ausentes, símbolos ociosos, licença e regressões para o sprite antigo.
- `npm run check:sensitive` falha se dados de runtime, segredo padrão ou chaves privadas forem adicionados ao Git.

Em Linux, prepare o navegador local com `npx playwright install --with-deps chromium`. A automação em `.github/workflows/ci.yml` executa qualidade e navegador em jobs separados.

## Manuais em LaTeX

Os fontes dos manuais de usuário e administrador ficam em `docs/manual/`. As telas documentais são geradas pelo Playwright com dados sintéticos e ficam versionadas; os PDFs são artefatos de CI e não são adicionados ao Git.

```bash
npm run docs:figures  # atualiza as capturas da interface
npm run docs:pdf      # compila os dois PDFs com latexmk
npm run docs:check    # valida metadados, figuras e compilação
npm run docs          # regenera figuras e executa a validação completa
```

Para compilar localmente em Ubuntu, instale `latexmk`, `texlive-latex-extra`, `texlive-lang-portuguese` e `texlive-fonts-recommended`. Os resultados são gravados em `docs/manual/build/manual-usuario.pdf` e `docs/manual/build/manual-administrador.pdf`.

## Serviço systemd

Execute `./setup.sh` com um usuário dedicado. O script instala dependências de runtime, protege `data/`, gera `/etc/mapa-horarios.env` quando necessário e instala `mapa-horarios.service`. Use `./stop.sh` para interromper o serviço.

## Licença

Consulte [LICENSE](LICENSE). Os ícones Lucide mantêm seus avisos próprios em [assets/icons/LICENSE-LUCIDE.txt](assets/icons/LICENSE-LUCIDE.txt).
