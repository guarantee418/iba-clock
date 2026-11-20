// Where the data lives: SharePoint lists on the private "IBA Time Clock" site,
// read and written through Microsoft Graph as the signed-in person. SharePoint's own
// permissions decide what each person can see or change (see README).
// On this Mac, http://localhost:5175/?demo uses made-up data instead (demo.ts).
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser';
import config from './config.json';
import { demoBackend } from './demo';

export type ListName = 'Staff' | 'Locations' | 'Jobs' | 'Punches' | 'Approvals' | 'Settings';
/** A list row: its fields plus SharePoint's own server-side created/modified times. */
export type Row = Record<string, any> & { Key: string; _created: string; _modified: string; _modifiedBy?: string };
/** eq: exact matches; ge/le: text ranges (used for Day = YYYY-MM-DD). */
export type Filter = { eq?: Record<string, string>; ge?: Record<string, string>; le?: Record<string, string> };
export type Backend = {
  me(): Promise<{ name: string; email: string }>;
  rows(list: ListName, filter?: Filter): Promise<Row[]>;
  create(list: ListName, fields: Record<string, unknown> & { Key: string }): Promise<Row>;
  update(list: ListName, key: string, fields: Record<string, unknown>): Promise<void>;
  signOut(): Promise<void>;
};

const SCOPES = ['User.Read', 'Sites.ReadWrite.All'];
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SITE = config.siteId;

const msal = new PublicClientApplication({
  auth: { clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}`, redirectUri: location.origin + '/' },
  cache: { cacheLocation: 'localStorage' },
});

let ready: Promise<AccountInfo | null> | null = null;
function signIn(): Promise<AccountInfo | null> {
  ready ??= (async () => {
    await msal.initialize();
    const res = await msal.handleRedirectPromise();
    const account = res?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0];
    if (!account) { await msal.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }); return null; }
    msal.setActiveAccount(account);
    return account;
  })();
  return ready;
}
const never = <T,>() => new Promise<T>(() => {});

async function token(): Promise<string> {
  const account = await signIn();
  if (!account) return never();
  try {
    return (await msal.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) { await msal.acquireTokenRedirect({ scopes: SCOPES, account }); return never(); }
    throw e;
  }
}

async function graph<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const url = path.startsWith('http') ? path : GRAPH + path;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if ((res.status === 429 || res.status === 503) && attempt < 5) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get('Retry-After') || 2 + attempt * 2) * 1000));
      continue;
    }
    if (res.status === 401 || res.status === 403)
      throw new Error("You don't have access to the time clock yet. Ask Mr. Greene to add you.");
    if (!res.ok) throw new Error(`SharePoint said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (res.status === 204 ? null : await res.json()) as T;
  }
}

let listIds: Promise<Record<string, string>> | null = null;
async function itemsUrl(list: ListName) {
  listIds ??= graph<{ value: { id: string; displayName: string }[] }>('GET', `/sites/${SITE}/lists?$select=id,displayName`)
    .then((d) => Object.fromEntries(d.value.map((l) => [l.displayName, l.id])));
  const id = (await listIds)[list];
  if (!id) throw new Error(`The SharePoint list "${list}" is missing`);
  return `/sites/${SITE}/lists/${id}/items`;
}

const spIds = new Map<string, string>();
type Who = { user?: { email?: string; displayName?: string } };
type Item = { id: string; createdDateTime: string; lastModifiedDateTime: string; lastModifiedBy?: Who; fields: Record<string, any> };
const toRow = (list: ListName, it: Item): Row => {
  spIds.set(`${list}:${it.fields.Key}`, it.id);
  return { ...it.fields, Key: it.fields.Key, _created: it.createdDateTime, _modified: it.lastModifiedDateTime,
    _modifiedBy: it.lastModifiedBy?.user?.email?.toLowerCase() };
};
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

const sharepoint: Backend = {
  async me() {
    const account = await signIn();
    if (!account) return never();
    const p = await graph<{ displayName: string; mail: string | null; userPrincipalName: string }>('GET', '/me?$select=displayName,mail,userPrincipalName');
    return { name: p.displayName, email: (p.userPrincipalName || p.mail || '').toLowerCase() };
  },
  async rows(list, filter) {
    const parts = [
      ...Object.entries(filter?.eq ?? {}).map(([k, v]) => `fields/${k} eq ${q(v)}`),
      ...Object.entries(filter?.ge ?? {}).map(([k, v]) => `fields/${k} ge ${q(v)}`),
      ...Object.entries(filter?.le ?? {}).map(([k, v]) => `fields/${k} le ${q(v)}`),
    ];
    let url: string | undefined = `${await itemsUrl(list)}?$expand=fields&$top=999${parts.length ? `&$filter=${encodeURIComponent(parts.join(' and '))}` : ''}`;
    const out: Row[] = [];
    while (url) {
      const d: { value: Item[]; '@odata.nextLink'?: string } = await graph('GET', url);
      for (const it of d.value) if (it.fields.Key) out.push(toRow(list, it));
      url = d['@odata.nextLink'];
    }
    return out;
  },
  async create(list, fields) {
    return toRow(list, await graph<Item>('POST', `${await itemsUrl(list)}?$expand=fields`, { fields }));
  },
  async update(list, key, fields) {
    let id = spIds.get(`${list}:${key}`);
    if (!id) { await sharepoint.rows(list, { eq: { Key: key } }); id = spIds.get(`${list}:${key}`); }
    if (!id) throw new Error('That record was deleted. Reload the page.');
    await graph('PATCH', `${await itemsUrl(list)}/${id}/fields`, fields);
  },
  async signOut() {
    await msal.logoutRedirect({ postLogoutRedirectUri: location.origin + '/' });
  },
};

const isDemo = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
export const backend: Backend = isDemo ? demoBackend : sharepoint;
