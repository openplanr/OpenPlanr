import type { Command } from 'commander';
import {
  loginCompany,
  logoutCompany,
  storeCompanyManualToken,
} from '../../services/company-auth-service.js';
import {
  applyCompanyProposal,
  type CompanyPreview,
  companyApi,
  companyBindingStatus,
  normalizeCompanyOrigin,
  previewCompanyProposal,
  previewCompanyPublication,
  previewCompanyPull,
  previewCompanyPush,
  publishCompanyPreview,
  pullCompanyBinding,
  pushCompanyBinding,
} from '../../services/company-sync-service.js';

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
function printPublicationPreview(
  result:
    | Awaited<ReturnType<typeof previewCompanyPublication>>
    | Awaited<ReturnType<typeof previewCompanyPush>>,
  json?: boolean,
) {
  if (json || result.preview.sourceType !== 'design-document') return print(result);
  const summary = result.preview.designSummary;
  process.stdout.write(
    [
      'Design publication preview',
      `  ${result.preview.title}`,
      `  ${summary?.screenCount ?? 0} screens · ${summary?.frameCount ?? 0} frames · ${summary?.variantCount ?? 0} variants`,
      `  ${result.preview.byteLength.toLocaleString('en-US')} bytes · ${result.selectedFiles.length} selected files`,
      '',
      ...result.selectedFiles.map((file) => `  ${file}`),
      '',
      result.notice,
      ...('warnings' in result && result.warnings
        ? result.warnings.map((warning: string) => `Notice: ${warning}`)
        : []),
      '',
      result.action === 'company.preview'
        ? `Publish: planr company publish ${result.preview.id}`
        : `Publish update: planr company push ${result.preview.id}`,
      '',
    ].join('\n'),
  );
}
export function registerCompanyCommand(program: Command) {
  const company = program
    .command('company')
    .description('Preview selected artifact publication and review company changes locally');
  const root = () => program.opts().projectDir as string;
  company
    .command('login')
    .requiredOption('--api-url <origin>', 'company API HTTPS origin')
    .option('--no-open', 'print the authorization URL without opening a browser')
    .option('--timeout <seconds>', 'time allowed to complete browser sign-in', '300')
    .option('--json', 'structured result')
    .description('Sign in through the browser with renewable, organization-scoped authorization')
    .action(async (options: { apiUrl: string; open: boolean; timeout: string }) => {
      const timeout = Number(options.timeout);
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600)
        throw new Error('Sign-in timeout must be between 1 and 600 seconds.');
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      try {
        print(
          await loginCompany(options.apiUrl, {
            open: options.open,
            timeoutMs: timeout * 1000,
            signal: controller.signal,
            onAuthorization: (url) => {
              process.stderr.write(`Complete company sign-in on this computer:\n${url}\n`);
            },
          }),
        );
      } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
    });
  company
    .command('logout')
    .requiredOption('--api-url <origin>', 'company API HTTPS origin')
    .option('--local-only', 'forget local sign-in without requesting remote token revocation')
    .option('--json', 'structured result')
    .description('Revoke saved OAuth tokens and remove local company sign-in')
    .action(async (options: { apiUrl: string; localOnly?: boolean }) =>
      print(await logoutCompany(options.apiUrl, { localOnly: options.localOnly })),
    );
  company
    .command('connect')
    .description(
      'Developer fallback: store a manually supplied scoped token without automatic renewal',
    )
    .requiredOption('--api-url <origin>', 'company API HTTPS origin')
    .requiredOption(
      '--token-stdin',
      'read a current scoped session token from stdin, never arguments',
    )
    .option('--json', 'structured output')
    .action(async (options: { apiUrl: string }) => {
      if (process.stdin.isTTY)
        throw new Error(
          'Pipe the scoped session token on stdin; it is never accepted as a command argument.',
        );
      let token = '';
      for await (const chunk of process.stdin) {
        token += chunk;
        if (token.length > 16384) throw new Error('Session token exceeds the supported size.');
      }
      token = token.trim();
      if (!token) throw new Error('A scoped session token is required.');
      const origin = normalizeCompanyOrigin(options.apiUrl);
      await companyApi(origin, '/v1/projects', { token });
      const source = await storeCompanyManualToken(origin, token);
      print({
        ok: true,
        action: 'company.connect',
        apiUrl: origin,
        credentialStorage: source,
        notice: 'Session expiry and revocation are enforced by the company service.',
      });
    });
  company
    .command('projects')
    .requiredOption('--api-url <origin>', 'company API HTTPS origin')
    .option('--json', 'structured output')
    .action(async (options: { apiUrl: string }) =>
      print(await companyApi(options.apiUrl, '/v1/projects')),
    );
  company
    .command('preview')
    .argument(
      '<file>',
      'repository-relative artifact; --kind design bundles an authored design document and its references',
    )
    .requiredOption('--api-url <origin>', 'company API HTTPS origin')
    .requiredOption('--project <id>', 'company project ID')
    .option('--title <title>', 'artifact title')
    .option('--kind <kind>', 'diagram, design, plan, or document', 'document')
    .option('--json', 'structured output')
    .action(
      async (
        filePath: string,
        options: {
          apiUrl: string;
          project: string;
          title?: string;
          kind: CompanyPreview['kind'];
          json?: boolean;
        },
      ) =>
        printPublicationPreview(
          await previewCompanyPublication(root(), {
            filePath,
            apiUrl: options.apiUrl,
            projectId: options.project,
            title: options.title,
            kind: options.kind,
          }),
          options.json,
        ),
    );
  company
    .command('publish')
    .argument('<preview-id>', 'previously reviewed local preview')
    .option('--json', 'structured output')
    .action(async (previewId: string) => print(await publishCompanyPreview(root(), previewId)));
  company
    .command('push')
    .argument('<binding-id>', 'existing publication binding')
    .option(
      '--preview',
      'review the bound file or complete referenced design bundle before publishing',
    )
    .option('--json', 'structured output')
    .description('Preview or explicitly publish an update against the current bound revision')
    .action(async (bindingId: string, options: { preview?: boolean; json?: boolean }) => {
      if (options.preview)
        printPublicationPreview(await previewCompanyPush(root(), bindingId), options.json);
      else print(await pushCompanyBinding(root(), bindingId));
    });
  company
    .command('pull')
    .argument('<binding-id>', 'existing publication binding')
    .option('--preview', 'review a remote revision before retrieving a private copy')
    .option('--revision <id>', 'select a historical immutable revision; requires --preview')
    .option('--json', 'structured output')
    .description(
      'Preview and retrieve remote content for review without changing repository files or the accepted binding',
    )
    .action(async (bindingId: string, options: { preview?: boolean; revision?: string }) => {
      if (options.revision && !options.preview)
        throw new Error(
          'Use --revision with --preview, then run company pull without either option to retrieve the reviewed revision.',
        );
      print(
        options.preview
          ? await previewCompanyPull(root(), bindingId, { revisionId: options.revision })
          : await pullCompanyBinding(root(), bindingId),
      );
    });
  company
    .command('status')
    .argument('<binding-id>', 'publication binding returned by publish')
    .option('--json', 'structured output')
    .action(async (bindingId: string) => print(await companyBindingStatus(root(), bindingId)));
  company
    .command('proposal')
    .argument('<binding-id>')
    .argument('<proposal-id>')
    .description('Preview and validate a semantic proposal without modifying repository content')
    .option('--json', 'structured output')
    .action(async (bindingId: string, proposalId: string) =>
      print(await previewCompanyProposal(root(), bindingId, proposalId)),
    );
  company
    .command('apply')
    .argument('<binding-id>')
    .argument('<proposal-id>')
    .description(
      'Explicitly apply a reviewed semantic proposal against its bound base; keeps a local backup',
    )
    .option('--json', 'structured output')
    .action(async (bindingId: string, proposalId: string) =>
      print(await applyCompanyProposal(root(), bindingId, proposalId)),
    );
}
