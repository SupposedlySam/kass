import { Link } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import { Check, Copy, FileArchive, FolderOpen, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingSection } from '@/components/ServerTab/SettingRow';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

/** The shipped script the button runs; Terminal or an AI agent can run it too. */
export const REPORT_COMMAND = 'bash /Applications/Kass.app/Contents/Resources/kass-report.sh';

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Reports: zip the logs, crash reports and system info into Downloads, to
 * send when something goes wrong. `kass-report.sh` decides what goes in,
 * so the button and the command make the same zip. Nothing is uploaded.
 */
export function ReportsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      setReport(await invoke<string>('create_report'));
    } catch (error) {
      toast({
        title: t('reports.failed'),
        description: String(error),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const reveal = (path: string) => {
    invoke('reveal_report', { path }).catch((error) =>
      toast({
        title: t('reports.revealFailed'),
        description: String(error),
        variant: 'destructive',
      }),
    );
  };

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(REPORT_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      toast({ title: t('reports.copyFailed'), description: String(error), variant: 'destructive' });
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[760px] px-12 py-7">
        <h1 className="text-lg font-semibold">{t('reports.title')}</h1>
        <p className="mt-1 mb-6 text-[13px] leading-relaxed text-muted-foreground">
          {t('reports.intro')}
        </p>

        <div className="mb-8 flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <Button onClick={create} disabled={creating}>
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileArchive className="size-4" />
              )}
              {creating ? t('reports.creating') : t('reports.create')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('reports.where')}</span>
          </div>
          {report && (
            <div className="flex items-center gap-3 rounded-md bg-muted px-3 py-2">
              <Check className="size-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={report}>
                {fileName(report)}
              </span>
              <Button
                variant="outline"
                className="h-7 px-2.5 text-xs"
                onClick={() => reveal(report)}
              >
                <FolderOpen className="size-3.5" />
                {t('reports.reveal')}
              </Button>
            </div>
          )}
        </div>

        <SettingSection title={t('reports.contents.title')}>
          <ul className="space-y-1.5 py-3.5 text-[13px] leading-relaxed">
            <li>{t('reports.contents.logs')}</li>
            <li>{t('reports.contents.crashes')}</li>
            <li>{t('reports.contents.system')}</li>
          </ul>
        </SettingSection>

        <SettingSection title={t('reports.private.title')}>
          <p className="py-3.5 text-[13px] leading-relaxed text-muted-foreground">
            {t('reports.private.body')}
          </p>
        </SettingSection>

        <SettingSection
          title={t('reports.command.title')}
          description={t('reports.command.description')}
        >
          <div className="my-3 flex items-center gap-2 rounded-md border border-border bg-sidebar py-1.5 pr-1.5 pl-3">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">
              {REPORT_COMMAND}
            </code>
            <Button
              variant="ghost"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={copyCommand}
              aria-label={t('reports.command.copy')}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied ? t('reports.command.copied') : t('reports.command.copy')}
            </Button>
          </div>
        </SettingSection>

        <p className="text-xs text-muted-foreground">
          {t('reports.liveLogsPrefix')}{' '}
          <Link to="/settings/logs" className="text-foreground underline underline-offset-2">
            {t('reports.liveLogs')}
          </Link>
        </p>
      </div>
    </div>
  );
}
