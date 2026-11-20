// Types for the shared modules that attach themselves to globalThis
// (classic scripts, no bundler). `globalThis.X = ...` in each module is
// type-checked against these declarations, so they cannot drift apart.

type Theme = 'system' | 'light' | 'dark';

interface SyncState {
  scrollbarHidden: boolean;
  whitelist: string[];
  theme: Theme;
}

type IconSet = Record<16 | 32 | 48 | 128, string>;

interface ScrollHideConstantsApi {
  BACKUP_FILENAME: string;
  CSS_FILE: string;
  CSS_MARKER: string;
  DEFAULT_SYNC_STATE: SyncState;
  ICONS: { active: IconSet; inactive: IconSet };
  RESTRICTED_PROTOCOLS: string[];
  RESTRICTED_HOSTS: string[];
  RESTRICTED_PATHS: string[];
  THEMES: Theme[];
  OFF_ATTR: string;
  SCRIPT_ID: string;
  STYLE_ID: string;
}

interface PageInfo {
  /** What the popup shows; '' when the URL can't be described */
  label: string;
  /** Hostname that can go on the whitelist; '' for browser pages, files, ... */
  host: string;
  restricted: boolean;
}

interface ScrollHideWhitelistApi {
  applyInFrame(
    hidden: boolean,
    matcher: { exact: string[]; wildcards: string[] },
    names: { offAttr: string; marker: string; legacyStyleId: string },
  ): boolean;
  buildMatcher(whitelist: string[]): { exact: string[]; wildcards: string[] };
  describeUrl(url: string | undefined): PageInfo;
  domainToMatchPatterns(domain: string): string[];
  isRestrictedUrl(url: string | undefined): boolean;
  isWhitelisted(hostnameOrUrl: string, whitelist: string[]): boolean;
  normalizeWhitelist(domains: unknown): string[];
  parseWhitelistFile(text: string): string[] | null;
  sanitizeDomain(raw: unknown): string;
  serializeDomains(domains: string[]): string;
  shouldHideOn(url: string | undefined, state: Pick<SyncState, 'scrollbarHidden' | 'whitelist'>): boolean;
  whitelistToExcludeMatches(whitelist: string[]): string[];
}

interface ScrollHideStorageApi {
  applyTheme(theme: string, target?: Pick<Element, 'setAttribute' | 'removeAttribute'>): void;
  getHideCount(): Promise<number>;
  getSyncState(): Promise<SyncState>;
  normalizeSyncState(raw: unknown): SyncState;
  parseBackup(data: unknown): Partial<SyncState> | null;
  setHideCount(count: number): Promise<void>;
  setSyncValue(value: Partial<SyncState>): Promise<void>;
}

interface ScrollHideI18nApi {
  applyI18n(root?: ParentNode): void;
  getMessage(key: string, substitutions?: string | string[]): string;
}

interface ScrollHideDomApi {
  getElement<T extends Element = HTMLElement>(id: string, type?: new () => T): T;
}

declare var ScrollHideConstants: ScrollHideConstantsApi;
declare var ScrollHideWhitelist: ScrollHideWhitelistApi;
declare var ScrollHideStorage: ScrollHideStorageApi;
declare var ScrollHideI18n: ScrollHideI18nApi;
declare var ScrollHideDom: ScrollHideDomApi;
