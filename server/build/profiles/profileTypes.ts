export interface ProfileContext {
  repoFullName: string;
  branch: string;
  localPath: string;
  runId: string;
  logsDir: string;
  screenshotsDir: string;
  devPort?: number;
}

export interface ProfileResult {
  status: 'success' | 'failure';
  screenshotPath?: string;
  buildLogPath: string;
  runtimeLogPath?: string;
  networkLogPath?: string;
  errorMessage?: string;
}

export type ProfileRunner = (ctx: ProfileContext) => Promise<ProfileResult>;

export interface ProfileDefinition {
  name: string;
  displayName: string;
  description: string;
  run: ProfileRunner;
}
