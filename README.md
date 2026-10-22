# Redator Groq · hub compacto para o console

Hub preto de 284 px para gerar redações a partir do texto de uma página. O painel principal fica no canto inferior direito; as opções abrem no canto oposto e fecham quando você escolhe. Em telas pequenas, o principal reaparece ao concluir a escolha.

Repositório: https://github.com/batataeyurimartins-cloud/Redacao-Maker

Publicação: https://redacao-maker.vercel.app · Script: https://redacao-maker.vercel.app/hub.js

A Groq está integrada por um backend na Vercel: o navegador envia a referência para `/api/generate`, e o servidor chama a Groq. A chave do provedor permanece no servidor.

## Como usar

1. Acesse https://redacao-maker.vercel.app e clique em **Copiar comando**.
2. Abra a página cujo texto deseja usar. Pressione **F12**, entre na aba **Console**, cole o comando e pressione **Enter**. No Mac, use `⌘⌥J` para abrir o console do Chrome.
3. Em **Referência**, revise o texto capturado e clique em **Usar este texto**. Você pode editar manualmente, reler a página ou usar uma seleção.
4. Em **Tipo** e **Extensão**, escolha as opções; o painel auxiliar fecha e atualiza o resumo no hub. Em **Tema**, defina instruções se quiser.
5. Clique em **Gerar redação**. O resultado abre no painel auxiliar; revise, copie ou baixe o `.txt`.

O hub é público, sem login, senha ou código de acesso. Você pode compartilhar o link de instalação e o script. A chave da Groq permanece no servidor e não é solicitada aos visitantes.

Se a página bloquear o carregamento externo pelo comando curto, use **Copiar script completo** na página de instalação e cole todo o código no console. Não desative a segurança do navegador.

**Escape**, o **×** das opções ou um clique fora fecham o painel auxiliar. **−** recolhe o hub; **+** expande. O **×** do hub encerra a sessão e limpa os campos. Reexecutar a mesma versão preserva o rascunho; uma versão nova encerra e substitui a anterior.

## Configuração na Vercel

Cadastre estas variáveis como segredos no projeto, em **Production**, antes da implantação:

| Variável | Valor |
| --- | --- |
| `GROQ_API_KEY` | Chave criada em https://console.groq.com/keys |
| `GROQ_MODEL` | Opcional: `openai/gpt-oss-20b` (padrão) ou `openai/gpt-oss-120b` |

Não coloque esses valores no código ou no GitHub. `.env.example` documenta apenas os nomes, sem credenciais. Mudanças nas variáveis de produção exigem uma nova implantação para afetar o código implantado.

O projeto usa Node.js 24, `npm run build` e o diretório estático `public`. Os endpoints ficam em `api/`. O build copia o script público para `redator-groq.js` e `hub.js` e configura a origem usando `VERCEL_PROJECT_PRODUCTION_URL`, ou `DEPLOYMENT_ORIGIN` quando definido explicitamente.

A proteção de login da Vercel não deve interceptar os endpoints usados pelo console: eles precisam responder ao navegador em qualquer origem. `/api/generate` aceita requisições públicas, sem cabeçalho de autorização. O servidor controla os modelos, o prompt, o tamanho do texto e os limites de geração.

## API

- `GET /api/health`: informa `publicAccess: true` e `configured: true/false`, sem revelar valores. Isso verifica a presença da chave; não confirma sua validade na Groq.
- `POST /api/generate`: recebe `{context, theme, genre, words, instructions, model}` sem credenciais no navegador. Retorna `choices[0].message.content` e `finish_reason`.
- `OPTIONS /api/generate`: permite o preflight CORS, sem executar uma geração.

O servidor limita a referência a 18.000 caracteres, aceita os dois modelos indicados, monta o prompt e usa até 2.800 tokens de saída. O tipo pode ser `dissertativa`, `enem` ou `expositiva`; a extensão aproximada pode ser 250, 350, 500 ou 700 palavras. O servidor espera até 80 segundos pela Groq; o cliente espera até 90 segundos pelo servidor.

Os modelos GPT-OSS são servidos pela própria Groq e usam a chave Groq configurada. A chamada usa raciocínio baixo e retorna somente a redação. Os modelos Llama anteriores foram desativados para contas gratuitas/developer em agosto de 2026.

Há um limite local de 5 solicitações válidas por IP e 30 no total por minuto em cada instância do servidor. Ao atingir o limite, a API responde HTTP 429 e informa o tempo de espera. Os contadores ficam na memória de cada instância: não são um limite distribuído nem uma garantia de orçamento global.

## Captura e privacidade

A captura é local e prefere `main`, depois `article`, e por último o corpo da página. Exclui navegação, cabeçalhos, rodapés, conteúdo oculto, formulários e campos editáveis. Não lê imagens, PDFs, canvas ou documentos de iframes. Revise o texto, porque a organização varia entre páginas.

Só ao gerar, a referência revisada, tema, instruções, tipo, extensão e modelo seguem para seu backend e para a Groq. O script não lê cookies nem inclui a URL ou o título da página na mensagem. Nenhum campo da página é preenchido ou enviado automaticamente.

A chave Groq fica apenas no servidor. Os textos ficam na memória da página, sem `localStorage`, `sessionStorage` ou cookies. Scripts e extensões da página podem observar o conteúdo: use páginas confiáveis. Shadow DOM isola a aparência.

A resposta é exibida como texto simples; HTML retornado pelo modelo não é executado. O prompt instrui o modelo a tratar comandos da referência como dados e evitar fontes inventadas. Revise a redação: modelos podem errar, e o formato ENEM não garante nota.

Cada geração pública consome a cota ou saldo da conta Groq configurada pelo administrador. Não há repetição automática. Cancelar interrompe a espera; a Groq pode já ter processado a chamada. Uma tentativa que falha preserva o resultado anterior.

## Falhas comuns

| Situação | Ação |
| --- | --- |
| HTTP 400 | Confira o modelo permitido, a extensão e o texto de referência. |
| HTTP 429 | Aguarde o prazo informado pela Groq. |
| HTTP 502 com erro de autenticação do provedor | Confira `GROQ_API_KEY` na Vercel e reimplante. |
| HTTP 503 | O administrador precisa configurar `GROQ_API_KEY` e reimplantar. |
| HTTP 504 | A Groq demorou a responder; tente novamente depois. |
| CSP/CORS ou conexão bloqueada pela página | Use outra página confiável que permita a conexão e cole a referência manualmente; não desative a segurança do navegador. |

## Desenvolvimento e verificação

```sh
npm install
npx playwright install chromium
npm run check
npm test
npm run build
```

A suíte contém testes de navegador e backend com credenciais fictícias e respostas simuladas. Ela verifica o hub, a captura, envio, autenticação, erros, limites, cancelamento, privacidade e download. Para usar Chromium do sistema, defina `CHROMIUM_PATH`.

Uma geração real na implantação ainda precisa de uma chave Groq configurada e válida no servidor. O estado de saúde, os testes simulados e a publicação dos arquivos não substituem essa verificação.
