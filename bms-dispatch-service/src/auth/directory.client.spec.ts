import { DirectoryClient } from './directory.client';

/** Spec bms/0012: Team Management reads every BMS account from the directory. */
describe('DirectoryClient.roster', () => {
  const person = (id: string) => ({ id, name: id, email: `${id}@example.test`, phone: null, roles: ['HELPER'], isActive: true, deleted: false });
  let fetchMock: jest.SpyInstance;
  let client: DirectoryClient;

  beforeEach(() => {
    client = new DirectoryClient(
      { withToken: (work: (token: string) => unknown) => work('test-token') } as any,
      { internalUrl: 'http://auth' } as any,
    );
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      const body = url.includes('cursor=page2')
        ? { users: [person('b')], next: null, changesCursor: 'c' }
        : { users: [person('a')], next: 'page2', changesCursor: 'c' };
      return new Response(JSON.stringify(body), { status: 200 });
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('reads every page, then reuses the answer for 30 seconds', async () => {
    expect((await client.roster()).map((p) => p.id)).toEqual(['a', 'b']);
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://auth/auth/directory/users?limit=500');
    expect(String(fetchMock.mock.calls[1][0])).toBe('http://auth/auth/directory/users?limit=500&cursor=page2');
    await client.roster();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failed read', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(client.roster()).rejects.toMatchObject({ status: 503 });
    expect((await client.roster()).map((p) => p.id)).toEqual(['a', 'b']);
  });
});
