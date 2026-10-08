/** 固定评审维度按名称和重复次数精确匹配；空配置仍只提供参考评价。 */
export function reviewDimensionsMatch(expected: readonly string[], reported: readonly { dimension: string }[]): boolean {
  return !expected.length || JSON.stringify([...expected].sort()) === JSON.stringify(reported.map(row => row.dimension).sort())
}
