export type OutlineItemData = {
  line: number
  title: string
  level?: number
  children?: OutlineItemData[]
  from?: number
  to?: number
  // present when this node is a special comment (a user highlight tag) rather
  // than a (sub)section heading
  comment?: { tag: string; color: string; text: string }
}
