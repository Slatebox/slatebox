// The brief `slatebox agent-prompt` prints, for a coding agent asked to
// install Slatebox for a person. The same text belongs in the docs and llms.txt.
export const AGENT_PROMPT = `# Install Slatebox with an agent

You are installing Slatebox, a self-hosted team canvas, for a person. Use the
\`slatebox\` command from npm. It never prompts when run by an agent; it tells
you what it still needs. Follow these steps exactly.

1. **Ask the person** (do not guess):
   - Where: this computer (Docker), a Linux server over SSH (user@host), or
     Kubernetes (which kube context and namespace). Or only write the files.
   - The address: a domain name for HTTPS, or a port.
   - The admin email (required for a server or a cluster).
   - AI: none for now, or which providers. Slatebox works with any provider and
     has no default: OpenAI, Anthropic, DeepInfra, OpenRouter, Groq, Together,
     Mistral, or any OpenAI-compatible endpoint they run (Ollama, vLLM, LM
     Studio) with its model. Keys are never typed into files or flags: ask the
     person to export each key in an environment variable and give its name.
   - Single sign-on (bundled Keycloak): on or off.
2. **Write an answers file** \`slatebox.yaml\` (no secrets in it):

   \`\`\`yaml
   version: 1
   target: local            # local | ssh | k8s | export
   adminEmail: ops@example.com
   ai:
     mode: providers        # or: none
     providers:
       - { id: openai, kind: openai, model: gpt-5-mini, keyFrom: "env:OPENAI_API_KEY" }
       - { id: local, kind: openai-compatible, baseUrl: "http://ollama.internal:11434/v1", model: "qwen3:8b" }
     default: local
   sso: { enabled: false }
   # ssh:  { host: 203.0.113.5, user: root }        with target: ssh
   # address: { domain: boards.example.com }         for HTTPS on a server or a cluster route
   # k8s:  { context: my-cluster, namespace: slatebox, route: ingress, ingressClass: nginx, tlsIssuer: { kind: ClusterIssuer, name: letsencrypt } }
   \`\`\`
3. **Plan**: \`npx -y slatebox@latest plan --answers slatebox.yaml --json\`.
   It changes nothing. Read the \`plan\` event.
   - Exit 2: fix the fields listed in the \`error\` event.
   - Exit 3: answers are missing; the event lists each \`field\`, its
     \`question\`, \`choices\` and the \`flag\` to answer it. Ask the person.
   - Exit 4: a precondition failed (no Docker, no access, port taken, an
     unknown SSH host key, a missing key encryption key). Tell the person what
     the message says; do not work around it: never add --install-docker or
     --new-encryption-key without asking, never turn off ssh host-key
     checking, and never export SLATEBOX_INSTALL_YES (it is ignored).
4. **Show the plan to the person and get an explicit yes.** It lists every
   file, command, object and port, and where the secrets are kept.
5. **Install**: \`npx -y slatebox@latest install --answers slatebox.yaml --yes --json\`.
   Report \`done.address\` from the last line. Do not print or copy any secret;
   the output never contains one. Tell the person where the key encryption key
   is stored (\`done.secretsFile\`) and that they must back it up themselves.
6. **If it fails**: exit 5 means the change was rolled back and the previous
   state is running; exit 6 means a person must act: show them
   \`error.commands\` and stop.
7. **Later**: \`slatebox status --json\`, \`slatebox upgrade --yes --json\`,
   \`slatebox ai add "kind=...,model=...,key=env:VAR" --yes --json\`,
   \`slatebox backup\`. Never run \`uninstall --delete-data\` unless the person
   asked for their data to be deleted.

Nothing the installer runs sends data anywhere except pulling the image (and,
with consent, installing Docker from get.docker.com, and the certificate
authority when a domain is given).
`
