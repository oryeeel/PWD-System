const numericCollator = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'})

export function comparePwdIds(left,right) {
  const first = String(left ?? '')
  const second = String(right ?? '')
  return numericCollator.compare(first,second) || first.localeCompare(second)
}
