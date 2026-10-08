/** Supplier IDs remain unchanged in saved records; only compatibility adapters use aliases. */
export function providerFamily(provider: string): string {
  return ({ moonshot:"kimi",zai:"zhipu",alibaba:"qwen" } as Record<string,string>)[provider] ?? provider
}
