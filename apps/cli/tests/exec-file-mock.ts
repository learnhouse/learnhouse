// Since 1.6.0 the docker helpers call execFileSync('docker', [...args]) instead
// of execSync('docker ...'). Tests that script execSync by matching command
// strings route execFileSync through that same mock as one joined string, so
// their existing matchers (and assertions on execSync calls) keep working and
// nothing falls through to a real docker binary.
//
// No imports here: this is loaded from inside vi.mock factories.
export function routeExecFile<T extends { execSync: (...a: any[]) => any }>(mod: T) {
  return {
    ...mod,
    execFileSync: (file: string, args: string[] = [], opts?: unknown) => mod.execSync([file, ...args].join(' '), opts),
  }
}
